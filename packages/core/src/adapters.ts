/**
 * ProviderAdapter 注册点 — DESIGN.md §4, §5.1
 *
 * 数据从哪来。本卡立接口与骨架:
 * - ProviderAdapter: 统一契约(输入实例配置+已解析凭据, 输出 ProviderSnapshot)
 * - GenericHttpAdapter: 声明式 URL/headers/JSONPath 映射(零代码接标准接口)
 * - ScriptedAdapter: TS 类抽象基类(签名/多步/CLI 包装等复杂逻辑)
 *
 * 框架边界(D-015): 不做热加载, 加平台 = 加适配器发新版。
 */
import type { ChannelDescriptor } from "./channels/descriptor.js";
import type { CredentialSourceRegistry } from "./credentials.js";
import type { ProviderSnapshot } from "./schema.js";
import type { FetchContext } from "./scheduler.js";
import {
  applyPipe,
  evalAssertion,
  evalJsonPathFirst,
  type PipeFilter,
} from "./mapping/jsonpath.js";

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

export interface AdapterContext extends FetchContext {
  /** 按 CredentialRef 解析凭据; 返回值只活在请求构造瞬间(D-029) */
  resolveCredential: CredentialSourceRegistry["resolve"];
  /** 本次采集时间(unix 秒), 适配器填 fetched_at 用 */
  fetchedAt: number;
}

/** 统一适配器契约(四个注册点之一) */
export interface ProviderAdapter {
  /** 采集类型(D-028): http / command; local-agent 为 P3 预留 */
  readonly kind: "http" | "command" | "local-agent";
  /** 采集一次, 输出统一快照。永不 throw 凭据值; 失败返回 status=error 快照或抛错 */
  fetchSnapshot(
    descriptor: ChannelDescriptor,
    instance: InstanceConfig,
    ctx: AdapterContext,
  ): Promise<ProviderSnapshot>;
  /** command 类通道健康检查(§5.0); http 类可不实现 */
  healthCheck?(
    descriptor: ChannelDescriptor,
    instance: InstanceConfig,
    ctx: AdapterContext,
  ): Promise<{ ok: boolean; setupHint?: string }>;
}

// ---- GenericHttpAdapter 声明式映射(骨架, §5.1) ----

/** 单字段映射: JSONPath + 可选过滤器管道 */
export interface FieldMapping {
  path: string;
  pipes?: PipeFilter[];
}

/** 单指标映射 */
export interface MetricMapping {
  key: string;
  kind: "balance" | "window" | "usage";
  unit: "requests" | "credits" | "cny" | "tokens";
  used: FieldMapping;
  limit?: FieldMapping;
  /** 窗口重置时间: JSONPath 取时间戳, 或 duration 秒数(加 fetched_at 推算) */
  reset_at?: FieldMapping & { relative?: boolean };
}

/** GenericHttpAdapter 的通道声明(内置在通道目录, 用户不可见) */
export interface GenericHttpMapping {
  url: string;
  method?: "GET" | "POST";
  /** 请求头模板; {{api_key}} 占位在请求构造瞬间替换(D-029) */
  headers?: Record<string, string>;
  /** 非 2xx 时判定 auth_expired 的状态码(默认 [401, 403]) */
  auth_expired_status?: number[];
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

/**
 * 声明式 HTTP 适配器骨架。只做"一次请求 + 静态映射"(§5.1 能力边界);
 * 需要签名/多步/派生计算的通道走 ScriptedAdapter。
 *
 * 安全: JSONPath 经 mapping/jsonpath.ts 受限求值, 无 eval。
 */
export class GenericHttpAdapter implements ProviderAdapter {
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

    const json: unknown = await resp.json();
    if (
      this.mapping.ok_assertions?.some((a) => !evalAssertion(json, a))
    ) {
      return {
        ...base,
        status: "error",
        metrics: [],
        error_message: "状态断言未通过",
      };
    }

    const metrics = this.mapping.metrics.map((mm) => {
      const usedRaw = evalJsonPathFirst(json, mm.used.path);
      const used = Number(applyPipe(usedRaw, mm.used.pipes ?? ["number"]));
      const limitRaw = mm.limit ? evalJsonPathFirst(json, mm.limit.path) : undefined;
      const limit =
        limitRaw !== undefined
          ? Number(applyPipe(limitRaw, mm.limit!.pipes ?? ["number"]))
          : undefined;
      let reset_at: number | undefined;
      if (mm.reset_at) {
        const raw = evalJsonPathFirst(json, mm.reset_at.path);
        const n = Number(applyPipe(raw, mm.reset_at.pipes ?? ["number"]));
        reset_at = mm.reset_at.relative ? ctx.fetchedAt + n : n;
      }
      return { key: mm.key, kind: mm.kind, unit: mm.unit, used, limit, reset_at };
    });

    return { ...base, status: "ok", metrics };
  }
}

/**
 * ScriptedAdapter 抽象基类(§5.1)。复杂通道继承实现 fetchSnapshot;
 * 提供 runCommand 受控子进程助手(超时联动 AbortSignal, kill 硬切断)。
 */
export abstract class ScriptedAdapter implements ProviderAdapter {
  abstract readonly kind: "command" | "local-agent";
  abstract fetchSnapshot(
    descriptor: ChannelDescriptor,
    instance: InstanceConfig,
    ctx: AdapterContext,
  ): Promise<ProviderSnapshot>;

  /**
   * 跑 CLI 子进程取 stdout; signal abort/超时即 SIGTERM → 5s 后 SIGKILL。
   */
  protected async runCommand(
    command: string,
    args: string[],
    ctx: FetchContext,
  ): Promise<string> {
    const { spawn } = await import("node:child_process");
    return new Promise<string>((resolvePromise, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.stderr.on("data", (c: Buffer) => errChunks.push(c));

      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const onAbort = () => {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
        if (typeof killTimer === "object" && killTimer && "unref" in killTimer) {
          (killTimer as { unref: () => void }).unref();
        }
        reject(new Error(`命令被切断: ${command}`));
      };
      if (ctx.signal.aborted) {
        onAbort();
        return;
      }
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      child.on("error", (err) => {
        ctx.signal.removeEventListener("abort", onAbort);
        reject(new Error(`命令启动失败: ${command}: ${err.message}`));
      });
      child.on("close", (code) => {
        ctx.signal.removeEventListener("abort", onAbort);
        if (killTimer !== null) clearTimeout(killTimer);
        if (code === 0) resolvePromise(Buffer.concat(chunks).toString("utf8"));
        // stderr 可能含敏感信息, 只带 exit code
        else reject(new Error(`命令失败(exit=${code}): ${command}`));
      });
    });
  }
}

/** 适配器注册表(四个注册点之一): channel → adapter 实例 */
export class ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(channel: string, adapter: ProviderAdapter): void {
    if (this.adapters.has(channel)) {
      throw new Error(`适配器重复注册: ${channel}`);
    }
    this.adapters.set(channel, adapter);
  }

  get(channel: string): ProviderAdapter | undefined {
    return this.adapters.get(channel);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
