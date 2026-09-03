// L1(QuotaMeter 最小组件 + 四元素实例, t_37416b22 + t_af01e265): 进度条本体契约 + 实例 slot 扩展。
// - 数据契约 pct(0-1) + state(ok/warn/bad), variant 形态, 全部无状态受控
// - 最小性: 裸条(不传扩展 slot)textContent === "" 即证(纯条无文案)
// - 四元素实例: 传 title/resetText/used/limit → 渲染「标题+重置+条+用量」完整卡片,
//   且不破坏 .progress/.progress-fill[data-health]/role=progressbar 契约(纯增量)
// - a11y: role=progressbar + aria-valuenow(0-100)
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuotaMeter, clampPct, usageText } from "./QuotaMeter";

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

describe("usageText(纯函数, 用量行文案)", () => {
  it("91/100 → '91 / 100 (91%)'", () => {
    expect(usageText(91, 100)).toBe("91 / 100 (91%)");
  });
  it("2300/10000 → '2300 / 10000 (23%)'", () => {
    expect(usageText(2300, 10000)).toBe("2300 / 10000 (23%)");
  });
  it("limit=0 不除零, pct 归 0", () => {
    expect(usageText(5, 0)).toBe("5 / 0 (0%)");
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

  it("最小性: 裸条无文案/无四元素 slot(textContent 空)", () => {
    render(<QuotaMeter pct={0.4} />);
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.textContent).toBe("");
    // 未进入实例模式(无 .quota-meter--instance, 无 slot 行)
    expect(wrap.classList.contains("quota-meter--instance")).toBe(false);
    expect(container.querySelectorAll(".quota-title, .quota-reset, .quota-usage").length).toBe(0);
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

describe("QuotaMeter 四元素实例(扩展 slot, 纯增量)", () => {
  it("完整四元素: 标题/重置/条/用量 四行齐全", () => {
    render(
      <QuotaMeter pct={0.91} state="bad" title="月窗 91 次" resetText="6.4 小时后重置" used={91} limit={100} />,
    );
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.classList.contains("quota-meter--instance")).toBe(true);
    expect(wrap.querySelector(".quota-title")!.textContent).toBe("月窗 91 次");
    expect(wrap.querySelector(".quota-reset")!.textContent).toBe("6.4 小时后重置");
    expect(wrap.querySelector(".quota-usage")!.textContent).toBe("91 / 100 (91%)");
    // 条契约不破
    expect(wrap.querySelector(".progress")).toBeTruthy();
    expect(wrap.querySelector(".progress-fill")!.getAttribute("data-health")).toBe("bad");
  });

  it("部分 slot: 只传 title+used/limit → 渲染标题与用量, 无重置行", () => {
    render(<QuotaMeter pct={0.4} title="闪购 40 次" used={40} limit={100} />);
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.querySelector(".quota-title")).toBeTruthy();
    expect(wrap.querySelector(".quota-usage")).toBeTruthy();
    expect(wrap.querySelector(".quota-reset")).toBeNull();
  });

  it("只传重置(无标题/无用量) → 渲染重置行, 其余 slot 不出现", () => {
    render(<QuotaMeter pct={0.4} resetText="即将重置" />);
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.querySelector(".quota-reset")!.textContent).toBe("即将重置");
    expect(wrap.querySelector(".quota-title")).toBeNull();
    expect(wrap.querySelector(".quota-usage")).toBeNull();
  });
});