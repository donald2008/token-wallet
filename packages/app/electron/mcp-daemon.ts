/**
 * MCP daemon 生命周期管理(D-048, t_4bd214de):
 * - probe: POST /mcp initialize 握手 → 200 = 真活(不裸 TCP, 按卡体钉死)
 * - start: spawn `resources/token-wallet-mcp(.exe)` detached + polling health 至绿
 * - stop: Windows taskkill /T /F, 其他平台 SIGTERM
 * - isInstalled: 探测候选路径(可注入扩展)
 *
 * 纯逻辑模块 — 零 electron 依赖, 全部副作用(proc/http/fs)经 shim 注入, 便于
 * node vitest 单测。本文件导出 5 个函数, 不与 IPC 直绑(IPC 层 main.ts 包装)。
 */
import * as path from "node:path";
import { existsSync } from "node:fs";

export type ProbeResult =
  | { alive: true; latencyMs: number }
  | { alive: false; reason: "unreachable" | "handshake_failed" | "timeout" };

export interface SpawnShim {
  spawn: (
    cmd: string,
    args: string[],
    opts: { detached: boolean; stdio: "ignore" | "pipe"; env: NodeJS.ProcessEnv },
  ) => { pid?: number; unref: () => void };
  killTree: (pid: number, signal: "SIGTERM" | "SIGKILL" | "TASKKILL") => Promise<void>;
  wait: (ms: number) => Promise<void>;
}

export interface HttpShim {
  /**
   * 实际请求 MCP initialize。返回 {status} 或 throw 表示网络错/超时。
   * 卡体钉死 POST /mcp initialize → 200 即活, 其他/抛错 = 不活。
   */
  postInitialize: (url: string, timeoutMs: number) => Promise<{ status: number }>;
}

export interface PathShim {
  /** 探测 daemon 可执行文件 — 返回绝对路径或 null。注入便于 dev 模式返回 fake 路径 */
  resolveDaemonPath: (platform: NodeJS.Platform, isPackaged: boolean, appRoot: string) => string | null;
  exists: (p: string) => boolean;
}

export interface ProbeOptions {
  host: string;
  port: number;
  /** 探测超时(ms), 默认 1500 */
  timeoutMs?: number;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 1500;
export const DEFAULT_START_POLL_TIMEOUT_MS = 10_000;
export const DEFAULT_START_POLL_INTERVAL_MS = 200;

/**
** 进程内缓存最近一次 mcp_start 成功后的 pid(用于 stop 无 pid 路径, t_4bd214de round-2 BLOCKING-1):
** 主进程不持久化跨重启 — OS 重启 / 用户外部起 daemon 后, 该缓存失效 → mcp_stop 无 pid
** 时会 fallback 到 probe 反推(detect live → pid_required)。若 daemon 真在跑但无 pid 可用,
** UI 必须显式告知用户, 不许静默吞。
*/
let lastStartedPid: number | undefined;

/** 测试/清理钩子: vitest beforeEach 重置避免泄漏 */
export function _resetLastStartedPid(): void {
  lastStartedPid = undefined;
}

/** UI/RPC 层读最近 pid, 用于诊断/编排(无则 undefined) */
export function getLastStartedPid(): number | undefined {
  return lastStartedPid;
}

export function defaultSpawnShim(): SpawnShim {
  // 动态 require 避免 vitest node 环境之外误引(本模块本就该 node-only)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require("node:child_process") as typeof import("node:child_process");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const isWin = process.platform === "win32";
  return {
    spawn: (cmd, args, opts) =>
      cp.spawn(cmd, args, {
        detached: opts.detached,
        stdio: opts.stdio,
        env: opts.env,
        windowsHide: true,
      }),
    killTree: async (pid, signal) => {
      if (isWin || signal === "TASKKILL") {
        await new Promise<void>((resolve) => {
          const p = cp.spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
          p.on("exit", () => resolve());
          p.on("error", () => resolve()); // 进程已死也算成功
        });
        return;
      }
      try {
        process.kill(-pid, signal); // 负 pid = 进程组(SIGTERM 给整个 detached 组)
      } catch {
        /* 进程已死, 不重试 SIGKILL(避免误杀; 上层 mcp:stop 失败由 UI 重试) */
      }
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function defaultPathShim(): PathShim {
  return {
    resolveDaemonPath: (platform, _isPackaged, appRoot) => {
      // 卡体钉死: 约定 `resources/token-wallet-mcp(.exe)`
      // dev 模式(_isPackaged=false)不期望有 resources/ → resolveDaemonPath 仍返回路径,
      // 由 exists() 决定实际可用性; UI 据此提示"未找到 daemon, 请先构建 resources/"
      void _isPackaged;
      const exe = platform === "win32" ? "token-wallet-mcp.exe" : "token-wallet-mcp";
      const candidate = path.join(appRoot, "resources", exe);
      return candidate;
    },
    exists: (p) => existsSync(p),
  };
}

/** 真活判定: POST {host}:{port}/mcp initialize 200 + status ok */
export async function probe(
  opts: ProbeOptions,
  http: HttpShim,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const url = `http://${opts.host}:${opts.port}/mcp`;
  const start = Date.now();
  try {
    const res = await http.postInitialize(url, timeoutMs);
    if (res.status === 200) return { alive: true, latencyMs: Date.now() - start };
    return { alive: false, reason: "handshake_failed" };
  } catch {
    return { alive: false, reason: "unreachable" };
  }
}

/** spawn detached + polling health 至绿(超时返回 alive:false reason=timeout) */
export async function start(
  cfg: { host: string; port: number; key: string; dbPath: string; ttlDays: number },
  spawn: SpawnShim,
  http: HttpShim,
  paths: PathShim,
  appRoot: string,
  isPackaged: boolean,
  platform: NodeJS.Platform = process.platform,
): Promise<{ started: boolean; pid?: number; reason?: string }> {
  const daemonPath = paths.resolveDaemonPath(platform, isPackaged, appRoot);
  if (!daemonPath) return { started: false, reason: "not_installed" };
  if (!paths.exists(daemonPath)) return { started: false, reason: "not_installed" };

  // spawn detached + unref(主进程退出不影响 daemon)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TOKEN_WALLET_MCP_KEY: cfg.key,
    TOKEN_WALLET_PORT: String(cfg.port),
    TOKEN_WALLET_HOST: cfg.host,
    TOKEN_WALLET_DB_PATH: cfg.dbPath,
    USAGE_TTL_DAYS: String(cfg.ttlDays),
  };
  const child = spawn.spawn(daemonPath, [], {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  const pid = child.pid;

  // polling health
  const deadline = Date.now() + DEFAULT_START_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = await probe({ host: cfg.host, port: cfg.port }, http, DEFAULT_PROBE_TIMEOUT_MS);
    if (r.alive) {
      lastStartedPid = pid; // 缓存最新成功 pid, 用于 stop 无 pid 路径(BLOCKING-1)
      return { started: true, pid };
    }
    await spawn.wait(DEFAULT_START_POLL_INTERVAL_MS);
  }
  // 超时 → 不缓存(进程可能未启动), 但仍返 pid 让 UI 看见实际值
  return { started: false, pid, reason: "timeout" };
}

/**
** Stop + 缓存清理: 真停了之后清缓存(避免下次 stop 复用死 pid)。
** 编排调用方(start 自动重启 / key regen 编排)在调 stop 后立即调此函数清缓存。
*/
export function clearLastStartedPid(): void {
  lastStartedPid = undefined;
}

export async function stop(
  pid: number,
  spawn: SpawnShim,
  http: HttpShim,
  cfg: { host: string; port: number },
  platform: NodeJS.Platform = process.platform,
): Promise<{ stopped: boolean; reason?: string }> {
  const isWin = platform === "win32";
  // 先 SIGTERM/taskkill, 然后等 1.5s, 再 probe 确认真死
  await spawn.killTree(pid, isWin ? "TASKKILL" : "SIGTERM");
  await spawn.wait(1500);
  const r = await probe({ host: cfg.host, port: cfg.port }, http, DEFAULT_PROBE_TIMEOUT_MS);
  if (!r.alive) {
    if (lastStartedPid === pid) lastStartedPid = undefined; // 真停成功, 清缓存(BLOCKING-1)
    return { stopped: true };
  }
  // 还没死 → 强杀兜底
  await spawn.killTree(pid, isWin ? "TASKKILL" : "SIGKILL");
  await spawn.wait(500);
  const r2 = await probe({ host: cfg.host, port: cfg.port }, http, DEFAULT_PROBE_TIMEOUT_MS);
  if (!r2.alive) {
    if (lastStartedPid === pid) lastStartedPid = undefined; // 强杀成功, 清缓存
    return { stopped: true };
  }
  return { stopped: false, reason: "still_alive" };
}

export function isInstalled(paths: PathShim, platform: NodeJS.Platform, isPackaged: boolean, appRoot: string): boolean {
  const p = paths.resolveDaemonPath(platform, isPackaged, appRoot);
  return p !== null && paths.exists(p);
}
