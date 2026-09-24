/**
 * MCP daemon 读数据契约类型(t_9255cb63, D-055 后续) — renderer 端副本:
 * 类型唯一权威 = docs/mcp-protocol.md §2.2 / §2.3 JSON Schema 的 TypeScript 映射。
 *
 * ⚠️ 此文件与 electron/mcp-query-types.ts 是同一份契约的 renderer 端副本。
 * src/ tsconfig 不允许跨目录 import electron/(node:fs/child_process 会拖进浏览器 bundle),
 * 故 renderer 端用独立文件 + 注释明示「必须与 electron 端同步」。两份都纯类型,
 * 零运行时, 改一边需手动同步另一边(本卡内已对齐, 后续若改请 patch 两份)。
 */

/**
 * delete_usage 输入/输出契约(t_6eb3e728, docs/mcp-protocol.md v1.1 §2.4 增补形态):
 * - 输入: { agent_id }(必填, 1+ 字符) — 清除该 agent 的全部上报数据, 不可逆
 * - 输出: { deleted: number } — 实际删除的 usage 事件行数(管理面语义, Bearer key 即授权边界)
 *
 * ⚠️ 此文件与 electron/mcp-query-types.ts 是同一份契约的 renderer 端副本。
 * 改一边需手动同步另一边。
 */
export interface DeleteUsageInput {
  agent_id: string;
}

export interface DeleteUsageOutput {
  deleted: number;
}

export interface UsageSummaryInput {
  since?: string;
  until?: string;
  agent_id?: string;
  provider?: string;
  model?: string;
  kanban_task?: string;
  /** t_56c66972: 增 "hour"(协议 §2.2 v1.1 增补, 本地时区语义同 day) — 置顶 5h 折线数据面 */
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
  /**
   * t_56c66972 边界①(数据滞后)所需: 该 agent 最近一次上报时间(daemon 本地时区 ISO)。
   * ⚠️ 现行协议 §2.2 summary_row **尚无此字段**(additionalProperties:false)——本字段按
   * 「可选 + 缺失即不判陈旧」的形态前向兼容: daemon 未提供时, meta 右列回落 generated_at,
   * 不做任何陈旧标记(宁可不标, 不误报)。daemon 侧补齐后无需再改前端。
   */
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
