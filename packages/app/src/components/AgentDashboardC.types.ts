/**
 * AgentDashboardC 组件入参类型(t_9255cb63, D-048 后续)
 * 调用方从 mcpUsageSummary 拉数据后传入 — 组件本身不直接调 daemon, 便于
 * (a) 单元测试传固定数据 (b) 多个组件复用同一份数据。
 */
import type { UsageSummaryOutput } from "../mcpQueryTypes";

export interface TrendBucket {
  label: string;
  tokens: number;
}

export interface ModelSlice {
  model: string;
  tokens: number;
}

export interface DetailRow {
  agent_id: string;
  tokens: number;
  cost: number | null;
  currency: string | null;
  calls: number;
  /** completed > 0 → active, calls > 0 && completed = 0 → idle, calls = 0 → no_report_today */
  completed: number;
  idle: boolean;
}

export interface AgentDashboardCProps {
  summary: UsageSummaryOutput;
  /** 由调用方(mcpUsageSummary 返回 generatedAt)传入 — 避免组件内部再发请求 */
  generatedAt: string;
  /** 返回主页回调(点 ← 返回) */
  onBack: () => void;
}
