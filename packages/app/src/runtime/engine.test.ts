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
  purgeProvider: async () => {},
};

// 真正未接入的通道(不在 PRESET_CHANNELS/CHANNEL_MAPPINGS): 本卡后 kimi/opencode 已接入,
// 不能再拿它们当"未支持"样例(语义被 t_44497e20 推翻)
const unsupportedInstance: InstanceConfig = {
  id: "inst-aliyun-1",
  channel: "aliyun/bailian",
  name: "百炼 Token Plan #1",
  params: { api_key: { source: "store", key: "inst-aliyun-1:api_key" } },
};

describe("P0-8 未支持通道显式化(不静默跳过)", () => {
  it("unsupportedSnapshot 产出 status=unsupported 合法快照", () => {
    const snap = unsupportedSnapshot(unsupportedInstance);
    expect(snap.status).toBe("unsupported");
    expect(snap.provider_id).toBe("inst-aliyun-1");
    expect(snap.display_name).toBe("百炼 Token Plan #1");
    expect(snap.plan_type).toBe("window"); // 目录查不到 → 兜底 window
    expect(snap.metrics).toEqual([]);
    expect(snap.alerts[0]?.message).toContain("暂未接入");
  });

  it("目录外未知通道也显式化, plan_type 兜底 window", () => {
    const snap = unsupportedSnapshot({ ...unsupportedInstance, id: "x", channel: "foo/bar" });
    expect(snap.status).toBe("unsupported");
    expect(snap.plan_type).toBe("window");
  });

  it("引擎启动后面板立即收到 unsupported 卡, 且不进调度器", async () => {
    const engine = new RuntimeEngine([unsupportedInstance], fakeStorage);
    const outs: EngineOutput[] = [];
    engine.subscribe((o) => outs.push(o));
    engine.start();
    // start 同步段即 emit(unsupported 卡不等 hydrate/首轮采集)
    const last = outs[outs.length - 1];
    expect(last?.snapshots).toHaveLength(1);
    expect(last?.snapshots[0]?.status).toBe("unsupported");
    expect(last?.snapshots[0]?.provider_id).toBe("inst-aliyun-1");
    // 不进调度器(无适配器可轮询)
    expect(engine.stats["inst-aliyun-1"]).toBeUndefined();
    // hydrate 完成后仍是同一张卡(无存储历史, 不被覆盖)
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.snapshots.map((s) => s.status)).toEqual(["unsupported"]);
    engine.stop();
  });

  it("已接入通道(deepseek/opencode/kimi)进调度器, 不产 unsupported", () => {
    const engine = new RuntimeEngine(
      [
        { ...unsupportedInstance, id: "a", channel: "deepseek/balance" },
        { ...unsupportedInstance, id: "b", channel: "opencode/go" },
        { ...unsupportedInstance, id: "c", channel: "kimi/coding" },
      ],
      fakeStorage,
    );
    engine.subscribe(() => {});
    engine.start();
    // 三个通道都在 CHANNEL_MAPPINGS → 全部进调度器(不产 unsupported 卡)
    expect(engine.snapshots).toHaveLength(0);
    expect(engine.stats["a"]?.state).toBeTruthy();
    expect(engine.stats["b"]?.state).toBeTruthy();
    expect(engine.stats["c"]?.state).toBeTruthy();
    engine.stop();
  });
});

describe("hydrate 过滤(t_2ac39613: 删除的 provider 不复活)", () => {
  /** 幽灵快照(库里残留的已删实例历史) */
  const ghostSnap = (providerId: string, name: string) => ({
    provider_id: providerId,
    display_name: name,
    plan_type: "balance" as const,
    fetched_at: 1_700_000_000,
    status: "ok" as const,
    metrics: [{ key: "remaining", kind: "balance" as const, unit: "cny" as const, used: 42.5 }],
    alerts: [],
  });

  it("库里幽灵 provider 快照不进入 latest(实例集合是唯一真相源)", async () => {
    const storage: SnapshotStorage = {
      init: async () => {},
      saveSnapshot: async () => {},
      latestSnapshots: async () => [
        ghostSnap("live-1", "活着的 #1"),
        ghostSnap("deleted-a", "已删除 A"),
        ghostSnap("deleted-b", "已删除 B"),
      ],
      history: async () => [],
      purgeProvider: async () => {},
    };
    // 实例集合只剩 live-1 —— deleted-a/b 是已删实例, hydrate 后不得出现在 latest
    const engine = new RuntimeEngine(
      [
        { ...unsupportedInstance, id: "live-1", channel: "deepseek/balance", name: "活着的 #1" },
      ],
      storage,
    );
    engine.subscribe(() => {});
    engine.start();
    await new Promise((r) => setTimeout(r, 0)); // 等 hydrate 完成
    const ids = engine.snapshots.map((s) => s.provider_id);
    expect(ids).toContain("live-1");
    expect(ids).not.toContain("deleted-a");
    expect(ids).not.toContain("deleted-b");
    engine.stop();
  });
});
