/**
 * Agent 用量详情大屏 mock 数据 (t_4a8bc406, 2026-09-09)
 *
 * 严格对齐契约(任务 body 引用 docs/mcp-protocol.md AgentUsageReport v1):
 *   - tokens 必有; cost/currency 可空(null 表示 daemon 未补出)
 *   - total 只有 cost(无 tokens)——展示端把三分项 tokens 相加
 *   - 必须包含有金额 + 无金额 agent 两种, 验证留空形态
 *
 * 大屏查询形态(usage_summary 聚合后展示):
 *   - 按 agent 聚合 tokens 总量 + 可选 cost/currency
 *   - 时间窗: 5h / today / week / month
 *   - 趋势: 5h 按小时分桶, today/week/month 按天分桶
 *   - model 分布: 按 model 的 token 消耗占比
 *   - 明细: 按 model 或 session 的明细行
 *   - 三分项: input_cache_hit / input_cache_miss / output 拆分 + 百分比
 *
 * 当前数据快照锚定 2026-09-09 (mock "now"), 可被大屏 HTML 用来 mock 当前时刻。
 */
import type {
  AgentUsageSummary,
  ModelDistribution,
  TimeWindow,
  TrendBucket,
  UsageSplit,
  AgentUsageDetailRow,
  AgentUsageReport,
} from "./agentUsage.types";

// ---------- 时刻锚点(mock 静态, 大屏 HTML 用此 "now") ----------
export const MOCK_NOW_ISO = "2026-09-09T14:00:00+08:00";
const NOW = new Date(MOCK_NOW_ISO).getTime();

// ---------- 4 个 agent (混合 harness/model/provider) ----------

// 1. hermes-njbx02 — 活跃, 有金额(USD)
const HERMES_RAW_REPORTS: AgentUsageReport[] = [
  // 5h 趋势窗: 近 5 小时, 每小时 1 条
  ...[0, 1, 2, 3, 4].map((h) => ({
    agent_id: "hermes-njbx02",
    harness: "hermes",
    model: "glm-5.3",
    provider: "volcengine",
    ts: new Date(NOW - h * 60 * 60 * 1000).toISOString(),
    session_id: `sess-h-${h}`,
    usage: {
      input_cache_hit: { tokens: 12000 + h * 600, cost: 0.04, currency: "USD" },
      input_cache_miss: { tokens: 30000 + h * 1500, cost: 0.45, currency: "USD" },
      output: { tokens: 18000 + h * 900, cost: 0.36, currency: "USD" },
      total: { cost: 0.85, currency: "USD" },
    },
  })),
  // 今日 / 本周: 一天多条, 跨多 session
  ...Array.from({ length: 14 }, (_, i) => ({
    agent_id: "hermes-njbx02",
    harness: "hermes",
    model: i % 3 === 0 ? "glm-5.3" : i % 3 === 1 ? "deepseek-v3" : "qwen-max",
    provider: i % 3 === 0 ? "volcengine" : i % 3 === 1 ? "deepseek" : "aliyun",
    ts: new Date(NOW - i * 90 * 60 * 1000).toISOString(),
    session_id: `sess-h-d${i}`,
    usage: {
      input_cache_hit: { tokens: 8000 + (i % 5) * 1200, cost: 0.02, currency: "USD" },
      input_cache_miss: { tokens: 22000 + (i % 7) * 2000, cost: 0.3 + (i % 4) * 0.05, currency: "USD" },
      output: { tokens: 14000 + (i % 6) * 1500, cost: 0.25 + (i % 3) * 0.04, currency: "USD" },
      total: { cost: 0.57 + (i % 4) * 0.09, currency: "USD" },
    },
  })),
  // 本月: 跨 9 天, 每天 2-3 条
  ...Array.from({ length: 22 }, (_, i) => ({
    agent_id: "hermes-njbx02",
    harness: "hermes",
    model: ["glm-5.3", "deepseek-v3", "qwen-max"][i % 3],
    provider: ["volcengine", "deepseek", "aliyun"][i % 3],
    ts: new Date(NOW - (i + 1) * 10 * 60 * 60 * 1000).toISOString(),
    session_id: `sess-h-w${i}`,
    usage: {
      input_cache_hit: { tokens: 6000 + (i % 8) * 800, cost: 0.018, currency: "USD" },
      input_cache_miss: { tokens: 18000 + (i % 9) * 1500, cost: 0.24 + (i % 5) * 0.03, currency: "USD" },
      output: { tokens: 11000 + (i % 7) * 1000, cost: 0.2 + (i % 4) * 0.03, currency: "USD" },
      total: { cost: 0.46 + (i % 5) * 0.06, currency: "USD" },
    },
  })),
];

// 2. claude-code-ws1 — 活跃, 有金额(USD)
const CLAUDE_RAW_REPORTS: AgentUsageReport[] = [
  // 5h 趋势
  ...[0, 1, 2, 3, 4].map((h) => ({
    agent_id: "claude-code-ws1",
    harness: "claude-code",
    model: "claude-sonnet-4.5",
    provider: "anthropic",
    ts: new Date(NOW - h * 60 * 60 * 1000).toISOString(),
    session_id: `sess-c-${h}`,
    usage: {
      input_cache_hit: { tokens: 4500 + h * 200, cost: 0.022, currency: "USD" },
      input_cache_miss: { tokens: 22000 + h * 800, cost: 0.66, currency: "USD" },
      output: { tokens: 9000 + h * 350, cost: 0.45, currency: "USD" },
      total: { cost: 1.13, currency: "USD" },
    },
  })),
  // 今日
  ...Array.from({ length: 9 }, (_, i) => ({
    agent_id: "claude-code-ws1",
    harness: "claude-code",
    model: i % 2 === 0 ? "claude-sonnet-4.5" : "claude-haiku-4.5",
    provider: "anthropic",
    ts: new Date(NOW - i * 100 * 60 * 1000).toISOString(),
    session_id: `sess-c-d${i}`,
    usage: {
      input_cache_hit: { tokens: 3000 + (i % 4) * 400, cost: 0.015, currency: "USD" },
      input_cache_miss: { tokens: 18000 + (i % 5) * 1200, cost: 0.5 + (i % 3) * 0.08, currency: "USD" },
      output: { tokens: 7000 + (i % 6) * 600, cost: 0.35 + (i % 4) * 0.04, currency: "USD" },
      total: { cost: 0.86 + (i % 4) * 0.12, currency: "USD" },
    },
  })),
  // 本月
  ...Array.from({ length: 16 }, (_, i) => ({
    agent_id: "claude-code-ws1",
    harness: "claude-code",
    model: ["claude-sonnet-4.5", "claude-haiku-4.5"][i % 2],
    provider: "anthropic",
    ts: new Date(NOW - (i + 1) * 14 * 60 * 60 * 1000).toISOString(),
    session_id: `sess-c-w${i}`,
    usage: {
      input_cache_hit: { tokens: 2000 + (i % 6) * 300, cost: 0.012, currency: "USD" },
      input_cache_miss: { tokens: 14000 + (i % 7) * 900, cost: 0.4 + (i % 5) * 0.05, currency: "USD" },
      output: { tokens: 5000 + (i % 5) * 500, cost: 0.25 + (i % 4) * 0.03, currency: "USD" },
      total: { cost: 0.66 + (i % 5) * 0.08, currency: "USD" },
    },
  })),
];

// 3. codex-main — 活跃, 有金额(USD)
const CODEX_RAW_REPORTS: AgentUsageReport[] = [
  // 5h 趋势
  ...[0, 1, 2, 3, 4].map((h) => ({
    agent_id: "codex-main",
    harness: "codex",
    model: "gpt-5-codex",
    provider: "openai",
    ts: new Date(NOW - h * 60 * 60 * 1000).toISOString(),
    session_id: `sess-x-${h}`,
    usage: {
      input_cache_hit: { tokens: 2000 + h * 100, cost: 0.012, currency: "USD" },
      input_cache_miss: { tokens: 14000 + h * 600, cost: 0.42, currency: "USD" },
      output: { tokens: 6000 + h * 250, cost: 0.3, currency: "USD" },
      total: { cost: 0.73, currency: "USD" },
    },
  })),
  // 今日
  ...Array.from({ length: 7 }, (_, i) => ({
    agent_id: "codex-main",
    harness: "codex",
    model: "gpt-5-codex",
    provider: "openai",
    ts: new Date(NOW - i * 110 * 60 * 1000).toISOString(),
    session_id: `sess-x-d${i}`,
    usage: {
      input_cache_hit: { tokens: 1500 + (i % 3) * 200, cost: 0.009, currency: "USD" },
      input_cache_miss: { tokens: 11000 + (i % 4) * 800, cost: 0.32 + (i % 3) * 0.05, currency: "USD" },
      output: { tokens: 4500 + (i % 4) * 400, cost: 0.22 + (i % 3) * 0.03, currency: "USD" },
      total: { cost: 0.55 + (i % 3) * 0.08, currency: "USD" },
    },
  })),
  // 本月
  ...Array.from({ length: 12 }, (_, i) => ({
    agent_id: "codex-main",
    harness: "codex",
    model: ["gpt-5-codex", "gpt-5-mini"][i % 4 === 0 ? 1 : 0],
    provider: "openai",
    ts: new Date(NOW - (i + 1) * 18 * 60 * 60 * 1000).toISOString(),
    session_id: `sess-x-w${i}`,
    usage: {
      input_cache_hit: { tokens: 1000 + (i % 5) * 150, cost: 0.006, currency: "USD" },
      input_cache_miss: { tokens: 9000 + (i % 6) * 600, cost: 0.27 + (i % 4) * 0.04, currency: "USD" },
      output: { tokens: 3500 + (i % 5) * 350, cost: 0.17 + (i % 3) * 0.03, currency: "USD" },
      total: { cost: 0.45 + (i % 4) * 0.07, currency: "USD" },
    },
  })),
];

// 4. opencode-spark — 活跃, 无金额(cost 留空 — daemon 还未接入计费)
//    验证「金额可空留空」形态
const SPARK_RAW_REPORTS: AgentUsageReport[] = [
  // 5h 趋势
  ...[0, 1, 2, 3, 4].map((h) => ({
    agent_id: "opencode-spark",
    harness: "opencode",
    model: "kimi-k2",
    provider: "moonshot",
    ts: new Date(NOW - h * 60 * 60 * 1000).toISOString(),
    session_id: `sess-o-${h}`,
    usage: {
      input_cache_hit: { tokens: 1500 + h * 80, cost: null, currency: null },
      input_cache_miss: { tokens: 9000 + h * 400, cost: null, currency: null },
      output: { tokens: 5000 + h * 220, cost: null, currency: null },
      total: { cost: null, currency: null },
    },
  })),
  // 今日
  ...Array.from({ length: 6 }, (_, i) => ({
    agent_id: "opencode-spark",
    harness: "opencode",
    model: i % 2 === 0 ? "kimi-k2" : "qwen-coder",
    provider: i % 2 === 0 ? "moonshot" : "aliyun",
    ts: new Date(NOW - i * 130 * 60 * 1000).toISOString(),
    session_id: `sess-o-d${i}`,
    usage: {
      input_cache_hit: { tokens: 1000 + (i % 3) * 150, cost: null, currency: null },
      input_cache_miss: { tokens: 7000 + (i % 4) * 500, cost: null, currency: null },
      output: { tokens: 3500 + (i % 4) * 300, cost: null, currency: null },
      total: { cost: null, currency: null },
    },
  })),
  // 本月
  ...Array.from({ length: 10 }, (_, i) => ({
    agent_id: "opencode-spark",
    harness: "opencode",
    model: ["kimi-k2", "qwen-coder"][i % 2],
    provider: ["moonshot", "aliyun"][i % 2],
    ts: new Date(NOW - (i + 1) * 20 * 60 * 60 * 1000).toISOString(),
    session_id: `sess-o-w${i}`,
    usage: {
      input_cache_hit: { tokens: 700 + (i % 4) * 100, cost: null, currency: null },
      input_cache_miss: { tokens: 5000 + (i % 5) * 400, cost: null, currency: null },
      output: { tokens: 2500 + (i % 4) * 250, cost: null, currency: null },
      total: { cost: null, currency: null },
    },
  })),
];

// 5. hermes-ws2 — 空闲(今天无上报, 但 24h+ 前有零星) — 验证空闲态
const WS2_RAW_REPORTS: AgentUsageReport[] = [
  // 仅 26-30h 前有几条(今日无, 本周/月有零星)
  ...Array.from({ length: 3 }, (_, i) => ({
    agent_id: "hermes-ws2",
    harness: "hermes",
    model: "deepseek-v3",
    provider: "deepseek",
    ts: new Date(NOW - (26 + i * 4) * 60 * 60 * 1000).toISOString(),
    session_id: `sess-ws2-${i}`,
    usage: {
      input_cache_hit: { tokens: 1200, cost: 0.004, currency: "USD" },
      input_cache_miss: { tokens: 4500, cost: 0.06, currency: "USD" },
      output: { tokens: 2200, cost: 0.044, currency: "USD" },
      total: { cost: 0.108, currency: "USD" },
    },
  })),
];

export const ALL_AGENTS_RAW: AgentUsageReport[] = [
  ...HERMES_RAW_REPORTS,
  ...CLAUDE_RAW_REPORTS,
  ...CODEX_RAW_REPORTS,
  ...SPARK_RAW_REPORTS,
  ...WS2_RAW_REPORTS,
];

// ---------- 聚合函数(usage_summary 形态, 供大屏消费) ----------

const ALL_AGENT_IDS = [
  "hermes-njbx02",
  "claude-code-ws1",
  "codex-main",
  "opencode-spark",
  "hermes-ws2", // 空闲
] as const;

type AgentId = (typeof ALL_AGENT_IDS)[number];

const HOURS_BY_WINDOW: Record<TimeWindow, number> = { "5h": 5, today: 24, week: 24 * 7, month: 24 * 30 };

function bucketByWindow(reports: AgentUsageReport[], window: TimeWindow): AgentUsageReport[] {
  const hours = HOURS_BY_WINDOW[window];
  const cutoff = NOW - hours * 60 * 60 * 1000;
  return reports.filter((r) => new Date(r.ts).getTime() >= cutoff);
}

function sumTokens(reports: AgentUsageReport[]): number {
  let n = 0;
  for (const r of reports) {
    n += r.usage.input_cache_hit.tokens + r.usage.input_cache_miss.tokens + r.usage.output.tokens;
  }
  return n;
}

function sumCost(reports: AgentUsageReport[]): { cost: number | null; currency: string | null } {
  let cost = 0;
  let seen = false;
  let currency: string | null = null;
  for (const r of reports) {
    if (r.usage.total.cost == null) continue;
    seen = true;
    cost += r.usage.total.cost;
    currency = r.usage.total.currency;
  }
  // 如果所有 r.usage.total.cost 都是 null, 返回 null(留空态)
  return seen ? { cost: round2(cost), currency } : { cost: null, currency: null };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** 按 agent 聚合(用于"明细行" + "总览卡"展示) */
export function buildAgentSummaries(window: TimeWindow): AgentUsageSummary[] {
  return ALL_AGENT_IDS.map((id) => {
    const reports = bucketByWindow(ALL_AGENTS_RAW, window).filter((r) => r.agent_id === id);
    const { cost, currency } = sumCost(reports);
    return {
      agent_id: id,
      tokens: sumTokens(reports),
      cost,
      currency,
      report_count: reports.length,
      is_idle: reports.length === 0,
    };
  }).sort((a, b) => b.tokens - a.tokens);
}

/** 三分项拆分(用于"输入/输出构成"环图/堆叠条) */
export function buildSplit(window: TimeWindow): UsageSplit {
  const reports = bucketByWindow(ALL_AGENTS_RAW, window);
  let hit = 0,
    miss = 0,
    out = 0;
  for (const r of reports) {
    hit += r.usage.input_cache_hit.tokens;
    miss += r.usage.input_cache_miss.tokens;
    out += r.usage.output.tokens;
  }
  const total = hit + miss + out;
  return {
    input_cache_hit: hit,
    input_cache_miss: miss,
    output: out,
    total,
    pct: {
      input_cache_hit: total === 0 ? 0 : hit / total,
      input_cache_miss: total === 0 ? 0 : miss / total,
      output: total === 0 ? 0 : out / total,
    },
  };
}

/** model 分布(占比图) */
export function buildModelDistribution(window: TimeWindow): ModelDistribution[] {
  const reports = bucketByWindow(ALL_AGENTS_RAW, window);
  const byModel = new Map<string, number>();
  for (const r of reports) {
    const n = r.usage.input_cache_hit.tokens + r.usage.input_cache_miss.tokens + r.usage.output.tokens;
    byModel.set(r.model, (byModel.get(r.model) ?? 0) + n);
  }
  return Array.from(byModel.entries())
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

/** 明细行(按 model × agent 的 token + cost) */
export function buildDetailRows(window: TimeWindow): AgentUsageDetailRow[] {
  const reports = bucketByWindow(ALL_AGENTS_RAW, window);
  const map = new Map<string, { tokens: number; cost: number | null; currency: string | null; saw: boolean }>();
  for (const r of reports) {
    const k = `${r.agent_id}|${r.model}`;
    const cur = map.get(k) ?? { tokens: 0, cost: 0, currency: null, saw: false };
    cur.tokens += r.usage.input_cache_hit.tokens + r.usage.input_cache_miss.tokens + r.usage.output.tokens;
    if (r.usage.total.cost != null) {
      cur.cost = (cur.cost ?? 0) + r.usage.total.cost;
      cur.currency = r.usage.total.currency;
      cur.saw = true;
    }
    map.set(k, cur);
  }
  return Array.from(map.entries())
    .map(([k, v]) => {
      const [agent_id, model] = k.split("|");
      return {
        agent_id,
        model,
        tokens: v.tokens,
        cost: v.saw ? round2(v.cost ?? 0) : null,
        currency: v.saw ? v.currency : null,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);
}

/** 趋势序列(5h 按小时分桶, today/week/month 按天分桶)
 *  返回的桶序列 = 完整覆盖窗内所有桶(零值补 0), 保证 chart.js 折线连贯
 */
export function buildTrend(window: TimeWindow): TrendBucket[] {
  const reports = bucketByWindow(ALL_AGENTS_RAW, window);
  const buckets: TrendBucket[] = [];

  if (window === "5h") {
    // 5 个小时桶: 起始 = now-5h, 每桶 = 1h
    for (let i = 4; i >= 0; i--) {
      const start = NOW - (i + 1) * 60 * 60 * 1000;
      const end = NOW - i * 60 * 60 * 1000;
      const ts = new Date(end).toISOString();
      const inBucket = reports.filter((r) => {
        const t = new Date(r.ts).getTime();
        return t >= start && t < end;
      });
      buckets.push({
        label: `T-${i}h`,
        ts,
        tokens: sumTokens(inBucket),
      });
    }
  } else {
    // today/week/month 按天分桶
    const hours = HOURS_BY_WINDOW[window];
    const days = Math.ceil(hours / 24);
    for (let i = days - 1; i >= 0; i--) {
      const dayEnd = NOW - i * 24 * 60 * 60 * 1000;
      const dayStart = dayEnd - 24 * 60 * 60 * 1000;
      const ts = new Date(dayEnd).toISOString();
      const inBucket = reports.filter((r) => {
        const t = new Date(r.ts).getTime();
        return t >= dayStart && t < dayEnd;
      });
      const date = new Date(dayEnd);
      const label = `${date.getMonth() + 1}/${date.getDate()}`;
      buckets.push({ label, ts, tokens: sumTokens(inBucket) });
    }
  }

  return buckets;
}

/** 单个 agent 的 meta(供头部卡片展示) */
export const AGENT_META: Record<AgentId, { harness: string; primary_model: string; provider: string }> = {
  "hermes-njbx02": { harness: "hermes", primary_model: "glm-5.3", provider: "volcengine" },
  "claude-code-ws1": { harness: "claude-code", primary_model: "claude-sonnet-4.5", provider: "anthropic" },
  "codex-main": { harness: "codex", primary_model: "gpt-5-codex", provider: "openai" },
  "opencode-spark": { harness: "opencode", primary_model: "kimi-k2", provider: "moonshot" },
  "hermes-ws2": { harness: "hermes", primary_model: "deepseek-v3", provider: "deepseek" },
};