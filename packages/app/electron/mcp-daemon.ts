/**
 * MCP daemon 生命周期管理(D-055, t_4bd214de; t_1b396e2f 归属可发现 + 版本一致性):
 * - probe: POST /mcp initialize 握手 → 200 = 真活(不裸 TCP, 按卡体钉死)
 * - start: spawn `resources/token-wallet-mcp(.exe)` detached + polling health 至绿
 *          (t_1b396e2f: 端口已被他人占 → 拒启 port_in_use, 封死「poll 被旧 daemon 骗绿」假绿路径)
 * - stop: Windows taskkill /T /F, 其他平台 SIGTERM; 快路径 pid 失败 → **端口归属反查**兜底
 *          (netstat -ano / lsof / ss — 端口是唯一不会说谎的事实源, app 重启后 lastStartedPid
 *          进程内缓存已丢, 反查保证 stop/restart 真生效; discovery_failed 显式上报不静默绕过)
 * - checkDaemonVersion: 本机 exe build_id(build-exe.ps1 注入) vs daemon /guide 自报 → stale 判定
 * - isInstalled: 探测候选路径(可注入扩展)
 *
 * 纯逻辑模块 — 零 electron 依赖, 全部副作用(proc/http/fs)经 shim 注入, 便于
 * node vitest 单测。本文件导出函数不与 IPC 直绑(IPC 层 main.ts/mcp-ipc.ts 包装)。
 */
import * as path from "node:path";
import { existsSync, readFileSync } from "node:fs";

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
   * key: Bearer 鉴权头 — daemon 全额鉴权不豁免 loopback(含 initialize), 无 key 401 (t_da2fd1f1 U6b)。
   */
  postInitialize: (url: string, timeoutMs: number, key?: string) => Promise<{ status: number }>;
  /**
   * t_1b396e2f 版本一致性: GET /guide 拿 daemon 自报 build_id(/guide 在 BearerAuth 之外, 无 key)。
   * 返回 {status, body(text)}; throw = 网络错/超时。缺省(旧 shim)→ checkDaemonVersion 返 checked:false。
   */
  getGuide?: (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>;
}

export interface PathShim {
  /** 探测 daemon 可执行文件 — 返回绝对路径或 null。注入便于 dev 模式返回 fake 路径 */
  resolveDaemonPath: (platform: NodeJS.Platform, isPackaged: boolean, appRoot: string) => string | null;
  exists: (p: string) => boolean;
}

/**
 * t_1b396e2f: 端口归属反查 — 端口是唯一不会说谎的事实源(daemon 可能由上一个 app
 * 实例/外部手工/系统残留拉起, pidfile 一样会漂)。返回监听 {port} 的 PID, 查不到 → null。
 * Windows: `netstat -ano | findstr :<port>` 取 LISTENING 行最后一列 PID;
 * POSIX: `ss -lptnH` 或 `lsof -ti tcp:<port>`。
 * 全部失败/超时/多监听者(环境异常) → 返 null 并由调用方显式上抛 discovery_failed, 不静默绕过。
 */
export interface SpawnShimDiscovery {
  /** 同步执行 shell 命令, 返回 stdout; throw/非零退出由实现方决定(实现为 throw) */
  execFile: (cmd: string, args: string[], timeoutMs: number) => string;
}

export function defaultDiscoveryShim(): SpawnShimDiscovery {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require("node:child_process") as typeof import("node:child_process");
  return {
    execFile: (cmd, args, timeoutMs) =>
      cp.execFileSync(cmd, args, { timeout: timeoutMs, windowsHide: true, encoding: "utf-8" }) as string,
  };
}

/**
 * 解析 netstat -ano(Windows) / ss -lptnH(POSIX) 输出中监听 {port} 的 PID 集合。
 * Windows 行样例: `  TCP    0.0.0.0:9131    0.0.0.0:0    LISTENING    6360`
 *   (IPv6 行 `[::]:9131` 同构; findstr ":9131" 会误吞 :91310 类端口 → 在此精确解析)
 * ss 行样例: `LISTEN 0 128 0.0.0.0:9131 0.0.0.0:* users:(("python",pid=6360,fd=3))`
 */
export function parseListenerPids(output: string, port: number, platform: NodeJS.Platform): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    if (platform === "win32") {
      // 精确端口匹配: local address 以 :<port> 结尾(排除 :91310 / 时间列数字等)
      const m = line.match(/^\s*(TCP|TCPv6)\s+\S+?:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (m && Number(m[2]) === port) pids.add(Number(m[3]));
    } else {
      if (!line.includes(`:${port} `) && !line.trimEnd().endsWith(`:${port}`)) continue;
      if (!/\bLISTEN\b/i.test(line)) continue;
      const pm = line.match(/pid=(\d+)/);
      if (pm) pids.add(Number(pm[1]));
    }
  }
  return [...pids];
}

export function discoverPidByPort(
  port: number,
  discovery: SpawnShimDiscovery,
  platform: NodeJS.Platform = process.platform,
): number | null {
  const tryCmd = (cmd: string, args: string[]): number | null => {
    let out: string;
    try {
      out = discovery.execFile(cmd, args, DISCOVERY_TIMEOUT_MS);
    } catch {
      return null;
    }
    const pids = parseListenerPids(out, port, platform);
    return pids.length > 0 ? pids[0] : null;
  };
  if (platform === "win32") {
    // netstat -ano 拿全表, 本进程内 findstr 等价过滤(免 shell 管道) → 解析 LISTENING 行
    let out: string;
    try {
      out = discovery.execFile("netstat", ["-ano"], DISCOVERY_TIMEOUT_MS);
    } catch {
      return null;
    }
    const pids = parseListenerPids(out, port, platform);
    return pids.length > 0 ? pids[0] : null;
  }
  // POSIX: 先 lsof(最精准, 一行一 pid), 退化 ss(不需要 lsof 安装)
  return tryCmd("lsof", ["-ti", `tcp:${port}`, "-s", "TCP:LISTEN"]) ?? tryCmd("ss", ["-lptnH"]);
}

/**
 * t_1b396e2f 真机实证补丁: Windows 上 spawn 的是 launcher wrapper(onefile bootloader),
 * 真正 serve/占端口的是它的 child → 缓存 pid(wrapper) ≠ 端口 owner(serve child) 是**同一进程树**。
 * 判定: owner 的祖先链上出现 expectPid(或反之) → 同树。
 * 实现: 沿 ParentProcessId 向上最多 5 跳(避免环/超深); Windows 用 PowerShell CIM, POSIX 读 /proc。
 * 查询失败(命令不可用等) → 返 false(保守, 调用方按异树处理)。
 */
export function isSameProcessTree(
  expectPid: number,
  ownerPid: number,
  discovery: SpawnShimDiscovery,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!expectPid || !ownerPid || expectPid === ownerPid) return expectPid === ownerPid && expectPid > 0;
  const ancestorOf = (pid: number): number | null => {
    try {
      if (platform === "win32") {
        const out = discovery.execFile(
          "powershell.exe",
          ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`],
          DISCOVERY_TIMEOUT_MS,
        );
        const v = Number(out.trim());
        return Number.isFinite(v) && v > 0 ? v : null;
      }
      const out = discovery.execFile("sh", ["-c", `awk '{print $4}' /proc/${pid}/stat`], DISCOVERY_TIMEOUT_MS);
      const v = Number(out.trim());
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  };
  // 向上走 owner 的祖先链找 expectPid
  let cur = ownerPid;
  for (let i = 0; i < 5; i++) {
    const parent = ancestorOf(cur);
    if (parent === null) return false;
    if (parent === expectPid) return true;
    cur = parent;
  }
  return false;
}

export interface ProbeOptions {
  host: string;
  port: number;
  /** Bearer key — daemon 鉴权面不豁免 initialize, 无 key 401 (t_da2fd1f1 U6b) */
  key?: string;
  /** 探测超时(ms), 默认 1500 */
  timeoutMs?: number;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 1500;
export const DEFAULT_START_POLL_TIMEOUT_MS = 10_000;
export const DEFAULT_START_POLL_INTERVAL_MS = 200;
/** t_1b396e2f: 端口反查超时(ms) — netstat/ss 是同步外部命令, 卡死也不能拖住 UI */
export const DISCOVERY_TIMEOUT_MS = 5000;

/**
** 进程内缓存最近一次 mcp_start 成功后的 pid(用于 stop 无 pid 路径, t_4bd214de round-2 BLOCKING-1):
** 主进程不持久化跨重启 — OS 重启 / 用户外部起 daemon 后, 该缓存失效 → t_1b396e2f 起 stop/restart
** 走端口归属反查兜底(不再有 pid_required 终态), 此缓存仅作快路径。
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
    const res = await http.postInitialize(url, timeoutMs, opts.key);
    if (res.status === 200) return { alive: true, latencyMs: Date.now() - start };
    return { alive: false, reason: "handshake_failed" };
  } catch {
    return { alive: false, reason: "unreachable" };
  }
}

/** spawn detached + polling health 至绿(超时返回 alive:false reason=timeout) */
export async function start(
  cfg: {
    host: string;
    port: number;
    key: string;
    dbPath: string;
    ttlDays: number;
    /** 就绪 probe 的连接地址(U6): HOST=通配 bind 时传 127.0.0.1; 缺省归一 host 本身 */
    connectAddress?: string;
  },
  spawn: SpawnShim,
  http: HttpShim,
  paths: PathShim,
  appRoot: string,
  isPackaged: boolean,
  platform: NodeJS.Platform = process.platform,
  discovery?: SpawnShimDiscovery,
): Promise<{ started: boolean; pid?: number; reason?: string }> {
  const daemonPath = paths.resolveDaemonPath(platform, isPackaged, appRoot);
  if (!daemonPath) return { started: false, reason: "not_installed" };
  if (!paths.exists(daemonPath)) return { started: false, reason: "not_installed" };

  // t_1b396e2f 假绿护栏(注入 discovery 时激活; mcp-ipc 生产路径必注入):
  // 端口已被一个**非本缓存 pid 的活 daemon**占用 → spawn 只会自退,
  // poll 又会被那个活 daemon 应答 200 骗绿(app 重启后 restart 编排的典型事故路径)。
  // 此处直接拒启, 由调用方(mcp_restart / UI)先走 stop(端口反查)再回来。
  if (discovery) {
    const pre = await probe({ host: cfg.connectAddress ?? cfg.host, port: cfg.port, key: cfg.key }, http, DEFAULT_PROBE_TIMEOUT_MS);
    if (pre.alive) {
      const cached = getLastStartedPid() ?? 0;
      const owner = discoverPidByPort(cfg.port, discovery, platform);
      // owner===缓存 → 幂等; owner 是缓存的 serve child(launcher 链) → 同样幂等 (t_1b396e2f 真机实证)
      if (owner && (owner === cached || (cached > 0 && isSameProcessTree(cached, owner, discovery, platform)))) {
        return { started: true, pid: cached };
      }
      return { started: false, reason: "port_in_use" as const, pid: owner ?? undefined };
    }
  }

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

  // polling health — probe 打归一 connect 地址(通配 bind 的 0.0.0.0 不能作 connect 目标, U6)
  const probeHost = cfg.connectAddress ?? cfg.host;
  const deadline = Date.now() + DEFAULT_START_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = await probe({ host: probeHost, port: cfg.port, key: cfg.key }, http, DEFAULT_PROBE_TIMEOUT_MS);
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
** Stop: 快路径(pid) kill + probe 复核 → 端口归属反查兜底(t_1b396e2f) → 收尾复核。
** 真停成功才清缓存(避免下次 stop 复用死 pid); 失败显式返 reason(still_alive/discovery_failed/
** pid_required), 不许「停止即假成功」。
*/
export function clearLastStartedPid(): void {
  lastStartedPid = undefined;
}

export async function stop(
  pid: number,
  spawn: SpawnShim,
  http: HttpShim,
  cfg: { host: string; port: number; key?: string },
  platform: NodeJS.Platform = process.platform,
  discovery?: SpawnShimDiscovery,
): Promise<{ stopped: boolean; reason?: string }> {
  const isWin = platform === "win32";
  /** kill(先温和后强杀) + probe 复核 — 复用旧语义, 不许「停止即假成功」 */
  const attemptKill = async (target: number): Promise<boolean> => {
    await spawn.killTree(target, isWin ? "TASKKILL" : "SIGTERM");
    await spawn.wait(1500);
    const r = await probe({ host: cfg.host, port: cfg.port, key: cfg.key }, http, DEFAULT_PROBE_TIMEOUT_MS);
    if (!r.alive) return true;
    await spawn.killTree(target, isWin ? "TASKKILL" : "SIGKILL");
    await spawn.wait(500);
    const r2 = await probe({ host: cfg.host, port: cfg.port, key: cfg.key }, http, DEFAULT_PROBE_TIMEOUT_MS);
    return !r2.alive;
  };
  const succeed = (): { stopped: boolean; reason?: string } => {
    // 真停成功即清缓存: 被停的是端口归属者, 缓存里的 pid 无论指向谁都已无意义
    // (旧条件 lastStartedPid===pid 在「缓存 pid 与端口归属者不一致」时会漏清 → 死 pid 滞留)
    lastStartedPid = undefined;
    return { stopped: true };
  };

  // t_1b396e2f: pid≤0 时先 probe 判活 — daemon 没跑 → 幂等成功, 不瞎查端口;
  // 活着才走端口反查, 反查命中才有 kill 目标。
  let target = pid;
  if (target <= 0) {
    const r0 = await probe({ host: cfg.host, port: cfg.port, key: cfg.key }, http, DEFAULT_PROBE_TIMEOUT_MS);
    if (!r0.alive) return { stopped: true }; // 本来就没跑
    if (!discovery) return { stopped: false, reason: "pid_required" }; // 旧调用方显式语义
    const owner = discoverPidByPort(cfg.port, discovery, platform);
    if (!owner) {
      const alive2 = await probe({ host: cfg.host, port: cfg.port, key: cfg.key }, http, DEFAULT_PROBE_TIMEOUT_MS);
      return alive2.alive ? { stopped: false, reason: "discovery_failed" } : { stopped: true };
    }
    target = owner;
  }

  // 快路径: 调用方/缓存/反查出的 pid
  if (await attemptKill(target)) return succeed();

  // 兜底: 端口归属反查(t_1b396e2f) — 缓存 pid 已死/指向他人时, 端口是唯一事实源。
  // 典型场景: app 重启后 lastStartedPid 为空、或 restart 编排缓存 pid 已死但 daemon 仍占端口。
  if (discovery && cfg.port > 0) {
    const owner = discoverPidByPort(cfg.port, discovery, platform);
    if (owner && owner !== target && (await attemptKill(owner))) return succeed();
  }

  // 收尾复核: 覆盖「pid 没停掉但 daemon 恰好自行退出」等竞态
  const fin = await probe({ host: cfg.host, port: cfg.port, key: cfg.key }, http, DEFAULT_PROBE_TIMEOUT_MS);
  if (!fin.alive) return succeed();
  return { stopped: false, reason: "still_alive" };
}

// ---------------- t_1b396e2f: 版本一致性(build_id 注入 + 比对) ----------------

/** exe 内 build_id 标记(build-exe.ps1 写入产物字节流, 每次构建必变) */
export const BUILD_ID_MARKER = "TW_MCP_BUILD_ID=";

/** 从本机 exe 二进制提取 build_id(ASCII 标记扫描; 未注入/读不到 → null) */
export function readLocalBuildId(exePath: string): string | null {
  try {
    const buf = readFileSync(exePath);
    const marker = Buffer.from(BUILD_ID_MARKER, "ascii");
    const idx = buf.indexOf(marker);
    if (idx < 0) return null;
    // 值: 标记后到非 [0-9A-Za-z._-] 字节为止
    let end = idx + marker.length;
    while (end < buf.length && /[0-9A-Za-z._\-]/.test(String.fromCharCode(buf[end]))) end++;
    const val = buf.subarray(idx + marker.length, end).toString("ascii");
    return val || null;
  } catch {
    return null;
  }
}

/** 解析 daemon /guide JSON 的 build_id 字段(无字段/非 JSON → null) */
export function parseDaemonBuildId(body: string): string | null {
  try {
    const j = JSON.parse(body) as { build_id?: unknown };
    return typeof j.build_id === "string" && j.build_id ? j.build_id : null;
  } catch {
    return null;
  }
}

export interface DaemonVersionCheck {
  /** false = 无法执行比对(getGuide shim 缺失等), UI 不提示 */
  checked: boolean;
  reason?: "no_shim" | "fetch_failed" | "no_field" | "no_local_id";
  daemonBuildId?: string;
  localBuildId?: string;
  /** true = daemon 与本机 exe 版本不一致(含 daemon 侧无 build_id 而本机有 → 旧 daemon) */
  stale: boolean;
}

/**
 * 版本一致性检查: 本机 exe 的 build_id vs daemon 自报(/guide 无鉴权)。
 * stale 判定只在**双侧都可判定且不一致**时为 true; 任一侧无法判定(旧 exe 无标记等)不误报。
 */
export async function checkDaemonVersion(
  cfg: { host: string; port: number },
  exePath: string | null,
  http: HttpShim,
  timeoutMs = 3000,
): Promise<DaemonVersionCheck> {
  if (!http.getGuide) return { checked: false, reason: "no_shim", stale: false };
  const local = exePath ? readLocalBuildId(exePath) : null;
  let daemon: string | null = null;
  try {
    const res = await http.getGuide(`http://${cfg.host}:${cfg.port}/guide`, timeoutMs);
    if (res.status !== 200) return { checked: true, reason: "fetch_failed", localBuildId: local ?? undefined, stale: false };
    daemon = parseDaemonBuildId(res.body);
  } catch {
    return { checked: true, reason: "fetch_failed", localBuildId: local ?? undefined, stale: false };
  }
  if (daemon === null) {
    // daemon 侧无 build_id: 本机 exe 有标记 → daemon 是旧产物 → 陈旧; 双侧皆无 → 不判定
    return {
      checked: true,
      reason: "no_field",
      localBuildId: local ?? undefined,
      stale: local !== null,
    };
  }
  if (local === null) {
    return { checked: true, reason: "no_local_id", daemonBuildId: daemon, stale: false };
  }
  return { checked: true, daemonBuildId: daemon, localBuildId: local, stale: daemon !== local };
}

export function isInstalled(paths: PathShim, platform: NodeJS.Platform, isPackaged: boolean, appRoot: string): boolean {
  const p = paths.resolveDaemonPath(platform, isPackaged, appRoot);
  return p !== null && paths.exists(p);
}
