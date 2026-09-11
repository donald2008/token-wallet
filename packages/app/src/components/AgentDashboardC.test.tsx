/**
 * AgentDashboardC 组件单测(t_9255cb63):
 * - 渲染 hero / split / detail 三象限
 * - 金额可空留白契约(hero-cost 与 detail-list .cost.is-empty)
 * - 主题切换 aria-pressed 同步
 * - 返回按钮触发 onBack 回调
 * - chart 区域 canvas 存在(chart.js 异步加载不阻断整页)
 */
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDashboardC } from "./AgentDashboardC";
import type { UsageSummaryOutput } from "../mcpQueryTypes";

const fakeSummary: UsageSummaryOutput = {
  window: { since: "2026-09-09T00:00:00+08:00", until: "2026-09-09T23:59:59+08:00" },
  timezone: "Asia/Shanghai",
  generated_at: "2026-09-09T12:00:00+08:00",
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
      group: "home-computer",
      calls: 50,
      input_cache_hit_tokens: 10000,
      input_cache_miss_tokens: 5000,
      output_tokens: 2000,
      cost_total: 0.5,
      currency: "USD",
      by_status: { completed: 50, partial: 0, unknown: 0 },
    },
  ],
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

describe("AgentDashboardC", () => {
  it("渲染顶部摘要(tokens 三项和 + cost 1.73 USD + 4 元数据)", () => {
    const { container: c } = mount(
      <AgentDashboardC summary={fakeSummary} generatedAt={fakeSummary.generated_at} onBack={() => {}} />,
    );
    // 60000 + 15000 + 6000 = 81000 tokens
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-tokens"]')?.textContent).toBe("81,000");
    expect(c.querySelector('[data-testid="agent-dashboard-c-hero-cost"]')?.textContent).toMatch(/1\.73 USD/);
    expect(c.querySelector('[data-testid="agent-dashboard-c-active"]')?.textContent).toBe("2"); // 两条都 completed>0
    expect(c.querySelector('[data-testid="agent-dashboard-c-samples"]')?.textContent).toBe("150");
    expect(c.querySelector('[data-testid="agent-dashboard-c-models"]')?.textContent).toBe("1"); // 退路占位
  });

  it("detail-list 渲染两行 + 金额可空留白契约", () => {
    const { container: c } = mount(
      <AgentDashboardC summary={fakeSummary} generatedAt={fakeSummary.generated_at} onBack={() => {}} />,
    );
    const list = c.querySelector('[data-testid="agent-dashboard-c-detail-list"]');
    expect(list?.querySelectorAll("li")).toHaveLength(2);
    const njbx02 = list?.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"]');
    expect(njbx02?.textContent).toMatch(/njbx02/);
    expect(njbx02?.textContent).toMatch(/1\.23 USD/);
    expect(njbx02?.textContent).not.toMatch(/——|—/); // 拍板:不留破折号
    // t_4b7984d9 B: detail-list 的 tokens 列也是全数字(50000+10000+4000 = 64000 → "64,000"),
    // 删原 K/M 简写分支后与 AgentCard 口径一致
    const tokensCell = njbx02?.querySelector(".tokens");
    expect(tokensCell?.textContent).toMatch(/64,000/);
    expect(tokensCell?.textContent).not.toMatch(/\d+\.?\d*K\b|\d+\.?\d*M\b/);
  });

  it("cost_total=null 时 detail-list .cost 留空(visibility:hidden 保持对齐)", () => {
    const partial: UsageSummaryOutput = {
      ...fakeSummary,
      rows: [{ ...fakeSummary.rows[0]!, cost_total: null }],
      total: { ...fakeSummary.total, cost_total: null },
    };
    const { container: c } = mount(
      <AgentDashboardC summary={partial} generatedAt={partial.generated_at} onBack={() => {}} />,
    );
    const cost = c.querySelector('[data-testid="agent-dashboard-c-detail-njbx02"] .cost');
    expect(cost?.classList.contains("is-empty")).toBe(true);
    const hero = c.querySelector('[data-testid="agent-dashboard-c-hero-cost"]');
    expect(hero?.classList.contains("is-empty")).toBe(true);
    expect(hero?.textContent).toBe(""); // 彻底空白
  });

  it("三分项 split-bar 三段宽度按比例", () => {
    const { container: c } = mount(
      <AgentDashboardC summary={fakeSummary} generatedAt={fakeSummary.generated_at} onBack={() => {}} />,
    );
    // 60000/(60000+15000+6000) = 74.1%, 15000/81000 = 18.5%, 6000/81000 = 7.4%
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
    const { container: c } = mount(
      <AgentDashboardC summary={fakeSummary} generatedAt={fakeSummary.generated_at} onBack={() => {}} />,
    );
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-trend"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="agent-dashboard-c-chart-model"]')).toBeTruthy();
  });

  it("主题切换 aria-pressed 同步", () => {
    const { container: c } = mount(
      <AgentDashboardC summary={fakeSummary} generatedAt={fakeSummary.generated_at} onBack={() => {}} />,
    );
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
      <AgentDashboardC summary={fakeSummary} generatedAt={fakeSummary.generated_at} onBack={onBack} />,
    );
    const back = c.querySelector('[data-testid="agent-dashboard-c-back"]') as HTMLButtonElement;
    act(() => back.click());
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("footer 显示 generated_at 时间戳", () => {
    const { container: c } = mount(
      <AgentDashboardC summary={fakeSummary} generatedAt={fakeSummary.generated_at} onBack={() => {}} />,
    );
    expect(c.querySelector('[data-testid="agent-dashboard-c-meta"]')?.textContent).toMatch(
      /2026-09-09T12:00:00\+08:00/,
    );
  });
});
