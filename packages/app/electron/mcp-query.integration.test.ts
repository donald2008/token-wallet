/**
 * mcp-query 真 daemon 冒烟(t_eece584f B 部分 — 合并门禁):
 * - 起真 daemon(python -m mcp_server 或打包 exe)→ initialize → tools/call
 * - 端到端断言 session 复用 + 自愈(杀 daemon 重启后 query 自动恢复)
 * - 修真用 fastmcp streamable-http 协议握手(非 mock http shim)
 *
 * 必要性: mock shim 用例证明不了协议握手(fastmcp 真实返 text/event-stream, 真 session 头只
 * 在真 HTTP 上才有);回归门禁必须能在合并前咬住「mcp-query.ts 再次退化为无 session 直接调」的退化。
 *
 * 跑法: 在 packages/app/ 目录 `corepack pnpm vitest run electron/mcp-query.integration.test.ts`
 * 依赖: 本机 python3 + fastmcp(已 `pip install -e packages/mcp-server`)+ uvicorn。
 *
 * 与单测(mcp-query.test.ts)区分: 单测是 fast(纯逻辑 + 状态机 mock), 集成测试是慢(进程 spawn + 真 HTTP)。
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  callMcpTool,
  _resetSessionCache,
  invalidateSession,
  McpCallError,
  type HttpShim,
  type UsageSummaryOutput,
} from "./mcp-query";

// vitest 单文件模式下 __dirname 可能解析为 "."; 用 import.meta.url 推真实文件位置
const HERE = path.dirname(fileURLToPath(import.meta.url));
// 起 daemon 用端口: 19132 避开 9131(防撞真机/兄弟卡残留)
const DAEMON_PORT = 19132;
const DAEMON_KEY = "0123456789abcdef0123456789abcdef";
const DAEMON_HOST = "127.0.0.1";
// 用 which 拿 python3 绝对路径,绕开 vitest pool 的 PATH 不继承
const PYTHON_BIN = (() => {
  try {
    return fs.realpathSync("/usr/local/lib/hermes-agent/venv/bin/python3");
  } catch {
    return "python3";
  }
})();

let daemon: ChildProcess | null = null;
let daemonReady = false;

/** 起 daemon: subprocess env 设 token/port/db_path, 等 /mcp initialize 200 视为就绪 */
async function startDaemon(): Promise<ChildProcess> {
  const dbPath = path.join(os.tmpdir(), `token-wallet-int-${process.pid}-${Date.now()}.db`);
  // 启动前清掉旧文件
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* ignore */
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // t_eece584f: vitest pool 偶尔用 hermes runtime python3.11(无 fastmcp),
    // 强制 PATH 走 venv 路径确保 spawn 到带 fastmcp 的 python;同时显式挂 site-packages
    // PYTHONPATH(避免 PYTHONPATH 被父进程遮蔽, vitest pool 可能 strip env)
    PATH: [
      path.dirname(PYTHON_BIN),
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      process.env.PATH ?? "",
    ].join(path.delimiter),
    // t_eece584f: mcp_server 是 pip editable install 到 packages/mcp-server/src,
    // 不是 site-packages。daemon 端 __main__.py 用 `from . import onboarding` 是相对包,
    // PYTHONPATH 必须指 packages/mcp-server/src 让 mcp_server 包可被 import。
    PYTHONPATH: [
      path.resolve(HERE, "../../mcp-server/src"),
      "/usr/local/lib/hermes-agent/venv/lib/python3.11/site-packages",
    ].join(path.delimiter),
    TOKEN_WALLET_MCP_KEY: DAEMON_KEY,
    TOKEN_WALLET_HOST: DAEMON_HOST,
    TOKEN_WALLET_PORT: String(DAEMON_PORT),
    TOKEN_WALLET_DB_PATH: dbPath,
    USAGE_TTL_DAYS: "90",
  };
  const cwd = path.resolve(HERE, "../../mcp-server");
  const child = spawn(
    PYTHON_BIN,
    ["-m", "mcp_server"],
    { env, cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  child.stdout?.on("data", () => {
    /* swallow */
  });
  // t_eece584f: 失败兜底捕获 stderr(daemon 启动报错时 swallow 信息=完全黑盒),用 errorBuf 在 exit 时一并抛
  let errorBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    errorBuf += chunk.toString("utf-8");
  });
  child.once("exit", (code) => {
    if (code !== null && code !== 0) {
      errorBuf = `[daemon exit code=${code}]\n${errorBuf}`;
    }
  });

  // 等就绪: 探测 /mcp initialize 直到 200 或超时
  const start = Date.now();
  const deadline = 15_000;
  const probeUrl = `http://${DAEMON_HOST}:${DAEMON_PORT}/mcp`;
  while (Date.now() - start < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`daemon exited prematurely (code=${child.exitCode}): ${errorBuf}`);
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1000);
      const resp = await fetch(probeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: "Bearer " + DAEMON_KEY,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {} },
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (resp.status === 200) return child;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  // 超时: 杀进程再抛
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  throw new Error(`daemon not ready within ${deadline}ms on ${probeUrl}`);
}

async function stopDaemon(): Promise<void> {
  if (!daemon) return;
  const d = daemon;
  daemon = null;
  daemonReady = false;
  await new Promise<void>((resolve) => {
    d.once("exit", () => resolve());
    try {
      d.kill("SIGTERM");
    } catch {
      resolve();
      return;
    }
    setTimeout(() => {
      try {
        d.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 3000);
  });
  // 等端口释放(避免下次 start 撞同端口)
  await new Promise((r) => setTimeout(r, 300));
}

/** 通过 defaultHttpShim(真 fetch)走真 daemon — 这就是我们要验的门禁 */
import { defaultHttpShim } from "./mcp-query";
function realHttpShim(): HttpShim {
  return defaultHttpShim();
}

describe("t_eece584f mcp-query 真 daemon 冒烟", () => {
  beforeAll(async () => {
    _resetSessionCache();
    daemon = await startDaemon();
    daemonReady = true;
  }, 30_000);

  afterAll(async () => {
    await stopDaemon();
    _resetSessionCache();
  }, 30_000);

  it("起 daemon → initialize → tools/call 真出数据(空库 → total.calls=0)", async () => {
    expect(daemonReady).toBe(true);
    const r = await callMcpTool<UsageSummaryOutput>(
      { host: DAEMON_HOST, port: DAEMON_PORT, key: DAEMON_KEY },
      { name: "usage_summary", arguments: { group_by: ["agent"] } },
      realHttpShim(),
      { timeoutMs: 8000 },
    );
    expect(r.parsed.total.calls).toBe(0);
    expect(r.parsed.timezone).toBeTruthy();
    expect(r.parsed.generated_at).toBeTruthy();
  });

  it("二次调用: 复用同一 sid(session 缓存命中, 不重发 initialize)", async () => {
    _resetSessionCache();
    // 1st call: 触发 initialize
    await callMcpTool<UsageSummaryOutput>(
      { host: DAEMON_HOST, port: DAEMON_PORT, key: DAEMON_KEY },
      { name: "usage_summary", arguments: { group_by: ["agent"] } },
      realHttpShim(),
      { timeoutMs: 8000 },
    );
    // 抓第二次请求的工具调用 headers(我们没法直接观测 sid, 但通过 spyHttpShim 验)
    let toolsCallCount = 0;
    let initializeCount = 0;
    const spy: HttpShim = {
      postJson: async <T,>(opts: {
        url: string;
        headers: Record<string, string>;
        body: unknown;
        timeoutMs: number;
      }): Promise<{ status: number; body: T; headers: Record<string, string> }> => {
        const method = (opts.body as { method: string }).method;
        if (method === "initialize") initializeCount++;
        if (method === "tools/call") toolsCallCount++;
        // 用真 fetch 转发
        const real = realHttpShim();
        return real.postJson<T>(opts);
      },
    };
    // 二次调用走 spy → 不应再触发 initialize
    await callMcpTool<UsageSummaryOutput>(
      { host: DAEMON_HOST, port: DAEMON_PORT, key: DAEMON_KEY },
      { name: "usage_summary", arguments: { group_by: ["agent"] } },
      spy,
      { timeoutMs: 8000 },
    );
    expect(initializeCount).toBe(0); // 缓存命中, 不重发
    expect(toolsCallCount).toBe(1);
  });

  it("自愈: 杀 daemon 重启 → 显式 invalidateSession → 下次 query 自动恢复拿真数据", async () => {
    // 当前 daemon 还活着, 做一次成功调用预热缓存
    await callMcpTool<UsageSummaryOutput>(
      { host: DAEMON_HOST, port: DAEMON_PORT, key: DAEMON_KEY },
      { name: "usage_summary", arguments: {} },
      realHttpShim(),
      { timeoutMs: 8000 },
    );
    // 杀 daemon
    expect(daemon).not.toBeNull();
    await stopDaemon();
    // 显式失效缓存(模拟"调用方知道 daemon 重启了"或留给自愈机制处理)
    invalidateSession(`http://${DAEMON_HOST}:${DAEMON_PORT}/mcp`);
    // 立即 query 应失败(daemon 还没起来)
    await expect(
      callMcpTool<UsageSummaryOutput>(
        { host: DAEMON_HOST, port: DAEMON_PORT, key: DAEMON_KEY },
        { name: "usage_summary", arguments: {} },
        realHttpShim(),
        { timeoutMs: 2000 },
      ),
    ).rejects.toMatchObject({ kind: "unreachable" });
    // 重启 daemon
    daemon = await startDaemon();
    daemonReady = true;
    // 再次 query 应自愈(走重新 initialize)拿真数据
    const r = await callMcpTool<UsageSummaryOutput>(
      { host: DAEMON_HOST, port: DAEMON_PORT, key: DAEMON_KEY },
      { name: "usage_summary", arguments: { group_by: ["agent"] } },
      realHttpShim(),
      { timeoutMs: 8000 },
    );
    expect(r.parsed.total.calls).toBe(0);
    expect(r.parsed.generated_at).toBeTruthy();
  }, 60_000);

  it("McpCallError.kind 正确归类: 不可达(unreachable)", async () => {
    // 用一个肯定没起的端口
    _resetSessionCache();
    await expect(
      callMcpTool<UsageSummaryOutput>(
        { host: DAEMON_HOST, port: 1, key: DAEMON_KEY },
        { name: "usage_summary", arguments: {} },
        realHttpShim(),
        { timeoutMs: 1500 },
      ),
    ).rejects.toBeInstanceOf(McpCallError);
    await expect(
      callMcpTool<UsageSummaryOutput>(
        { host: DAEMON_HOST, port: 1, key: DAEMON_KEY },
        { name: "usage_summary", arguments: {} },
        realHttpShim(),
        { timeoutMs: 1500 },
      ),
    ).rejects.toMatchObject({ kind: "unreachable" });
  });
});
