/**
 * MCP daemon 读数据桥单测(t_9255cb63):
 * - callMcpTool: 走 HttpShim mock, 校验 envelope/headers/解析/错误归类
 * - callMcpToolFromEnv: 加载 mcp.env + 转发, 端到端(纯函数 + 注入 IO)
 */
import { describe, expect, it } from "vitest";
import {
  callMcpTool,
  callMcpToolFromEnv,
  defaultHttpShim,
  McpCallError,
  type HttpShim,
  type JsonRpcResponse,
  type UsageSummaryOutput,
} from "./mcp-query";
import { serializeMcpEnv } from "./mcp-env";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** 简易 mock: 把请求参数存到 captured, 返回预置 body */
function mockHttp(respond: (req: { body: unknown; headers: Record<string, string>; url: string }) => {
  status: number;
  body: unknown;
}): { shim: HttpShim; captured: Array<{ body: unknown; headers: Record<string, string>; url: string }> } {
  const captured: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
  return {
    captured,
    shim: {
      postJson: async ({ url, headers, body }) => {
        captured.push({ body, headers, url });
        return respond({ body, headers, url });
      },
    },
  };
}

function buildJsonRpcOk<T>(parsed: T): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(parsed) }] },
  };
}

function buildJsonRpcError(code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: 1,
    error: { code, message },
  };
}

const fakeSummary: UsageSummaryOutput = {
  window: { since: "2026-09-09T00:00:00+08:00", until: "2026-09-09T23:59:59+08:00" },
  timezone: "Asia/Shanghai",
  generated_at: "2026-09-09T12:00:00+08:00",
  rows: [
    {
      group: "njbx02",
      calls: 100,
      input_cache_hit_tokens: 50000,
      input_cache_miss_tokens: 10000,
      output_tokens: 4000,
      cost_total: 1.23,
      currency: "USD",
      by_status: { completed: 95, partial: 5, unknown: 0 },
    },
  ],
  total: {
    calls: 100,
    input_cache_hit_tokens: 50000,
    input_cache_miss_tokens: 10000,
    output_tokens: 4000,
    cost_total: 1.23,
    currency: "USD",
    by_status: { completed: 95, partial: 5, unknown: 0 },
  },
};

describe("callMcpTool", () => {
  it("构造正确的 JSON-RPC envelope + Bearer header + endpoint", async () => {
    const { shim, captured } = mockHttp(({ body }) => ({
      status: 200,
      body: buildJsonRpcOk(fakeSummary),
    }));
    const r = await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "abcd" },
      { name: "usage_summary", arguments: { group_by: ["agent"] } },
      shim,
    );
    expect(r.parsed).toEqual(fakeSummary);
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe("http://127.0.0.1:9131/mcp");
    expect(req.headers.Authorization).toBe("Bearer abcd");
    expect(req.headers.Accept).toBe("application/json, text/event-stream");
    const body = req.body as { jsonrpc: string; id: number; method: string; params: { name: string; arguments: unknown } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("usage_summary");
    expect(body.params.arguments).toEqual({ group_by: ["agent"] });
  });

  it("解析 result.content[0].text 的 JSON 字符串", async () => {
    const { shim } = mockHttp(() => ({ status: 200, body: buildJsonRpcOk(fakeSummary) }));
    const r = await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    expect(r.parsed.rows[0]?.group).toBe("njbx02");
    expect(r.parsed.total.cost_total).toBe(1.23);
  });

  it("401/403 → McpCallError kind=unauthorized", async () => {
    const shim: HttpShim = {
      postJson: async () => {
        throw new Error("mcp http status 401");
      },
    };
    await expect(
      callMcpTool(
        { host: "127.0.0.1", port: 9131, key: "wrong" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("网络失败/超时 → McpCallError kind=unreachable", async () => {
    const shim: HttpShim = {
      postJson: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    };
    await expect(
      callMcpTool(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
    ).rejects.toBeInstanceOf(McpCallError);
    await expect(
      callMcpTool(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
    ).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("JSON-RPC 协议层错误 → kind=protocol_error 带 code+message", async () => {
    const { shim } = mockHttp(() => ({ status: 200, body: buildJsonRpcError(-32601, "method not found") }));
    await expect(
      callMcpTool(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "wrong_tool", arguments: {} },
        shim,
      ),
    ).rejects.toMatchObject({ kind: "protocol_error" });
  });

  it("result.content[0].text 不是 JSON → kind=protocol_error", async () => {
    const bad: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "not json" }] },
    };
    const { shim } = mockHttp(() => ({ status: 200, body: bad }));
    await expect(
      callMcpTool(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
    ).rejects.toMatchObject({ kind: "protocol_error" });
  });
});

describe("callMcpToolFromEnv", () => {
  // 临时目录 + 写 mcp.env, 测从 env 加载 + 转发
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-query-test-"));
  const configDir = path.join(tmpRoot, "token-wallet");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "mcp.env"),
    serializeMcpEnv({
      TOKEN_WALLET_MCP_KEY: "00112233445566778899aabbccddeeff",
      TOKEN_WALLET_PORT: 9131,
      TOKEN_WALLET_HOST: "10.200.1.110",
      TOKEN_WALLET_DB_PATH: "/tmp/daemon.db",
      USAGE_TTL_DAYS: 90,
    }),
  );

  it("读 mcp.env 的 host/port/key + 转发", async () => {
    const { shim, captured } = mockHttp(() => ({ status: 200, body: buildJsonRpcOk(fakeSummary) }));
    const r = await callMcpToolFromEnv<UsageSummaryOutput>(
      configDir,
      { name: "usage_summary", arguments: { group_by: ["agent"] } },
      shim,
    );
    expect(r.parsed.total.cost_total).toBe(1.23);
    expect(captured[0]?.url).toBe("http://10.200.1.110:9131/mcp");
    expect(captured[0]?.headers.Authorization).toBe("Bearer 00112233445566778899aabbccddeeff");
  });

  it("defaultHttpShim 类型契约: HttpShim 接口匹配", () => {
    const shim = defaultHttpShim();
    // 仅类型契约校验 — 真 fetch 在 node vitest 不跑, 默认实现只在浏览器/dev server 生效
    expect(typeof shim.postJson).toBe("function");
  });
});
