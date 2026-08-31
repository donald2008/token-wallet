/**
 * 调度器 — DESIGN.md §3.2, D-027 全语义
 *
 * - 全异步并发: 每实例独立调度循环, 故障完全隔离
 * - 防重叠: 上次采集未结束时下个周期跳过(记 skipped)
 * - 超时硬切断: http 默认 10s, command 默认 15s; AbortSignal + race 双保险
 *   (fetch 不理 signal 也不会拖住循环, 迟到结果丢弃)
 * - 启动抖动: 首次采集 0~30s 随机 jitter
 * - 失败退避: 连续失败指数退避 5→10→20→封顶 30min, 成功回正常周期
 * - auth_expired 停摆: 等用户处理(resume() 恢复)
 * - 写库原子由 StorageBackend 保证; 本层只负责节拍
 */
import type { ProviderSnapshot } from "./schema.js";

/** auth_expired 专用错误: fetch 抛出它等价于返回 auth_expired 快照 */
export class AuthExpiredError extends Error {
  constructor(
    message: string,
    public readonly setupHint?: string,
  ) {
    super(message);
    this.name = "AuthExpiredError";
  }
}

export interface FetchContext {
  /** 超时/stop 时触发; 命令类适配器必须监听并 kill 子进程 */
  signal: AbortSignal;
  /** 本次调用的超时预算(毫秒) */
  timeoutMs: number;
}

export type FetchFn = (ctx: FetchContext) => Promise<ProviderSnapshot>;

export interface SchedulerInstanceDef {
  id: string;
  fetch: FetchFn;
  /** 轮询周期(毫秒), 默认 5min(D-011 T2 档) */
  intervalMs?: number;
  /** 决定默认超时: http 10s / command 15s(§3.2) */
  kind?: "http" | "command";
  /** 显式超时覆盖(毫秒) */
  timeoutMs?: number;
  /** 每次采集结束回调(成功/失败/跳过前的实际结果), 宿主在此写库 */
  onResult?: (snapshot: ProviderSnapshot, meta: RunMeta) => void;
}

export interface RunMeta {
  /** 本次耗时 */
  durationMs: number;
  /** 是否超时切断 */
  timedOut: boolean;
  /** 失败后连续失败计数(成功时为 0) */
  consecutiveFailures: number;
}

export type InstanceState = "idle" | "running" | "halted";

export interface InstanceStats {
  state: InstanceState;
  runs: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  /** 因上次未结束而跳过的周期数 */
  skipped: number;
  /** auth_expired 停摆原因 */
  haltReason?: string;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface SchedulerOptions {
  /** 默认轮询周期, 5min */
  defaultIntervalMs?: number;
  httpTimeoutMs?: number;
  commandTimeoutMs?: number;
  /** 启动抖动上限, 30s */
  jitterMaxMs?: number;
  /** 退避基数 5min → 10 → 20 → 封顶 */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** 注入随机源(测试确定性) */
  random?: () => number;
  /** 注入时钟(测试) */
  now?: () => number;
}

interface InstanceRuntime {
  def: SchedulerInstanceDef;
  intervalMs: number;
  timeoutMs: number;
  state: InstanceState;
  stats: InstanceStats;
  timer: ReturnType<typeof setTimeout> | null;
  abort: AbortController | null;
  /** 时钟起点: 上次 tick 调度时刻(固定节拍, 防重叠判定用) */
  started: boolean;
}

const MIN = 60_000;

export class Scheduler {
  private readonly opts: Required<Omit<SchedulerOptions, "random" | "now">> & {
    random: () => number;
    now: () => number;
  };
  private readonly instances = new Map<string, InstanceRuntime>();

  constructor(options: SchedulerOptions = {}) {
    this.opts = {
      defaultIntervalMs: options.defaultIntervalMs ?? 5 * MIN,
      httpTimeoutMs: options.httpTimeoutMs ?? 10_000,
      commandTimeoutMs: options.commandTimeoutMs ?? 15_000,
      jitterMaxMs: options.jitterMaxMs ?? 30_000,
      backoffBaseMs: options.backoffBaseMs ?? 5 * MIN,
      backoffMaxMs: options.backoffMaxMs ?? 30 * MIN,
      random: options.random ?? Math.random,
      now: options.now ?? Date.now,
    };
  }

  add(def: SchedulerInstanceDef): void {
    if (this.instances.has(def.id)) {
      throw new Error(`调度实例重复: ${def.id}`);
    }
    const timeoutMs =
      def.timeoutMs ??
      (def.kind === "command" ? this.opts.commandTimeoutMs : this.opts.httpTimeoutMs);
    this.instances.set(def.id, {
      def,
      intervalMs: def.intervalMs ?? this.opts.defaultIntervalMs,
      timeoutMs,
      state: "idle",
      stats: {
        state: "idle",
        runs: 0,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        skipped: 0,
      },
      timer: null,
      abort: null,
      started: false,
    });
  }

  remove(id: string): void {
    const rt = this.instances.get(id);
    if (!rt) return;
    this.clearTimer(rt);
    rt.abort?.abort();
    this.instances.delete(id);
  }

  /** 启动单实例(首次采集带 0~jitterMax 抖动) */
  start(id: string): void {
    const rt = this.mustGet(id);
    if (rt.state !== "idle" || rt.started) return;
    rt.started = true;
    const jitter = Math.floor(this.opts.random() * this.opts.jitterMaxMs);
    this.schedule(rt, jitter);
  }

  startAll(): void {
    for (const id of this.instances.keys()) this.start(id);
  }

  /** auth_expired 停摆后, 用户处理完凭据调用恢复(重新走抖动启动) */
  resume(id: string): void {
    const rt = this.mustGet(id);
    if (rt.state !== "halted") return;
    rt.state = "idle";
    rt.stats.state = "idle";
    rt.stats.haltReason = undefined;
    rt.stats.consecutiveFailures = 0;
    rt.started = false;
    this.start(id);
  }

  /**
   * 手动刷新 = 触发对应适配器立即同步(§3.1)。
   * 立即跑一次采集并走 onResult; 不改变既定节拍(下个周期仍按 interval 排)。
   * 与周期 tick 天然防重叠(run 内 state=running, 并发 tick 记 skipped)。
   *
   * t_66b67453 契约5: halted(auth_expired 停摆)不得拦截手动刷新 —— 用户在壳外
   * 重新授权(如 `bl auth login --console`)后点 ⟳, 必须立即重探而不是 no-op。
   * 此前 halted 直接 return: 卡片永远停在「待授权」, 只能重启 app 才恢复
   * (重启重建调度器恰好绕过了这扇单程门)。停摆解除与 resume() 同语义
   * (清 haltReason + 连败计数归零), 重探仍 auth_expired 会自然再次停摆 ——
   * 代价一次受 timeout 约束的探针, 换取「外部凭据变更后手动刷新即生效」;
   * 周期节拍不受影响(下一次周期仍由 run() 收尾按 interval/退避排)。
   */
  async refresh(id: string): Promise<void> {
    const rt = this.mustGet(id);
    if (rt.state === "running") return; // 在途: 防重叠(§3.2)
    if (rt.state === "halted") {
      rt.state = "idle";
      rt.stats.state = "idle";
      rt.stats.haltReason = undefined;
      rt.stats.consecutiveFailures = 0;
    }
    await this.run(rt);
  }

  async refreshAll(): Promise<void> {
    await Promise.all([...this.instances.keys()].map((id) => this.refresh(id)));
  }

  stop(id: string): void {
    const rt = this.instances.get(id);
    if (!rt) return;
    this.clearTimer(rt);
    rt.abort?.abort();
    rt.abort = null;
    if (rt.state === "running") {
      rt.state = "idle";
      rt.stats.state = "idle";
    }
    rt.started = false;
    rt.stats.nextRunAt = undefined;
  }

  stopAll(): void {
    for (const id of [...this.instances.keys()]) this.stop(id);
  }

  stats(id: string): InstanceStats {
    return { ...this.mustGet(id).stats };
  }

  listStats(): Record<string, InstanceStats> {
    const out: Record<string, InstanceStats> = {};
    for (const [id, rt] of this.instances) out[id] = { ...rt.stats };
    return out;
  }

  // ---- 内部 ----

  private mustGet(id: string): InstanceRuntime {
    const rt = this.instances.get(id);
    if (!rt) throw new Error(`调度实例不存在: ${id}`);
    return rt;
  }

  private clearTimer(rt: InstanceRuntime): void {
    if (rt.timer !== null) {
      clearTimeout(rt.timer);
      rt.timer = null;
    }
  }

  private schedule(rt: InstanceRuntime, delayMs: number): void {
    this.clearTimer(rt);
    rt.stats.nextRunAt = this.opts.now() + delayMs;
    rt.timer = setTimeout(() => void this.tick(rt), delayMs);
    // 不阻塞进程退出(mcp-server 由宿主保活, 单测/脚本不被拖住)
    if (typeof rt.timer === "object" && rt.timer && "unref" in rt.timer) {
      (rt.timer as { unref: () => void }).unref();
    }
  }

  private async tick(rt: InstanceRuntime): Promise<void> {
    if (rt.state === "halted") return;
    if (rt.state === "running") {
      // 防重叠: 上次未结束, 本周期跳过
      rt.stats.skipped += 1;
      this.schedule(rt, rt.intervalMs);
      return;
    }
    // 固定节拍: 先排下个周期再跑本次 — 本次执行超过 interval 时, 下个周期
    // 到期触发 tick → 发现 running → 记 skipped(§3.2 防重叠语义)
    this.schedule(rt, rt.intervalMs);
    await this.run(rt);
  }

  private async run(rt: InstanceRuntime): Promise<void> {
    rt.state = "running";
    rt.stats.state = "running";
    rt.stats.runs += 1;
    rt.stats.lastRunAt = this.opts.now();
    const startedAt = this.opts.now();

    const controller = new AbortController();
    rt.abort = controller;
    const timeoutMs = rt.timeoutMs;

    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`采集超时硬切断(${timeoutMs}ms)`));
      }, timeoutMs);
      if (typeof timeoutHandle === "object" && timeoutHandle && "unref" in timeoutHandle) {
        (timeoutHandle as { unref: () => void }).unref();
      }
    });

    let snapshot: ProviderSnapshot | null = null;
    let failure: Error | null = null;
    const fetchPromise = rt.def.fetch({ signal: controller.signal, timeoutMs });
    try {
      snapshot = await Promise.race([fetchPromise, timeoutPromise]);
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      // 迟到的 fetch 结果丢弃, 但必须吞掉避免 unhandled rejection
      fetchPromise.catch(() => {});
    }
    rt.abort = null;

    const durationMs = this.opts.now() - startedAt;

    // auth_expired → 停摆(快照或异常两种入口)
    const authExpired =
      failure instanceof AuthExpiredError || snapshot?.status === "auth_expired";
    if (authExpired) {
      const hint =
        (failure instanceof AuthExpiredError ? failure.setupHint : snapshot?.setup_hint) ??
        snapshot?.setup_hint;
      this.clearTimer(rt); // 取消 tick() 预排的下一周期
      rt.state = "halted";
      rt.stats.state = "halted";
      rt.stats.haltReason = hint ?? "auth_expired";
      rt.stats.nextRunAt = undefined;
      if (snapshot) {
        rt.def.onResult?.(snapshot, { durationMs, timedOut, consecutiveFailures: rt.stats.consecutiveFailures });
      }
      return;
    }

    // unsupported → 同样停摆(无适配器, 轮询无意义)
    if (snapshot?.status === "unsupported") {
      this.clearTimer(rt);
      rt.state = "halted";
      rt.stats.state = "halted";
      rt.stats.haltReason = "unsupported";
      rt.stats.nextRunAt = undefined;
      rt.def.onResult?.(snapshot, { durationMs, timedOut, consecutiveFailures: rt.stats.consecutiveFailures });
      return;
    }

    const ok = !failure && snapshot?.status === "ok";
    if (ok && snapshot) {
      rt.stats.successes += 1;
      rt.stats.consecutiveFailures = 0;
      rt.def.onResult?.(snapshot, { durationMs, timedOut: false, consecutiveFailures: 0 });
      rt.state = "idle";
      rt.stats.state = "idle";
      this.schedule(rt, rt.intervalMs);
      return;
    }

    // 失败路径: 异常 / 超时 / 非 ok 状态(error, stale 视为可接受? — stale 由 UI 派生, 适配器不产)
    rt.stats.failures += 1;
    rt.stats.consecutiveFailures += 1;
    if (snapshot) {
      // 适配器返回 error 快照: 照样落库(异常卡显示真实状态, 不放假数据)
      rt.def.onResult?.(snapshot, {
        durationMs,
        timedOut,
        consecutiveFailures: rt.stats.consecutiveFailures,
      });
    } else {
      // fetch 抛异常(无快照): 必须落一条显式 error 快照, 绝不静默蒸发 ——
      // 无快照 = 该实例本周期零产出 = 面板整卡缺失(t_5b52b633 实锤:
      // kimi 限流态映射异常走旧静默路径, 用户连错误卡都看不到)。
      rt.def.onResult?.(
        {
          provider_id: rt.def.id,
          display_name: rt.def.id,
          plan_type: "window",
          fetched_at: Math.floor(this.opts.now() / 1000),
          status: "error",
          metrics: [],
          alerts: [{ level: "critical", message: failure?.message ?? "采集失败", code: "fetch_failed" }],
          error_message: failure?.message ?? "采集失败",
        },
        { durationMs, timedOut, consecutiveFailures: rt.stats.consecutiveFailures },
      );
    }
    rt.state = "idle";
    rt.stats.state = "idle";
    // 指数退避: base * 2^(n-1), 封顶 max
    const backoff = Math.min(
      this.opts.backoffBaseMs * 2 ** (rt.stats.consecutiveFailures - 1),
      this.opts.backoffMaxMs,
    );
    this.schedule(rt, backoff);
  }
}
