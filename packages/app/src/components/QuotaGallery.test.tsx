// L1(QuotaGallery 排版变体对比页, t_35ff3c1f + t_23800bd4 mock 修正): 同一 4 行数据 × 5 种容器层排版。
// - 5 段 qvar-row/duo/hero/micro/ticker, 每段画布 4 条完整四元素(标题+重置+条+用量)
// - 同数据跨段: 每段第一条的标题/用量文案一致(同一 mock 喂不同排版)
// - 数据(t_23800bd4): 前 3 行百分制三态(ok 40%/warn 72%/bad 91%, 真实 provider 风格名, 无「xx 次」误导),
//   第 4 行计数制演示(credits 2300/10000)——用量行按 unit 语义格式化
// - 填充计数: ok 10(2 ok 数据 × 5 段) / warn 5 / bad 5
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
  it("渲染 5 种排版段, 每段 4 条完整四元素实例(role=progressbar 段内 = 4)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const sections = LAYOUTS.map((l) => container.querySelector(`[data-testid='qvar-${l}']`));
    expect(sections.every(Boolean)).toBe(true);
    for (const l of LAYOUTS) {
      const meters = metersOf(l);
      expect(meters.length).toBe(4);
      for (const m of meters) {
        expect(m.querySelectorAll('[role="progressbar"]').length).toBe(1);
        expect(m.querySelector(".quota-title")!.textContent!.length).toBeGreaterThan(0);
        expect(m.querySelector(".quota-reset")!.textContent!.length).toBeGreaterThan(0);
        expect(m.querySelector(".quota-usage")!.textContent!.length).toBeGreaterThan(0);
      }
    }
    // 总 progressbar = 4 数据 × 5 排版 = 20(t_23800bd4: 3 百分制 + 1 计数制演示)
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(20);
    expect(container.querySelectorAll(".progress").length).toBe(20);
  });

  it("同一组数据喂所有排版: 各段 4 条标题与用量文案两两一致", () => {
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
    // 数据组合断言(t_23800bd4): 百分制 3 行(40/72/91, provider 风格标题) + 计数制 1 行(2300/10000 credits)
    expect(first[0]).toBe("OpenCode 5 小时窗");
    expect(usages[0]).toEqual([
      usageText(40, 100, "percent"),
      usageText(72, 100, "percent"),
      usageText(91, 100, "percent"),
      usageText(2300, 10000, "credits"),
    ]);
    // 单位语义上屏: 百分制带 % 无单位词, 计数制带 credits(不硬编码「次」)
    expect(usages[0]![0]).toBe("40% / 100%");
    expect(usages[0]![3]).toContain("credits");
    for (let i = 1; i < usages.length; i++) {
      expect(usages[i]).toEqual(usages[0]);
    }
  });

  it("三态色按数据分布: ok 10(2 行 ok × 5 段) / warn 5 / bad 5", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const fills = Array.from(container.querySelectorAll(".progress-fill"));
    const byHealth = (h: string) => fills.filter((f) => f.getAttribute("data-health") === h).length;
    expect(byHealth("ok")).toBe(10);
    expect(byHealth("warn")).toBe(5);
    expect(byHealth("bad")).toBe(5);
    // 每段内部: 3 百分制三态 + 1 计数制 ok
    for (const l of LAYOUTS) {
      const seg = Array.from(canvasOf(l).querySelectorAll(".progress-fill")).map((f) =>
        f.getAttribute("data-health"),
      );
      expect(seg.sort()).toEqual(["bad", "ok", "ok", "warn"]);
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
