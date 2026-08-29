/**
 * E2 主进程 http_get_json 单测(node vitest) — 语义对齐换壳前 Rust http_get_json
 * (5c50f47 lib.rs) 与 renderer 端 ipc.ts httpGetJson(P0-8 纪律: 不动 renderer 可见语义):
 *
 * 1. 正常 2xx+JSON → { status, body } 原样(且出口脱敏)
 * 2. 超时 → 抛错(消息含"超时", AbortController 硬切断)
 * 3. 非 2xx → 不抛, { status, body } 原样(分类责任在引擎层, 与 Rust 版逐字一致)
 * 4. 非法 JSON 体 → 不抛(主进程不解析, 引擎层 resp.json()/JSONPath 负责报错)
 * 5. 网络错误 → 抛错(消息脱敏)
 * 6. IPC 载荷防御: url/headers/timeoutMs 类型非法 → HttpArgError fail-fast
 *
 * stub HTTP server = node:http 真端口(验收要求: 集成测试起本地 stub server)。
 */
import { describe, it, expect, afterAll } from "vitest";
import * as http from "node:http";
import { hostHttpGetJson, HttpArgError } from "./host-http";

/** 本地 stub server: /ok /timeout /error-500 /badjson 四条路径 + 网络不可达用例 */
const server = http.createServer((req, res) => {
  if (req.url === "/ok") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ is_available: true, total_balance: "448.45" }));
    return;
  }
  if (req.url === "/timeout") {
    // 挂住不响应, 由客户端 AbortController 超时切断
    return;
  }
  if (req.url === "/error-500") {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("internal error key=sk-abcdef123456");
    return;
  }
  if (req.url === "/badjson") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{ not valid json");
    return;
  }
  res.writeHead(404);
  res.end();
});

/** 随机端口起服(并行安全), 测试结束关闭 */
const listening = new Promise<void>((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve());
});
afterAll(() => {
  server.close();
});

async function base(): Promise<string> {
  await listening;
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("stub server 未监听");
  return `http://127.0.0.1:${addr.port}`;
}

describe("hostHttpGetJson(主进程 http_get_json)", () => {
  it("正常 2xx+JSON → { status:200, body 原样 }", async () => {
    const resp = await hostHttpGetJson({
      url: `${await base()}/ok`,
      headers: { Authorization: "Bearer test-token" },
      timeoutMs: 5_000,
    });
    expect(resp.status).toBe(200);
    expect(JSON.parse(resp.body)).toEqual({ is_available: true, total_balance: "448.45" });
  });

  it("2xx 响应体里的密钥形态统一出口脱敏(D-029)", async () => {
    const resp = await hostHttpGetJson({
      url: `${await base()}/error-500`,
      headers: {},
      timeoutMs: 5_000,
    });
    expect(resp.status).toBe(500);
    expect(resp.body).toContain("sk-***");
    expect(resp.body).not.toContain("sk-abcdef");
  });

  it("非 2xx 不抛 → { status, body } 原样(引擎层负责分类, 换壳前后语义一致)", async () => {
    const resp = await hostHttpGetJson({
      url: `${await base()}/error-500`,
      headers: {},
      timeoutMs: 5_000,
    });
    expect(resp.status).toBe(500);
    expect(resp.body).toContain("internal error");
  });

  it("超时 → 抛错且消息含超时(AbortController 硬切断)", async () => {
    await expect(
      hostHttpGetJson({ url: `${await base()}/timeout`, headers: {}, timeoutMs: 300 }),
    ).rejects.toThrow(/超时/);
  });

  it("非法 JSON 体 → 不抛(主进程不解析, 引擎层报错 — renderer 语义零变化)", async () => {
    const resp = await hostHttpGetJson({
      url: `${await base()}/badjson`,
      headers: {},
      timeoutMs: 5_000,
    });
    expect(resp.status).toBe(200);
    expect(resp.body).toBe("{ not valid json");
  });

  it("网络错误(端口不可达) → 抛错且消息脱敏", async () => {
    // 127.0.0.1:1 → ECONNREFUSED, 不会真连出去
    await expect(
      hostHttpGetJson({
        url: "http://127.0.0.1:1/never",
        headers: { Authorization: "Bearer sk-secret-token-xyz" },
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/网络错误/);
  });

  it("IPC 载荷防御: url/timeoutMs 非法 → HttpArgError fail-fast(不发请求)", async () => {
    await expect(
      hostHttpGetJson({ url: "", headers: {}, timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(HttpArgError);
    await expect(
      hostHttpGetJson({ url: `${await base()}/ok`, headers: {}, timeoutMs: 0 }),
    ).rejects.toBeInstanceOf(HttpArgError);
    await expect(
      // headers 传数组(故意错型, 模拟跨壳契约破坏): HttpGetJsonArgs.headers=unknown, 需 as 断言
      hostHttpGetJson({ url: `${await base()}/ok`, headers: [] as unknown, timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(HttpArgError);
  });
});
