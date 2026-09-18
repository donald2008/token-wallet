/**
 * token-wallet Agent 用量大屏 — mock 数据浏览器版 (t_4a8bc406)
 *
 * 把 packages/app/src/mock/agentUsage.mock.ts 的逻辑搬到 JS,
 * 供 dev-pages/*.html 独立浏览器打开使用(不走 vite 构建)。
 *
 * ⚠️ 这是 mock 数据副本, 不要在这里修改业务契约; 改动请回
 *   packages/app/src/mock/agentUsage.mock.ts(给真正的 P0 路径用)。
 *
 * 严格对齐契约:
 *   - usage.input_cache_hit/input_cache_miss/output: tokens 必有, cost/currency 可空
 *   - usage.total: 只有 cost + currency(无 tokens)
 *   - 无金额 agent(cost=null)走留空态
 */

(function (global) {
  "use strict";

  const MOCK_NOW_ISO = "2026-09-09T14:00:00+08:00";
  const NOW = new Date(MOCK_NOW_ISO).getTime();

  // ---- 单条上报生成器 ----
  function hoursAgo(h) {
    return new Date(NOW - h * 60 * 60 * 1000).toISOString();
  }

  // 5 个 agent 的原始上报(完全对应 mock.ts)
  const RAW = [];

  // 1. hermes-njbx02 — 活跃, USD
  for (let h = 0; h < 5; h++) {
    RAW.push({
      agent_id: "hermes-njbx02", harness: "hermes", model: "glm-5.3", provider: "volcengine",
      ts: hoursAgo(h), session_id: `sess-h-${h}`,
      usage: {
        input_cache_hit: { tokens: 12000 + h * 600, cost: 0.04, currency: "USD" },
        input_cache_miss: { tokens: 30000 + h * 1500, cost: 0.45, currency: "USD" },
        output: { tokens: 18000 + h * 900, cost: 0.36, currency: "USD" },
        total: { cost: 0.85, currency: "USD" },
      },
    });
  }
  for (let i = 0; i < 14; i++) {
    const mod = i % 3;
    const m = ["glm-5.3", "deepseek-v3", "qwen-max"][mod];
    const p = ["volcengine", "deepseek", "aliyun"][mod];
    RAW.push({
      agent_id: "hermes-njbx02", harness: "hermes", model: m, provider: p,
      ts: hoursAgo(i * 1.5), session_id: `sess-h-d${i}`,
      usage: {
        input_cache_hit: { tokens: 8000 + (i % 5) * 1200, cost: 0.02, currency: "USD" },
        input_cache_miss: { tokens: 22000 + (i % 7) * 2000, cost: 0.3 + (i % 4) * 0.05, currency: "USD" },
        output: { tokens: 14000 + (i % 6) * 1500, cost: 0.25 + (i % 3) * 0.04, currency: "USD" },
        total: { cost: 0.57 + (i % 4) * 0.09, currency: "USD" },
      },
    });
  }
  for (let i = 0; i < 22; i++) {
    const arr = ["glm-5.3", "deepseek-v3", "qwen-max"];
    RAW.push({
      agent_id: "hermes-njbx02", harness: "hermes", model: arr[i % 3], provider: arr[i % 3] === "glm-5.3" ? "volcengine" : arr[i % 3] === "deepseek-v3" ? "deepseek" : "aliyun",
      ts: hoursAgo((i + 1) * 10), session_id: `sess-h-w${i}`,
      usage: {
        input_cache_hit: { tokens: 6000 + (i % 8) * 800, cost: 0.018, currency: "USD" },
        input_cache_miss: { tokens: 18000 + (i % 9) * 1500, cost: 0.24 + (i % 5) * 0.03, currency: "USD" },
        output: { tokens: 11000 + (i % 7) * 1000, cost: 0.2 + (i % 4) * 0.03, currency: "USD" },
        total: { cost: 0.46 + (i % 5) * 0.06, currency: "USD" },
      },
    });
  }

  // 2. claude-code-ws1 — 活跃, USD
  for (let h = 0; h < 5; h++) {
    RAW.push({
      agent_id: "claude-code-ws1", harness: "claude-code", model: "claude-sonnet-4.5", provider: "anthropic",
      ts: hoursAgo(h), session_id: `sess-c-${h}`,
      usage: {
        input_cache_hit: { tokens: 4500 + h * 200, cost: 0.022, currency: "USD" },
        input_cache_miss: { tokens: 22000 + h * 800, cost: 0.66, currency: "USD" },
        output: { tokens: 9000 + h * 350, cost: 0.45, currency: "USD" },
        total: { cost: 1.13, currency: "USD" },
      },
    });
  }
  for (let i = 0; i < 9; i++) {
    const m = i % 2 === 0 ? "claude-sonnet-4.5" : "claude-haiku-4.5";
    RAW.push({
      agent_id: "claude-code-ws1", harness: "claude-code", model: m, provider: "anthropic",
      ts: hoursAgo(i * 1.7), session_id: `sess-c-d${i}`,
      usage: {
        input_cache_hit: { tokens: 3000 + (i % 4) * 400, cost: 0.015, currency: "USD" },
        input_cache_miss: { tokens: 18000 + (i % 5) * 1200, cost: 0.5 + (i % 3) * 0.08, currency: "USD" },
        output: { tokens: 7000 + (i % 6) * 600, cost: 0.35 + (i % 4) * 0.04, currency: "USD" },
        total: { cost: 0.86 + (i % 4) * 0.12, currency: "USD" },
      },
    });
  }
  for (let i = 0; i < 16; i++) {
    const m = i % 2 === 0 ? "claude-sonnet-4.5" : "claude-haiku-4.5";
    RAW.push({
      agent_id: "claude-code-ws1", harness: "claude-code", model: m, provider: "anthropic",
      ts: hoursAgo((i + 1) * 14), session_id: `sess-c-w${i}`,
      usage: {
        input_cache_hit: { tokens: 2000 + (i % 6) * 300, cost: 0.012, currency: "USD" },
        input_cache_miss: { tokens: 14000 + (i % 7) * 900, cost: 0.4 + (i % 5) * 0.05, currency: "USD" },
        output: { tokens: 5000 + (i % 5) * 500, cost: 0.25 + (i % 4) * 0.03, currency: "USD" },
        total: { cost: 0.66 + (i % 5) * 0.08, currency: "USD" },
      },
    });
  }

  // 3. codex-main — 活跃, USD
  for (let h = 0; h < 5; h++) {
    RAW.push({
      agent_id: "codex-main", harness: "codex", model: "gpt-5-codex", provider: "openai",
      ts: hoursAgo(h), session_id: `sess-x-${h}`,
      usage: {
        input_cache_hit: { tokens: 2000 + h * 100, cost: 0.012, currency: "USD" },
        input_cache_miss: { tokens: 14000 + h * 600, cost: 0.42, currency: "USD" },
        output: { tokens: 6000 + h * 250, cost: 0.3, currency: "USD" },
        total: { cost: 0.73, currency: "USD" },
      },
    });
  }
  for (let i = 0; i < 7; i++) {
    RAW.push({
      agent_id: "codex-main", harness: "codex", model: "gpt-5-codex", provider: "openai",
      ts: hoursAgo(i * 1.85), session_id: `sess-x-d${i}`,
      usage: {
        input_cache_hit: { tokens: 1500 + (i % 3) * 200, cost: 0.009, currency: "USD" },
        input_cache_miss: { tokens: 11000 + (i % 4) * 800, cost: 0.32 + (i % 3) * 0.05, currency: "USD" },
        output: { tokens: 4500 + (i % 4) * 400, cost: 0.22 + (i % 3) * 0.03, currency: "USD" },
        total: { cost: 0.55 + (i % 3) * 0.08, currency: "USD" },
      },
    });
  }
  for (let i = 0; i < 12; i++) {
    const m = i % 4 === 0 ? "gpt-5-mini" : "gpt-5-codex";
    RAW.push({
      agent_id: "codex-main", harness: "codex", model: m, provider: "openai",
      ts: hoursAgo((i + 1) * 18), session_id: `sess-x-w${i}`,
      usage: {
        input_cache_hit: { tokens: 1000 + (i % 5) * 150, cost: 0.006, currency: "USD" },
        input_cache_miss: { tokens: 9000 + (i % 6) * 600, cost: 0.27 + (i % 4) * 0.04, currency: "USD" },
        output: { tokens: 3500 + (i % 5) * 350, cost: 0.17 + (i % 3) * 0.03, currency: "USD" },
        total: { cost: 0.45 + (i % 4) * 0.07, currency: "USD" },
      },
    });
  }

  // 4. opencode-spark — 活跃, 无金额(cost=null, 验证留空)
  for (let h = 0; h < 5; h++) {
    RAW.push({
      agent_id: "opencode-spark", harness: "opencode", model: "kimi-k2", provider: "moonshot",
      ts: hoursAgo(h), session_id: `sess-o-${h}`,
      usage: {
        input_cache_hit: { tokens: 1500 + h * 80, cost: null, currency: null },
        input_cache_miss: { tokens: 9000 + h * 400, cost: null, currency: null },
        output: { tokens: 5000 + h * 220, cost: null, currency: null },
        total: { cost: null, currency: null },
      },
    });
  }
  for (let i = 0; i < 6; i++) {
    const m = i % 2 === 0 ? "kimi-k2" : "qwen-coder";
    const p = i % 2 === 0 ? "moonshot" : "aliyun";
    RAW.push({
      agent_id: "opencode-spark", harness: "opencode", model: m, provider: p,
      ts: hoursAgo(i * 2.15), session_id: `sess-o-d${i}`,
      usage: {
        input_cache_hit: { tokens: 1000 + (i % 3) * 150, cost: null, currency: null },
        input_cache_miss: { tokens: 7000 + (i % 4) * 500, cost: null, currency: null },
        output: { tokens: 3500 + (i % 4) * 300, cost: null, currency: null },
        total: { cost: null, currency: null },
      },
    });
  }
  for (let i = 0; i < 10; i++) {
    const m = i % 2 === 0 ? "kimi-k2" : "qwen-coder";
    const p = i % 2 === 0 ? "moonshot" : "aliyun";
    RAW.push({
      agent_id: "opencode-spark", harness: "opencode", model: m, provider: p,
      ts: hoursAgo((i + 1) * 20), session_id: `sess-o-w${i}`,
      usage: {
        input_cache_hit: { tokens: 700 + (i % 4) * 100, cost: null, currency: null },
        input_cache_miss: { tokens: 5000 + (i % 5) * 400, cost: null, currency: null },
        output: { tokens: 2500 + (i % 4) * 250, cost: null, currency: null },
        total: { cost: null, currency: null },
      },
    });
  }

  // 5. hermes-ws2 — 空闲(26h+ 之前 3 条零星, 今日窗内无)
  for (let i = 0; i < 3; i++) {
    RAW.push({
      agent_id: "hermes-ws2", harness: "hermes", model: "deepseek-v3", provider: "deepseek",
      ts: hoursAgo(26 + i * 4), session_id: `sess-ws2-${i}`,
      usage: {
        input_cache_hit: { tokens: 1200, cost: 0.004, currency: "USD" },
        input_cache_miss: { tokens: 4500, cost: 0.06, currency: "USD" },
        output: { tokens: 2200, cost: 0.044, currency: "USD" },
        total: { cost: 0.108, currency: "USD" },
      },
    });
  }

  // ---- 聚合函数(对齐 mock.ts) ----
  const HOURS_BY_WINDOW = { "5h": 5, today: 24, week: 24 * 7, month: 24 * 30 };

  function bucketByWindow(reports, window) {
    const hours = HOURS_BY_WINDOW[window];
    const cutoff = NOW - hours * 60 * 60 * 1000;
    return reports.filter((r) => new Date(r.ts).getTime() >= cutoff);
  }
  function sumTokens(reports) {
    let n = 0;
    for (const r of reports) {
      n += r.usage.input_cache_hit.tokens + r.usage.input_cache_miss.tokens + r.usage.output.tokens;
    }
    return n;
  }
  function sumCost(reports) {
    let cost = 0;
    let seen = false;
    let currency = null;
    for (const r of reports) {
      if (r.usage.total.cost == null) continue;
      seen = true;
      cost += r.usage.total.cost;
      currency = r.usage.total.currency;
    }
    return seen ? { cost: round2(cost), currency } : { cost: null, currency: null };
  }
  function round2(x) { return Math.round(x * 100) / 100; }

  const ALL_AGENT_IDS = [
    "hermes-njbx02",
    "claude-code-ws1",
    "codex-main",
    "opencode-spark",
    "hermes-ws2",
  ];

  function buildAgentSummaries(window) {
    return ALL_AGENT_IDS.map((id) => {
      const reports = bucketByWindow(RAW, window).filter((r) => r.agent_id === id);
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

  function buildSplit(window) {
    const reports = bucketByWindow(RAW, window);
    let hit = 0, miss = 0, out = 0;
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

  function buildModelDistribution(window) {
    const reports = bucketByWindow(RAW, window);
    const byModel = new Map();
    for (const r of reports) {
      const n = r.usage.input_cache_hit.tokens + r.usage.input_cache_miss.tokens + r.usage.output.tokens;
      byModel.set(r.model, (byModel.get(r.model) || 0) + n);
    }
    return Array.from(byModel.entries())
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((a, b) => b.tokens - a.tokens);
  }

  function buildDetailRows(window) {
    const reports = bucketByWindow(RAW, window);
    const map = new Map();
    for (const r of reports) {
      const k = `${r.agent_id}|${r.model}`;
      const cur = map.get(k) || { tokens: 0, cost: 0, currency: null, saw: false };
      cur.tokens += r.usage.input_cache_hit.tokens + r.usage.input_cache_miss.tokens + r.usage.output.tokens;
      if (r.usage.total.cost != null) {
        cur.cost = (cur.cost || 0) + r.usage.total.cost;
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
          cost: v.saw ? round2(v.cost || 0) : null,
          currency: v.saw ? v.currency : null,
        };
      })
      .sort((a, b) => b.tokens - a.tokens);
  }

  function buildTrend(window) {
    const reports = bucketByWindow(RAW, window);
    const buckets = [];
    if (window === "5h") {
      for (let i = 4; i >= 0; i--) {
        const start = NOW - (i + 1) * 60 * 60 * 1000;
        const end = NOW - i * 60 * 60 * 1000;
        const ts = new Date(end).toISOString();
        const inBucket = reports.filter((r) => {
          const t = new Date(r.ts).getTime();
          return t >= start && t < end;
        });
        buckets.push({ label: `T-${i}h`, ts, tokens: sumTokens(inBucket) });
      }
    } else {
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
        const d = new Date(dayEnd);
        buckets.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, ts, tokens: sumTokens(inBucket) });
      }
    }
    return buckets;
  }

  const AGENT_META = {
    "hermes-njbx02": { harness: "hermes", primary_model: "glm-5.3", provider: "volcengine" },
    "claude-code-ws1": { harness: "claude-code", primary_model: "claude-sonnet-4.5", provider: "anthropic" },
    "codex-main": { harness: "codex", primary_model: "gpt-5-codex", provider: "openai" },
    "opencode-spark": { harness: "opencode", primary_model: "kimi-k2", provider: "moonshot" },
    "hermes-ws2": { harness: "hermes", primary_model: "deepseek-v3", provider: "deepseek" },
  };

  // ---- 导出 ----
  global.AgentUsageMock = {
    MOCK_NOW_ISO,
    AGENT_META,
    buildAgentSummaries,
    buildSplit,
    buildModelDistribution,
    buildDetailRows,
    buildTrend,
  };
})(window);