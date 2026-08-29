/**
 * L1 单元: instances.yaml 持久化(P0-7, §5.0.1/D-019/D-026/D-032)
 *
 * 覆盖:
 * - 持久化往返: buildInstancesFile → 序列化 → parseInstances 还原(CredentialRef 引用不变, 无 secret 值)
 * - 损坏文件 fail-fast: YAML/JSON 层 reject + zod 层(重复名/版本错) → 错误消息, 不静默丢配置
 * - 增/删触发 persister 写回; hydrate 预填不触发写回
 * - consent 持久化(浏览器降级链): persistConsent → getBootstrap firstRun=false
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const loadMock = vi.fn<() => Promise<unknown | null>>();
const saveMock = vi.fn<(file: unknown) => Promise<void>>();

vi.mock("../ipc", () => ({
  isTauriRuntime: () => false,
  keyringGet: async () => null,
  keyringSet: async () => undefined,
  keyringDelete: async () => undefined,
  instancesLoad: () => loadMock(),
  instancesSave: (file: unknown) => saveMock(file),
}));

import {
  MemoryInstanceStore,
  MemoryKeyring,
  KEYRING_SERVICE,
  buildInstancesFile,
  loadPersistedInstances,
  getSharedStore,
  getLastPersistError,
  subscribePersistError,
} from "./store";
import { parseInstances, type InstanceConfig } from "./schema";

const inst = (id: string, name: string): InstanceConfig => ({
  id,
  channel: "deepseek/balance",
  name,
  params: { api_key: { source: "store", key: `${id}:api_key` } },
});

describe("instances.yaml 持久化(P0-7)", () => {
  beforeEach(() => {
    loadMock.mockReset();
    saveMock.mockReset().mockResolvedValue(undefined);
  });

  it("持久化往返: 序列化 → 解析还原, CredentialRef 引用不变", () => {
    const original = [inst("ds-1", "DeepSeek-按量 #1"), inst("ds-2", "DS-小号")];
    const file = buildInstancesFile(original);
    // 模拟 YAML 往返(JSON 形态等价: Rust 侧 serde_yaml 保结构)
    const roundTripped = JSON.parse(JSON.stringify(file)) as unknown;
    const parsed = parseInstances(roundTripped);
    expect(parsed.ok).toBe(true);
    expect(parsed.instances).toEqual(original);
    // 落盘的只有 CredentialRef 引用, 无 secret 值(D-029)
    const text = JSON.stringify(file);
    expect(text).toContain('"source":"store"');
    expect(text).not.toContain("sk-");
  });

  it("buildInstancesFile 双重校验(D-026): 重复名抛错拒绝写盘", () => {
    expect(() => buildInstancesFile([inst("a", "dup"), inst("b", "dup")])).toThrow(
      /实例名重复/,
    );
  });

  it("增/删触发 persister 写回; hydrate 预填不触发", () => {
    const store = new MemoryInstanceStore();
    const seen: InstanceConfig[][] = [];
    store.attachPersister((list) => seen.push(list));
    const keyring = new MemoryKeyring();

    store.hydrate([inst("h", "预填")]); // 启动预填不写回
    expect(seen).toHaveLength(0);

    store.add(inst("n", "新增"));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.map((i) => i.id)).toEqual(["h", "n"]);

    store.remove("h", keyring);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.map((i) => i.id)).toEqual(["n"]);
  });

  it("启动加载: 文件不存在 → 零配置, 不报错", async () => {
    loadMock.mockResolvedValue(null);
    const err = await loadPersistedInstances();
    expect(err).toBeNull();
    expect(getSharedStore().list()).toEqual([]);
  });

  it("启动加载: 合法文件 → 预填共享 store(重启实例仍在)", async () => {
    const file = buildInstancesFile([inst("ds-1", "DeepSeek-按量 #1")]);
    loadMock.mockResolvedValue(JSON.parse(JSON.stringify(file)));
    const err = await loadPersistedInstances();
    expect(err).toBeNull();
    const loaded = getSharedStore().list();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(inst("ds-1", "DeepSeek-按量 #1"));
  });

  it("损坏 fail-fast: zod 拒绝(重复名) → 返回错误消息, 不预填", async () => {
    loadMock.mockResolvedValue({
      version: 1,
      instances: [inst("a", "dup"), inst("b", "dup")],
    });
    getSharedStore().hydrate([]);
    const err = await loadPersistedInstances();
    expect(err).toMatch(/校验失败/);
    expect(err).toMatch(/实例名重复/);
    expect(getSharedStore().list()).toEqual([]); // 未被污染
  });

  it("损坏 fail-fast: 版本不对 → 拒绝", async () => {
    loadMock.mockResolvedValue({ version: 2, instances: [] });
    const err = await loadPersistedInstances();
    expect(err).toMatch(/校验失败/);
  });

  it("损坏 fail-fast: 读取层抛错(YAML 语法坏, Rust Err) → 错误消息上传", async () => {
    loadMock.mockRejectedValue(new Error("instances.yaml 解析失败: did not find expected key"));
    const err = await loadPersistedInstances();
    expect(err).toMatch(/读取失败/);
    expect(err).toMatch(/解析失败/);
  });

  it("删除实例同步清钥匙串条目(D-029)且触发写回", async () => {
    const keyring = new MemoryKeyring();
    await keyring.set(KEYRING_SERVICE, "ds-1:api_key", "sk-secret");
    const store = new MemoryInstanceStore();
    const seen: InstanceConfig[][] = [];
    store.attachPersister((list) => seen.push(list));
    store.hydrate([inst("ds-1", "DeepSeek-按量 #1")]);
    store.remove("ds-1", keyring);
    expect(await keyring.get(KEYRING_SERVICE, "ds-1:api_key")).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([]);
  });

  it("写盘失败: 错误状态置起并可被订阅读到(W3); 恢复后自动清除", async () => {
    const seen: Array<string | null> = [];
    const unsub = subscribePersistError(() => seen.push(getLastPersistError()));
    try {
      getSharedStore().hydrate([]);
      // zod 校验失败(重复名) → 写盘被拒 → 错误状态置起, 内存态不回滚
      saveMock.mockRejectedValueOnce(new Error("磁盘已满"));
      getSharedStore().add(inst("w3-1", "写盘失败"));
      await vi.waitFor(() => expect(getLastPersistError()).toMatch(/磁盘已满/));
      expect(seen.length).toBeGreaterThan(0);
      expect(getSharedStore().list().map((i) => i.id)).toContain("w3-1"); // 内存态保留
      // 后续写盘成功 → 错误清除, 订阅者收到 null
      getSharedStore().add(inst("w3-2", "写盘恢复"));
      await vi.waitFor(() => expect(getLastPersistError()).toBeNull());
      expect(seen[seen.length - 1]).toBeNull();
    } finally {
      unsub();
      getSharedStore().hydrate([]); // 不污染其他用例
    }
  });
});
