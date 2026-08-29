/**
 * 实例存储抽象 — DESIGN.md §5.0.1 / 验收(删除实例同步清钥匙串条目)
 *
 * 持久化(P0-7 接真): 启动时 loadPersistedInstances() 从 instances.yaml 预填;
 * 增/删实例 → attachPersister 钩子写回 instances.yaml(Rust IPC, configDir, D-019)。
 * 语义对齐 core 的 KeychainBackend + StoreCredentialSource:
 *   - 实例配置只存 CredentialRef 引用(secret 值在钥匙串, D-029 不变)
 *   - 删除实例 → 同步删除该实例钥匙串条目(D-029)
 *   - 表单保存时: secret 值写入钥匙串, 实例配置存 store 引用
 */
import { useEffect, useRef, useState } from "react";
import type { InstanceConfig, CredentialRef } from "./schema";
import { InstancesFileSchema, makeCredentialRef, parseInstances } from "./schema";
import { instancesLoad, instancesSave, isDesktopHost, keyringDelete, keyringGet, keyringSet } from "../ipc";

/** 钥匙串后端抽象(D-029: Windows 凭据管理器 / Keychain / Secret Service) */
export interface KeyringBackend {
  get(service: string, key: string): Promise<string | null>;
  set(service: string, key: string, value: string): Promise<void>;
  delete(service: string, key: string): Promise<void>;
}

export const KEYRING_SERVICE = "token-wallet";

/** 内存钥匙串 mock —— 纯浏览器 dev/localStorage 无桌面桥时兜底; local-only, 不落盘 */
export class MemoryKeyring implements KeyringBackend {
  private readonly store = new Map<string, string>();

  async get(service: string, key: string): Promise<string | null> {
    return this.store.get(`${service}:${key}`) ?? null;
  }
  async set(service: string, key: string, value: string): Promise<void> {
    this.store.set(`${service}:${key}`, value);
  }
  async delete(service: string, key: string): Promise<void> {
    this.store.delete(`${service}:${key}`);
  }
}

/**
 * OS 钥匙串真实现(D-029): 主进程经 IPC 桥接(E2 卡接真)。
 * Windows 凭据管理器 / macOS Keychain / Linux Secret Service。
 */
export class HostKeyring implements KeyringBackend {
  async get(service: string, key: string): Promise<string | null> {
    return keyringGet(service, key);
  }
  async set(service: string, key: string, value: string): Promise<void> {
    await keyringSet(service, key, value);
  }
  async delete(service: string, key: string): Promise<void> {
    await keyringDelete(service, key);
  }
}

/** 增/删后的持久化钩子(P0-7): 由 getSharedStore 默认挂 instances.yaml 写回 */
export type InstancesPersister = (instances: InstanceConfig[]) => void;

// ---- W3: 写盘失败用户可见(不静默, 与 P0-8 同原则) ----
// 内存态不回滚是有意设计(仍可用), 但持久化错误必须暴露给 UI 渲染错误条。
let lastPersistError: string | null = null;
const persistErrorListeners = new Set<() => void>();

/** 最近一次持久化(写盘)错误; null = 无错误/已恢复 */
export function getLastPersistError(): string | null {
  return lastPersistError;
}

/** 订阅持久化错误变化(置起/清除都会通知) */
export function subscribePersistError(fn: () => void): () => void {
  persistErrorListeners.add(fn);
  return () => persistErrorListeners.delete(fn);
}

function setPersistError(message: string | null): void {
  if (lastPersistError === message) return;
  lastPersistError = message;
  for (const fn of persistErrorListeners) fn();
}

/** 订阅型实例存储(内存为主, P0-7 起经 persister 写回 instances.yaml)。增删 → notify → 组件重渲染。 */
export class MemoryInstanceStore {
  private items: InstanceConfig[] = [];
  private listeners = new Set<() => void>();
  private persister: InstancesPersister | null = null;

  /** 挂载持久化钩子: 增/删实例后触发写回 */
  attachPersister(fn: InstancesPersister): void {
    this.persister = fn;
  }

  /** 启动预填(P0-7): instances.yaml 载入的实例直接放入内存, 不触发写回 */
  hydrate(instances: InstanceConfig[]): void {
    this.items = [...instances];
    this.emit();
  }

  list(): InstanceConfig[] {
    return [...this.items];
  }
  add(inst: InstanceConfig): void {
    this.items = [...this.items, inst];
    this.emit();
    this.persist();
  }
  /** 删除实例 + 同步清钥匙串条目(D-029) */
  remove(id: string, keyring: KeyringBackend): void {
    const removed = this.items.find((i) => i.id === id);
    if (!removed) return;
    this.items = this.items.filter((i) => i.id !== id);
    for (const ref of Object.values(removed.params)) {
      // 清一切 store 源引用(secret 值所在钥匙串条目)
      if (ref && typeof ref === "object" && (ref as CredentialRef).source === "store") {
        const key = (ref as CredentialRef).key;
        if (key) void keyring.delete(KEYRING_SERVICE, key);
      }
    }
    this.emit();
    this.persist();
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }
  private persist(): void {
    this.persister?.(this.list());
  }
}

/** 内存实例 → instances.yaml 文件对象; 写回前再过一次 zod 双重唯一校验(D-026 第 2 道) */
export function buildInstancesFile(instances: InstanceConfig[]): {
  version: 1;
  instances: InstanceConfig[];
} {
  const parsed = InstancesFileSchema.safeParse({ version: 1, instances });
  if (!parsed.success) {
    throw new Error(`实例配置校验失败: ${parsed.error.issues[0]?.message ?? "未知错误"}`);
  }
  return parsed.data;
}

/** 全局共享实例 store(内存 + persister 写回 instances.yaml) */
let sharedStoreInstance: MemoryInstanceStore | null = null;
export function getSharedStore(): MemoryInstanceStore {
  if (!sharedStoreInstance) {
    sharedStoreInstance = new MemoryInstanceStore();
    // 默认持久化: 增/删 → zod 校验 → Rust 转 YAML 原子落盘(configDir, D-019/D-032)。
    // 写盘失败不阻塞 UI(内存态仍在, 不回滚是有意设计), 但错误状态置起让 App 顶部
    // 错误条可见(W3: 不静默); 后续写盘成功自动清除。console 记录由日志出口脱敏(不含凭据)。
    sharedStoreInstance.attachPersister((instances) => {
      void (async () => instancesSave(buildInstancesFile(instances)))()
        .then(() => setPersistError(null))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error("[instances] 写回 instances.yaml 失败:", msg);
          setPersistError(msg);
        });
    });
  }
  return sharedStoreInstance;
}

/**
 * 启动加载 instances.yaml → zod 校验(fail-fast D-026) → 预填共享 store。
 * 返回 null = 成功(含首开零配置); 返回 string = 失败原因(调用方须展示配置错误页,
 * 不静默丢配置)。
 */
export async function loadPersistedInstances(): Promise<string | null> {
  let raw: unknown;
  try {
    raw = await instancesLoad();
  } catch (err) {
    return `instances.yaml 读取失败: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (raw === null || raw === undefined) {
    getSharedStore().hydrate([]);
    return null;
  }
  const parsed = parseInstances(raw);
  if (!parsed.ok) return `instances.yaml 校验失败: ${parsed.error ?? "未知错误"}`;
  getSharedStore().hydrate(parsed.instances ?? []);
  return null;
}

/** 钥匙串 mock 单例共享(纯浏览器 dev 用) */
let sharedMemoryKeyring: MemoryKeyring | null = null;
/** 桌面宿主钥匙串单例(真 OS 钥匙串 D-029, E2 卡接真) */
let sharedHostKeyring: HostKeyring | null = null;

/**
 * 共享钥匙串后端: 桌面宿主 → OS 钥匙串(主进程 IPC);
 * 纯浏览器 dev(无桌面桥)→ 内存 mock。
 */
export function getSharedKeyring(): KeyringBackend {
  if (isDesktopHost()) {
    if (!sharedHostKeyring) sharedHostKeyring = new HostKeyring();
    return sharedHostKeyring;
  }
  if (!sharedMemoryKeyring) sharedMemoryKeyring = new MemoryKeyring();
  return sharedMemoryKeyring;
}

/** React 绑定: 订阅 store 变更返回最新实例列表 */
export function useInstances(): InstanceConfig[] {
  const store = getSharedStore();
  const [, setTick] = useState(0);
  const tickRef = useRef(0);
  useEffect(() => {
    return store.subscribe(() => {
      tickRef.current += 1;
      setTick(tickRef.current);
    });
  }, [store]);
  return store.list();
}

/** React 绑定: 最近一次持久化错误(W3 错误条); 写盘恢复后回到 null */
export function usePersistError(): string | null {
  const [, setTick] = useState(0);
  useEffect(() => subscribePersistError(() => setTick((t: number) => t + 1)), []);
  return getLastPersistError();
}

/** 当前实例名集合(供表单即时唯一校验 D-026) */
export function existingNames(): Set<string> {
  return new Set(getSharedStore().list().map((i) => i.name));
}

/** 便捷: 把表单 secret 值写入钥匙串, 构造 instance.params 的 CredentialRef 并加 store */
export interface DraftInput {
  id: string;
  channel: string;
  name: string;
  poll_interval?: string;
  /** 表单参数 raw 值; secret 字段的值恒为 string, 非 secret 可为 number/boolean/string */
  params: Record<string, string | number | boolean>;
  /** 钥匙串里 secret 字段的 key 名(即参数 key) */
  secretFields: string[];
  keyring: KeyringBackend;
}

/** 保存一个实例: secret 值写入钥匙串, 配置只存引用(§5.0.1, D-029) */
export async function saveInstance(draft: DraftInput): Promise<InstanceConfig> {
  const params: InstanceConfig["params"] = {};
  for (const [k, v] of Object.entries(draft.params)) {
    if (draft.secretFields.includes(k)) {
      const ref = makeCredentialRef(draft.id, k);
      await draft.keyring.set(KEYRING_SERVICE, ref.key!, String(v));
      params[k] = ref;
    } else {
      params[k] = v;
    }
  }
  const inst: InstanceConfig = {
    id: draft.id,
    channel: draft.channel,
    name: draft.name,
    ...(draft.poll_interval ? { poll_interval: draft.poll_interval } : {}),
    params,
  };
  getSharedStore().add(inst);
  return inst;
}