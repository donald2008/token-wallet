/**
 * agent-card fixture 单一事实源(t_9255cb63 起, t_6eb3e728 抽独立模块):
 * spec 文件间禁 import(Playwright 规则), 抽到独立模块供 agent-card.spec / agent-ux-lite.spec 共享。
 * ⚠️ 派生比例禁从旧记忆抄: 断言值一律按本文件 fixture 现算。
 */
export const fakeSummary = {
  window: {
    since: "2026-09-09T00:00:00+08:00",
    until: "2026-09-09T23:59:59+08:00",
  },
  timezone: "Asia/Shanghai",
  generated_at: "2026-09-09T12:34:56+08:00",
  rows: [
    {
      group: "njbx02",
      calls: 100,
      input_cache_hit_tokens: 50000,
      input_cache_miss_tokens: 10000,
      output_tokens: 4000,
      cost_total: 1.23,
      currency: "USD",
      by_status: { completed: 95, partial: 5, unknown: 0 },
    },
    {
      // t_4b7984d9 round-3 老大 njbx02 亲测 BLOCKING:
      // 9 位数字(4,474,000)场景,buggy CSS 让 tokens 1fr 列只 ~140px,数字 scrollWidth 180
      // 被 .card overflow:hidden 视觉裁掉 — round-3 修复后数字容器宽 286px 零裁剪
      group: "njbx02-heavy",
      calls: 8000,
      input_cache_hit_tokens: 3_310_760,
      input_cache_miss_tokens: 827_690,
      output_tokens: 335_550,
      cost_total: 12.34,
      currency: "USD",
      by_status: { completed: 7600, partial: 400, unknown: 0 },
    },
    {
      group: "home-computer",
      calls: 50,
      input_cache_hit_tokens: 10000,
      input_cache_miss_tokens: 5000,
      output_tokens: 2000,
      cost_total: null,
      currency: null,
      by_status: { completed: 0, partial: 5, unknown: 0 },
    },
    {
      group: "desktop-e5jupfs",
      calls: 0,
      input_cache_hit_tokens: 0,
      input_cache_miss_tokens: 0,
      output_tokens: 0,
      cost_total: null,
      currency: null,
      by_status: { completed: 0, partial: 0, unknown: 0 },
    },
  ],
  total: {
    // t_4b7984d9 round-3: total 必须等于 rows[] 合计(否则大屏 hero 数字与明细对不上)
    // njbx02(64k) + njbx02-heavy(4,474k) + home(17k) + desktop(0) = 4,555,000
    // calls: 100 + 8000 + 50 + 0 = 8,150
    calls: 8150,
    input_cache_hit_tokens: 50000 + 3310760 + 10000 + 0, // = 3,370,760
    input_cache_miss_tokens: 10000 + 827690 + 5000 + 0, // = 842,690
    output_tokens: 4000 + 335550 + 2000 + 0, // = 341,550
    cost_total: 1.23 + 12.34, // home + desktop cost=null, 合计 = 13.57
    currency: "USD",
    by_status: { completed: 95 + 7600 + 0 + 0, partial: 5 + 400 + 5 + 0, unknown: 0 },
    // 9 + 8 + 0 + 0 = 8,005; partial: 5 + 400 + 5 + 0 = 410
  },
}

export function deriveMultiFromSingle(base: typeof fakeSummary) {
  const agentRows = base.rows;
  const modelRows = agentRows.flatMap((r) => {
    const hit = Math.round(r.input_cache_hit_tokens / 2);
    const miss = Math.round(r.input_cache_miss_tokens / 2);
    const out = Math.round(r.output_tokens / 2);
    const mk = (model: string) => ({
      ...r,
      group: `${r.group}|${model}`,
      input_cache_hit_tokens: hit,
      input_cache_miss_tokens: miss,
      output_tokens: out,
    });
    return [mk("glm-5.3-flash"), mk("kimi-k2")];
  });
  const dayRows = agentRows.map((r, i) => ({
    ...r,
    group: i % 2 === 0 ? "2026-09-08" : "2026-09-09",
  }));
  return {
    agent: { ok: true, data: base },
    "agent,model": { ok: true, data: { ...base, rows: modelRows } },
    day: { ok: true, data: { ...base, rows: dayRows } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// t_56c66972 置顶组件 AgentUsageHero 数据面 fixture(hour 维 = 协议 v1.1 增补)
// 窗口口径: generated_at(12:34:56) 往前 5h → since 07:34:56, until = generated_at。
// 前端按 daemon 回显的 window 换算刻度 → 断言与客户端时钟无关(确定性)。
// ⚠️ 断言值一律按本文件现算, 禁抄旧记忆。
// ─────────────────────────────────────────────────────────────────────────────

const HOUR_WINDOW = {
  since: "2026-09-09T07:34:56+08:00",
  until: "2026-09-09T12:34:56+08:00",
};

/** hour 维桶行(协议 §2.2 summary_row 同形): tokens 记在 input_cache_miss 分项, 其余分项 0 */
function hourRow(hour: string, tokens: number) {
  return {
    group: hour,
    calls: Math.round(tokens / 1000),
    input_cache_hit_tokens: 0,
    input_cache_miss_tokens: tokens,
    output_tokens: 0,
    cost_total: null,
    currency: null,
    by_status: { completed: 1, partial: 0, unknown: 0 },
  };
}

function hourSummary(buckets: Array<[string, number]>) {
  const rows = buckets.map(([hour, tokens]) => hourRow(hour, tokens));
  const miss = buckets.reduce((s, [, t]) => s + t, 0);
  return {
    window: { ...HOUR_WINDOW },
    timezone: "Asia/Shanghai",
    generated_at: "2026-09-09T12:34:56+08:00",
    rows,
    total: {
      calls: rows.reduce((s, r) => s + r.calls, 0),
      input_cache_hit_tokens: 0,
      input_cache_miss_tokens: miss,
      output_tokens: 0,
      cost_total: null,
      currency: null,
      by_status: { completed: rows.length, partial: 0, unknown: 0 },
    },
  };
}

/** 正常态: 5 个整点桶覆盖 08:00-12:00 → 折线自刻度 0 起, 不标首点星 */
export const fakeHourSummary = hourSummary([
  ["2026-09-09T08:00", 1_000_000],
  ["2026-09-09T09:00", 1_200_000],
  ["2026-09-09T10:00", 1_100_000],
  ["2026-09-09T11:00", 1_500_000],
  ["2026-09-09T12:00", 2_000_000],
]);

/** 边界④ 不足窗口: 仅当前小时桶(12:00 距 until 34 分钟 < 60min) → 首点标记 + 星标 + 提示句 */
export const fakeHourSummaryShort = hourSummary([["2026-09-09T12:00", 18_425_400]]);

/** 边界④ 断线起始: 两个桶但首个在 11:00(距 until 94 分钟) → 折线自刻度 3 起(非 x=0 零值平线) */
export const fakeHourSummaryLate = hourSummary([
  ["2026-09-09T11:00", 18_425_400],
  ["2026-09-09T12:00", 20_000_000],
]);

/** 边界②/③: 全局零数据(零行 + 零 tokens) */
export const emptySummary = {
  ...fakeSummary,
  rows: [],
  total: {
    calls: 0,
    input_cache_hit_tokens: 0,
    input_cache_miss_tokens: 0,
    output_tokens: 0,
    cost_total: null,
    currency: null,
    by_status: { completed: 0, partial: 0, unknown: 0 },
  },
};

/** 边界①: 陈旧 agent 行(快照前一日 22:14 无上报 > 30min) */
export const staleAgentSummary = {
  ...fakeSummary,
  rows: [
    {
      group: "k3-worker",
      calls: 2,
      input_cache_hit_tokens: 4_000_000,
      input_cache_miss_tokens: 474_000,
      output_tokens: 0,
      cost_total: null,
      currency: null,
      by_status: { completed: 0, partial: 2, unknown: 0 },
      latest_ts: "2026-09-08T22:14:00+08:00",
    },
    ...fakeSummary.rows.map((r) => ({ ...r, latest_ts: "2026-09-09T12:30:00+08:00" })),
  ],
};
