/**
 * 实例存储抽象 — DESIGN.md §5.0.1 / 验收(删除实例同步清钥匙串条目)
 *
 * store 接口本卡用内存 mock 撑住(D-029 说 OS 钥匙串真实现 P0-5/P1)。
 * 语义对齐 core 的 KeychainBackend + StoreCredentialSource:
 *   - 实例配置只存 CredentialRef 引用(值在钥匙串)
 *   - 删除实例 → 同步删除该实例钥匙串条目(D-029)
 *   - 表单保存时: secret 值写入钥匙串, 实例配置存 store 引用
 */
import { useEffect, useRef, useState } from "react";
import type { InstanceConfig, CredentialRef } from "./schema";
import { makeCredentialRef } from "./schema";

/** 钥匙串后端抽象(D-029: Windows 凭据管理器 / Keychain / Secret Service) */
export interface KeyringBackend {
  get(service: string, key: string): Promise<string | null>;
  set(service: string, key: string, value: string): Promise<void>;
  delete(service: string, key: string): Promise<void>;
}

export const KEYRING_SERVICE = "token-wallet";

/** 内存钥匙串 mock —— 本卡(P0-4)撑住 store 接口; local-only, 不落盘 */
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

/** 订阅型实例存储(内存 mock)。增删 → notify → 组件重渲染。 */
export class MemoryInstanceStore {
  private items: InstanceConfig[] = [];
  private listeners = new Set<() => void>();

  list(): InstanceConfig[] {
    return [...this.items];
  }
  add(inst: InstanceConfig): void {
    this.items = [...this.items, inst];
    this.emit();
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
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

// 全局共享实例 store(mock: 仅前端内存, 不落盘)
let sharedStoreInstance: MemoryInstanceStore | null = null;
export function getSharedStore(): MemoryInstanceStore {
  if (!sharedStoreInstance) sharedStoreInstance = new MemoryInstanceStore();
  return sharedStoreInstance;
}

/** 钥匙串 mock 单例共享 */
let sharedKeyring: MemoryKeyring | null = null;
export function getSharedKeyring(): MemoryKeyring {
  if (!sharedKeyring) sharedKeyring = new MemoryKeyring();
  return sharedKeyring;
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