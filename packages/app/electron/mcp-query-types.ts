/**
 * MCP daemon 读数据契约类型(t_9255cb63, D-055 后续):
 * 类型唯一权威 = docs/mcp-protocol.md §2.2 / §2.3 JSON Schema 的 TypeScript 映射。
 *
 * 单独成文件是为了让 renderer (src/) 与 main process (electron/) 共享类型时,
 * 不需要 src 引 electron 目录(electron 目录含 node:fs / node:child_process,
 * vite 浏览器构建会拖进去)。本文件零运行时副作用,纯类型。
 */

/**
 * delete_usage 输入/输出契约(t_6eb3e728, docs/mcp-protocol.md v1.1 §2.4 增补形态):
 * - 输入: { agent_id }(必填) — 清除该 agent 的全部上报数据, 不可逆
 * - 输出: { deleted: number } — 实际删除的 usage 事件行数
 */
export interface DeleteUsageInput {
  agent_id: string;
}

export interface DeleteUsageOutput {
  deleted: number;
}

/** UsageSummaryInput(§2.2) — group_by 1-3 维(hour 维 = t_56c66972 v1.1 增补) */
export interface UsageSummaryInput {
  since?: string;
  until?: string;
  agent_id?: string;
  provider?: string;
  model?: string;
  kanban_task?: string;
  group_by?: Array<"agent" | "provider" | "model" | "day" | "hour" | "status">;
}

export interface ByStatus {
  completed: number;
  partial: number;
  unknown: number;
}

export interface SummaryRow {
  /** 多维时按 group_by 顺序用 | 连接, 日维 = YYYY-MM-DD, 时维 = YYYY-MM-DDTHH:00(本地时区) */
  group: string;
  calls: number;
  input_cache_hit_tokens: number;
  input_cache_miss_tokens: number;
  output_tokens: number;
  cost_total: number | null;
  currency: string | null;
  by_status: ByStatus;
  /** t_56c66972 边界①: agent 最近一次上报时间(可选前向兼容, 缺省不判陈旧 —— 见 src/mcpQueryTypes.ts) */
  latest_ts?: string | null;
}

export interface SummaryTotal {
  calls: number;
  input_cache_hit_tokens: number;
  input_cache_miss_tokens: number;
  output_tokens: number;
  cost_total: number | null;
  currency: string | null;
  by_status: ByStatus;
}

export interface UsageSummaryOutput {
  window: { since: string; until: string };
  timezone: string;
  generated_at: string;
  rows: SummaryRow[];
  total: SummaryTotal;
}

/** UsageReportEchoInput(§2.3) */
export interface UsageReportEchoInput {
  event_id?: string;
  session_id?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface UsageReportEchoEvent {
  event_id: string;
  agent_id: string;
  ts: string;
  status: "completed" | "partial" | "unknown";
  model: string;
  provider: string;
  usage: unknown | null;
  context: unknown;
}

export interface UsageReportEchoOutput {
  events: UsageReportEchoEvent[];
  total_count: number;
}
