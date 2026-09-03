// L1(QuotaGallery 排版变体对比页, t_35ff3c1f): 同一 3 行数据 × 5 种容器层排版。
// - 5 段 qvar-row/duo/hero/micro/ticker, 每段画布 3 条完整四元素(标题+重置+条+用量)
// - 同数据跨段: 每段第一条的标题/用量文案一致(同一 mock 喂不同排版)
// - 三态 ok/warn/bad: 3 数据 × 5 段 = 各 5 根填充
// - .progress/.progress-fill[data-health]/role=progressbar 契约保留; 图例/返回钮在
// - 旧矩阵结构(.quota-table/.quota-row/.quota-vhead)零残留
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuotaGallery } from "./QuotaGallery";
import { usageText } from "./QuotaMeter";

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

const LAYOUTS = ["row", "duo", "hero", "micro", "ticker"] as const;

function canvasOf(layout: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-testid='qvar-canvas-${layout}']`)!;
}
function metersOf(layout: string): HTMLElement[] {
  return Array.from(canvasOf(layout).querySelectorAll<HTMLElement>("[data-testid='quota-meter']"));
}

describe("QuotaGallery 排版对比页(同数据 × 5 排版)", () => {
  it("渲染 5 种排版段, 每段 3 条完整四元素实例(role=progressbar 段内 = 3)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const sections = LAYOUTS.map((l) => container.querySelector(`[data-testid='qvar-${l}']`));
    expect(sections.every(Boolean)).toBe(true);
    for (const l of LAYOUTS) {
      const meters = metersOf(l);
      expect(meters.length).toBe(3);
      for (const m of meters) {
        expect(m.querySelectorAll('[role="progressbar"]').length).toBe(1);
        expect(m.querySelector(".quota-title")!.textContent!.length).toBeGreaterThan(0);
        expect(m.querySelector(".quota-reset")!.textContent!.length).toBeGreaterThan(0);
        expect(m.querySelector(".quota-usage")!.textContent!.length).toBeGreaterThan(0);
      }
    }
    // 总 progressbar = 3 数据 × 5 排版 = 15(不是旧矩阵的 12, 也不是旧竖排的 5)
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(15);
    expect(container.querySelectorAll(".progress").length).toBe(15);
  });

  it("同一组数据喂所有排版: 各段第 1/2/3 条标题与用量文案两两一致", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const titles = LAYOUTS.map((l) =>
      metersOf(l).map((m) => m.querySelector(".quota-title")!.textContent),
    );
    const usages = LAYOUTS.map((l) =>
      metersOf(l).map((m) => m.querySelector(".quota-usage")!.textContent),
    );
    const first = titles[0]!;
    for (let i = 1; i < titles.length; i++) {
      expect(titles[i]).toEqual(first);
    }
    // 数据组合断言: 第 1 条 ok 40/100, 第 2 条 72/100, 第 3 条 91/100(usageText 派生同规)
    expect(first[0]).toBe("闪购 40 次");
    expect(usages[0]).toEqual([
      usageText(40, 100),
      usageText(72, 100),
      usageText(91, 100),
    ]);
    for (let i = 1; i < usages.length; i++) {
      expect(usages[i]).toEqual(usages[0]);
    }
  });

  it("三态色齐全且按段均匀: ok/warn/bad 填充各 5(3 数据 × 5 排版)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const fills = Array.from(container.querySelectorAll(".progress-fill"));
    const byHealth = (h: string) => fills.filter((f) => f.getAttribute("data-health") === h).length;
    expect(byHealth("ok")).toBe(5);
    expect(byHealth("warn")).toBe(5);
    expect(byHealth("bad")).toBe(5);
    // 每段内部也三态齐(同数据三行 = ok/warn/bad)
    for (const l of LAYOUTS) {
      const seg = Array.from(canvasOf(l).querySelectorAll(".progress-fill")).map((f) =>
        f.getAttribute("data-health"),
      );
      expect(seg.sort()).toEqual(["bad", "ok", "warn"]);
    }
  });

  it("每条 meter 的 data-layout/class 与其所在段一致(容器层排版生效面)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    for (const l of LAYOUTS) {
      const meters = metersOf(l);
      for (const m of meters) {
        expect(m.getAttribute("data-layout")).toBe(l);
        expect(m.classList.contains(`quota-meter--layout-${l}`)).toBe(true);
      }
    }
  });

  it("返回钮回调 onBack", () => {
    const back = vi.fn();
    render(<QuotaGallery onBack={back} />);
    container.querySelector<HTMLButtonElement>('[data-testid="quota-back"]')!.click();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("确保非表格: 无 matrix/vhead/窗口行 残留结构", () => {
    render(<QuotaGallery onBack={() => {}} />);
    expect(container.querySelectorAll(".quota-table, .quota-row, .quota-vhead, .quota-cell").length).toBe(0);
  });
});
