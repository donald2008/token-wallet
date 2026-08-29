import { describe, expect, it, vi } from "vitest";

// unsupported 通道绝不进调度器 → httpGetJson 被调即失败
vi.mock("../ipc", () => ({
  httpGetJson: vi.fn(async () => {
    throw new Error("不应调用: 未接入通道不进调度器");
  }),
}));

import { RuntimeEngine, unsupportedSnapshot, type EngineOutput } from "./engine";
import type { SnapshotStorage } from "./storage";
import type { InstanceConfig } from "../instances/schema";

const fakeStorage: SnapshotStorage = {
  init: async () => {},
  saveSnapshot: async () => {},
  latestSnapshots: async () => [],
  history: async () => [],
};

const kimiInstance: InstanceConfig = {
  id: "inst-kimi-1",
  channel: "kimi/kimi-code",
  name: "Kimi Code #1",
  params: { api_key: { source: "store", key: "inst-kimi-1:api_key" } },
};

describe("P0-8 未支持通道显式化(不静默跳过)", () => {
  it("unsupportedSnapshot 产出 status=unsupported 合法快照", () => {
    const snap = unsupportedSnapshot(kimiInstance);
    expect(snap.status).toBe("unsupported");
    expect(snap.provider_id).toBe("inst-kimi-1");
    expect(snap.display_name).toBe("Kimi Code #1");
    expect(snap.plan_type).toBe("window"); // 通道目录查得(kimi/kimi-code 是窗口制)
    expect(snap.metrics).toEqual([]);
    expect(snap.alerts[0]?.message).toContain("暂未接入");
  });

  it("目录外未知通道也显式化, plan_type 兜底 window", () => {
    const snap = unsupportedSnapshot({ ...kimiInstance, id: "x", channel: "foo/bar" });
    expect(snap.status).toBe("unsupported");
    expect(snap.plan_type).toBe("window");
  });

  it("引擎启动后面板立即收到 unsupported 卡, 且不进调度器", async () => {
    const engine = new RuntimeEngine([kimiInstance], fakeStorage);
    const outs: EngineOutput[] = [];
    engine.subscribe((o) => outs.push(o));
    engine.start();
    // start 同步段即 emit(unsupported 卡不等 hydrate/首轮采集)
    const last = outs[outs.length - 1];
    expect(last?.snapshots).toHaveLength(1);
    expect(last?.snapshots[0]?.status).toBe("unsupported");
    expect(last?.snapshots[0]?.provider_id).toBe("inst-kimi-1");
    // 不进调度器(无适配器可轮询)
    expect(engine.stats["inst-kimi-1"]).toBeUndefined();
    // hydrate 完成后仍是同一张卡(无存储历史, 不被覆盖)
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.snapshots.map((s) => s.status)).toEqual(["unsupported"]);
    engine.stop();
  });
});
