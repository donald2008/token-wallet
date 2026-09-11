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
// t_eece584f round-2: 探测 python3 + mcp_server 包路径, 不硬编码 hermes venv
// (老路径在 home-computer / desktop-e5jupfs 上不存在, CI matrix 必挂)。
// 探测策略: 先 spawn python3 看 venv 是否可用; 不行用 PATH 探测; 不行 try
// PYTHON_BIN env 覆盖。
function detectPythonBin(): string {
  const candidates = [
    process.env.PYTHON_BIN,
    "/usr/local/lib/hermes-agent/venv/bin/python3",
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "python3",
  ].filter((x): x is string => Boolean(x));
  for (const c of candidates) {
    if (c.startsWith("/")) {
      try {
        if (fs.existsSync(c)) return c;
      } catch {
        /* ignore */
      }
    } else {
      // 非绝对路径 — 留给 spawn 用 PATH 解析
      return c;
    }
  }
  return "python3";
}
const PYTHON_BIN = detectPythonBin();
// 探测 mcp_server 包位置: 同 packages/mcp-server 目录结构, 从 HERE 推
const MCP_SERVER_SRC = path.resolve(HERE, "../../mcp-server/src");
const MCP_SERVER_CWD = path.resolve(HERE, "../../mcp-server");

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
    // t_eece584f round-2: PATH 强制带系统 bin, 避免 vitest pool 切到 hermes runtime
    PATH: [
      path.dirname(PYTHON_BIN) === "." ? "" : path.dirname(PYTHON_BIN),
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      process.env.PATH ?? "",
    ].filter(Boolean).join(path.delimiter),
    // t_eece584f round-2: PYTHONPATH 推 mcp_server 包路径而非硬编码 site-packages
    // (mcp_server 是 pip editable install 到 packages/mcp-server/src, __main__.py 用
    // 相对包 import, 必须把 src 挂到 PYTHONPATH)
    PYTHONPATH: [
      MCP_SERVER_SRC,
      "/usr/local/lib/hermes-agent/venv/lib/python3.11/site-packages",
    ].filter(Boolean).join(path.delimiter),
    TOKEN_WALLET_MCP_KEY: DAEMON_KEY,
    TOKEN_WALLET_HOST: DAEMON_HOST,
    TOKEN_WALLET_PORT: String(DAEMON_PORT),
    TOKEN_WALLET_DB_PATH: dbPath,
    USAGE_TTL_DAYS: "90",
  };
  const child = spawn(
    PYTHON_BIN,
    ["-m", "mcp_server"],
    { env, cwd: MCP_SERVER_CWD, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
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

  it("自愈(协议层): 杀 daemon 重启 → app 不显式 invalidateSession → 下次 query 经 status=404 + body=-32600 自动重握手恢复", async () => {
    // t_eece584f round-2: 协议层自愈(非应用层失效) — 真机场景核心 case
    // app 不知道 daemon 重启, 缓存里仍是旧 sid; 下次 query 自动被 daemon 返 404 + body 拒绝,
    // → callMcpTool attempt 识别 _SessionExpired → 自动重握手 → 拿新 sid → 拿真数据
    // 这才是 task body 验收 '点刷新 → 卡恢复真数据' 的协议路径

    // 预热: 用当前 daemon 拿 sid 缓存
    await callMcpTool<UsageSummaryOutput>(
      { host: DAEMON_HOST, port: DAEMON_PORT, key: DAEMON_KEY },
      { name: "usage_summary", arguments: {} },
      realHttpShim(),
      { timeoutMs: 8000 },
    );
    // 杀 daemon(快速重启模拟外部重启)
    expect(daemon).not.toBeNull();
    await stopDaemon();
    // 立刻重启新 daemon(旧 sid 已死)
    daemon = await startDaemon();
    daemonReady = true;
    // 不显式 invalidateSession — 缓存里仍是旧 sid
    // 下次 query: 用旧 sid → daemon 返 status=404 + body=-32600 'Session not found'
    // → callMcpTool attempt self-heal 判定 → _SessionExpired → invalidateSession + 重握手 → 拿新 sid
    // → 重试 → 拿真数据
    const r = await callMcpTool<UsageSummaryOutput>(
      { host: DAEMON_HOST, port: DAEMON_PORT, key: DAEMON_KEY },
      { name: "usage_summary", arguments: { group_by: ["agent"] } },
      realHttpShim(),
      { timeoutMs: 8000 },
    );
    expect(r.parsed.total.calls).toBe(0);
    expect(r.parsed.generated_at).toBeTruthy();
    // 第二次 query 应复用新 sid(不重发 initialize)— 验缓存已被自愈更新
    let initializeCount = 0;
    const spy: HttpShim = {
      postJson: async <T,>(opts: {
        url: string;
        headers: Record<string, string>;
        body: unknown;
        timeoutMs: number;
      }): Promise<{ status: number; body: T; headers: Record<string, string> }> => {
        if ((opts.body as { method: string }).method === "initialize") initializeCount++;
        return realHttpShim().postJson<T>(opts);
      },
    };
    await callMcpTool<UsageSummaryOutput>(
      { host: DAEMON_HOST, port: DAEMON_PORT, key: DAEMON_KEY },
      { name: "usage_summary", arguments: {} },
      spy,
      { timeoutMs: 8000 },
    );
    expect(initializeCount).toBe(0); // 缓存已被自愈刷新, 复用新 sid
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
