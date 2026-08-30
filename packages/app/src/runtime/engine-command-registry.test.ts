/**
 * D-042 注册表缺失防御分支的真覆盖 (t_c561c8a8 round3 W2)
 *
 * engine.test.ts 第 5 用例(unknown-command/plan)走的是 !descriptor(目录外)分支,
 * 并非 COMMAND_ADAPTERS 缺失分支。COMMAND_ADAPTERS 是 D-041 常量, 无法在
 * 普通测试里删 key —— 本文件用 vi.mock 注入**空注册表**, 配合目录内真实
 * command 描述符(aliyun-bailian/token-plan)真覆盖「描述符在但适配器缺失」分支。
 */
import { describe, expect, it, vi } from "vitest";

// 空注册表: 目录内有 command 描述符, 但 COMMAND_ADAPTERS 无任何条目
vi.mock("@token-wallet/core/channels/aliyun-bailian", () => ({
  COMMAND_ADAPTERS: {},
}));

vi.mock("../ipc", () => ({
  httpGetJson: vi.fn(async () => {
    throw new Error("不应调用: 未接入通道不进调度器");
  }),
  commandRun: vi.fn(async () => null),
}));

import { RuntimeEngine } from "./engine";
import type { SnapshotStorage } from "./storage";
import type { InstanceConfig } from "../instances/schema";

const fakeStorage: SnapshotStorage = {
  init: async () => {},
  saveSnapshot: async () => {},
  latestSnapshots: async () => [],
  history: async () => [],
  purgeProvider: async () => {},
};

describe("D-042 command 注册表缺失防御(空 COMMAND_ADAPTERS)", () => {
  it("目录有 command 描述符但注册表缺条目 → 显式 unsupported 卡(防御保留)", () => {
    // aliyun-bailian/token-plan 在 PRESET_CHANNELS(adapter=command), 但本文件 mock 了空注册表
    const inst: InstanceConfig = {
      id: "inst-bailian",
      channel: "aliyun-bailian/token-plan",
      name: "百炼 Token Plan #1",
      params: {},
    };
    const engine = new RuntimeEngine([inst], fakeStorage);
    engine.subscribe(() => {});
    engine.start();

    // 不进调度器(无适配器可轮询) → 同步 emit unsupported
    expect(engine.snapshots.map((s) => s.status)).toEqual(["unsupported"]);
    expect(engine.stats["inst-bailian"]).toBeUndefined();
    engine.stop();
  });
});
