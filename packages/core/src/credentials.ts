/**
 * CredentialRef + CredentialSource — DESIGN.md §5.0.1, D-013 / D-029
 *
 * 实例配置只存引用, 永不存值; 仓库零密钥。
 * - store:    桌面端 OS 钥匙串(宿主注入 KeychainBackend, app 侧=keyring crate)
 * - env:      headless 环境变量
 * - file:     600 权限文件(headless 降级链末端, 文档显著警告)
 * - command:  外部命令(我们接 Consul KV 的口子)
 *
 * 内存纪律(D-029): key 只活在请求构造瞬间; 错误/日志永不包含凭据值。
 */
import { z } from "zod";

export const CredentialSourceKindSchema = z.enum(["store", "env", "file", "command"]);
export type CredentialSourceKind = z.infer<typeof CredentialSourceKindSchema>;

export const CredentialRefSchema = z.object({
  source: CredentialSourceKindSchema,
  /**
   * 各源语义:
   * - store:   钥匙串条目 key(缺省用默认条目名)
   * - env:     环境变量名(必填)
   * - file:    文件路径(必填)
   * - command: 命令行(必填), stdout 第一行即凭据
   */
  key: z.string().min(1).optional(),
});
export type CredentialRef = z.infer<typeof CredentialRefSchema>;

/** 凭据解析失败。message 只允许描述"哪个源/哪个 key 失败", 禁止携带值 */
export class CredentialError extends Error {
  constructor(
    public readonly source: CredentialSourceKind,
    message: string,
  ) {
    super(message);
    this.name = "CredentialError";
  }
}

export class CredentialNotFoundError extends CredentialError {
  constructor(source: CredentialSourceKind, message: string) {
    super(source, message);
    this.name = "CredentialNotFoundError";
  }
}

/** 统一凭据源接口(四个注册点之一, §4) */
export interface CredentialSource {
  readonly kind: CredentialSourceKind;
  /**
   * 解析引用为凭据值。返回值是调用方责任: 用完即弃, 不进状态/日志。
   * 找不到或失败抛 CredentialError / CredentialNotFoundError。
   */
  resolve(ref: CredentialRef): Promise<string>;
}

function requireKey(ref: CredentialRef, what: string): string {
  if (!ref.key) {
    throw new CredentialError(ref.source, `${ref.source} 源缺少 key(${what})`);
  }
  return ref.key;
}

/** env 源: 读环境变量(D-029 headless 降级链首选) */
export class EnvCredentialSource implements CredentialSource {
  readonly kind = "env" as const;
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  async resolve(ref: CredentialRef): Promise<string> {
    const name = requireKey(ref, "环境变量名");
    const value = this.env[name];
    if (value === undefined || value === "") {
      throw new CredentialNotFoundError("env", `环境变量未设置: ${name}`);
    }
    return value;
  }
}

/** file 源: 读文件全文(trim)。POSIX 下强制 group/other 零权限(D-029 600 文件) */
export class FileCredentialSource implements CredentialSource {
  readonly kind = "file" as const;

  async resolve(ref: CredentialRef): Promise<string> {
    const path = requireKey(ref, "文件路径");
    const { readFile, stat } = await import("node:fs/promises");
    let st;
    try {
      st = await stat(path);
    } catch {
      throw new CredentialNotFoundError("file", `凭据文件不存在: ${path}`);
    }
    if (process.platform !== "win32" && (st.mode & 0o077) !== 0) {
      throw new CredentialError(
        "file",
        `凭据文件权限过宽(应为 600/400): ${path}`,
      );
    }
    const content = (await readFile(path, "utf8")).trim();
    if (content === "") {
      throw new CredentialNotFoundError("file", `凭据文件为空: ${path}`);
    }
    return content;
  }
}

export interface CommandSourceOptions {
  /** 命令超时(毫秒), 默认 15s 与调度器 command 超时一致 */
  timeoutMs?: number;
}

/** command 源: 跑外部命令取 stdout(D-013: 我们部署用 command 接 Consul KV) */
export class CommandCredentialSource implements CredentialSource {
  readonly kind = "command" as const;
  constructor(private readonly opts: CommandSourceOptions = {}) {}

  async resolve(ref: CredentialRef): Promise<string> {
    const cmd = requireKey(ref, "命令行");
    const { execFile } = await import("node:child_process");
    const timeoutMs = this.opts.timeoutMs ?? 15_000;
    return new Promise<string>((resolvePromise, reject) => {
      // 经 sh -c 以支持管道/重定向; 命令来自受信任的实例配置(管理员面), 非用户输入
      execFile(
        "sh",
        ["-c", cmd],
        { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (err, stdout, _stderr) => {
          if (err) {
            // stderr 可能含敏感信息, 只带 exit 语义不带输出全文
            const timedOut = err.killed || err.signal === "SIGTERM";
            reject(
              new CredentialError(
                "command",
                timedOut
                  ? `凭据命令超时(${timeoutMs}ms): ${cmd}`
                  : `凭据命令失败(exit=${err.code ?? "?"}): ${cmd}`,
              ),
            );
            return;
          }
          const value = stdout.trim();
          if (value === "") {
            reject(new CredentialNotFoundError("command", `凭据命令输出为空: ${cmd}`));
            return;
          }
          resolvePromise(value);
        },
      );
    });
  }
}

/**
 * OS 钥匙串后端 — 由宿主注入:
 * - app(Electron, D-033): 主进程钥匙串经 IPC 桥接(E2 接真)
 * - mcp-server/测试: 内存 mock 或 Secret Service 封装
 */
export interface KeychainBackend {
  get(service: string, key: string): Promise<string | null>;
  set(service: string, key: string, value: string): Promise<void>;
  delete(service: string, key: string): Promise<void>;
}

export const KEYCHAIN_SERVICE = "token-wallet";
export const DEFAULT_STORE_KEY = "default";

/** store 源: 桌面端默认, 委托宿主注入的钥匙串后端(D-029) */
export class StoreCredentialSource implements CredentialSource {
  readonly kind = "store" as const;
  constructor(
    private readonly backend: KeychainBackend,
    private readonly service: string = KEYCHAIN_SERVICE,
  ) {}

  async resolve(ref: CredentialRef): Promise<string> {
    const key = ref.key ?? DEFAULT_STORE_KEY;
    const value = await this.backend.get(this.service, key);
    if (value === null || value === "") {
      throw new CredentialNotFoundError("store", `钥匙串条目不存在: ${key}`);
    }
    return value;
  }

  /** 设置页保存凭据(实例配置只留 CredentialRef) */
  async store(key: string, value: string): Promise<void> {
    await this.backend.set(this.service, key, value);
  }

  /** 删除实例时同步删钥匙串条目(D-029) */
  async remove(key: string): Promise<void> {
    await this.backend.delete(this.service, key);
  }
}

/**
 * 凭据源注册表(四个注册点之一)。四种源内建注册; resolve() 按 ref.source 分发,
 * 分发前 zod 校验 ref。
 */
export class CredentialSourceRegistry {
  private readonly sources = new Map<CredentialSourceKind, CredentialSource>();

  register(source: CredentialSource): void {
    this.sources.set(source.kind, source);
  }

  get(kind: CredentialSourceKind): CredentialSource | undefined {
    return this.sources.get(kind);
  }

  async resolve(ref: unknown): Promise<string> {
    const parsed = CredentialRefSchema.parse(ref);
    const source = this.sources.get(parsed.source);
    if (!source) {
      throw new CredentialError(parsed.source, `凭据源未注册: ${parsed.source}`);
    }
    return source.resolve(parsed);
  }
}

/** 便捷工厂: env/file/command + 注入后端的 store, 一次配齐四源 */
export function createDefaultCredentialSources(backend: KeychainBackend): CredentialSourceRegistry {
  const reg = new CredentialSourceRegistry();
  reg.register(new EnvCredentialSource());
  reg.register(new FileCredentialSource());
  reg.register(new CommandCredentialSource());
  reg.register(new StoreCredentialSource(backend));
  return reg;
}
