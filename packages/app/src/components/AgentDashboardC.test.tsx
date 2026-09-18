/**
 * AgentDashboardC 组件单测(t_15397c99 SL-01 Ops Wall IA 重构):
 * - 渲染 KPI 带 / 趋势 / Model / 明细 / 三分项 五块面板(Ops Wall 12 列面板墙)
 * - testid 契约映射(40-handoff/contracts/testid-contract.md): hero-*→kpi-*(大数字锚
 *   hero-tokens/hero-cost 保留), detail-list→detail-table(testid 名保留, DOM ul→table)
 * - 金额可空留白契约(hero-cost is-empty; 明细表 pricing 未接入无金额列)
 * - 主题切换/返回钮已删减契约(SL-08 B③); canvas 存在(chart.js 异步)
 * - t_12c28686/t_e83ad982 语义继承: agent tab 切换联动(现在落 Model 面板头, 联动明细行
 *   高亮 + 模型分布过滤); 模块空态(失败重试/积累中/单模型)
 * - t_5cf22ba4 回归锁: 补 0 桶/一位小数不吞项/tokens 标注
 */
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentDashboardC,
  buildTrend,
  splitGroupDims,
  seriesVar,
  weekdayLabel,
  snapshotStamp,
  snapshotAge,
} from "./AgentDashboardC";
import type { AgentDashboardCProps } from "./AgentDashboardC.types";
import type { McpQueryResult } from "../mcpQuery";
import type { UsageSummaryOutput, SummaryRow } from "../mcpQueryTypes";

const rows: SummaryRow[] = [
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
    group: "home-computer",
    calls: 50,
    input_cache_hit_tokens: 10000,
    input_cache_miss_tokens: 5000,
    output_tokens: 2000,
    cost_total: 0.5,
    currency: "USD",
    by_status: { completed: 50, partial: 0, unknown: 0 },
  },
];

const fakeSummary: UsageSummaryOutput = {
  window: { since: "2026-09-09T00:00:00+08:00", until: "2026-09-09T23:59:59+08:00" },
  timezone: "Asia/Shanghai",
  generated_at: "2026-09-09T12:00:00+08:00",
  rows,
  total: {
    calls: 150,
    input_cache_hit_tokens: 60000,
    input_cache_miss_tokens: 15000,
    output_tokens: 6000,
    cost_total: 1.73,
    currency: "USD",
    by_status: { completed: 145, partial: 5, unknown: 0 },
  },
};

/** 多维 mock — 2 agent × 2 model(agent|model) + 2 day */
const multiModelSummary: UsageSummaryOutput = {
  window: { since: "2026-09-08T00:00:00+08:00", until: "2026-09-09T23:59:59+08:00" },
  timezone: "Asia/Shanghai",
  generated_at: "2026-09-09T12:00:00+08:00",
  rows: [
    { ...rows[0]!, group: "njbx02|glm-5.3-flash" },
    { ...rows[0]!, group: "njbx02|kimi-k2" },
    { ...rows[1]!, group: "home-computer|glm-5.3-flash" },
    { ...rows[1]!, group: "home-computer|deepseek-v3" },
  ],
  total: { ...fakeSummary.total },
};

const multiDaySummary: UsageSummaryOutput = {
  window: { since: "2026-09-08T00:00:00+08:00", until: "2026-09-09T23:59:59+08:00" },
  timezone: "Asia/Shanghai",
  generated_at: "2026-09-09T12:00:00+08:00",
  rows: [
    { ...rows[0]!, group: "2026-09-08" },
    { ...rows[1]!, group: "2026-09-09" },
  ],
  total: { ...fakeSummary.total },
};

const okResult = { ok: true as const, data: multiModelSummary, generatedAt: multiModelSummary.generated_at };
const okDayResult = { ok: true as const, data: multiDaySummary, generatedAt: multiDaySummary.generated_at };
const failResult: McpQueryResult<UsageSummaryOutput> = { ok: false, reason: "unreachable" };

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: React.ReactNode): { container: HTMLDivElement; root: Root } {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r = createRoot(c);
  act(() => {
    r.render(node);
  });
  container = c;
  root = r;
  return { container: c, root: r };
}

afterEach(() => {
  const r = root;
  const c = container;
  if (r !== null && c !== null) {
    act(() => r.unmount());
    c.remove();
  }
  container = null;
  root = null;
});

function mountDash(
  summary: UsageSummaryOutput = fakeSummary,
  modelSummary: McpQueryResult<UsageSummaryOutput> = okResult,
  trendSummary: McpQueryResult<UsageSummaryOutput> = okDayResult,
  /** SL-03: 降级形态 props(offline / *Stale / onRetry)透传 —— 既有调用点零改动 */
  extra: Partial<AgentDashboardCProps> = {},
) {
  return mount(
    <AgentDashboardC
      summary={summary}
      modelSummary={modelSummary}
      trendSummary={trendSummary}
      generatedAt={summary.generated_at}
      onRetry={() => {}}
      {...extra}
    />,
  );
}

describe("splitGroupDims(多维 group 解析防御)", () => {
  it("按维度顺序拆分 a|b|c", () => {
    expect(splitGroupDims("njbx02|glm-5.3-flash", ["agent", "model"])).toEqual([
      "njbx02",
      "glm-5.3-flash",
    ]);
  });
  it("空段防御: 连续分隔符丢弃空段, 段数不符返回 null", () => {
    expect(splitGroupDims("a||b", ["agent", "model"])).toEqual(["a", "b"]);
    expect(splitGroupDims("a|", ["agent", "model"])).toBeNull();
    expect(splitGroupDims("only-one", ["agent", "model"])).toBeNull();
    expect(splitGroupDims("a|b|c|d", ["agent", "model"])).toBeNull();
  });
});

describe("seriesVar/weekdayLabel(t_15397c99 SL-01 渲染层派生)", () => {
  it("seriesVar: 系列色序变量名固定顺序取用, 超 6 系列回绕", () => {
    expect(seriesVar(0)).toBe("--chart-1");
    expect(seriesVar(5)).toBe("--chart-6");
    expect(seriesVar(6)).toBe("--chart-1");
  });
  it("weekdayLabel: YYYY-MM-DD → 中文星期(appendix 数据接线)", () => {
    // 2026-09-09 是周三(真机库同窗)
    expect(weekdayLabel("2026-09-09")).toBe("周三");
    expect(weekdayLabel("2026-09-13")).toBe("周日");
    // 非日期 label(兼容退路「今日」)原样返回
    expect(weekdayLabel("今日")).toBe("今日");
  });
});

describe("AgentDashboardC(Ops Wall 常态渲染 SC-01)", () => {
  it("KPI 带: tokens/cost/命中率/活跃 四卡 + 精确数副行(hero-* 映射为 KPI 大数字锚)", () => {
    const { container: c } = mountDash();
    // KPI tokens = 全局 total 81,000(tab 不联动 KPI)
    expect(c.querySelector('[data-testid="agent-dashboard-c-kpi-tokens"]')?.textContent).toContain("81,000");
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-tokens"]')?.textContent).toBe("81,000");
    // KPI cost = 1.73 USD(大数字锚 hero-cost)
    expect(c.querySelector('[data-testid="agent-dashboard-c-kpi-cost"]')?.textContent).toContain("1.73 USD");
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-cost"]')?.textContent).toBe("1.73 USD");
    // KPI 命中率 = hit/(hit+miss) = 60000/75000 = 80.0%(H2 口径, 非 hit/total 的 74.1%)
    expect(c.querySelector('[data-testid="agent-dashboard-c-kpi-hit"]')?.textContent).toContain("80.0%");
    expect(c.querySelector('[data-testid="agent-dashboard-c-hit-rate"]')?.textContent).toBe("80.0%");
    // KPI 活跃 = 2/2(completed>0 计数)
    expect(c.querySelector('[data-testid="agent-dashboard-c-kpi-active"]')?.textContent).toContain("2");
    expect(c.querySelector('[data-testid="agent-dashboard-c-active"]')?.textContent).toBe("2");
    // 调用副行 = total.calls(KPI tokens 卡的 sub 行)
    const tokensSub = c.querySelector(".dash-kpi.t1 .dash-kpi-sub");
    expect(tokensSub?.textContent).toContain("150");
  });

  it("titlebar: 产品语言标题(S10), 内部命名「Layout C」禁出街", () => {
    const { container: c } = mountDash();
    const bar = c.querySelector(".dash-titlebar");
    expect(bar?.textContent).toContain("Agent 用量");
    expect(bar?.textContent).toContain("09-09 ~ 09-09"); // 窗口副题
    expect(c.querySelector('[data-testid="agent-dashboard-c"]')?.textContent).not.toContain("Layout C");
    expect(c.querySelector('[data-testid="agent-dashboard-c"]')?.textContent).not.toContain("2×2");
  });

  it("明细表: agent 维全量一行一 agent(appendix 数据接线), 7 列右对齐成列", () => {
    const { container: c } = mountDash();
    const table = c.querySelector('[data-testid="agent-dashboard-c-detail-list"]');
    expect(table?.tagName).toBe("TABLE"); // DOM 契约: ul→table
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(2); // 全量, 不只当前 agent
    expect(table?.querySelectorAll("thead th")).toHaveLength(7);
    // W1 裁定(2026-09-18 人工终审): 第 7 列「模型」→「成本」, 对齐锁定参考 ops-wall 第 7 列
    expect(table?.querySelectorAll("thead th")[6]?.textContent).toBe("成本");
    const njbx02 = table?.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"]');
    expect(njbx02?.textContent).toContain("njbx02");
    expect(njbx02?.querySelector(".num")?.textContent).toMatch(/64,000/);
    // W1 成本列接线: cost_total/currency 进第 7 列(H3: null 留空)
    expect(njbx02?.querySelector("td:last-child")?.textContent).toContain("1.23 USD");
    // 当前 agent(njbx02, tokens 最大)行高亮 = H4 联动语义保留
    expect(njbx02?.getAttribute("data-selected")).toBe("true");
    const home = table?.querySelector('[data-testid="agent-dashboard-c-detail-home-computer"]');
    expect(home?.getAttribute("data-selected")).toBeNull();
  });

  it("三分项: 堆叠条三段宽度按比例(全局 total 口径) + 行式三行", () => {
    const { container: c } = mountDash();
    // 全局 total: 60000/81000 = 74.1%, 15000/81000 = 18.5%, 6000/81000 = 7.4%
    expect(c.querySelector('[data-testid="agent-dashboard-c-seg-hit"]')?.getAttribute("style")).toMatch(
      /width:\s*74\.1%/,
    );
    expect(c.querySelector('[data-testid="agent-dashboard-c-seg-miss"]')?.getAttribute("style")).toMatch(
      /width:\s*18\.5%/,
    );
    expect(c.querySelector('[data-testid="agent-dashboard-c-seg-out"]')?.getAttribute("style")).toMatch(
      /width:\s*7\.4%/,
    );
    const split = c.querySelector(".dash-p-split");
    expect(split?.textContent).toContain("CACHE HIT");
    expect(split?.textContent).toContain("CACHE MISS");
    expect(split?.textContent).toContain("OUTPUT");
    expect(split?.textContent).toContain("60,000"); // hit 精确数
  });

  it("canvas 元素存在(chart.js 异步加载, 渲染不阻断)", () => {
    const { container: c } = mountDash();
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-trend"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-model"]')).toBeTruthy();
  });

  it("趋势 phead note: bucket 数与均值(S8 派生, 零新增查询)", () => {
    const { container: c } = mountDash();
    // 2 天桶: tokens = 64,000(09-08) + 17,000(09-09) → 均值 40,500
    const note = c.querySelector('[data-testid="dash-trend-note"]');
    expect(note?.textContent).toContain("日粒度");
    expect(note?.textContent).toContain("均值 40,500");
  });

  it("SL-08 B③: 顶栏主题切换/返回钮已删减 — 不再渲染, 主题跟随全局", () => {
    const { container: c } = mountDash();
    // B③ 契约: 三 testid 全删(theme-dark/-light/-back), 顶栏只留标题+时间窗占位
    expect(c.querySelector('[data-testid="agent-dashboard-c-theme-dark"]')).toBeNull();
    expect(c.querySelector('[data-testid="agent-dashboard-c-theme-light"]')).toBeNull();
    expect(c.querySelector('[data-testid="agent-dashboard-c-back"]')).toBeNull();
    // 时间窗占位保留(C② 下周期填入切换)
    expect(c.querySelector('[data-testid="agent-dashboard-c-window"]')).not.toBeNull();
  });

  it("footer 显示 generated_at 时间戳(agent-dashboard-c-meta)", () => {
    const { container: c } = mountDash();
    expect(c.querySelector('[data-testid="agent-dashboard-c-meta"]')?.textContent).toMatch(
      /2026-09-09T12:00:00\+08:00/,
    );
  });

  it("H2: hit+miss=0 命中率显干净 — 而非 —%", () => {
    const noCache: UsageSummaryOutput = {
      ...fakeSummary,
      total: {
        ...fakeSummary.total,
        input_cache_hit_tokens: 0,
        input_cache_miss_tokens: 0,
        output_tokens: 6000,
      },
      rows: rows.map((r) => ({ ...r, input_cache_hit_tokens: 0, input_cache_miss_tokens: 0 })),
    };
    const { container: c } = mountDash(noCache);
    expect(c.querySelector('[data-testid="agent-dashboard-c-hit-rate"]')?.textContent).toBe("—");
  });

  it("H3: cost=null 时 KPI cost 大数字留空(is-empty)不显 0", () => {
    const partial: UsageSummaryOutput = {
      ...fakeSummary,
      rows: [{ ...fakeSummary.rows[0]!, cost_total: null }],
      total: { ...fakeSummary.total, cost_total: null, currency: null },
    };
    const { container: c } = mountDash(partial);
    // is-empty 挂在 KPI 大数字(.dash-kpi-v, 即 testid 落点元素)上: visibility:hidden 保行高
    const kpiV = c.querySelector('[data-testid="agent-dashboard-c-kpi-cost"]');
    expect(kpiV?.classList.contains("is-empty")).toBe(true);
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-cost"]')?.textContent).toBe("");
  });
});

describe("AgentDashboardC(多维数据面 + agent tab H4)", () => {
  it("多 agent 渲染 tab 栏(Model 面板头) + 切换联动明细行高亮/KPI 保持全局口径", () => {
    const { container: c } = mountDash();
    const tabs = c.querySelectorAll(".dash-agent-tab");
    expect(tabs).toHaveLength(2);
    expect(c.querySelector('[data-testid="dash-agent-tab-njbx02"]')?.getAttribute("aria-selected")).toBe("true");
    expect(c.querySelector('[data-testid="dash-agent-tab-home-computer"]')?.getAttribute("aria-selected")).toBe("false");
    // KPI = 全局 total 81,000(tab 不联动 KPI)
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-tokens"]')?.textContent).toBe("81,000");
    // 切到 home-computer → KPI 不变, 明细高亮切行
    const homeTab = c.querySelector('[data-testid="dash-agent-tab-home-computer"]') as HTMLButtonElement;
    act(() => homeTab.click());
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-tokens"]')?.textContent).toBe("81,000");
    const list = c.querySelector('[data-testid="agent-dashboard-c-detail-list"]');
    expect(list?.querySelector('[data-testid="agent-dashboard-c-detail-home-computer"]')?.getAttribute("data-selected")).toBe("true");
    expect(list?.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"]')?.getAttribute("data-selected")).toBeNull();
  });

  it("Model 分布: 二维 rows 过滤当前 agent, 多模型 ≥2 slice + 模型计数", () => {
    const { container: c } = mountDash(fakeSummary, okResult);
    expect(c.querySelector('[data-testid="agent-dashboard-c-models"]')?.textContent).toBe("2");
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-model"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="agent-dashboard-c-model-table"]')).toBeTruthy();
    // 切 home-computer → 也是 2 模型(glm + deepseek)
    const homeTab = c.querySelector('[data-testid="dash-agent-tab-home-computer"]') as HTMLButtonElement;
    act(() => homeTab.click());
    expect(c.querySelector('[data-testid="agent-dashboard-c-models"]')?.textContent).toBe("2");
  });

  it("Model 迷你数据表: 每模型一行(calls/tokens/占比/命中率) + chips 色点(S3 同源)", () => {
    const { container: c } = mountDash(fakeSummary, okResult);
    const table = c.querySelector('[data-testid="agent-dashboard-c-model-table"]');
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(2);
    const glm = table?.querySelector('[data-testid="agent-dashboard-c-model-row-glm-5.3-flash"]');
    expect(glm?.textContent).toContain("glm-5.3-flash");
    expect(glm?.textContent).toContain("64,000");
    expect(glm?.textContent).toMatch(/50\.0%/);
    expect(glm?.textContent).toMatch(/83\.3%/); // hit/(hit+miss) = 50000/60000
    expect(table?.querySelectorAll("thead th")).toHaveLength(5);
    // chips 色点 = var(--chart-N), 组件禁硬编码色值(H9)
    const chip = glm?.querySelector<HTMLDivElement>(".dash-chip");
    expect(chip?.getAttribute("style")).toContain("var(--chart-1)");
    const kimi = table?.querySelector('[data-testid="agent-dashboard-c-model-row-kimi-k2"] .dash-chip');
    expect(kimi?.getAttribute("style")).toContain("var(--chart-2)");
  });

  it("Model 分布: 拉取失败 → 模块显式空态 + 重试按钮触发 onRetry", () => {
    const onRetry = vi.fn();
    const { container: c } = mount(
      <AgentDashboardC
        summary={fakeSummary}
        modelSummary={failResult}
        trendSummary={okDayResult}
        generatedAt={fakeSummary.generated_at}
        onRetry={onRetry}
      />,
    );
    expect(c.querySelector('[data-testid="dash-model-empty"]')?.textContent).toMatch(/数据拉取失败/);
    const retry = c.querySelector('[data-testid="dash-model-empty-retry"]') as HTMLButtonElement;
    expect(retry).toBeTruthy();
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-model"]')).toBeNull();
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("Model 分布: ok 但当前 agent 无模型行 → 「暂无模型数据」(无重试)", () => {
    const emptyModel = {
      ...multiModelSummary,
      rows: multiModelSummary.rows.filter((r) => !r.group.startsWith("njbx02|")),
    };
    const { container: c } = mountDash(fakeSummary, { ok: true, data: emptyModel, generatedAt: "" });
    expect(c.querySelector('[data-testid="dash-model-empty"]')?.textContent).toMatch(/暂无模型数据/);
    expect(c.querySelector('[data-testid="dash-model-empty-retry"]')).toBeNull();
  });

  it("趋势: day 维 ≥2 桶 → 渲染 chart", () => {
    const { container: c } = mountDash();
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-trend"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="dash-trend-empty"]')).toBeNull();
  });

  it("趋势: 拉取失败 → 模块显式空态 + 重试", () => {
    const { container: c } = mountDash(fakeSummary, okResult, failResult);
    expect(c.querySelector('[data-testid="dash-trend-empty"]')?.textContent).toMatch(/数据拉取失败/);
    expect(c.querySelector('[data-testid="dash-trend-empty-retry"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-trend"]')).toBeNull();
  });

  it("趋势: day 桶不足 2 天 → 「数据积累中(N 天)」占位, 不画假曲线", () => {
    const oneDay = {
      ...multiDaySummary,
      rows: [multiDaySummary.rows[0]!],
    };
    const { container: c } = mountDash(fakeSummary, okResult, { ok: true, data: oneDay, generatedAt: "" });
    const empty = c.querySelector('[data-testid="dash-trend-empty"]');
    expect(empty?.textContent).toMatch(/数据积累中（1 天）/);
    expect(empty?.textContent).not.toMatch(/数据拉取失败/);
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-trend"]')).toBeNull();
    expect(c.querySelector('[data-testid="dash-trend-empty-retry"]')).toBeNull();
  });

  it("单模型如实 1 slice(不伪造多色环): 当前 agent 只有 1 个模型时模型计数=1", () => {
    const single = {
      ...multiModelSummary,
      rows: multiModelSummary.rows.filter((r) => r.group !== "njbx02|kimi-k2"),
    };
    const { container: c } = mountDash(fakeSummary, { ok: true, data: single, generatedAt: "" });
    expect(c.querySelector('[data-testid="agent-dashboard-c-models"]')?.textContent).toBe("1");
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-model"]')).toBeTruthy();
  });

  it("H2 守卫: 纯 output 模型行(tokens>0 且 hit+miss=0) 命中率显 — 而非 NaN/Infinity", () => {
    const pureOutModel: UsageSummaryOutput = {
      ...multiModelSummary,
      rows: [
        {
          ...rows[0]!,
          group: "njbx02|glm-5.3-flash",
          calls: 5,
          input_cache_hit_tokens: 0,
          input_cache_miss_tokens: 0,
          output_tokens: 4000,
        },
      ],
    };
    const { container: c } = mountDash(fakeSummary, { ok: true, data: pureOutModel, generatedAt: "" });
    const glm = c.querySelector('[data-testid="agent-dashboard-c-model-row-glm-5.3-flash"]');
    expect(glm).toBeTruthy();
    expect(glm?.textContent).not.toMatch(/NaN|Infinity/);
    expect(glm?.textContent).toContain("—");
  });
});

describe("AgentDashboardC(t_5cf22ba4 展示品质回归锁)", () => {
  it("buildTrend: 缺失日补 tokens=0 桶, X 轴日期连续(问题 4)", () => {
    const gap: UsageSummaryOutput = {
      ...multiDaySummary,
      rows: [
        { ...rows[0]!, group: "2026-09-08" },
        { ...rows[1]!, group: "2026-09-10" },
      ],
    };
    const buckets = buildTrend(gap);
    expect(buckets.map((b) => b.label)).toEqual(["2026-09-08", "2026-09-09", "2026-09-10"]);
    expect(buckets[1]!.tokens).toBe(0);
    expect(buckets[0]!.tokens).toBeGreaterThan(0);
    expect(buckets[2]!.tokens).toBeGreaterThan(0);
  });

  it("buildTrend: 缺口 >7 天不补桶(防窗口错配无限补), 原样保留两桶", () => {
    const far: UsageSummaryOutput = {
      ...multiDaySummary,
      rows: [
        { ...rows[0]!, group: "2026-09-01" },
        { ...rows[1]!, group: "2026-09-12" },
      ],
    };
    const buckets = buildTrend(far);
    expect(buckets.map((b) => b.label)).toEqual(["2026-09-01", "2026-09-12"]);
  });

  it("三分项头部保留一位小数不吞项(问题 3): 94.1/5.4/0.4 形态", () => {
    const swallow: UsageSummaryOutput = {
      ...fakeSummary,
      total: {
        ...fakeSummary.total,
        input_cache_hit_tokens: 9414,
        input_cache_miss_tokens: 544,
        output_tokens: 42,
      },
    };
    const { container: c } = mountDash(swallow);
    const note = c.querySelector(".dash-p-split .dash-pnote");
    expect(note?.textContent).toBe("94.1% / 5.4% / 0.4%");
    expect(c.querySelector('[data-testid="agent-dashboard-c-seg-out"]')).toBeTruthy();
  });

  it("明细卡头标注=tokens · 成本(W1): 第 7 列裁定为成本后标注同步", () => {
    const { container: c } = mountDash();
    const note = c.querySelector(".dash-p-detail .dash-pnote");
    expect(note?.textContent).toBe("tokens · 成本");
  });

  it("明细行扩列 — 调用/Hit/Output/占比全在场 + 成本列(W1 裁定)", () => {
    const { container: c } = mountDash(fakeSummary, okResult);
    const njbx02 = c.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"]');
    expect(njbx02?.textContent).toContain("64,000"); // tokens 列
    expect(njbx02?.textContent).toContain("79.0%"); // 占比 = 64000/81000
    expect(njbx02?.textContent).toContain("50,000"); // cache hit 列
    expect(njbx02?.textContent).toContain("4,000"); // output 列
    expect(njbx02?.textContent).toContain("100"); // 调用列
    expect(njbx02?.textContent).toContain("1.23 USD"); // 成本列(W1: cost_total/currency 接线)
  });

  it("W1/SC-06 混币种: 明细成本各行带原币种, 分行不换汇(D-055)", () => {
    const mixed: UsageSummaryOutput = {
      ...fakeSummary,
      rows: [
        { ...rows[0]!, cost_total: 1.23, currency: "USD" },
        { ...rows[1]!, cost_total: 4.5, currency: "CNY" },
      ],
    };
    const { container: c } = mountDash(mixed);
    const table = c.querySelector('[data-testid="agent-dashboard-c-detail-list"]');
    // 第 7 列表头 = 成本(W1 裁定, 对齐锁定参考 ops-wall 第 7 列)
    expect(table?.querySelector("thead th:last-child")?.textContent).toBe("成本");
    expect(c.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"]')?.textContent).toContain(
      "1.23 USD",
    );
    expect(c.querySelector('[data-testid="agent-dashboard-c-detail-home-computer"]')?.textContent).toContain(
      "4.50 CNY",
    );
  });

  it("W1/SC-06 H3: cost=null 明细成本单元格留空不显 0(cost-empty)", () => {
    const nullCost: UsageSummaryOutput = {
      ...fakeSummary,
      rows: [{ ...rows[0]!, cost_total: null, currency: null }],
    };
    const { container: c } = mountDash(nullCost);
    const cell = c.querySelector(
      '[data-testid="agent-dashboard-c-detail-njbx02"] td:last-child',
    );
    expect(cell?.textContent).toBe("");
    expect(cell?.className).toContain("cost-empty");
  });
});

describe("AgentDashboardC(SL-03 降级形态 SC-02/SC-03)", () => {
  it("快照时效格式契约: snapshotStamp MM-DD HH:MM / snapshotAge 相对时长", () => {
    // 本地时区构造 → 断言与运行机 TZ 无关
    const localNoon = new Date(2026, 8, 9, 12, 0, 0);
    const iso = localNoon.toISOString();
    expect(snapshotStamp(iso)).toBe("09-09 12:00");
    expect(snapshotStamp("不可解析")).toBe("不可解析");
    const base = localNoon.getTime();
    expect(snapshotAge(iso, base + 30_000)).toBe("刚刚");
    expect(snapshotAge(iso, base + 5 * 60_000)).toBe("5 分钟前");
    expect(snapshotAge(iso, base + 3 * 3_600_000)).toBe("3 小时前");
    expect(snapshotAge(iso, base + 50 * 3_600_000)).toBe("2 天前");
    // 不可解析 / 未来时间 → 空串(不渲染假时效)
    expect(snapshotAge("不可解析")).toBe("");
    expect(snapshotAge(iso, base - 60_000)).toBe("");
  });

  it("SC-02: offline → 横幅显式(状态明确+快照时效+重试) + 数据区快照降饱和标记, 快照数据保留", () => {
    const { container: c } = mountDash(fakeSummary, okResult, okDayResult, { offline: true });
    const banner = c.querySelector('[data-testid="agent-dashboard-c-banner-offline"]');
    expect(banner?.className).toContain("is-visible");
    expect(banner?.textContent).toContain("DAEMON 未连接"); // 状态明确
    expect(banner?.textContent).toContain("三维查询全部失败");
    expect(banner?.textContent).toMatch(/数据截至 \d{2}-\d{2} \d{2}:\d{2}/); // 快照时效(绝对)
    expect(banner?.querySelector('[data-testid="agent-dashboard-c-banner-retry"]')).toBeTruthy(); // 恢复动作
    // 数据区降饱和快照语义(root 标位) + 旧快照仍在(不清空成空态 — H7 同源)
    const rootEl = c.querySelector('[data-testid="agent-dashboard-c"]');
    expect(rootEl?.className).toContain("is-snapshot");
    expect(rootEl?.getAttribute("data-snapshot")).toBe("1");
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-tokens"]')?.textContent).toBe("81,000");
    expect(c.querySelector('[data-testid="agent-dashboard-c-detail-list"]')?.querySelectorAll("tbody tr")).toHaveLength(2);
    // footer 降级摘要(时效标注) + 重试入口
    expect(c.querySelector('[data-testid="agent-dashboard-c-foot-degraded"]')?.textContent).toContain("上次刷新失败");
    expect(c.querySelector(".dash-foot-live")?.className).toContain("is-degraded");
  });

  it("SC-02: 横幅重试与 footer 重试均触发 onRetry(恢复动作可点)", () => {
    const onRetry = vi.fn();
    const { container: c } = mountDash(fakeSummary, failResult, failResult, { offline: true, onRetry });
    const bannerRetry = c.querySelector('[data-testid="agent-dashboard-c-banner-retry"]') as HTMLButtonElement;
    act(() => bannerRetry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    const footRetry = c.querySelector('[data-testid="agent-dashboard-c-retry"]') as HTMLButtonElement;
    act(() => footRetry.click());
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("SC-02: 常态(offline 未置) → 横幅不可见 + 无快照标记 + footer 无降级块", () => {
    const { container: c } = mountDash();
    expect(c.querySelector('[data-testid="agent-dashboard-c-banner-offline"]')?.className).not.toContain("is-visible");
    expect(c.querySelector('[data-testid="agent-dashboard-c-banner-offline"]')?.getAttribute("aria-hidden")).toBe("true");
    const rootEl = c.querySelector('[data-testid="agent-dashboard-c"]');
    expect(rootEl?.className).not.toContain("is-snapshot");
    expect(rootEl?.getAttribute("data-snapshot")).toBeNull();
    expect(c.querySelector('[data-testid="agent-dashboard-c-foot-degraded"]')).toBeNull();
    expect(c.querySelectorAll(".dash-panel.is-stale")).toHaveLength(0);
    expect(c.querySelector(".dash-foot-live")?.className).not.toContain("is-degraded");
  });

  it("SC-03: model 单维失败但旧快照仍在 → 该面板标降级不丢数据(H7), 其余面板正常 + footer 时效/重试", () => {
    const onRetry = vi.fn();
    const { container: c } = mountDash(fakeSummary, okResult, okDayResult, { modelStale: true, onRetry });
    const modelPanel = c.querySelector(".dash-p-model");
    expect(modelPanel?.className).toContain("is-stale");
    expect(modelPanel?.getAttribute("data-stale")).toBe("1");
    // 缓存数据保留: 迷你表仍在, 不得退化成失败空态
    expect(c.querySelector('[data-testid="agent-dashboard-c-model-table"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="dash-model-empty"]')).toBeNull();
    // 其余面板不标(失败域隔离)
    expect(c.querySelector(".dash-p-trend")?.className).not.toContain("is-stale");
    expect(c.querySelectorAll(".dash-kpi.is-stale")).toHaveLength(0);
    expect(c.querySelector(".dash-p-trend")?.getAttribute("data-stale")).toBeNull();
    // footer: 面板级降级摘要 + 重试(SC-03 恢复动作)
    expect(c.querySelector('[data-testid="agent-dashboard-c-foot-degraded"]')?.textContent).toContain("部分面板拉取失败");
    const footRetry = c.querySelector('[data-testid="agent-dashboard-c-retry"]') as HTMLButtonElement;
    act(() => footRetry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("SC-03: trend 单维失败 → 趋势面板标降级 + 缓存曲线仍在; KPI/明细不受影响", () => {
    const { container: c } = mountDash(fakeSummary, okResult, okDayResult, { trendStale: true });
    expect(c.querySelector(".dash-p-trend")?.className).toContain("is-stale");
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-trend"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="dash-trend-empty"]')).toBeNull();
    expect(c.querySelector(".dash-p-model")?.className).not.toContain("is-stale");
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-tokens"]')?.textContent).toBe("81,000");
  });

  it("SC-03: summary 维失败 → KPI 带/明细/三分项(同源 summary 派生)标降级, 趋势与 Model 不标", () => {
    const { container: c } = mountDash(fakeSummary, okResult, okDayResult, { summaryStale: true });
    expect(c.querySelectorAll(".dash-kpi.is-stale")).toHaveLength(4);
    expect(c.querySelector(".dash-p-detail")?.className).toContain("is-stale");
    expect(c.querySelector(".dash-p-split")?.className).toContain("is-stale");
    expect(c.querySelector(".dash-p-trend")?.className).not.toContain("is-stale");
    expect(c.querySelector(".dash-p-model")?.className).not.toContain("is-stale");
  });

  it("SC-02/SC-03 分层: 整屏降级时面板级标记让位(防双重告警)", () => {
    const { container: c } = mountDash(fakeSummary, okResult, okDayResult, {
      offline: true,
      summaryStale: true,
      modelStale: true,
      trendStale: true,
    });
    expect(c.querySelectorAll(".dash-panel.is-stale")).toHaveLength(0);
    expect(c.querySelector('[data-testid="agent-dashboard-c-banner-offline"]')?.className).toContain("is-visible");
    expect(c.querySelector('[data-testid="agent-dashboard-c"]')?.className).toContain("is-snapshot");
  });

  it("SC-03: 面板冷失败(无旧快照)语义不回退 → 面板内「数据拉取失败」+重试, 不标降级", () => {
    const { container: c } = mountDash(fakeSummary, failResult, failResult);
    expect(c.querySelector('[data-testid="dash-model-empty"]')?.textContent).toContain("数据拉取失败");
    expect(c.querySelector('[data-testid="dash-model-empty-retry"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="dash-trend-empty"]')?.textContent).toContain("数据拉取失败");
    expect(c.querySelector('[data-testid="dash-trend-empty-retry"]')).toBeTruthy();
    expect(c.querySelectorAll(".dash-panel.is-stale")).toHaveLength(0);
    expect(c.querySelector('[data-testid="agent-dashboard-c-foot-degraded"]')).toBeNull();
  });
});
