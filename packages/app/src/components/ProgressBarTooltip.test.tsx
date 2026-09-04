// L1(t_a398348b): 窗口行悬停 tooltip —— micro 排版四元素微型展示。
// - 每条 bar-row 内嵌 .bar-tooltip(role=tooltip), 内含 QuotaMeter layout=micro
// - 四元素与行同源: quota-title(窗名) / quota-reset(重置) / progressbar(4px 条) / quota-usage(用量)
// - percent 浮点尾差经 displayUsed+fmt1 修正(37.941548… → "37.9% / 100%", t_23800bd4 单位语义对齐)
// - 无 reset_at → quota-reset slot 不渲染(不留空壳); 健康度着色与行一致
// - CSS 揭示机制(hover/focus-within)在 e2e(bar-tooltip.spec.ts)验证, 这里只验 DOM 结构
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";
import type { Metric } from "../types";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function renderRow(metric: Metric, tightest = false) {
  act(() => root.render(<ProgressBar metric={metric} tightest={tightest} />));
}

const NOW = Math.floor(Date.now() / 1000);

function metricOf(partial: Partial<Metric>): Metric {
  return {
    key: "weekly",
    kind: "window",
    unit: "percent",
    used: 0,
    limit: 100,
    reset_at: NOW + 86400,
    ...partial,
  };
}

describe("bar-row 悬停 tooltip(t_a398348b): micro 排版四元素", () => {
  it("行内嵌 .bar-tooltip(role=tooltip), 内含 quota-meter[data-layout=micro] 四元素", () => {
    renderRow(metricOf({ used: 40 }));
    const tip = container.querySelector(".bar-tooltip")!;
    expect(tip).toBeTruthy();
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.getAttribute("data-metric")).toBe("weekly");
    const meter = tip.querySelector("[data-testid='quota-meter']")!;
    expect(meter.getAttribute("data-layout")).toBe("micro");
    expect(meter.className).toContain("quota-meter--layout-micro");
    // 四元素: 标题/重置/条/用量
    expect(tip.querySelector(".quota-title")!.textContent).toBe("周窗");
    expect(tip.querySelector(".quota-reset")!.textContent).toBe("1.0天");
    expect(tip.querySelector("[role='progressbar']")!.getAttribute("aria-valuenow")).toBe("40");
    expect(tip.querySelector(".quota-usage")!.textContent).toBe("40% / 100%");
  });

  it("percent 浮点尾差修正: used=37.941548… → 用量行 '37.9% / 100%'(t_23800bd4 单位语义)", () => {
    renderRow(metricOf({ used: 0.37941548 * 100 }));
    const tip = container.querySelector(".bar-tooltip")!;
    expect(tip.querySelector(".quota-usage")!.textContent).toBe("37.9% / 100%");
  });

  it("健康度着色与行一致(91% → bad), 条宽 = 用量比例", () => {
    renderRow(metricOf({ used: 91 }), true);
    const tip = container.querySelector(".bar-tooltip")!;
    const fill = tip.querySelector(".progress-fill")!;
    expect(fill.getAttribute("data-health")).toBe("bad");
    expect((fill as HTMLElement).style.width).toBe("91%");
    // 行本体契约不受影响: 行内仍有自己的 progressbar + tightest 标记
    const row = container.querySelector(".bar-row")!;
    expect(row.getAttribute("data-tightest")).toBe("true");
  });

  it("无 reset_at → tooltip 不渲染 quota-reset slot(无空壳)", () => {
    renderRow(metricOf({ reset_at: undefined }));
    const tip = container.querySelector(".bar-tooltip")!;
    expect(tip.querySelector(".quota-reset")).toBeNull();
    // 标题/条/用量仍在
    expect(tip.querySelector(".quota-title")).toBeTruthy();
    expect(tip.querySelector("[role='progressbar']")).toBeTruthy();
    expect(tip.querySelector(".quota-usage")).toBeTruthy();
  });

  it("limit 缺省 → 无用量行, 条 0%, 不崩", () => {
    renderRow(metricOf({ limit: undefined, used: 5 }));
    const tip = container.querySelector(".bar-tooltip")!;
    expect(tip.querySelector(".quota-usage")).toBeNull();
    expect(tip.querySelector("[role='progressbar']")!.getAttribute("aria-valuenow")).toBe("0");
  });
});
