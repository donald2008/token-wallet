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

/** 子进程 spawn 结果: stdout/stderr 原文 + exit code(判定依赖 exit code 的通道用) */
export interface CommandRunResult {
  stdout: string;
  /** exit code; null 表示被信号终止 */
  code: number | null;
  /** stderr 原文。脱敏纪律: 仅供"命令未找到"等分类判定, 全文不进 error_message */
  stderr: string;
}

/**
 * shell 包装下"命令未找到"(CLI 缺失)判定 — D-041 round2(t_198b1330 #862):
 *
 * win32 下 buildSpawnPlan 一律包 `cmd /c <command>`, cmd.exe 恒存在 →
 * spawn 层**永不**触发 ENOENT error 事件; 目标 CLI 缺失时 cmd 以非零码
 * 退出(Windows 实测 9009; POSIX sh 类比 127)、stdout 空、stderr 提示
 * "not recognized" / "不是内部或外部命令"。
 *
 * 与 spawn 层 ENOENT 同判 CLI 缺失 → 调用方转安装 setup_hint。
 * 注意: 分类**不依赖具体 exit code**(9009/127 因 shell 与 locale 而异,
 * 且契约说 exit code 不可信), 以 stderr 判别串为准。
 */
const SHELL_NOT_FOUND_STDERR_PATTERNS = [
  "not recognized",
  "不是内部或外部命令",
] as const;

export function isShellCommandNotFound(res: CommandRunResult): boolean {
  if (res.code === 0 || res.code === null) return false;
  if (res.stdout.trim() !== "") return false;
  return SHELL_NOT_FOUND_STDERR_PATTERNS.some((p) => res.stderr.includes(p));
}

/**
 * spawn 平台适配计划(D-041, 2026-08-30 aliyun bl 首实例实证):
 * - Node ≥18.20 对 `.cmd`/`.bat` shim 直接 spawn 报 EPERM(CVE-2024-27980)
 *   → Windows 一律经 `cmd /c <command> <args>`(shell: false 仍防注入),
 *   `%APPDATA%\npm\*.cmd` 全路径 shim 同理
 * - windowsHide: true 防命令窗口黑框闪烁
 * - 非 Windows 直接 spawn 原命令
 */
export function buildSpawnPlan(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsHide: boolean } {
  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", command, ...args],
      windowsHide: true,
    };
  }
  return { command, args, windowsHide: false };
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
   * 非零 exit code → reject(带 exit code, 不含 stderr——可能含敏感信息)。
   */
  protected async runCommand(
    command: string,
    args: string[],
    ctx: FetchContext,
  ): Promise<string> {
    const { stdout, code } = await this.runCommandResult(command, args, ctx);
    if (code !== 0) throw new Error(`命令失败(exit=${code}): ${command}`);
    return stdout;
  }

  /**
   * 与 runCommand 同款 spawn 平台适配, 但 resolve {stdout, code} 不 reject ——
   * 供需要解析"失败态 body"(如 bl usage exit=3 的 error JSON)的通道使用。
   * spawn ENOENT(CLI 未装) → reject SpawnError(err), 由调用方转 setup_hint。
   */
  protected async runCommandResult(
    command: string,
    args: string[],
    ctx: FetchContext,
  ): Promise<CommandRunResult> {
    const { spawn } = await import("node:child_process");
    const plan = buildSpawnPlan(command, args);
    return new Promise<CommandRunResult>((resolvePromise, reject) => {
      const child = spawn(plan.command, plan.args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: plan.windowsHide,
      });
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
        reject(new SpawnError(`命令启动失败: ${command}: ${err.message}`, err));
      });
      child.on("close", (code) => {
        ctx.signal.removeEventListener("abort", onAbort);
        if (killTimer !== null) clearTimeout(killTimer);
        resolvePromise({
          stdout: Buffer.concat(chunks).toString("utf8"),
          code,
          stderr: Buffer.concat(errChunks).toString("utf8"),
        });
      });
    });
  }
}

/** spawn 层面的启动失败(ENOENT=CLI 不在 PATH 等); 保留底层错误码供分类 */
export class SpawnError extends Error {
  readonly causeErr: Error;
  constructor(message: string, cause: Error) {
    super(message);
    this.name = "SpawnError";
    this.causeErr = cause;
  }
  get code(): string | undefined {
    return (this.causeErr as NodeJS.ErrnoException).code;
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
