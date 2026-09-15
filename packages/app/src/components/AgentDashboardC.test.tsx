/**
 * AgentDashboardC 组件单测(t_9255cb63; t_12c28686 多维数据面):
 * - 渲染 hero / split / detail 三象限
 * - 金额可空留白契约(hero-cost 与 detail-list .cost.is-empty)
 * - 主题切换 aria-pressed 同步
 * - 返回按钮触发 onBack 回调
 * - chart 区域 canvas 存在(chart.js 异步加载不阻断整页)
 * - t_12c28686: agent tab 切换联动 hero/三分项/明细/Model 分布; 模块空态(失败重试/积累中/单模型)
 */
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDashboardC, buildTrend, splitGroupDims } from "./AgentDashboardC";
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

/** t_12c28686: 多维 mock — 2 agent × 2 model(agent|model) + 2 day */
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
) {
  return mount(
    <AgentDashboardC
      summary={summary}
      modelSummary={modelSummary}
      trendSummary={trendSummary}
      generatedAt={summary.generated_at}
      onBack={() => {}}
      onRetry={() => {}}
    />,
  );
}

describe("splitGroupDims(t_12c28686 多维 group 解析防御)", () => {
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

describe("AgentDashboardC(单维兼容路径 — 旧 e2e 断言保持)", () => {
  it("渲染顶部摘要(tokens 三项和 + cost 1.73 USD + 元数据)", () => {
    const { container: c } = mountDash();
    // hero/三分项 = 全局 total 口径(81,000; tab 只联动 Model 分布/明细)
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-tokens"]')?.textContent).toBe("81,000");
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-cost"]')?.textContent).toMatch(/1\.73 USD/);
    expect(c.querySelector('[data-testid="agent-dashboard-c-active"]')?.textContent).toBe("2"); // 两条都 completed>0
    // t_e83ad982: 副指标扩列 — samples 改名 calls(调用, 取 total.calls), 新增命中率/Output/窗口
    expect(c.querySelector('[data-testid="agent-dashboard-c-calls"]')?.textContent).toBe("150");
    // 命中率 = hit/(hit+miss) = 60000/75000 = 80.0%(与 Model 表同口径, 非 hit/total 的 74.1%)
    expect(c.querySelector('[data-testid="agent-dashboard-c-hit-rate"]')?.textContent).toBe("80.0%");
    expect(c.querySelector('[data-testid="agent-dashboard-c-output"]')?.textContent).toBe("6,000");
    // 窗口范围来自 summary.window(非「now」)
    expect(c.querySelector('[data-testid="agent-dashboard-c-window"]')?.textContent).toBe("09-09 ~ 09-09");
  });

  it("detail-list 渲染当前 agent 一行(t_5cf22ba4: 金额单元格不再渲染, 标注=tokens)", () => {
    const { container: c } = mountDash();
    const list = c.querySelector('[data-testid="agent-dashboard-c-detail-list"]');
    expect(list?.querySelectorAll("li")).toHaveLength(1);
    const njbx02 = list?.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"]');
    expect(njbx02?.textContent).toMatch(/njbx02/);
    // t_5cf22ba4(问题 5): pricing 未接入, 明细行不渲染金额(标注同步只写 tokens) —
    // 金额信息仍有值场景也统一不展示, 待 pricing 接入后一并恢复。
    expect(njbx02?.querySelector(".cost")).toBeNull();
    expect(list?.parentElement?.textContent).not.toMatch(/tokens \+ 金额/);
    expect(list?.parentElement?.textContent).not.toMatch(/1\.23 USD/);
    expect(njbx02?.textContent).not.toMatch(/——|—/); // 拍板:不留破折号
    // t_4b7984d9 B: detail-list 的 tokens 列也是全数字(50000+10000+4000 = 64000 → "64,000")
    const tokensCell = njbx02?.querySelector(".tokens");
    expect(tokensCell?.textContent).toMatch(/64,000/);
    expect(tokensCell?.textContent).not.toMatch(/\d+\.?\d*K\b|\d+\.?\d*M\b/);
  });

  it("cost_total=null 时 hero-cost 留空 + 明细行不渲染金额单元格(t_5cf22ba4 口径统一)", () => {
    const partial: UsageSummaryOutput = {
      ...fakeSummary,
      rows: [{ ...fakeSummary.rows[0]!, cost_total: null }],
      total: { ...fakeSummary.total, cost_total: null },
    };
    const { container: c } = mountDash(partial);
    // t_5cf22ba4(问题 5): 明细行金额单元格不渲染(null 与有值同口径)
    const cost = c.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"] .cost');
    expect(cost).toBeNull();
    const hero = c.querySelector('[data-testid="agent-dashboard-c-hero-cost"]');
    expect(hero?.classList.contains("is-empty")).toBe(true);
    expect(hero?.textContent).toBe(""); // 彻底空白
  });

  it("三分项 split-bar 三段宽度按比例(当前 agent 口径)", () => {
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
  });

  it("canvas 元素存在(chart.js 异步加载, 渲染不阻断)", () => {
    const { container: c } = mountDash();
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-trend"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-model"]')).toBeTruthy();
  });

  it("主题切换 aria-pressed 同步", () => {
    const { container: c } = mountDash();
    const darkBtn = c.querySelector('[data-testid="agent-dashboard-c-theme-dark"]') as HTMLButtonElement;
    const lightBtn = c.querySelector('[data-testid="agent-dashboard-c-theme-light"]') as HTMLButtonElement;
    expect(darkBtn.getAttribute("aria-pressed")).toBe("true");
    expect(lightBtn.getAttribute("aria-pressed")).toBe("false");
    act(() => lightBtn.click());
    expect(lightBtn.getAttribute("aria-pressed")).toBe("true");
    expect(darkBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("返回按钮触发 onBack 回调", () => {
    const onBack = vi.fn();
    const { container: c } = mount(
      <AgentDashboardC
        summary={fakeSummary}
        modelSummary={okResult}
        trendSummary={okDayResult}
        generatedAt={fakeSummary.generated_at}
        onBack={onBack}
        onRetry={() => {}}
      />,
    );
    const back = c.querySelector('[data-testid="agent-dashboard-c-back"]') as HTMLButtonElement;
    act(() => back.click());
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("footer 显示 generated_at 时间戳", () => {
    const { container: c } = mountDash();
    expect(c.querySelector('[data-testid="agent-dashboard-c-meta"]')?.textContent).toMatch(
      /2026-09-09T12:00:00\+08:00/,
    );
  });
});

describe("AgentDashboardC(t_12c28686 多维数据面)", () => {
  it("多 agent 渲染 tab 栏 + 切换联动 Model 分布/明细(hero 保持全局口径)", () => {
    const { container: c } = mountDash();
    const tabs = c.querySelectorAll(".dash-agent-tab");
    expect(tabs).toHaveLength(2); // 单维 summary 有 2 个 agent → tab 出现
    // 默认选中 tokens 最多的 njbx02
    expect(c.querySelector('[data-testid="dash-agent-tab-njbx02"]')?.getAttribute("aria-selected")).toBe("true");
    expect(c.querySelector('[data-testid="dash-agent-tab-home-computer"]')?.getAttribute("aria-selected")).toBe("false");
    // hero = 全局 total 81,000(tab 不联动 hero)
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-tokens"]')?.textContent).toBe("81,000");
    // 切到 home-computer → hero 保持全局口径, 明细切行
    const homeTab = c.querySelector('[data-testid="dash-agent-tab-home-computer"]') as HTMLButtonElement;
    act(() => homeTab.click());
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-tokens"]')?.textContent).toBe("81,000");
    const list = c.querySelector('[data-testid="agent-dashboard-c-detail-list"]');
    expect(list?.querySelector('[data-testid="agent-dashboard-c-detail-home-computer"]')).toBeTruthy();
    expect(list?.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"]')).toBeNull();
  });

  it("Model 分布: 二维 rows 过滤当前 agent, 多模型 ≥2 slice + 模型计数", () => {
    const { container: c } = mountDash(fakeSummary, okResult);
    // njbx02 有 glm + kimi 两个模型
    expect(c.querySelector('[data-testid="agent-dashboard-c-models"]')?.textContent).toBe("2");
    // canvas 存在(modelState=ok 才挂 chart-wrap)
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-model"]')).toBeTruthy();
    // 切 home-computer → 也是 2 模型(glm + deepseek)
    const homeTab = c.querySelector('[data-testid="dash-agent-tab-home-computer"]') as HTMLButtonElement;
    act(() => homeTab.click());
    expect(c.querySelector('[data-testid="agent-dashboard-c-models"]')?.textContent).toBe("2");
  });

  it("Model 分布: 拉取失败 → 模块显式空态 + 重试按钮触发 onRetry", () => {
    const onRetry = vi.fn();
    const { container: c } = mount(
      <AgentDashboardC
        summary={fakeSummary}
        modelSummary={failResult}
        trendSummary={okDayResult}
        generatedAt={fakeSummary.generated_at}
        onBack={() => {}}
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
    // 默认选中 njbx02, 其模型行被过滤光 → empty
    expect(c.querySelector('[data-testid="dash-model-empty"]')?.textContent).toMatch(/暂无模型数据/);
    expect(c.querySelector('[data-testid="dash-model-empty-retry"]')).toBeNull();
  });

  it("趋势: day 维 ≥2 桶 → 渲染 chart + bucket 计数", () => {
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
    expect(c.querySelector('[data-testid="dash-trend-empty-retry"]')).toBeNull(); // 非失败, 无重试
  });

  it("单模型如实 1 slice(不伪造多色环): 当前 agent 只有 1 个模型时模型计数=1", () => {
    const single = {
      ...multiModelSummary,
      rows: multiModelSummary.rows.filter((r) => r.group !== "njbx02|kimi-k2"),
    };
    const { container: c } = mountDash(fakeSummary, { ok: true, data: single, generatedAt: "" });
    expect(c.querySelector('[data-testid="agent-dashboard-c-models"]')?.textContent).toBe("1");
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-model"]')).toBeTruthy(); // 如实画 1 slice
  });
});

describe("AgentDashboardC(t_5cf22ba4 展示品质回归锁)", () => {
  it("buildTrend: 缺失日补 tokens=0 桶, X 轴日期连续(问题 4)", () => {
    // rows 只有 09-08 / 09-10, 09-09 无上报 → 补 0 桶
    const gap: UsageSummaryOutput = {
      ...multiDaySummary,
      rows: [
        { ...rows[0]!, group: "2026-09-08" },
        { ...rows[1]!, group: "2026-09-10" },
      ],
    };
    const buckets = buildTrend(gap);
    expect(buckets.map((b) => b.label)).toEqual(["2026-09-08", "2026-09-09", "2026-09-10"]);
    expect(buckets[1]!.tokens).toBe(0); // 补的 0 桶
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

  it("三分项头部保留一位小数不吞项(问题 3): 94.1/5.4/0.4 形态不再被舍入成 94/5/0", () => {
    // 构造 hit 94.14% / miss 5.44% / out 0.42% 的 total(toFixed(1) → 94.1/5.4/0.4,
    // 与用户真机截图同形态; 旧 Math.round 会显示 94/5/0 吞掉第三项)
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
    const splitRight = c.querySelector(
      '.panel:has([data-testid="agent-dashboard-c-split-bar"]) .panel-title-row .right',
    );
    expect(splitRight?.textContent).toBe("94.1% / 5.4% / 0.4%");
    // 条形图三段照常按比例在位
    expect(c.querySelector('[data-testid="agent-dashboard-c-seg-out"]')).toBeTruthy();
  });

  it("明细卡头标注=tokens(问题 5): 不再出现「tokens + 金额」文案", () => {
    const { container: c } = mountDash();
    const detailPanel = [...c.querySelectorAll(".panel")].find((p) =>
      p.querySelector('[data-testid="agent-dashboard-c-detail-list"]'),
    );
    expect(detailPanel?.querySelector(".panel-title-row .right")?.textContent).toBe("tokens");
  });

  it("t_e83ad982(问题 2): Model 卡两列 — 迷你数据表每模型一行(calls/tokens/占比/命中率)", () => {
    const { container: c } = mountDash(fakeSummary, okResult);
    const table = c.querySelector('[data-testid="agent-dashboard-c-model-table"]');
    expect(table).toBeTruthy();
    // njbx02 有 2 模型 → 表 2 行(多模型如实多行)
    const bodyRows = table?.querySelectorAll("tbody tr") ?? [];
    expect(bodyRows).toHaveLength(2);
    // 第一行 = tokens 最大的 glm-5.3-flash: mock 二维 rows 用单维原值(50k+10k+4k=64,000),
    // 两模型 tokens 同值并列 → 排序稳定取 glm 在前
    const glm = table?.querySelector('[data-testid="agent-dashboard-c-model-row-glm-5.3-flash"]');
    expect(glm?.textContent).toContain("glm-5.3-flash");
    expect(glm?.textContent).toContain("64,000");
    expect(glm?.textContent).toMatch(/50\.0%/);
    // 命中率 = hit/(hit+miss) = 50000/60000 = 83.3%
    expect(glm?.textContent).toMatch(/83\.3%/);
    // 表头 5 列齐
    expect(table?.querySelectorAll("thead th")).toHaveLength(5);
  });

  it("t_e83ad982(问题 2): 单模型迷你表也如实 1 行(不伪造多行)", () => {
    const single = {
      ...multiModelSummary,
      rows: multiModelSummary.rows.filter((r) => r.group !== "njbx02|kimi-k2"),
    };
    const { container: c } = mountDash(fakeSummary, { ok: true, data: single, generatedAt: "" });
    const table = c.querySelector('[data-testid="agent-dashboard-c-model-table"]');
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(table?.querySelector('[data-testid="agent-dashboard-c-model-row-glm-5.3-flash"]')).toBeTruthy();
  });

  it("t_e83ad982(问题 3): 明细行扩列 — 调用/Hit/Miss/Output/占比/模型数全在场", () => {
    const { container: c } = mountDash(fakeSummary, okResult);
    const row = c.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"]');
    expect(row?.textContent).toContain("调用");
    expect(row?.textContent).toContain("100");
    expect(row?.textContent).toContain("Hit");
    expect(row?.textContent).toContain("50,000");
    expect(row?.textContent).toContain("Miss");
    expect(row?.textContent).toContain("10,000");
    expect(row?.textContent).toContain("Output");
    expect(row?.textContent).toContain("4,000");
    // 占比 = 64000/81000 = 79.0%
    expect(row?.textContent).toMatch(/79\.0%/);
    // 模型数来自 modelSummary 过滤当前 agent(njbx02 = glm + kimi = 2)
    expect(row?.textContent).toMatch(/模型\s*2/);
  });
});
