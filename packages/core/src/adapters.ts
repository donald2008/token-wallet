/**
 * ProviderAdapter 注册点 — DESIGN.md §4, §5.1
 *
 * 数据从哪来。本卡立接口与骨架:
 * - ProviderAdapter: 统一契约(输入实例配置+已解析凭据, 输出 ProviderSnapshot)
 * - GenericHttpAdapter: 声明式 URL/headers/JSONPath 映射(零代码接标准接口)
 *   ⚠️ P0-5 起拆到 ./generic-http.ts(browser-safe, 供 app 经 subpath export 接入);
 *     本文件 re-export 保持 core 内 import 兼容。
 * - ScriptedAdapter: TS 类抽象基类(签名/多步/CLI 包装等复杂逻辑)
 *
 * 框架边界(D-015): 不做热加载, 加平台 = 加适配器发新版。
 */
import type { ChannelDescriptor } from "./channels/descriptor.js";
import type { CredentialSourceRegistry } from "./credentials.js";
import type { ProviderSnapshot } from "./schema.js";
import type { FetchContext } from "./scheduler.js";
import type { AdapterContext, GenericHttpMapping, InstanceConfig } from "./generic-http.js";
import { GenericHttpAdapter } from "./generic-http.js";
export { GenericHttpAdapter } from "./generic-http.js";
export type {
  AdapterContext,
  FieldMapping,
  GenericHttpMapping,
  HttpFetchError,
  InstanceConfig,
  MetricMapping,
  ResolveCredential,
} from "./generic-http.js";

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

/** 便捷: 按通道声明构造 GenericHttpAdapter(供注册表注册) */
export function genericHttpFromMapping(mapping: GenericHttpMapping): GenericHttpAdapter {
  return new GenericHttpAdapter(mapping);
}

// 显式 re-export 类型, 便于只 import adapters.js 的旧代码继续可用
export type { CredentialSourceRegistry };
