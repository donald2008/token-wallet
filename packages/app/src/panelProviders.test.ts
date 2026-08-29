import { describe, expect, it } from "vitest";
import { selectPanelProviders } from "./panelProviders";
import type { ProviderSnapshot } from "./types";

const snap: ProviderSnapshot = {
  provider_id: "deepseek",
  display_name: "DeepSeek-按量 #1",
  plan_type: "balance",
  fetched_at: 1_000,
  status: "ok",
  metrics: [],
  alerts: [],
};

describe("P0-8 面板数据源裁决(selectPanelProviders)", () => {
  it("生产构建零实例 → 空数组(EmptyState), 绝不走 mock 演示卡", () => {
    const out = selectPanelProviders({
      hasInstances: false,
      snapshots: [],
      scenario: "mixed",
      isProd: true,
    });
    expect(out).toEqual([]);
  });

  it("dev 零实例 → 场景 mock 行为不变(mixed 出演示卡)", () => {
    const out = selectPanelProviders({
      hasInstances: false,
      snapshots: [],
      scenario: "mixed",
      isProd: false,
    });
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThan(0);
  });

  it("dev loading 场景仍返回 null(LoadingState)", () => {
    const out = selectPanelProviders({
      hasInstances: false,
      snapshots: [],
      scenario: "loading",
      isProd: false,
    });
    expect(out).toBeNull();
  });

  it("有实例 → 引擎快照原样透传; 空数组 = 采集进行中, 不回退 mock", () => {
    expect(
      selectPanelProviders({ hasInstances: true, snapshots: [], scenario: "mixed", isProd: false }),
    ).toEqual([]);
    expect(
      selectPanelProviders({
        hasInstances: true,
        snapshots: [snap],
        scenario: "mixed",
        isProd: true,
      }),
    ).toEqual([snap]);
  });
});
