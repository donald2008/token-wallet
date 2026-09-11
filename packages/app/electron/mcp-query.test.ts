/**
 * MCP daemon 读数据桥单测(t_9255cb63, t_eece584f session 生命周期):
 * - callMcpTool: 走 HttpShim mock, 校验 envelope/headers/解析/错误归类
 * - callMcpToolFromEnv: 加载 mcp.env + 转发, 端到端(纯函数 + 注入 IO)
 * - t_eece584f: session 生命周期 — initialize 拿 sid、并发首调单飞、自愈重握手
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  callMcpTool,
  callMcpToolFromEnv,
  defaultHttpShim,
  _resetSessionCache,
  invalidateSession,
  McpCallError,
  type HttpShim,
  type JsonRpcResponse,
  type UsageSummaryOutput,
} from "./mcp-query";
import { serializeMcpEnv } from "./mcp-env";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** 简易 mock: 用计数器驱动的"状态机" respond 函数 — 同一 endpoint 按调用次数返不同 body */
function mockHttpStateful(responses: Array<{
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** true = throw 网络错(模拟 ECONNREFUSED) */
  throwNetwork?: boolean;
}>): { shim: HttpShim; captured: Array<{ body: unknown; headers: Record<string, string>; url: string }> } {
  const captured: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
  let i = 0;
  const shim: HttpShim = {
    postJson: <T,>(opts: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
      timeoutMs: number;
    }): Promise<{ status: number; body: T; headers: Record<string, string> }> => {
      captured.push({ body: opts.body, headers: opts.headers, url: opts.url });
      const r = responses[i++] ?? responses[responses.length - 1];
      if (!r) throw new Error("mockHttpStateful: out of responses");
      if (r.throwNetwork) throw new Error("ECONNREFUSED");
      return Promise.resolve({
        status: r.status ?? 200,
        body: (r.body ?? null) as T,
        headers: r.headers ?? {},
      });
    },
  };
  return { shim, captured };
}

function buildJsonRpcOk<T>(parsed: T): {
  status: number;
  body: JsonRpcResponse;
  headers?: Record<string, string>;
} {
  return {
    status: 200,
    body: {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify(parsed) }] },
    },
    headers: {},
  };
}

function buildJsonRpcInitializeOk(sid: string): {
  status: number;
  body: JsonRpcResponse;
  headers: Record<string, string>;
} {
  return {
    status: 200,
    // t_eece584f: initialize 的 result 含 protocolVersion/capabilities, 不需要 content;
    // 测试只关心 body 不为 error + headers 含 sid, 故 cast 成 JsonRpcResponse(展开 content 字段忽略)
    body: {
      jsonrpc: "2.0",
      id: 0,
      result: { content: [] },
    } as unknown as JsonRpcResponse,
    // t_eece584f: session id 经 mcp-session-id header(小写)传递
    headers: { "mcp-session-id": sid, "content-type": "application/json" },
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
  beforeEach(() => {
    _resetSessionCache();
  });
  afterEach(() => {
    _resetSessionCache();
  });

  it("首次调用: 先 initialize(收 mcp-session-id) → 带 sid 调 tools/call, envelope + Bearer header + endpoint", async () => {
    const sid = "abcdef0123456789abcdef0123456789";
    const { shim, captured } = mockHttpStateful([
      // 1st: initialize → 200 + sid
      buildJsonRpcInitializeOk(sid),
      // 2nd: tools/call → 200 + result
      buildJsonRpcOk(fakeSummary),
    ]);
    const r = await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "abcd" },
      { name: "usage_summary", arguments: { group_by: ["agent"] } },
      shim,
    );
    expect(r.parsed).toEqual(fakeSummary);
    expect(captured).toHaveLength(2);

    // 第一次请求: initialize
    const initReq = captured[0]!;
    expect(initReq.url).toBe("http://127.0.0.1:9131/mcp");
    expect(initReq.headers.Authorization).toBe("Bearer abcd");
    expect(initReq.headers.Accept).toBe("application/json, text/event-stream");
    expect(initReq.headers["mcp-session-id"]).toBeUndefined();
    const initBody = initReq.body as { jsonrpc: string; id: number; method: string };
    expect(initBody.jsonrpc).toBe("2.0");
    expect(initBody.method).toBe("initialize");

    // 第二次请求: tools/call(带 sid)
    const callReq = captured[1]!;
    expect(callReq.url).toBe("http://127.0.0.1:9131/mcp");
    expect(callReq.headers.Authorization).toBe("Bearer abcd");
    expect(callReq.headers.Accept).toBe("application/json, text/event-stream");
    expect(callReq.headers["mcp-session-id"]).toBe(sid);
    const callBody = callReq.body as {
      jsonrpc: string;
      id: number;
      method: string;
      params: { name: string; arguments: unknown };
    };
    expect(callBody.jsonrpc).toBe("2.0");
    expect(callBody.method).toBe("tools/call");
    expect(callBody.params.name).toBe("usage_summary");
    expect(callBody.params.arguments).toEqual({ group_by: ["agent"] });
  });

  it("解析 result.content[0].text 的 JSON 字符串", async () => {
    const sid = "deadbeefdeadbeefdeadbeefdeadbeef";
    const { shim } = mockHttpStateful([
      buildJsonRpcInitializeOk(sid),
      buildJsonRpcOk(fakeSummary),
    ]);
    const r = await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    expect(r.parsed.rows[0]?.group).toBe("njbx02");
    expect(r.parsed.total.cost_total).toBe(1.23);
  });

  it("401/403 → McpCallError kind=unauthorized", async () => {
    // initialize 阶段就 401 → 走 unauthorized 路径
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
    const sid = "0123456789abcdef0123456789abcdef";
    const { shim } = mockHttpStateful([
      buildJsonRpcInitializeOk(sid),
      {
        status: 200,
        body: buildJsonRpcError(-32601, "method not found"),
      },
    ]);
    await expect(
      callMcpTool(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "wrong_tool", arguments: {} },
        shim,
      ),
    ).rejects.toMatchObject({ kind: "protocol_error" });
  });

  it("result.content[0].text 不是 JSON → kind=protocol_error", async () => {
    const sid = "0123456789abcdef0123456789abcdef";
    const bad: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "not json" }] },
    };
    const { shim } = mockHttpStateful([
      buildJsonRpcInitializeOk(sid),
      { status: 200, body: bad },
    ]);
    await expect(
      callMcpTool(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
    ).rejects.toMatchObject({ kind: "protocol_error" });
  });

  it("result 缺 content 字段 → kind=protocol_error", async () => {
    const sid = "0123456789abcdef0123456789abcdef";
    const bad: JsonRpcResponse = { jsonrpc: "2.0", id: 1 };
    const { shim } = mockHttpStateful([
      buildJsonRpcInitializeOk(sid),
      { status: 200, body: bad },
    ]);
    await expect(
      callMcpTool(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
    ).rejects.toMatchObject({ kind: "protocol_error" });
  });
});

// ============== t_eece584f: session 生命周期专项 ==============

describe("t_eece584f session 生命周期", () => {
  beforeEach(() => {
    _resetSessionCache();
  });
  afterEach(() => {
    _resetSessionCache();
  });

  it("同一 endpoint 多次调用: initialize 只发一次, sid 复用", async () => {
    const sid = "aabbccddeeffaabbccddeeffaabbccdd";
    // 3 次调用: 第 1 次需要 initialize + tools/call, 后 2 次只需 tools/call
    // 共 4 次 postJson 调用
    const { shim, captured } = mockHttpStateful([
      buildJsonRpcInitializeOk(sid),
      buildJsonRpcOk(fakeSummary),
      buildJsonRpcOk(fakeSummary),
      buildJsonRpcOk(fakeSummary),
    ]);
    await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    expect(captured).toHaveLength(4);
    // 仅第 1 个是 initialize
    expect((captured[0]!.body as { method: string }).method).toBe("initialize");
    expect((captured[1]!.body as { method: string }).method).toBe("tools/call");
    expect((captured[2]!.body as { method: string }).method).toBe("tools/call");
    expect((captured[3]!.body as { method: string }).method).toBe("tools/call");
    // 后 3 次都带同一个 sid
    expect(captured[1]!.headers["mcp-session-id"]).toBe(sid);
    expect(captured[2]!.headers["mcp-session-id"]).toBe(sid);
    expect(captured[3]!.headers["mcp-session-id"]).toBe(sid);
  });

  it("并发首调: 多个 callMcpTool 同时启动, initialize 只发一次(single-flight)", async () => {
    const sid = "11223344556677889900aabbccddeeff";
    // 用延迟响应模拟 initialize 在飞 — 多个并发 call 触发同一个 initialize
    let initInflight = 0;
    let initResolved = 0;
    const captured: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
    const shim: HttpShim = {
      postJson: <T,>(opts: {
        url: string;
        headers: Record<string, string>;
        body: unknown;
        timeoutMs: number;
      }): Promise<{ status: number; body: T; headers: Record<string, string> }> => {
        captured.push({ body: opts.body, headers: opts.headers, url: opts.url });
        const method = (opts.body as { method: string }).method;
        if (method === "initialize") {
          initInflight++;
          return new Promise((resolve) => {
            setTimeout(() => {
              initResolved++;
              resolve({
                status: 200,
                body: {
                  jsonrpc: "2.0",
                  id: 0,
                  result: { protocolVersion: "2025-03-26" },
                } as T,
                headers: { "mcp-session-id": sid },
              });
            }, 20);
          });
        }
        // tools/call 同步返
        return Promise.resolve({
          status: 200,
          body: buildJsonRpcOk(fakeSummary).body as T,
          headers: {},
        });
      },
    };
    // 5 个并发调用
    const results = await Promise.all([
      callMcpTool<UsageSummaryOutput>(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
      callMcpTool<UsageSummaryOutput>(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
      callMcpTool<UsageSummaryOutput>(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
      callMcpTool<UsageSummaryOutput>(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
      callMcpTool<UsageSummaryOutput>(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
    ]);
    expect(results).toHaveLength(5);
    // initialize 只触发 1 次(inflight 计数 + resolved 计数)
    expect(initInflight).toBe(1);
    expect(initResolved).toBe(1);
    // captured: 1 initialize + 5 tools/call
    expect(captured).toHaveLength(6);
    expect((captured[0]!.body as { method: string }).method).toBe("initialize");
    for (let i = 1; i <= 5; i++) {
      expect((captured[i]!.body as { method: string }).method).toBe("tools/call");
      expect(captured[i]!.headers["mcp-session-id"]).toBe(sid);
    }
  });

  it("自愈: -32600 Missing session ID → 失效缓存, 重握手, 重试原请求, 拿新 sid 返回数据", async () => {
    const oldSid = "old-session-id-old-session-id-old-s";
    const newSid = "new-session-id-new-session-id-new-s";
    const { shim, captured } = mockHttpStateful([
      // 1: initialize → 旧 sid
      buildJsonRpcInitializeOk(oldSid),
      // 2: tools/call → 拿旧 sid, 但 daemon 端过期 → -32600 Missing session ID
      { status: 200, body: buildJsonRpcError(-32600, "Bad Request: Missing session ID") },
      // 3: 自愈后重新 initialize → 新 sid
      buildJsonRpcInitializeOk(newSid),
      // 4: 重试 tools/call → 用新 sid → 200 + data
      buildJsonRpcOk(fakeSummary),
    ]);
    const r = await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    expect(r.parsed.total.cost_total).toBe(1.23);
    expect(captured).toHaveLength(4);
    expect((captured[1]!.body as { method: string }).method).toBe("tools/call");
    expect(captured[1]!.headers["mcp-session-id"]).toBe(oldSid);
    expect((captured[2]!.body as { method: string }).method).toBe("initialize");
    expect((captured[3]!.body as { method: string }).method).toBe("tools/call");
    expect(captured[3]!.headers["mcp-session-id"]).toBe(newSid);
  });

  it("自愈: -32600 Session not found → 同上(daemon 重启场景)", async () => {
    const oldSid = "old-restart-old-restart-old-restart";
    const newSid = "new-restart-new-restart-new-restart";
    const { shim, captured } = mockHttpStateful([
      buildJsonRpcInitializeOk(oldSid),
      { status: 200, body: buildJsonRpcError(-32600, "Session not found") },
      buildJsonRpcInitializeOk(newSid),
      buildJsonRpcOk(fakeSummary),
    ]);
    const r = await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    expect(r.parsed.rows[0]?.group).toBe("njbx02");
    expect(captured).toHaveLength(4);
    expect(captured[3]!.headers["mcp-session-id"]).toBe(newSid);
  });

  it("自愈只触发一次: 重握手后 tools/call 仍报 -32600 → 不再重试, 直接 protocol_error", async () => {
    const oldSid = "aaaaaaaaaaaaaa";
    const newSid = "bbbbbbbbbbbbbb";
    const { shim, captured } = mockHttpStateful([
      buildJsonRpcInitializeOk(oldSid),
      // tools/call 用旧 sid → Missing session ID
      { status: 200, body: buildJsonRpcError(-32600, "Bad Request: Missing session ID") },
      // 自愈 initialize → 新 sid
      buildJsonRpcInitializeOk(newSid),
      // 重试 tools/call → daemon 端仍报错
      { status: 200, body: buildJsonRpcError(-32601, "method not found") },
    ]);
    await expect(
      callMcpTool<UsageSummaryOutput>(
        { host: "127.0.0.1", port: 9131, key: "k" },
        { name: "usage_summary", arguments: {} },
        shim,
      ),
    ).rejects.toMatchObject({ kind: "protocol_error" });
    // 共 4 次: 1 init + 1 tools/call(失败) + 1 init + 1 tools/call(失败但不再重试)
    expect(captured).toHaveLength(4);
    expect((captured[3]!.body as { method: string }).method).toBe("tools/call");
    expect(captured[3]!.headers["mcp-session-id"]).toBe(newSid);
  });

  it("invalidateSession: 显式失效后下次调用重新 initialize", async () => {
    const sid1 = "11111111111111111111111111111111";
    const sid2 = "22222222222222222222222222222222";
    const endpoint = "http://127.0.0.1:9131/mcp";
    const { shim, captured } = mockHttpStateful([
      buildJsonRpcInitializeOk(sid1),
      buildJsonRpcOk(fakeSummary),
      buildJsonRpcInitializeOk(sid2),
      buildJsonRpcOk(fakeSummary),
    ]);
    await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    // 显式失效(模拟 daemon 重启等场景由调用方主动告知)
    invalidateSession(endpoint);
    await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    expect(captured).toHaveLength(4);
    expect((captured[0]!.body as { method: string }).method).toBe("initialize");
    expect((captured[1]!.body as { method: string }).method).toBe("tools/call");
    expect((captured[2]!.body as { method: string }).method).toBe("initialize");
    expect((captured[3]!.body as { method: string }).method).toBe("tools/call");
    expect(captured[1]!.headers["mcp-session-id"]).toBe(sid1);
    expect(captured[3]!.headers["mcp-session-id"]).toBe(sid2);
  });

  it("不同 endpoint 的 session 独立缓存(端口不同)", async () => {
    const sid9131 = "99999999999999999999999999999991";
    const sid9132 = "99999999999999999999999999999992";
    const { shim, captured } = mockHttpStateful([
      buildJsonRpcInitializeOk(sid9131),
      buildJsonRpcOk(fakeSummary),
      buildJsonRpcInitializeOk(sid9132),
      buildJsonRpcOk(fakeSummary),
    ]);
    await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9131, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    await callMcpTool<UsageSummaryOutput>(
      { host: "127.0.0.1", port: 9132, key: "k" },
      { name: "usage_summary", arguments: {} },
      shim,
    );
    expect(captured).toHaveLength(4);
    expect(captured[0]!.url).toBe("http://127.0.0.1:9131/mcp");
    expect(captured[2]!.url).toBe("http://127.0.0.1:9132/mcp");
    expect(captured[1]!.headers["mcp-session-id"]).toBe(sid9131);
    expect(captured[3]!.headers["mcp-session-id"]).toBe(sid9132);
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

  beforeEach(() => {
    _resetSessionCache();
  });
  afterEach(() => {
    _resetSessionCache();
  });

  it("读 mcp.env 的 host/port/key + 转发 + initialize → tools/call 带 sid", async () => {
    const sid = "envtestenvtestenvtestenvtestenvte";
    const { shim, captured } = mockHttpStateful([
      buildJsonRpcInitializeOk(sid),
      buildJsonRpcOk(fakeSummary),
    ]);
    const r = await callMcpToolFromEnv<UsageSummaryOutput>(
      configDir,
      { name: "usage_summary", arguments: { group_by: ["agent"] } },
      shim,
    );
    expect(r.parsed.total.cost_total).toBe(1.23);
    expect(captured[0]!.url).toBe("http://10.200.1.110:9131/mcp");
    expect(captured[0]!.headers.Authorization).toBe("Bearer 00112233445566778899aabbccddeeff");
    expect((captured[0]!.body as { method: string }).method).toBe("initialize");
    expect(captured[1]!.url).toBe("http://10.200.1.110:9131/mcp");
    expect(captured[1]!.headers["mcp-session-id"]).toBe(sid);
    expect((captured[1]!.body as { method: string }).method).toBe("tools/call");
  });

  it("defaultHttpShim 类型契约: HttpShim 接口匹配", () => {
    const shim = defaultHttpShim();
    // 仅类型契约校验 — 真 fetch 在 node vitest 不跑, 默认实现只在浏览器/dev server 生效
    expect(typeof shim.postJson).toBe("function");
  });

  it("U6 回归: mcp.env HOST=0.0.0.0(通配 bind) → 连接打 127.0.0.1, 不打 0.0.0.0", async () => {
    // 独立 configDir: HOST 通配 bind 场景
    const dir2 = path.join(tmpRoot, "wildcard");
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(
      path.join(dir2, "mcp.env"),
      serializeMcpEnv({
        TOKEN_WALLET_MCP_KEY: "00112233445566778899aabbccddeeff",
        TOKEN_WALLET_PORT: 9131,
        TOKEN_WALLET_HOST: "0.0.0.0",
        TOKEN_WALLET_DB_PATH: "/tmp/daemon.db",
        USAGE_TTL_DAYS: 90,
      }),
    );
    const sid = "wildcardsidwildcardsidwildcardsidw";
    const { shim, captured } = mockHttpStateful([
      buildJsonRpcInitializeOk(sid),
      buildJsonRpcOk(fakeSummary),
    ]);
    await callMcpToolFromEnv<UsageSummaryOutput>(
      dir2,
      { name: "usage_summary", arguments: {} },
      shim,
    );
    expect(captured).toHaveLength(2);
    expect(captured[0]!.url).toBe("http://127.0.0.1:9131/mcp");
    expect((captured[0]!.body as { method: string }).method).toBe("initialize");
    expect(captured[1]!.url).toBe("http://127.0.0.1:9131/mcp");
    expect((captured[1]!.body as { method: string }).method).toBe("tools/call");
    expect(captured[1]!.headers["mcp-session-id"]).toBe(sid);
  });
});
