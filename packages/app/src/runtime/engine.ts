/**
 * RuntimeEngine — P0-5 真实链路: 实例配置 → GenericHttpAdapter → Scheduler → SqliteStore → 面板
 *
 * 数据流(DESIGN §3.1 cache-first):
 *   Scheduler(后台轮询) → GenericHttpAdapter.fetchSnapshot
 *     → onResult → SnapshotStorage.saveSnapshot(SqliteStore)
 *     → 近 7 天速率附着(daily_rate) → 通知面板订阅者
 *
 * 关键纪律:
 * - 凭据 key 只活请求构造瞬间(D-029): resolveCredential 从 OS 钥匙串读取,
 *   返回后立即被 adapter 拼进 header, 不进 UI 状态/日志。
 * - 通道映射零代码(§5.1): GenericHttpAdapter + CHANNEL_MAPPINGS(与 PRESET_CHANNELS 配套)。
 */
import { GenericHttpAdapter, type AdapterContext } from "@token-wallet/core/generic-http";
import { CHANNEL_MAPPINGS, getPresetChannel, type ChannelDescriptor } from "@token-wallet/core/channels";
import { COMMAND_ADAPTERS } from "@token-wallet/core/channels/aliyun-bailian";
import { Scheduler } from "@token-wallet/core/scheduler";
import { dailyRateFromHistory } from "@token-wallet/core/rate";
import type { ProviderSnapshot } from "../types";
import type { InstanceConfig, CredentialRef } from "../instances/schema";
import { keyFingerprint } from "../instances/schema";
import { KEYRING_SERVICE, getSharedKeyring, getSharedStore } from "../instances/store";
import { getSharedStorage, type SnapshotStorage } from "./storage";
import { commandRun, httpGetJson } from "../ipc";
import { t } from "../i18n";

const HTTP_TIMEOUT_MS = 10_000;

/** 解析轮询间隔文本("5m"/"30s"/"1h") → 毫秒; 缺省 5min(D-011 T2) */
export function parsePollIntervalMs(text?: string): number {
  if (!text) return 5 * 60_000;
  const m = /^(\d+)\s*(s|m|h)?$/.exec(text.trim());
  if (!m) return 5 * 60_000;
  const n = Number(m[1]);
  switch (m[2]) {
    case "s":
      return n * 1_000;
    case "h":
      return n * 3_600_000;
    default:
      return n * 60_000;
  }
}

/**
 * 桌面宿主 fetch 桥: 主进程 http_get_json 执行,
 * 规避 webview CORS/CSP; 响应体已由主进程脱敏(D-029, E2 卡接真)。
 * 纯浏览器 dev(无桌面桥)→ 直接 fetch(本地预览; 生产不会走到)。
 */
async function runtimeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k] = String(v);
  const timeoutMs = HTTP_TIMEOUT_MS;
  const { status, body } = await httpGetJson(url, headers, timeoutMs);
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

/** 凭据解析(D-029): CredentialRef{source:store} → OS 钥匙串读取; key 只活构造瞬间 */
async function resolveCredential(ref: unknown): Promise<string> {
  const r = ref as CredentialRef | undefined;
  if (!r || typeof r !== "object") throw new Error(t("engine.credInvalid"));
  if (r.source === "store") {
    const key = r.key ?? "default";
    const value = await getSharedKeyring().get(KEYRING_SERVICE, key);
    if (value === null || value === "") {
      throw new Error(t("engine.keyringMissing", { key }));
    }
    return value;
  }
  if (r.source === "env") {
    const name = r.key ?? "";
    const value = import.meta.env?.[name];
    if (typeof value !== "string" || value === "") throw new Error(t("engine.envMissing", { name }));
    return value;
  }
  throw new Error(t("engine.credSourceUnsupported", { source: r.source }));
}

/**
 * P0-8: 未接入通道的显式快照 — 不允许静默跳过(无快照=面板永远空态的实锤 bug)。
 * 面板据此渲染"该通道暂未接入"灰卡(status=unsupported, §2.1 整卡文字不显示假数据)。
 * 长期方案按注册表收敛(P2 多通道适配器), 本卡只保证"不静默"。
 */
export function unsupportedSnapshot(inst: InstanceConfig): ProviderSnapshot {
  const ch = getPresetChannel(inst.channel);
  return {
    provider_id: inst.id,
    display_name: inst.name,
    plan_type: ch?.plan_type ?? "window",
    fetched_at: Math.floor(Date.now() / 1000),
    status: "unsupported",
    metrics: [],
    alerts: [{ level: "info", message: t("engine.unsupportedAlert", { channel: inst.channel }) }],
    logo: ch?.logo,
  };
}

/** 引擎输出: 面板订阅的最新快照 + 调度统计 */
export interface EngineOutput {
  snapshots: ProviderSnapshot[];
  /** provider_id → InstanceStats(面板/调试展示可选) */
  stats: Record<string, { state: string; consecutiveFailures: number; lastRunAt?: number }>;
}

export type EngineListener = (out: EngineOutput) => void;

export class RuntimeEngine {
  private readonly scheduler = new Scheduler({ httpTimeoutMs: HTTP_TIMEOUT_MS });
  private readonly storage: SnapshotStorage;
  private readonly latest = new Map<string, ProviderSnapshot>();
  private readonly listeners = new Set<EngineListener>();
  /**
   * B-3: 引擎构造时快照的实例 id 集合 —— 写库/入 latest 的准入依据。
   * 实例集合变化会重建引擎(App.tsx useRealEngine), 所以本集合恒等于"本引擎负责的实例";
   * 旧引擎在途采集的迟到响应即使回到旧引擎, 也被 started=false 拦住(见 onResult)。
   */
  private readonly liveIds: Set<string>;
  private started = false;

  constructor(
    private readonly instances: InstanceConfig[],
    storage: SnapshotStorage = getSharedStorage(),
  ) {
    this.storage = storage;
    this.liveIds = new Set(instances.map((i) => i.id));
  }

  /** 注册实例到调度器; 未接入的通道产出显式 unsupported 快照(P0-8, 不静默) */
  private buildInstances(): void {
    for (const inst of this.instances) {
      const descriptor = getPresetChannel(inst.channel);
      if (!descriptor) {
        // P0-8: 目录外通道 → 显式"暂未接入"卡, 不进调度器(无适配器可轮询)
        // eslint-disable-next-line no-console
        console.warn(`[engine] 通道 ${inst.channel} 暂无真实适配器, 显式 unsupported 卡`);
        this.latest.set(inst.id, unsupportedSnapshot(inst));
        continue;
      }
      // D-042: command 类通道走 COMMAND_ADAPTERS(D-036 不变量的 command 半边);
      // 真实 spawn 在主进程 command_run 桥, renderer 零 Node 能力(P0-4 同族纪律)
      if (descriptor.adapter === "command") {
        const commandFactory = COMMAND_ADAPTERS[inst.channel];
        if (!commandFactory) {
          // 目录有 command 描述符但注册表缺(不变量破坏, D-041 断言过)——显式 unsupported
          // eslint-disable-next-line no-console
          console.warn(`[engine] command 通道 ${inst.channel} 未注册适配器, 显式 unsupported 卡`);
          this.latest.set(inst.id, unsupportedSnapshot(inst));
          continue;
        }
        this.registerCommandInstance(inst, descriptor);
        continue;
      }
      // http 类通道: 声明式映射(零代码 §5.1, CHANNEL_MAPPINGS 与 PRESET_CHANNELS 配套, D-036)
      const mapping = CHANNEL_MAPPINGS[inst.channel];
      if (!mapping) {
        // P0-8: 目录有描述符但 http 映射缺(不变量破坏)——显式 unsupported
        // eslint-disable-next-line no-console
        console.warn(`[engine] http 通道 ${inst.channel} 缺映射, 显式 unsupported 卡`);
        this.latest.set(inst.id, unsupportedSnapshot(inst));
        continue;
      }
      const adapter = new GenericHttpAdapter(mapping, runtimeFetch);

      const coreInstance = {
        id: inst.id,
        channel: inst.channel,
        name: inst.name,
        params: inst.params as Record<string, unknown>,
      };

      this.scheduler.add({
        id: inst.id,
        kind: "http",
        intervalMs: parsePollIntervalMs(inst.poll_interval),
        fetch: async (ctx) => {
          const adapterCtx: AdapterContext = {
            signal: ctx.signal,
            timeoutMs: ctx.timeoutMs,
            resolveCredential,
            fetchedAt: Math.floor(Date.now() / 1000),
          };
          // t_5b52b633 兜底: 凭据解析/适配器意外抛错 → 显式 error 快照(不静默蒸发)
          try {
            return await adapter.fetchSnapshot(descriptor, coreInstance, adapterCtx);
          } catch (err) {
            return RuntimeEngine.errorSnapshot(inst, descriptor.plan_type, err);
          }
        },
        onResult: (snap) => void this.onResult(inst.id, snap),
      });
    }
  }

  /** 装配层兜底(t_5b52b633): 适配器/凭据解析意外抛错 → 显式 error 快照。
   *  抛异常会被调度器当作「无结果」静默蒸发 → 面板整卡缺失(本卡根因链最后一环);
   *  P0-8 纪律「不允许静默跳过」的运行时保险丝。 */
  private static errorSnapshot(inst: InstanceConfig, planType: ProviderSnapshot["plan_type"], err: unknown): ProviderSnapshot {
    const message = err instanceof Error ? err.message : String(err);
    return {
      provider_id: inst.id,
      display_name: inst.name,
      plan_type: planType,
      fetched_at: Math.floor(Date.now() / 1000),
      status: "error",
      metrics: [],
      alerts: [{ level: "critical", message, code: "adapter_threw" }],
      error_message: message,
    };
  }

  /**
   * D-042: command 类实例注册到调度器 — fetch 经主进程 command_run 桥执行真实 spawn。
   * 纯浏览器 dev(无桌面桥)→ commandRun 返回 null, 转显式 error 快照(不是 unsupported:
   * 通道已接入, 只是当前运行时无法执行; 用户看到「需桌面壳执行」而非「暂未接入」)。
   */
  private registerCommandInstance(inst: InstanceConfig, descriptor: ChannelDescriptor): void {
    this.scheduler.add({
      id: inst.id,
      kind: "command",
      intervalMs: parsePollIntervalMs(inst.poll_interval),
      fetch: async (ctx) => {
        // t_5b52b633 兜底: command 桥/适配器意外抛错 → 显式 error 快照(不静默蒸发)
        let snap: Awaited<ReturnType<typeof commandRun>>;
        try {
          snap = await commandRun({
            channel: inst.channel,
            descriptor,
            instance: {
              id: inst.id,
              channel: inst.channel,
              name: inst.name,
              params: inst.params as Record<string, unknown>,
            },
            fetchedAt: Math.floor(Date.now() / 1000),
            timeoutMs: ctx.timeoutMs,
          });
        } catch (err) {
          return RuntimeEngine.errorSnapshot(inst, descriptor.plan_type, err);
        }
        if (snap === null) {
          return {
            provider_id: inst.id,
            display_name: inst.name,
            plan_type: descriptor.plan_type,
            fetched_at: Math.floor(Date.now() / 1000),
            status: "error",
            metrics: [],
            alerts: [{ level: "critical", message: t("test.needsHost"), code: "no_host" }],
            error_message: t("test.needsHost"),
          };
        }
        return snap as ProviderSnapshot;
      },
      onResult: (snap) => void this.onResult(inst.id, snap),
    });
  }

  /** 一次采集结果: 落库 → 速率附着 → 通知面板 */
  private async onResult(providerId: string, snap: ProviderSnapshot): Promise<void> {
    // B-3 写库守卫(引擎层, 契约「先停源」): 三种情况的迟到响应静默丢弃 ——
    // ① 引擎已 stop(实例集合变更, 本引擎已被 React 废弃) ② provider 不在构造时的实例集合
    // ③ 快照 provider_id 与调度 id 不一致(适配器串号)。丢弃 = 不落库/不进 latest/不 emit,
    // 保证 purge 之后不会有该 id 的新行落库, 面板也不会闪回旧帧。
    if (!this.started || !this.liveIds.has(providerId) || snap.provider_id !== providerId) return;

    // D-043 存量补写: 首次采集成功(ok)时给无指纹的存量实例回填 key_fingerprint。
    // 不影响本轮结果展示, 失败仅记日志(下次成功再补写)。
    if (snap.status === "ok") {
      void this.backfillKeyFingerprint(providerId);
    }

    // 落库(cache-first 的写侧; 面板永远读内存 latest, 启动时从库恢复)
    try {
      await this.storage.init();
      await this.storage.saveSnapshot(snap);
    } catch (err) {
      // 落库失败不阻塞 UI; 记一次(不含凭据)
      // eslint-disable-next-line no-console
      console.warn(`[engine] 落库失败 ${providerId}:`, err instanceof Error ? err.message : err);
    }

    // 近 7 天速率: 用历史快照(含本次)算 daily_rate, 附着到 balance 指标
    if (snap.status === "ok") {
      try {
        const history = await this.storage.history(providerId, Math.floor(Date.now() / 1000) - 7 * 86_400, 200);
        const rate = dailyRateFromHistory([...history, snap]);
        if (rate !== null) {
          snap.metrics = snap.metrics.map((m) =>
            m.kind === "balance" ? { ...m, daily_rate: rate } : m,
          );
        }
      } catch {
        /* 速率计算失败不影响展示 */
      }
    }

    this.latest.set(providerId, snap);
    this.emit();
  }

  /** 从存储恢复最新快照(启动时面板秒出数) */
  async hydrate(): Promise<void> {
    try {
      await this.storage.init();
      const snaps = await this.storage.latestSnapshots();
      // t_2ac39613: 实例集合是唯一真相源 —— 库里可能有已删实例的历史快照,
      // 必须按现有实例 id 过滤, 否则幽灵快照会进 latest map 导致删除的 provider 复活。
      for (const s of snaps) {
        if (this.liveIds.has(s.provider_id)) this.latest.set(s.provider_id, s);
      }
    } catch {
      /* 无历史数据则从空开始 */
    }
    this.emit();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.buildInstances();
    // P0-8: unsupported 卡不进调度器, 立即广播一次(不等 hydrate/首轮采集)
    this.emit();
    // 先恢复库内最新快照 → 启动即出数; 再启动调度(首次采集带抖动)
    // 附加一次立即同步(§3.1 手动刷新语义): 添加实例后面板马上出数, 不等 0~30s jitter
    void this.hydrate().then(() => {
      this.scheduler.startAll();
      void this.scheduler.refreshAll();
    });
  }

  stop(): void {
    this.started = false;
    this.scheduler.stopAll();
    this.latest.clear();
  }

  /** 手动刷新 = 触发所有实例立即同步(§3.1) */
  refreshAll(): Promise<void> {
    return this.scheduler.refreshAll();
  }

  /**
   * D-043 存量补写: 为无 key_fingerprint 的实例回填指纹 —— 首次采集成功(ok)时调用。
   *
   * fingerprint 是纯函数(keyFingerprint(SHA-256 短摘要), schema.ts), 与添加时 DynamicForm/SaveInstance
   * 所写指纹同规(非空 secret 按字段 key 排序拼接再散列)。因此补写出来的指纹与"当初添加时"一致,
   * 后续添加同 channel 同 key 能被 findKeyDuplicate 正确命中。
   *
   * 这里需从钥匙串解密拿到真实 key(合法场景: 实例配置只存 CredentialRef, 明文在钥匙串 D-029)。
   * 失败不抛出(仅 console.warn), 本引擎本次采集结果照常展示, 下次成功再补写。
   */
  private async backfillKeyFingerprint(providerId: string): Promise<void> {
    const inst = this.instances.find((i) => i.id === providerId);
    // 已有指纹(新实例入库即写过)或非 store 源凭据 → 无需补写
    if (!inst || inst.key_fingerprint) return;
    const secretPairs: Array<[string, string]> = [];
    for (const [k, ref] of Object.entries(inst.params)) {
      const r = ref as CredentialRef | undefined;
      if (r?.source === "store" && r.key) {
        try {
          const value = await getSharedKeyring().get(KEYRING_SERVICE, r.key);
          if (value) secretPairs.push([k, value]);
        } catch {
          /* 钥匙串读取失败: 跳过该凭据, 不回填(下次成功再试) */
        }
      }
    }
    secretPairs.sort(([a], [b]) => a.localeCompare(b));
    if (!secretPairs.length) return;
    const fp = await keyFingerprint(secretPairs.map(([, v]) => v).join("\n"));
    getSharedStore().updateKeyFingerprint(providerId, fp);
  }

  get snapshots(): ProviderSnapshot[] {
    return [...this.latest.values()];
  }

  get stats(): Record<string, { state: string; consecutiveFailures: number; lastRunAt?: number }> {
    const out: Record<string, { state: string; consecutiveFailures: number; lastRunAt?: number }> = {};
    for (const [id, st] of Object.entries(this.scheduler.listStats())) {
      out[id] = { state: st.state, consecutiveFailures: st.consecutiveFailures, lastRunAt: st.lastRunAt };
    }
    return out;
  }

  subscribe(fn: EngineListener): () => void {
    this.listeners.add(fn);
    fn({ snapshots: this.snapshots, stats: this.stats });
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const out: EngineOutput = { snapshots: this.snapshots, stats: this.stats };
    for (const fn of this.listeners) fn(out);
  }
}
