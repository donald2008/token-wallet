/**
 * L1 单元: 实例 schema 双重唯一校验(D-026) + 默认编号 + store mock(D-029)。
 * 覆盖文档约束: 表单校验与实例校验复用同一 zod schema(§5.0)。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  InstancesFileSchema,
  parseInstances,
  validateFormName,
  defaultInstanceName,
  makeCredentialRef,
} from "./schema";
import { MemoryKeyring, MemoryInstanceStore, KEYRING_SERVICE } from "./store";
import { getPresetChannel } from "@token-wallet/core/channels";

const ds = () => getPresetChannel("deepseek/balance")!;

describe("instances schema (D-026 双重唯一)", () => {
  const validInstance = {
    id: "inst-1",
    channel: "deepseek/balance",
    name: "DeepSeek-按量 #1",
    params: { api_key: { source: "store", key: "inst-1:api_key" } },
  };

  it("合法实例通过", () => {
    const r = InstancesFileSchema.safeParse({ version: 1, instances: [validInstance] });
    expect(r.success).toBe(true);
  });

  it("instances.yaml 加载: 重复 name 拒绝(fail-fast)", () => {
    const r = InstancesFileSchema.safeParse({
      version: 1,
      instances: [
        validInstance,
        { ...validInstance, id: "inst-2", name: "DeepSeek-按量 #1" }, // name 重复
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes("实例名重复"))).toBe(true);
    }
  });

  it("instances.yaml 加载: 重复 id 拒绝", () => {
    const r = InstancesFileSchema.safeParse({
      version: 1,
      instances: [validInstance, { ...validInstance, name: "另一个" }], // id 重复
    });
    expect(r.success).toBe(false);
  });

  it("parseInstances 返回可读错误", () => {
    const out = parseInstances({
      version: 1,
      instances: [
        validInstance,
        { ...validInstance, name: "DeepSeek-按量 #1" },
      ],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("实例名重复");
  });

  it("validateFormName: 表单保存即时拒绝重复(D-026 第 1 道)", () => {
    expect(validateFormName("", ["A"])).toBe("实例名不能为空");
    expect(validateFormName("B", ["B"])).toBe("实例名已存在: B");
    expect(validateFormName("C", ["B"])).toBeNull();
  });

  it("defaultInstanceName: 自动编号避开已占用名", () => {
    const ch = ds();
    expect(defaultInstanceName(ch, [])).toBe("DeepSeek-按量 #1");
    expect(defaultInstanceName(ch, ["DeepSeek-按量 #1", "DeepSeek-按量 #2"])).toBe("DeepSeek-按量 #3");
  });

  it("makeCredentialRef: secret → store 源引用(§5.0.1)", () => {
    expect(makeCredentialRef("inst-A", "api_key")).toEqual({
      source: "store",
      key: "inst-A:api_key",
    });
  });
});

describe("MemoryKeyring + MemoryInstanceStore (D-029 删实例清钥匙串)", () => {
  let keyring: MemoryKeyring;
  let store: MemoryInstanceStore;

  beforeEach(() => {
    keyring = new MemoryKeyring();
    store = new MemoryInstanceStore();
  });

  it("store 读写 + 删除实例同步清钥匙串条目", async () => {
    const key = "inst-1:api_key";
    await keyring.set(KEYRING_SERVICE, key, "sk-xxx");
    store.add({
      id: "inst-1",
      channel: "deepseek/balance",
      name: "DeepSeek-按量 #1",
      params: { api_key: { source: "store", key } },
    });
    expect(store.list()).toHaveLength(1);
    expect(await keyring.get(KEYRING_SERVICE, key)).toBe("sk-xxx");

    store.remove("inst-1", keyring);
    expect(store.list()).toHaveLength(0);
    // 删除实例 → 钥匙串条目被清(D-029)
    expect(await keyring.get(KEYRING_SERVICE, key)).toBeNull();
  });
});