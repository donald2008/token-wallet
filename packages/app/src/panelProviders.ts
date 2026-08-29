import type { ProviderSnapshot } from "./types";
import { scenarioProviders, type ScenarioId } from "./mockData";

/**
 * 面板数据源裁决(P0-8):
 * - 有真实实例 → 引擎快照(快照未到时为 [], 由 App 渲染 CollectingState, 不回退 mock)
 * - 零实例 + dev 预览 → 场景 mock(ScenarioBar 仅 dev 渲染, 行为不变)
 * - 零实例 + 生产构建 → 空数组(EmptyState); 生产绝不显示演示假数据(DESIGN 原则)
 *
 * 返回 null 表示加载态(仅 dev scenario="loading")。
 */
export function selectPanelProviders(opts: {
  hasInstances: boolean;
  snapshots: ProviderSnapshot[];
  scenario: ScenarioId;
  isProd: boolean;
}): ProviderSnapshot[] | null {
  if (opts.hasInstances) return opts.snapshots;
  if (opts.isProd) return [];
  return scenarioProviders(opts.scenario);
}
