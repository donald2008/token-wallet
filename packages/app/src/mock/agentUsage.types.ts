/**
 * Agent 用量大屏 mock 数据契约 (t_4a8bc406, 2026-09-09)
 *
 * 对齐任务 body 引用的 docs/mcp-protocol.md AgentUsageReport v1:
 *   - usage.input_cache_hit/input_cache_miss/output: tokens 必有, cost/currency 可空
 *   - usage.total: 只有 cost + currency(无 tokens)
 *   - 无金额 agent(cost=null)走留空态, 不显示 0 / —
 */

// ---------- 单条上报粒度 ----------

export interface UsageComponent {
  tokens: number;
  cost: number | null;
  currency: string | null;
}

export interface UsageTotal {
  cost: number | null;
  currency: string | null;
  // ⚠️ total 没有 tokens 字段(契约明示), 展示端把三分项相加
}

export interface AgentUsageReport {
  agent_id: string;
  harness: string;
  model: string;
  provider: string;
  ts: string; // ISO 8601
  session_id: string;
  usage: {
    input_cache_hit: UsageComponent;
    input_cache_miss: UsageComponent;
    output: UsageComponent;
    total: UsageTotal;
  };
}

// ---------- 大屏查询形态(usage_summary 聚合后) ----------

export type TimeWindow = "5h" | "today" | "week" | "month";

export const TIME_WINDOW_LABEL: Record<TimeWindow, string> = {
  "5h": "近 5 小时",
  today: "今天",
  week: "本周",
  month: "本月",
};

export interface AgentUsageSummary {
  agent_id: string;
  tokens: number; // 必有 = 三分项 tokens 之和
  cost: number | null; // 可空(全无金额→null)
  currency: string | null;
  report_count: number;
  is_idle: boolean; // 窗内无上报 = true(显示"空闲")
}

export interface UsageSplit {
  input_cache_hit: number;
  input_cache_miss: number;
  output: number;
  total: number;
  pct: {
    input_cache_hit: number;
    input_cache_miss: number;
    output: number;
  };
}

export interface ModelDistribution {
  model: string;
  tokens: number;
}

export interface AgentUsageDetailRow {
  agent_id: string;
  model: string;
  tokens: number;
  cost: number | null;
  currency: string | null;
}

export interface TrendBucket {
  label: string; // 显示: 5h 窗=T-{n}h, 天窗=MM/DD
  ts: string; // ISO 8601
  tokens: number;
}