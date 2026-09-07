// @vitest-environment jsdom
// L1(P1 契约 t_c31e6099): 窗口排序 = 时间窗升序(不按紧度), 未识别 key 兜底不丢;
// tightest 标红逻辑不回归 —— 排序变更后 data-tightest 仍在最紧行(只标不置顶)。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Metric, ProviderSnapshot } from "../types";
import { BarsTemplate, sortByWindowSpan, tightestMetric, windowSpanRank } from "./registry";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Math.floor(Date.now() / 1000);

function wm(key: string, used: number, limit: number): Metric {
  return { key, kind: "window", unit: "requests", used, limit, reset_at: NOW + 3600 };
}

function snap(metrics: Metric[]): ProviderSnapshot {
  return {
    provider_id: "kimi-code",
    display_name: "Kimi-Code #1",
    plan_type: "window",
    fetched_at: NOW - 60,
    status: "ok",
    metrics,
    alerts: [],
  };
}

describe("windowSpanRank: key 语义分级", () => {
  it("5h/小时级=0, 周=1, 月=2, 未识别=3", () => {
    expect(windowSpanRank("rolling_5h")).toBe(0);
    expect(windowSpanRank("quota_24h")).toBe(0);
    expect(windowSpanRank("weekly")).toBe(1);
    expect(windowSpanRank("周用量")).toBe(1);
    expect(windowSpanRank("monthly")).toBe(2);
    expect(windowSpanRank("月额度")).toBe(2);
    expect(windowSpanRank("credits")).toBe(3);
  });
});

describe("sortByWindowSpan: 时间窗升序", () => {
  it("[rolling_5h, weekly, monthly] 任意输入顺序 → 输出恒为 5h→周→月", () => {
    const input = [wm("monthly", 10, 100), wm("rolling_5h", 50, 100), wm("weekly", 20, 100)];
    const out = sortByWindowSpan(input);
    expect(out.map((m) => m.key)).toEqual(["rolling_5h", "weekly", "monthly"]);
    // 顺序不变量: 已升序输入重排后不变
    const sorted = [wm("rolling_5h", 1, 100), wm("weekly", 2, 100), wm("monthly", 3, 100)];
    expect(sortByWindowSpan(sorted).map((m) => m.key)).toEqual(["rolling_5h", "weekly", "monthly"]);
  });

  it("不按紧度排序: 最紧的月窗不因此提前", () => {
    const input = [wm("rolling_5h", 10, 100), wm("monthly", 99, 100)]; // monthly 最紧
    expect(sortByWindowSpan(input).map((m) => m.key)).toEqual(["rolling_5h", "monthly"]);
  });

  it("未识别 key 保持原相对顺序追加在已知窗口之后(不丢不崩)", () => {
    const input = [wm("custom_b", 1, 10), wm("weekly", 1, 10), wm("custom_a", 1, 10), wm("rolling_5h", 1, 10)];
    const out = sortByWindowSpan(input);
    expect(out.map((m) => m.key)).toEqual(["rolling_5h", "weekly", "custom_b", "custom_a"]);
    expect(out).toHaveLength(input.length);
  });

  it("不改输入数组(纯函数)", () => {
    const input = [wm("monthly", 1, 10), wm("rolling_5h", 1, 10)];
    const before = input.map((m) => m.key);
    sortByWindowSpan(input);
    expect(input.map((m) => m.key)).toEqual(before);
  });
});

describe("tightestMetric: 最紧窗口 = used/limit 最高", () => {
  it("命中最高比例窗口; 空数组返回 undefined", () => {
    const metrics = [wm("rolling_5h", 10, 100), wm("weekly", 900, 1000)];
    expect(tightestMetric(metrics)?.key).toBe("weekly");
    expect(tightestMetric([])).toBeUndefined();
  });
});

describe("BarsTemplate: 排序变更后 tightest 标红不回归", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("DOM 顺序按时间窗升序; data-tightest 仍在最紧行(月窗), 不在首行", () => {
    // monthly 最紧(used/limit=0.99, metricHealth=bad)但时间窗最长 → 排最后仍标红
    const metrics = [wm("monthly", 99, 100), wm("rolling_5h", 10, 100), wm("weekly", 20, 100)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    const rows = Array.from(container.querySelectorAll(".bar-row"));
    const labels = rows.map((r) => r.querySelector(".quota-title")?.textContent);
    // 2026-09-03 文案本地化(⑤): key 直出改为友好窗名
    expect(labels).toEqual(["5 小时窗", "周窗", "月窗"]);
    const tightestRow = container.querySelector(".bar-row[data-tightest]");
    expect(tightestRow?.querySelector(".quota-title")?.textContent).toBe("月窗");
  });

  it("全部健康(remaining>30%)时不误标红", () => {
    const metrics = [wm("rolling_5h", 10, 100), wm("weekly", 20, 100)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    expect(container.querySelector(".bar-row[data-tightest]")).toBeNull();
  });
});

describe("BarsTemplate: 窗口行 = QuotaMeter 四元素实例(t_23800bd4)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("窗口行由 QuotaMeter layout=micro 渲染(t_27eeadad P1 化), 四元素齐全 + .progress 契约保留", () => {
    act(() => root.render(<BarsTemplate p={snap([wm("rolling_5h", 120, 1200)])} />));
    const meter = container.querySelector(".bar-row > [data-testid='quota-meter']")!;
    expect(meter).toBeTruthy();
    // t_27eeadad: 主页 P1 化后 QuotaMeter 排版变体从 row → micro(micro 与方案页 P1 同构)
    expect(meter.getAttribute("data-layout")).toBe("micro");
    expect(meter.classList.contains("quota-meter--layout-micro")).toBe(true);
    expect(meter.querySelector(".quota-title")!.textContent).toBe("5 小时窗");
    expect(meter.querySelector(".quota-reset")!.textContent!.length).toBeGreaterThan(0);
    expect(meter.querySelector("[role='progressbar']")).toBeTruthy();
    expect(meter.querySelector(".progress-fill")!.getAttribute("data-health")).toBe("ok");
    // t_27eeadad: 不再挂 BarRowTooltip(主页窗口行无 .bar-tooltip 节点)
    expect(container.querySelectorAll(".bar-tooltip").length).toBe(0);
  });

  it("percent 单位窗口 → 用量行百分比格式", () => {
    const m: Metric = { key: "weekly", kind: "window", unit: "percent", used: 37.941548, limit: 100, reset_at: NOW + 3600 };
    act(() => root.render(<BarsTemplate p={snap([m])} />));
    // micro 排版短格式取整百分比(t_f7d1beeb 9/7): Math.round(0.379*100)=38;
    // 与 usageText 在 percent 单位的 fmt1(37.9)不同, micro 走整数取整契约
    expect(container.querySelector(".quota-usage")!.textContent).toBe("38%");
  });
});

describe("BarsTemplate: P5 短窗并排排版(t_433892c6 9/7 用户拍板, 主页接入)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("3 窗(rolling_5h + weekly + monthly): 短窗同行两列 + 月窗全宽", () => {
    const metrics = [wm("rolling_5h", 960, 1200), wm("weekly", 1200, 6000), wm("monthly", 300, 1000)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    // 两个 windows-row 容器: 第一行短窗, 第二行月窗
    const rows = container.querySelectorAll(".qcard3-windows-row");
    expect(rows).toHaveLength(2);
    // 第一行: 短窗两列 grid, 内含 5h + 周两个 .bar-row
    const shortRow = rows[0] as HTMLElement;
    expect(shortRow.classList.contains("qcard3-windows-row--wide")).toBe(false);
    const shortBars = shortRow.querySelectorAll(".bar-row");
    expect(shortBars).toHaveLength(2);
    expect(shortBars[0].getAttribute("data-metric")).toBe("rolling_5h");
    expect(shortBars[1].getAttribute("data-metric")).toBe("weekly");
    // 第二行: 月窗全宽, --wide 修饰符, 内含 1 个 .bar-row
    const wideRow = rows[1] as HTMLElement;
    expect(wideRow.classList.contains("qcard3-windows-row--wide")).toBe(true);
    expect(wideRow.querySelectorAll(".bar-row")).toHaveLength(1);
    expect(wideRow.querySelector(".bar-row")!.getAttribute("data-metric")).toBe("monthly");
    // testid 锚点(主页 e2e 凭此定位)
    expect(container.querySelector('[data-testid="windows-row"]')).toBe(shortRow);
    expect(container.querySelector('[data-testid="windows-row-wide"]')).toBe(wideRow);
  });

  it("3 窗时 DOM 契约零破: progress / progress-fill[data-health] / role=progressbar 仍齐全", () => {
    const metrics = [wm("rolling_5h", 10, 100), wm("weekly", 20, 100), wm("monthly", 30, 100)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    expect(container.querySelectorAll(".progress").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll(".progress-fill").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll("[role='progressbar']").length).toBeGreaterThanOrEqual(3);
    // 每个 .progress-fill 必须带 data-health 属性(QuotaMeter 契约)
    const fills = container.querySelectorAll(".progress-fill");
    for (const f of fills) {
      expect(f.getAttribute("data-health")).toBeTruthy();
    }
    // micro 排版契约: quota-usage 只显百分比 + 短格式
    const usageTexts = Array.from(container.querySelectorAll(".quota-usage")).map((u) => u.textContent);
    expect(usageTexts).toEqual(["10%", "20%", "30%"]);
  });

  it("降级 2 窗(无 monthly): 全部短窗并排一行, 不出现 --wide 行", () => {
    const metrics = [wm("rolling_5h", 80, 100), wm("weekly", 30, 100)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    const rows = container.querySelectorAll(".qcard3-windows-row");
    expect(rows).toHaveLength(1); // 仅一个短行, 无月行
    const row = rows[0] as HTMLElement;
    expect(row.classList.contains("qcard3-windows-row--wide")).toBe(false);
    expect(row.querySelectorAll(".bar-row")).toHaveLength(2);
    // 月窗行 testid 必须不存在(2 窗无 monthly)
    expect(container.querySelector('[data-testid="windows-row-wide"]')).toBeNull();
  });

  it("降级 1 窗: 整行全宽(--wide), 单 .bar-row 占 grid 第 1 列", () => {
    const metrics = [wm("rolling_5h", 80, 100)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    const rows = container.querySelectorAll(".qcard3-windows-row");
    expect(rows).toHaveLength(1);
    const row = rows[0] as HTMLElement;
    expect(row.classList.contains("qcard3-windows-row--wide")).toBe(true);
    expect(row.querySelectorAll(".bar-row")).toHaveLength(1);
    expect(row.querySelector(".bar-row")!.getAttribute("data-metric")).toBe("rolling_5h");
  });

  it("降级 1 窗 + 仅有 monthly(异常配比, 但 0 业务可达): 月窗全宽行存在", () => {
    // 真业务里 monthly 不应单独存在(月窗必伴随更短窗), 但代码路径需自洽:
    // short=0, wide=monthly → 仅一个月窗全宽行, data-testid=windows-row-wide
    const metrics = [wm("monthly", 30, 100)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    const rows = container.querySelectorAll(".qcard3-windows-row");
    expect(rows).toHaveLength(1);
    const row = rows[0] as HTMLElement;
    expect(row.classList.contains("qcard3-windows-row--wide")).toBe(true);
    expect(row.querySelectorAll(".bar-row")).toHaveLength(1);
    expect(row.querySelector(".bar-row")!.getAttribute("data-metric")).toBe("monthly");
  });

  it("data-tightest 仍正确: 3 窗时 monthly 最紧(80%)标红", () => {
    const metrics = [wm("rolling_5h", 20, 100), wm("weekly", 30, 100), wm("monthly", 80, 100)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    const tightestRow = container.querySelector(".bar-row[data-tightest]");
    expect(tightestRow).toBeTruthy();
    expect(tightestRow!.getAttribute("data-metric")).toBe("monthly");
    // 短窗行 + 月窗行两个容器, monthly 在第二行
    expect(tightestRow!.closest(".qcard3-windows-row--wide")).toBeTruthy();
  });
});
