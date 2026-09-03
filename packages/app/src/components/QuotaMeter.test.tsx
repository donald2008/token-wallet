// L1(QuotaMeter 最小组件, t_37416b22): 进度条本体契约。
// - 数据契约 pct(0-1) + state(ok/warn/bad), variant 形态, 全部无状态受控
// - 最小性: 不含窗口名/用量数字/倒计时/按钮 —— 组件 textContent === "" 即证(纯条无文案)
// - a11y: role=progressbar + aria-valuenow(0-100) + min/max
// - 着色走 .progress-fill[data-health], 不硬编码色(交 D-016 token 语义)
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuotaMeter, clampPct } from "./QuotaMeter";

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

function render(el: React.ReactElement) {
  act(() => root.render(el));
}
/** 换一根全新 root 重渲(测不同 state 组合) */
function freshRender(el: React.ReactElement) {
  act(() => root.unmount());
  root = createRoot(container);
  act(() => root.render(el));
}

describe("clampPct(纯函数, 非法值收敛)", () => {
  it("钳 0-1", () => {
    expect(clampPct(0.4)).toBe(0.4);
    expect(clampPct(0)).toBe(0);
    expect(clampPct(1)).toBe(1);
    expect(clampPct(1.5)).toBe(1);
    expect(clampPct(-0.2)).toBe(0);
  });
  it("非法值(NaN/Infinity) → 0", () => {
    expect(clampPct(Number.NaN)).toBe(0);
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampPct(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("QuotaMeter 最小组件(条本体)", () => {
  it("role=progressbar + aria-valuenow 0-100(pct 0-1 → ×100)", () => {
    render(<QuotaMeter pct={0.4} />);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar).toBeTruthy();
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("着色走 .progress-fill[data-health](缺省 ok)", () => {
    render(<QuotaMeter pct={0.4} />);
    const fill = container.querySelector(".progress-fill")!;
    expect(fill.getAttribute("data-health")).toBe("ok");
  });

  it("state 驱动 warn/bad 着色(不硬编码色, 交 D-016 token)", () => {
    freshRender(<QuotaMeter pct={0.72} state="warn" />);
    expect(container.querySelector(".progress-fill")!.getAttribute("data-health")).toBe("warn");
    freshRender(<QuotaMeter pct={0.91} state="bad" />);
    expect(container.querySelector(".progress-fill")!.getAttribute("data-health")).toBe("bad");
  });

  it("variant 形态(全为条差异化, DOM 契约不变)", () => {
    render(<QuotaMeter pct={0.4} variant="thick" />);
    const wrapper = container.querySelector(".quota-meter")!;
    expect(wrapper.classList.contains("quota-meter--thick")).toBe(true);
    // 形态不影响 .progress/.progress-fill 契约
    expect(container.querySelector(".progress")).toBeTruthy();
    expect(container.querySelector(".progress-fill")).toBeTruthy();
  });

  it("最小性: 纯条无文案/无窗口名/无数值/无按钮(textContent 空)", () => {
    render(<QuotaMeter pct={0.4} />);
    expect(container.querySelector("[data-testid='quota-meter']")!.textContent).toBe("");
    expect(container.querySelectorAll(".bar-label, .bar-value, .bar-reset, button").length).toBe(0);
  });

  it("宽度走 inline style(pct×100, 钳 0-100)", () => {
    freshRender(<QuotaMeter pct={0.72} />);
    expect((container.querySelector(".progress-fill") as HTMLElement).style.width).toBe("72%");
    freshRender(<QuotaMeter pct={1.5} />);
    expect((container.querySelector(".progress-fill") as HTMLElement).style.width).toBe("100%");
    freshRender(<QuotaMeter pct={-0.2} />);
    expect((container.querySelector(".progress-fill") as HTMLElement).style.width).toBe("0%");
  });
});