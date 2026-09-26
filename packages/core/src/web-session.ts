/**
 * web_session 第三凭据范式 — t_4ad1c22e, D-058
 *
 * 适用边界: **仅无 API 用量端点的平台**(如小米 MiMo Token Plan——tp 网关 /v1/usage
 * 等 404 实锤, 用量只在控制台域, 走账号 SSO 会话 cookie)。有 API key 端点的平台
 * 一律用既有 api_key 范式, 禁用 web_session(安全面更大: cookie 即全账号会话)。
 *
 * 安全纪律(D-058):
 * - cookie 串 = 凭据值, 走既有 CredentialRef 四源(store=keyring/safeStorage 与
 *   API key 同级), 永不进实例配置/日志/错误信息/测试真值
 * - 只注入声明了 auth.kind=web_session 的通道指定的请求头; 请求只发往
 *   cookie_domain 同域端点, 禁外发第三方域
 * - 桌面端 keyring 后端 = safeStorage(D-033), cookie 与 key 加密同级
 *
 * 数据面复用既有 GenericHttpMapping 声明式 JSON 映射(零新解析框架):
 * 端点列表 = 若干 GenericHttpMapping 声明, 组合器并发拉取 + best-effort 聚合。
 * **跨端点指标聚合也是声明式**(patches 字段直拷, 通道 spec 声明, 组合器通吃任意
 * 通道, MiMo 零专用代码): 主端点产 metric 骨架, 辅端点按 patches 声明把
 * 「本端点已映射好的 metric 字段」(管道已在 GenericHttpAdapter 内应用)拷给主端点
 * 同 key metric —— 组合器不做二次 JSON 求值, 不复制解析逻辑。
 */
import type { ChannelDescriptor } from "./channels/descriptor.js";
import type { GenericHttpMapping, InstanceConfig, AdapterContext } from "./generic-http.js";
import { GenericHttpAdapter } from "./generic-http.js";
import type { ProviderSnapshot, Metric } from "./schema.js";

/** 单端点请求声明: 复用既有 GenericHttpMapping(声明式映射, 零新解析框架) */
export interface WebSessionEndpoint {
  /** 端点标识(错误信息/测试可见, 不含凭据) */
  name: string;
  mapping: GenericHttpMapping;
}

/** metric 字段名(patches 拷贝的源/目标字段域) */
export type PatchableField =
  | "used"
  | "limit"
  | "reset_at"
  | "remaining"
  | "currency"
  | "granted"
  | "topped_up"
  // 套餐元信息(t_7672da28): 沿用既有 patches 单一覆写机制, 禁另起聚合通道
  | "plan_code"
  | "expired";

/**
 * 跨端点字段覆写声明(通吃任意通道, 无通道专用代码):
 * 主端点 metrics 里 key 相同的 metric, 其 field 字段 = 辅端点快照中
 * sourceKey metric 的 sourceField 字段值(已含管道产出, 直拷)。
 */
export interface CrossEndpointPatch {
  /** 目标 metric key(主端点 mapping.metrics 里的 key) */
  key: string;
  /** 覆写字段 */
  field: PatchableField;
  /** 源端点名(辅助端点) */
  endpoint: string;
  /** 辅端点快照里源 metric 的 key */
  sourceKey: string;
  /** 辅端点源 metric 的字段 */
  sourceField: PatchableField;
}

/**
 * web_session 通道声明(声明式注册, 通道目录单一事实源)。
 * 端点并发拉取; primary 失败决定整卡状态; 其余失败 best-effort → warn alert。
 */
export interface WebSessionChannelSpec {
  /** 端点列表(并发拉取) */
  endpoints: WebSessionEndpoint[];
  /** 主端点名(决定整卡状态与 metric 骨架) */
  primary: string;
  /** 跨端点 metric 覆写声明(如 MiMo: usage 覆写 used/limit, detail 覆写 reset_at) */
  patches: CrossEndpointPatch[];
  /** auth_expired 快照的修复指引 */
  setup_hint: string;
}

/** 校验 cookie 串包含全部必需 cookie 名(只看名字, 不看值——值禁落日志) */
export function validateCookieNames(cookie: string, required: readonly string[]): boolean {
  const present = new Set(
    cookie
      .split(";")
      .map((p) => p.trim().split("=", 1)[0]?.trim())
      .filter((n): n is string => !!n),
  );
  return required.every((r) => present.has(r));
}

/** 3xx 重定向到登录页(会话失效第三形态): 不跟随, 直接判 auth_expired */
export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/** 非法端点 URL(域不匹配/非同源)——安全护栏, 不静默放行 */
export class WebSessionDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSessionDomainError";
  }
}

function endpointHost(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    throw new WebSessionDomainError(`端点 URL 非法: ${raw}`);
  }
}

/** 3xx 快照兜底: GenericHttpAdapter 把 3xx 归为 error(http ${status}), 会话语义下应为 auth_expired */
function redirectAware(snap: ProviderSnapshot, setupHint: string): ProviderSnapshot {
  const m = /^http (3\d\d)$/.exec(snap.error_message ?? "");
  if (snap.status === "error" && m) {
    return { ...snap, status: "auth_expired", error_message: undefined, setup_hint: setupHint };
  }
  return snap;
}

/**
 * web_session 通道组合适配器(§5.1 能力边界内: 每端点仍是一次请求 + 静态映射)。
 * 构造时校验: 所有端点必须与主端点同域(D-058 禁外发第三方域)。
 * 由引擎/测试连接按 descriptor.auth.kind === "web_session" 分流构造(spec 从
 * 通道目录按 channel 查, 引擎侧零通道专用代码)。
 */
export class WebSessionCompositeAdapter {
  readonly kind = "http" as const;

  constructor(
    private readonly spec: WebSessionChannelSpec,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const primaryUrl = this.specPrimaryUrl();
    const primaryHost = endpointHost(primaryUrl);
    for (const ep of spec.endpoints) {
      const host = endpointHost(ep.mapping.url);
      if (host !== primaryHost) {
        throw new WebSessionDomainError(
          `端点 ${ep.name} 域 ${host} 与主端点域 ${primaryHost} 不同(D-058 禁外发第三方域)`,
        );
      }
    }
  }

  private specPrimaryUrl(): string {
    const primary = this.spec.endpoints.find((e) => e.name === this.spec.primary);
    if (!primary) throw new WebSessionDomainError(`主端点 ${this.spec.primary} 不在端点列表`);
    return primary.mapping.url;
  }

  async fetchSnapshot(
    descriptor: ChannelDescriptor,
    instance: InstanceConfig,
    ctx: AdapterContext,
  ): Promise<ProviderSnapshot> {
    const base = {
      provider_id: instance.id,
      display_name: instance.name,
      plan_type: descriptor.plan_type,
      fetched_at: ctx.fetchedAt,
      alerts: [] as ProviderSnapshot["alerts"],
      logo: descriptor.logo,
    };
    const auth = descriptor.auth;
    if (!auth || auth.kind !== "web_session") {
      return { ...base, status: "error", metrics: [], error_message: "描述符缺 web_session auth 契约" };
    }

    // cookie 凭据只活在请求构造瞬间(D-029): 解析一次, 构造完请求即弃
    let cookie: string;
    try {
      cookie = await ctx.resolveCredential(instance.params.web_session);
    } catch (err) {
      return {
        ...base,
        status: "auth_expired",
        metrics: [],
        setup_hint: this.spec.setup_hint,
        error_message: err instanceof Error ? err.message : String(err),
      };
    }
    if (!validateCookieNames(cookie, auth.required_cookies)) {
      // 缺必需 cookie = 凭据形态错误(等于没登录) → auth_expired 引导重新授权
      return {
        ...base,
        status: "auth_expired",
        metrics: [],
        setup_hint: this.spec.setup_hint,
      };
    }

    // 端点并发; 每端点独立 adapter, cookie 在各自请求构造瞬间注入同一串
    const results = await Promise.all(
      this.spec.endpoints.map(async (ep) => {
        const mapping: GenericHttpMapping = {
          ...ep.mapping,
          headers: {
            ...ep.mapping.headers,
            [auth.header_name]: cookie,
          },
        };
        const adapter = new GenericHttpAdapter(mapping, this.fetchImpl);
        const snap = redirectAware(
          await adapter.fetchSnapshot(descriptor, instance, ctx),
          this.spec.setup_hint,
        );
        return { ep, snap };
      }),
    );

    const primary = results.find((r) => r.ep.name === this.spec.primary);
    if (!primary) {
      return {
        ...base,
        status: "error",
        metrics: [],
        error_message: `主端点 ${this.spec.primary} 不在端点列表(配置错误)`,
      };
    }

    const alerts: ProviderSnapshot["alerts"] = [...primary.snap.alerts];
    for (const { ep, snap } of results) {
      if (ep.name === this.spec.primary) continue;
      if (snap.status === "auth_expired") {
        // 会话失效是会话级事实: 辅助端点判出 → 整卡 auth_expired(重新授权)
        return { ...base, status: "auth_expired", metrics: [], setup_hint: this.spec.setup_hint };
      }
      if (snap.status !== "ok") {
        alerts.push({
          level: "warn",
          message: `${ep.name} 端点采集失败(best-effort 不阻塞): ${snap.error_message ?? snap.status}`,
          code: "endpoint_best_effort",
        });
      }
    }
    if (primary.snap.status !== "ok") {
      return { ...primary.snap, alerts };
    }

    return this.applyPatches(primary.snap, results, alerts);
  }

  /**
   * 声明式跨端点聚合: 主端点 metric 骨架 + patches 字段直拷(通吃任意通道)。
   * 拷贝失败(源 metric/字段缺失或无效)只跳过该 patch + warn alert, 不炸整卡
   * (D-036 单指标纪律: 数据缺失是数据不是故障)。
   */
  private applyPatches(
    primarySnap: ProviderSnapshot,
    results: { ep: WebSessionEndpoint; snap: ProviderSnapshot }[],
    alerts: ProviderSnapshot["alerts"],
  ): ProviderSnapshot {
    if (this.spec.patches.length === 0) return primarySnap;
    const metrics = primarySnap.metrics.map((m) => ({ ...m }) as Metric);
    const snapByEndpoint = new Map(results.map((r) => [r.ep.name, r.snap]));
    const skipped: string[] = [];
    for (const p of this.spec.patches) {
      const sourceSnap = snapByEndpoint.get(p.endpoint);
      const sourceMetric = sourceSnap?.metrics.find((m) => m.key === p.sourceKey);
      // 目标 metric 不在主端点快照(如 MiMo monthly_credits 只由辅端点产出):
      // 从源 metric 整体克隆并入(声明式聚合的「新增」半边), 再逐字段覆写。
      if (!metrics.find((m) => m.key === p.key) && sourceMetric) {
        metrics.push({ ...sourceMetric, key: p.key });
      }
      const target = metrics.find((m) => m.key === p.key);
      const value = sourceMetric ? (sourceMetric as unknown as Record<string, unknown>)[p.sourceField] : undefined;
      if (!target || value === undefined || value === null) {
        skipped.push(`${p.key}.${p.field}(源 ${p.endpoint}:${p.sourceKey}.${p.sourceField} 不可用)`);
        continue;
      }
      // reset_at 无效值(0/负)不覆写——保持主端点骨架值或缺省
      if (p.field === "reset_at" && (typeof value !== "number" || value <= 0)) {
        skipped.push(`${p.key}.reset_at(无效值)`);
        continue;
      }
      (target as unknown as Record<string, unknown>)[p.field] = value;
    }
    if (skipped.length > 0) {
      alerts.push({
        level: "warn",
        message: `部分聚合字段缺失, 已跳过: ${skipped.join("; ")}`,
        code: "metric_skipped",
      });
    }
    return { ...primarySnap, metrics, alerts };
  }
}
