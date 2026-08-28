/**
 * 统一快照类型 — 与 core schema 同源(P0-5 接真实链路起切 core import)
 *
 * ⚠️ P0-4 及之前 app 用自有 mock 契约; P0-5 真实链路后统一以
 * @token-wallet/core/schema 为唯一权威, 本文件只 re-export + app 专属类型。
 */
export type {
  Alert,
  AlertLevel,
  Metric,
  MetricKind,
  MetricUnit,
  PlanArchetype as PlanType,
  ProviderSnapshot,
  SnapshotStatus as ProviderStatus,
} from "@token-wallet/core/schema";

/** UI 健康度四色(D-003/§9): 绿(健康) / 黄(auth_expired 待处理或低于黄线) / 红(低于红线、error 或耗尽) / 灰(stale/unsupported) */
export type HealthLevel = "ok" | "warn" | "bad" | "unknown";

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
