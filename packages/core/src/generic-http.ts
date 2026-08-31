/**
 * GenericHttpAdapter 浏览器安全子模块 — DESIGN.md §5.1
 *
 * 与 adapters.ts 拆分原因(⚠️ P0-4 实证): core 的 index 桶 re-export sqlite.js(node:sqlite)
 * 与 credentials.js(node:child_process), app 的 vite 浏览器构建不能 import 整个 index。
 * 本文件只含"一次请求 + 静态 JSONPath 映射"的纯浏览器安全部分(jsonpath-plus 是纯 JS),
 * app 通过 subpath export(`@token-wallet/core/generic-http`)接入真实链路。
 *
 * 能力边界(§5.1): 需要签名/多步请求/派生计算的通道走 ScriptedAdapter(留在 adapters.ts)。
 */
import type { ChannelDescriptor } from "./channels/descriptor.js";
import type { ProviderSnapshot, MetricUnit } from "./schema.js";
import {
  applyPipe,
  evalAssertion,
  evalJsonPathFirst,
  MappingError,
  type PipeFilter,
} from "./mapping/jsonpath.js";

/** 单字段映射: JSONPath + 可选过滤器管道; 或常量值(与 path 二选一) */
export interface FieldMapping {
  /** JSONPath, 与 const 二选一 */
  path?: string;
  /** 常量值(如 opencode 的 limit=100, JSONPath 取不到字面量), 与 path 二选一 */
  const?: number;
  pipes?: PipeFilter[];
}

/** 单指标映射 */
export interface MetricMapping {
  key: string;
  kind: "balance" | "window" | "usage";
  unit: MetricUnit;
  used: FieldMapping;
  limit?: FieldMapping;
  /** 窗口重置时间: JSONPath 取时间戳, 或 duration 秒数(加 fetched_at 推算) */
  reset_at?: FieldMapping & { relative?: boolean };
  /** 余额制: 当前剩余余额(直接值, 优先于 limit-used 推导) */
  remaining?: FieldMapping;
  /** 余额制: 币种码(如 "CNY") */
  currency?: FieldMapping;
  /** 余额制: 赠送余额拆分 */
  granted?: FieldMapping;
  /** 余额制: 充值余额拆分 */
  topped_up?: FieldMapping;
}

/** GenericHttpAdapter 的通道声明(内置在通道目录, 用户不可见) */
export interface GenericHttpMapping {
  url: string;
  method?: "GET" | "POST";
  /** 请求头模板; {{api_key}} 占位在请求构造瞬间替换(D-029) */
  headers?: Record<string, string>;
  /** 非 2xx 时判定 auth_expired 的状态码(默认 [401, 403]) */
  auth_expired_status?: number[];
  /**
   * 业务码判态(HTTP 恒 2xx、auth 状态在响应体业务码的通道, 如 zai:\n * HTTP 恒 200, body.code=401 key 坏 / 1001 缺头)。\n * 解析响应体 `$.code`(可指定 path), 命中 auth_expired → auth_expired + setup_hint;\n * 命中 ok → 正常采集; 其余 → error。与 auth_expired_status 互斥(HTTP 判不了时才用)。\n */
  body_code?: {
    /** 业务码 JSONPath, 默认 $.code */
    path?: string;
    /** 视为 ok 的码(如 [200]) */
    ok: number[];
    /** 视为 auth_expired 的码(如 [401]) */
    auth_expired: number[];
  };
  /** auth_expired 快照的修复指引(卡片复制钮语义, §5.0) */
  setup_hint?: string;
  /** 可选状态断言(受限表达式); 全部通过才视为 ok */
  ok_assertions?: string[];
  metrics: MetricMapping[];
}

export class HttpFetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpFetchError";
  }
}

/** 实例配置(§5.0.1 instances.yaml 单条的运行时形态) */
export interface InstanceConfig {
  id: string;
  /** 通道全路径 "platform/product" */
  channel: string;
  /** 用户命名(D-026, 全局唯一由宿主校验) */
  name: string;
  /** 轮询覆盖(毫秒); 缺省走全局默认 */
  poll_interval_ms?: number;
  /** 参数: key → 原始值(text/number/boolean)或已解析的凭据占位 */
  params: Record<string, unknown>;
}

/** 凭据解析函数类型(与 credentials.ts 的注册表签名一致, 但本模块不 import 它) */
export type ResolveCredential = (ref: unknown) => Promise<string>;

export interface AdapterContext {
  /** 超时/stop 时触发 */
  signal: AbortSignal;
  /** 本次调用的超时预算(毫秒) */
  timeoutMs: number;
  /** 按 CredentialRef 解析凭据; 返回值只活在请求构造瞬间(D-029) */
  resolveCredential: ResolveCredential;
  /** 本次采集时间(unix 秒), 适配器填 fetched_at 用 */
  fetchedAt: number;
}

/** 求值一个字段映射: const 优先, 否则 JSONPath; 两者皆无 = 配置错误(不静默兜底) */
function fieldValue(json: unknown, fm: FieldMapping): unknown {
  if (fm.const !== undefined) return fm.const;
  if (!fm.path) throw new MappingError("FieldMapping 必须提供 path 或 const");
  return evalJsonPathFirst(json, fm.path);
}

/**
 * 声明式 HTTP 适配器。只做"一次请求 + 静态映射"(§5.1 能力边界)。
 *
 * 安全: JSONPath 经 mapping/jsonpath.ts 受限求值, 无 eval。
 */
export class GenericHttpAdapter {
  readonly kind = "http" as const;

  constructor(
    private readonly mapping: GenericHttpMapping,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

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

    // 凭据只活在请求构造瞬间(D-029): 替换完 header 即弃
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.mapping.headers ?? {})) {
      let value = v;
      for (const m of v.matchAll(/\{\{(\w+)\}\}/g)) {
        const ref = instance.params[m[1]];
        const secret = await ctx.resolveCredential(ref);
        value = value.replace(m[0], secret);
      }
      headers[k] = value;
    }

    let resp;
    try {
      resp = await this.fetchImpl(this.mapping.url, {
        method: this.mapping.method ?? "GET",
        headers,
        signal: ctx.signal,
      });
    } catch (err) {
      return {
        ...base,
        status: "error",
        metrics: [],
        error_message: err instanceof Error ? err.message : String(err),
      };
    }

    const authCodes = this.mapping.auth_expired_status ?? [401, 403];
    if (authCodes.includes(resp.status)) {
      return { ...base, status: "auth_expired", metrics: [] };
    }
    if (!resp.ok) {
      return {
        ...base,
        status: "error",
        metrics: [],
        error_message: `http ${resp.status}`,
      };
    }

    // 响应体解析失败(如上游回 HTML/截断体)也必须落显式快照 —— 抛异常会走
    // 调度器静默路径(快照蒸发 → 整卡缺失, t_5b52b633 根因之一)。
    let json: unknown;
    try {
      json = await resp.json();
    } catch (err) {
      return {
        ...base,
        status: "error",
        metrics: [],
        error_message: `响应体解析失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (this.mapping.ok_assertions?.some((a) => !evalAssertion(json, a))) {
      return {
        ...base,
        status: "error",
        metrics: [],
        error_message: "状态断言未通过",
      };
    }

    // body_code 判态(HTTP 恒 2xx 的通道, 如 zai): auth 状态在响应体业务码。
    // 不能看 HTTP 状态码(恒 200), 只能解析 body.code 分类:
    //   ok → 继续采集; auth_expired → auth_expired + setup_hint; 其他 → error。
    const bc = this.mapping.body_code;
    if (bc) {
      const codeVal = evalJsonPathFirst(json, bc.path ?? "$.code");
      const code = typeof codeVal === "number" ? codeVal : Number(codeVal);
      if (bc.auth_expired.includes(code)) {
        return {
          ...base,
          status: "auth_expired",
          metrics: [],
          setup_hint: this.mapping.setup_hint,
        };
      }
      if (!bc.ok.includes(code)) {
        return {
          ...base,
          status: "error",
          metrics: [],
          error_message: `业务码 ${code}`,
        };
      }
      // ok → 落到下方正常指标映射
    }

    // 单指标映射失败(字段缺失/管道炸)只跳过该指标 + warn alert, 不炸整卡:
    // 「单窗口数据缺失是数据, 不是故障」(D-036 opencode 单窗 status 协议同源)。
    // 实证(t_5b52b633): kimi 限流态响应 limits[0].detail 缺 used 字段, 旧逻辑
    // MappingError 直接抛出 → 调度器静默 → 整卡消失。
    const metrics: ProviderSnapshot["metrics"] = [];
    const skipped: string[] = [];
    for (const mm of this.mapping.metrics) {
      try {
        const usedRaw = fieldValue(json, mm.used);
        const used = Number(applyPipe(usedRaw, mm.used.pipes ?? ["number"]));
        const limitRaw = mm.limit ? fieldValue(json, mm.limit) : undefined;
        const limit =
          limitRaw !== undefined
            ? Number(applyPipe(limitRaw, mm.limit!.pipes ?? ["number"]))
            : undefined;
        let reset_at: number | undefined;
        if (mm.reset_at) {
          const raw = fieldValue(json, mm.reset_at);
          const n = Number(applyPipe(raw, mm.reset_at.pipes ?? ["number"]));
          reset_at = mm.reset_at.relative ? ctx.fetchedAt + n : n;
        }
        const optional = <T>(fm: FieldMapping | undefined): T | undefined => {
          if (!fm) return undefined;
          const raw = fieldValue(json, fm);
          if (raw === undefined) return undefined;
          return applyPipe(raw, fm.pipes ?? []) as T;
        };
        const metric: Record<string, unknown> = {
          key: mm.key,
          kind: mm.kind,
          unit: mm.unit,
          used,
          limit,
          reset_at,
        };
        const remaining = optional<number>(mm.remaining);
        if (remaining !== undefined) metric.remaining = remaining;
        const currency = optional<string>(mm.currency);
        if (currency !== undefined) metric.currency = currency;
        const granted = optional<number>(mm.granted);
        if (granted !== undefined) metric.granted = granted;
        const topped_up = optional<number>(mm.topped_up);
        if (topped_up !== undefined) metric.topped_up = topped_up;
        metrics.push(metric as ProviderSnapshot["metrics"][number]);
      } catch (err) {
        skipped.push(`${mm.key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 全部指标都映射失败 = 响应形态与 mapping 约定不符 → 显式 error 快照
    if (metrics.length === 0 && this.mapping.metrics.length > 0) {
      return {
        ...base,
        status: "error",
        metrics: [],
        error_message: `指标映射失败: ${skipped.join("; ")}`,
      };
    }

    const alerts = [...base.alerts];
    if (skipped.length > 0) {
      alerts.push({
        level: "warn",
        message: `部分窗口数据缺失, 已跳过: ${skipped.join("; ")}`,
        code: "metric_skipped",
      });
    }

    return { ...base, status: "ok", metrics, alerts };
  }
}
