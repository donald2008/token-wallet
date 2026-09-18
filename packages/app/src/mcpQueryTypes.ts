/**
 * MCP daemon 读数据契约类型(t_9255cb63, D-055 后续) — renderer 端副本:
 * 类型唯一权威 = docs/mcp-protocol.md §2.2 / §2.3 JSON Schema 的 TypeScript 映射。
 *
 * ⚠️ 此文件与 electron/mcp-query-types.ts 是同一份契约的 renderer 端副本。
 * src/ tsconfig 不允许跨目录 import electron/(node:fs/child_process 会拖进浏览器 bundle),
 * 故 renderer 端用独立文件 + 注释明示「必须与 electron 端同步」。两份都纯类型,
 * 零运行时, 改一边需手动同步另一边(本卡内已对齐, 后续若改请 patch 两份)。
 */

export interface UsageSummaryInput {
  since?: string;
  until?: string;
  agent_id?: string;
  provider?: string;
  model?: string;
  kanban_task?: string;
  group_by?: Array<"agent" | "provider" | "model" | "day" | "status">;
}

export interface ByStatus {
  completed: number;
  partial: number;
  unknown: number;
}

export interface SummaryRow {
  /** 多维时按 group_by 顺序用 | 连接, 日维 = YYYY-MM-DD */
  group: string;
  calls: number;
  input_cache_hit_tokens: number;
  input_cache_miss_tokens: number;
  output_tokens: number;
  cost_total: number | null;
  currency: string | null;
  by_status: ByStatus;
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
