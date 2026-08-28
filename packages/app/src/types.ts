/**
 * 统一快照类型 — 与 docs/DESIGN.md §2.1 对齐。
 * ⚠️ P0-1(core schema)未落定前, 本文件是 app 侧 mock 对接契约, P0-5 接真实数据链路时
 * 应切换为从 @token-wallet/core 导入。
 */

export type PlanType = "balance" | "window" | "local";

/** status 一等公民(D-005): 异常状态整卡文字替代图表, 不显示假数据 */
export type ProviderStatus = "ok" | "stale" | "auth_expired" | "unsupported" | "error";

/** UI 健康度四色(D-003/§9): 绿(健康) / 黄(低于黄线) / 红(低于红线或 auth_expired/耗尽) / 灰(stale/unsupported) */
export type HealthLevel = "ok" | "warn" | "bad" | "unknown";

export type MetricKind = "window" | "balance" | "counter";
export type MetricUnit = "requests" | "credits" | "cny" | "tokens";

export interface Metric {
  key: string;
  kind: MetricKind;
  unit: MetricUnit;
  used: number;
  limit?: number;
  /** epoch seconds */
  reset_at?: number;
}

export interface ProviderSnapshot {
  provider_id: string;
  display_name: string;
  plan_type: PlanType;
  /** epoch seconds */
  fetched_at: number;
  status: ProviderStatus;
  metrics: Metric[];
  alerts: string[];
}

/** 全局设置(P0-2 壳只落 theme, 阈值/通知为占位, 见 D-022/D-009) */
export interface AppSettings {
  /** 主题: 默认追随系统(D-010), 可配置覆盖 */
  theme: "system" | "light" | "dark";
}

/** Rust 侧 get_bootstrap 返回(camelCase, serde rename_all) */
export interface Bootstrap {
  firstRun: boolean;
  theme: AppSettings["theme"];
  version: string;
}
