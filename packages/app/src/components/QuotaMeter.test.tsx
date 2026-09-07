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
  it("缺省 unit → 旧契约 '91 / 100 (91%)' 不变(向后兼容)", () => {
    expect(usageText(91, 100)).toBe("91 / 100 (91%)");
  });
  it("缺省 unit: 2300/10000 → '2300 / 10000 (23%)'", () => {
    expect(usageText(2300, 10000)).toBe("2300 / 10000 (23%)");
  });
  it("limit=0 不除零, pct 归 0", () => {
    expect(usageText(5, 0)).toBe("5 / 0 (0%)");
  });

  // ---- t_23800bd4: 单位语义(跟真实 Metric.unit, 禁止硬编码单位词) ----
  it("percent → 百分比格式, fmt1 修浮点尾差(37.941548… → 37.9%)", () => {
    expect(usageText(40, 100, "percent")).toBe("40% / 100%");
    expect(usageText(0.37941548 * 100, 100, "percent")).toBe("37.9% / 100%");
    expect(usageText(12.35, 100, "percent")).toBe("12.4% / 100%"); // 一位小数四舍五入
  });
  it("requests → 计数 + 本地化单位标签(zh=次), 附 pct", () => {
    expect(usageText(120, 1200, "requests")).toBe("120 / 1200 次 (10%)");
  });
  it("credits/tokens → 计数 + 单位标签(不硬编码「次」)", () => {
    expect(usageText(2300, 10000, "credits")).toBe("2300 / 10000 credits (23%)");
    expect(usageText(500, 1000, "tokens")).toBe("500 / 1000 tokens (50%)");
  });
  it("cny → 金额(固定 2 位小数, 浮点尾巴不上屏)", () => {
    expect(usageText(48.14, 500, "cny")).toBe("¥48.14 / ¥500.00");
    expect(usageText(448.45000000000005, 500, "cny")).toBe("¥448.45 / ¥500.00");
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
      <QuotaMeter pct={0.91} state="bad" title="阿里云百炼 月窗" resetText="6.4 小时后重置" used={91} limit={100} unit="percent" />,
    );
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.classList.contains("quota-meter--instance")).toBe(true);
    expect(wrap.querySelector(".quota-title")!.textContent).toBe("阿里云百炼 月窗");
    expect(wrap.querySelector(".quota-reset")!.textContent).toBe("6.4 小时后重置");
    // 默认 layout=stack: 用量行仍走 usageText 完整文案「91% / 100%」
    expect(wrap.querySelector(".quota-usage")!.textContent).toBe("91% / 100%");
    // 条契约不破
    expect(wrap.querySelector(".progress")).toBeTruthy();
    expect(wrap.querySelector(".progress-fill")!.getAttribute("data-health")).toBe("bad");
  });

  it("部分 slot: 只传 title+used/limit → 渲染标题与用量, 无重置行", () => {
    render(<QuotaMeter pct={0.4} title="OpenCode 5 小时窗" used={40} limit={100} unit="percent" />);
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

describe("QuotaMeter 排版变体(layout prop, t_35ff3c1f 容器层组合)", () => {
  const LAYOUTS = ["row", "duo", "hero", "micro", "ticker"] as const;

  it("完整实例 + layout → 挂 quota-meter--layout-<layout> modifier, 数据契约 slot 全保留", () => {
    render(
      <QuotaMeter
        pct={0.4}
        layout="row"
        title="OpenCode 5 小时窗"
        resetText="即将重置"
        used={40}
        limit={100}
        unit="percent"
      />,
    );
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.classList.contains("quota-meter--instance")).toBe(true);
    expect(wrap.classList.contains("quota-meter--layout-row")).toBe(true);
    expect(wrap.getAttribute("data-layout")).toBe("row");
    // 四元素 slot 全部还在(排版只重排, 不删数据)
    expect(wrap.querySelector(".quota-title")!.textContent).toBe("OpenCode 5 小时窗");
    expect(wrap.querySelector(".quota-reset")!.textContent).toBe("即将重置");
    // row 排版: 用量行保留 usageText 完整文案「40% / 100%」(非 micro, 不走短格式)
    expect(wrap.querySelector(".quota-usage")!.textContent).toBe("40% / 100%");
    expect(wrap.querySelector(".progress")).toBeTruthy();
  });

  it("5 种排版 modifier 全覆盖(data-layout 与 class 对齐)", () => {
    for (const layout of LAYOUTS) {
      freshRender(
        <QuotaMeter
          pct={0.72}
          state="warn"
          layout={layout}
          title="Kimi 周窗"
          resetText="3.4 天后重置"
          used={72}
          limit={100}
        />,
      );
      const wrap = container.querySelector("[data-testid='quota-meter']")!;
      expect(wrap.classList.contains(`quota-meter--layout-${layout}`)).toBe(true);
      expect(wrap.getAttribute("data-layout")).toBe(layout);
      expect(wrap.querySelector('[role="progressbar"]')).toBeTruthy();
    }
  });

  it("不传 layout = 默认竖排卡片(stack): 无 layout modifier, data-layout=stack", () => {
    render(
      <QuotaMeter pct={0.91} state="bad" title="阿里云百炼 月窗" resetText="6.4 小时后重置" used={91} limit={100} />,
    );
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.classList.contains("quota-meter--instance")).toBe(true);
    expect(Array.from(wrap.classList).some((c) => c.startsWith("quota-meter--layout-"))).toBe(false);
    expect(wrap.getAttribute("data-layout")).toBe("stack");
  });

  it("裸条传 layout 不挂排版类(排版只对完整实例有意义, 最小性保持)", () => {
    render(<QuotaMeter pct={0.4} layout="hero" />);
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.textContent).toBe("");
    expect(wrap.classList.contains("quota-meter--instance")).toBe(false);
    expect(wrap.classList.contains("quota-meter--layout-hero")).toBe(false);
  });

  // ---- micro 排版短格式(用户 9/7 拍板, t_f7d1beeb): quota-usage 只显百分比 NN%,
  // 不走 usageText 长文案(其他 layout 仍走原样); 缺 used/limit 不渲染 quota-usage 不变
  it("micro + percent 单位 → 用量行仅显示 NN%(短格式, 不带单位标签/不用 usageText)", () => {
    render(
      <QuotaMeter pct={0.49} layout="micro" title="Kimi" resetText="3.4 天后重置" used={49} limit={100} unit="percent" />,
    );
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.getAttribute("data-layout")).toBe("micro");
    // 短文本 = "49%", 绝不带 " / 100%" 或 "(49%)"
    expect(wrap.querySelector(".quota-usage")!.textContent).toBe("49%");
    // 重置时间 + 条契约不破
    expect(wrap.querySelector(".quota-reset")!.textContent).toBe("3.4 天后重置");
    expect(wrap.querySelector(".progress")).toBeTruthy();
  });

  it("micro + requests 单位 → 用量行仍仅显示 NN%(短格式对所有 unit 一致)", () => {
    render(
      <QuotaMeter pct={0.49} layout="micro" title="OpenCode" resetText="5 小时后重置" used={960} limit={1200} unit="requests" />,
    );
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    // 即便 unit=requests(requests 完整文案应为 "960 / 1200 次 (80%)"), micro 只显 "49%"
    expect(wrap.querySelector(".quota-usage")!.textContent).toBe("49%");
  });

  it("micro 浮点尾差: 0.799 → '80%'(整数%, 与 pct 取整逻辑一致)", () => {
    render(
      <QuotaMeter pct={0.799} layout="micro" title="x" used={799} limit={1000} unit="requests" />,
    );
    expect(container.querySelector(".quota-usage")!.textContent).toBe("80%");
  });

  it("micro 缺 used/limit → 不渲染 quota-usage(行为不变)", () => {
    render(<QuotaMeter pct={0.49} layout="micro" title="Kimi" resetText="3.4 天后重置" />);
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    expect(wrap.querySelector(".quota-usage")).toBeNull();
    // title + reset + bar 仍在
    expect(wrap.querySelector(".quota-title")!.textContent).toBe("Kimi");
    expect(wrap.querySelector(".quota-reset")!.textContent).toBe("3.4 天后重置");
  });

  it("非 micro layout(row/duo/hero/ticker) + 任一 unit → 用量行仍走 usageText 完整文案(micro 短格式仅限 micro)", () => {
    const cases: Array<{ layout: typeof LAYOUTS[number]; expected: string; used: number; limit: number; unit: "percent" | "requests" }> = [
      { layout: "row",     used: 40, limit: 100, unit: "percent",  expected: "40% / 100%" },
      { layout: "duo",     used: 80, limit: 100, unit: "percent",  expected: "80% / 100%" },
      { layout: "hero",    used: 49, limit: 100, unit: "percent",  expected: "49% / 100%" },
      { layout: "ticker",  used: 960, limit: 1200, unit: "requests", expected: "960 / 1200 次 (80%)" },
    ];
    for (const c of cases) {
      freshRender(
        <QuotaMeter
          pct={c.used / c.limit}
          layout={c.layout}
          title="x"
          resetText="r"
          used={c.used}
          limit={c.limit}
          unit={c.unit}
        />,
      );
      const wrap = container.querySelector("[data-testid='quota-meter']")!;
      expect(wrap.getAttribute("data-layout")).toBe(c.layout);
      expect(wrap.querySelector(".quota-usage")!.textContent).toBe(c.expected);
    }
  });

  it("DOM slots 顺序不变(排版差异全在 CSS 容器层 grid-area 重排)", () => {
    render(
      <QuotaMeter
        pct={0.4}
        layout="row"
        title="OpenCode 5 小时窗"
        resetText="即将重置"
        used={40}
        limit={100}
      />,
    );
    const wrap = container.querySelector("[data-testid='quota-meter']")!;
    const slotOrder = Array.from(wrap.children).map(
      (c) => c.className.split(" ")[0] || c.getAttribute("role") || "",
    );
    expect(slotOrder).toEqual(["quota-title", "quota-reset", "progress", "quota-usage"]);
  });
});