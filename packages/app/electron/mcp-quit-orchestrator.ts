/**
 * will-quit daemon 停止编排(t_d59a9ad8):
 * - 复用 mcp-ipc 同款依赖形态(loadMcpEnv + stopFn + probe + discovery), 不新造停止路径
 * - 硬约束: 总等待 ≤ 3s(MCP_STOP_ON_QUIT_TIMEOUT_MS), 超时放行退出 — 退出路径禁被 daemon 卡死
 * - 停止失败/任何异常: 静默返回(不弹窗不阻断), 只落主进程日志
 * - 纯依赖注入式设计(同 web-session-auth.ts / mcp-daemon.ts 模式), node vitest 直测
 */
import {
  stop as stopFn,
  probe as probeFn,
  discoverPidByPort,
  getLastStartedPid,
  type HttpShim,
  type SpawnShim,
  type SpawnShimDiscovery,
} from "./mcp-daemon";
import { loadMcpEnv } from "./mcp-env";
import { connectHost } from "./mcp-address";
import { MCP_STOP_ON_QUIT_TIMEOUT_MS } from "./mcp-stop-on-quit";

export interface McpStopOnQuitDeps {
  spawn: SpawnShim;
  http: HttpShim;
  discovery?: SpawnShimDiscovery;
  platform: NodeJS.Platform;
  /** configDir 提供器(mcp.env 所在目录) */
  configDir: () => string;
  /** 计时注入(vitest 控制 fake time); 缺省 Date.now */
  now?: () => number;
  /** 超时上限注入(缺省 MCP_STOP_ON_QUIT_TIMEOUT_MS) */
  timeoutMs?: number;
  /** 日志注入(缺省 console.log) */
  log?: (msg: string) => void;
}

export interface McpStopOnQuitResult {
  /** daemon 已确认不活(含本来就没跑的幂等) */
  stopped: boolean;
  reason?: "timeout" | "stop_failed" | "env_load_failed" | "error";
}

/**
 * 退出路径的 daemon 停止编排:
 * 1) 快速 probe(1s 超时) — daemon 本来就没跑 → 幂等成功, 零耗时
 * 2) stopFn(快路径 pid 缓存 + 端口归属反查兜底, 复用既有实现)
 * 3) 收尾 probe 复核; 全程 deadline 控制, 任何一步超 budget → 立即放行退出
 */
export async function stopDaemonOnAppQuit(deps: McpStopOnQuitDeps): Promise<McpStopOnQuitResult> {
  const now = deps.now ?? Date.now;
  const budget = deps.timeoutMs ?? MCP_STOP_ON_QUIT_TIMEOUT_MS;
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const deadline = now() + budget;
  const remaining = () => deadline - now();

  let cfg: ReturnType<typeof loadMcpEnv>;
  try {
    cfg = loadMcpEnv(deps.configDir());
  } catch (e) {
    log(`[mcp-stop-on-quit] env load failed: ${e instanceof Error ? e.message : String(e)}`);
    return { stopped: false, reason: "env_load_failed" };
  }
  const target = { host: connectHost(cfg.TOKEN_WALLET_HOST), port: cfg.TOKEN_WALLET_PORT, key: cfg.TOKEN_WALLET_MCP_KEY };

  try {
    // ① 快速判活: 没跑 → 幂等成功(不进慢路径)。
    //    注意 probe 返回 ProbeResult 对象(非 boolean), 超时哨兵是 false — 需分别判型
    if (remaining() <= 0) return { stopped: false, reason: "timeout" };
    const aliveRes = await Promise.race([
      probeFn(target, deps.http, Math.min(1000, Math.max(remaining(), 1))),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), Math.max(remaining(), 1))),
    ]);
    const isAlive = aliveRes !== false && aliveRes.alive;
    if (!isAlive) {
      log("[mcp-stop-on-quit] daemon not running — nothing to stop");
      return { stopped: true };
    }

    // ② 真停: pid 解析 = lastStartedPid 缓存 > 端口归属反查兜底(与 mcp_stop 通道同款语义,
    //    stopFn(0) 无 discovery 时的 pid_required 终态不进退出路径)
    let pid = getLastStartedPid() ?? 0;
    if (!pid) {
      const owner = deps.discovery ? discoverPidByPort(cfg.TOKEN_WALLET_PORT, deps.discovery, deps.platform) : null;
      if (!owner) {
        log("[mcp-stop-on-quit] no pid and port discovery failed — releasing quit");
        return { stopped: false, reason: "stop_failed" };
      }
      pid = owner;
    }
    const stopRemaining = remaining();
    if (stopRemaining <= 0) {
      log("[mcp-stop-on-quit] stop skipped — deadline exceeded before stop");
      return { stopped: false, reason: "timeout" };
    }
    const stopPromise = stopFn(pid, deps.spawn, deps.http, target, deps.platform, deps.discovery);
    const stopResult = await Promise.race([
      stopPromise,
      new Promise<{ stopped: false; reason: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ stopped: false, reason: "timeout" }), Math.max(stopRemaining, 1)),
      ),
    ]);

    if (stopResult.stopped) {
      log("[mcp-stop-on-quit] daemon stopped");
      return { stopped: true };
    }

    // ③ 超时/失败: 静默放行退出(只落日志, 退出优先)
    log(`[mcp-stop-on-quit] stop not confirmed (${stopResult.reason ?? "unknown"}) — releasing quit`);
    return stopResult.reason === "timeout"
      ? { stopped: false, reason: "timeout" }
      : { stopped: false, reason: "stop_failed" };
  } catch (e) {
    log(`[mcp-stop-on-quit] error: ${e instanceof Error ? e.message : String(e)} — releasing quit`);
    return { stopped: false, reason: "error" };
  }
}
