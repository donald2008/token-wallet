// L1(QuotaGallery 排版变体对比页, t_35ff3c1f + t_23800bd4 mock 修正): 同一 4 行数据 × 5 种容器层排版。
// - 5 段 qvar-row/duo/hero/micro/ticker, 每段画布 4 条完整四元素(标题+重置+条+用量)
// - 同数据跨段: 每段第一条的标题/用量文案一致(同一 mock 喂不同排版)
// - 数据(t_23800bd4): 前 3 行百分制三态(ok 40%/warn 72%/bad 91%, 真实 provider 风格名, 无「xx 次」误导),
//   第 4 行计数制演示(credits 2300/10000)——用量行按 unit 语义格式化
// - 填充计数: ok 10(2 ok 数据 × 5 段) / warn 5 / bad 5
// - .progress/.progress-fill[data-health]/role=progressbar 契约保留; 图例/返回钮在
// - 旧矩阵结构(.quota-table/.quota-row/.quota-vhead)零残留
// - t_85237167 9/5 清空: Provider 卡片卡内排版方案段(279858d+d304801)已删, 故总 progressbar
//   从 29 回归到 20(4 数据 × 5 排版); 填充 ok 14/warn 10/bad 5 → ok 10/warn 5/bad 5
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
    // 总 progressbar = 5 排版段 20 + 4 方案卡片段 19 = 39(t_85237167 9/5 重建)
    // - 5 排版段: 4 数据 × 5 段
    // - 4 方案卡片段:
    //   A 基线: 2 主页 row + 2 主页 BarRowTooltip = 4
    //   B 头部综合态: 2 row + 2 BarRowTooltip + 2 触发器 BarRowTooltip(隐藏 DOM 仍计) = 6
    //   C 状态色条: 2 row + 2 BarRowTooltip = 4
    //   D 头部承担: 2 row + 2 BarRowTooltip + 1 头部触发器 BarRowTooltip = 5
    //   异常段: 0
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(39);
    expect(container.querySelectorAll(".progress").length).toBe(39);
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

  it("三态色按数据分布: 39 = 5 排版段(10/5/5) + 4 方案段(8 warn + 8 ok + 触发器内 2 warn 1 ok)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const fills = Array.from(container.querySelectorAll(".progress-fill"));
    const byHealth = (h: string) => fills.filter((f) => f.getAttribute("data-health") === h).length;
    // t_85237167 9/5 重建后:
    //  - 5 排版段: ok 10(2 ok 数据 × 5 段) / warn 5 / bad 5
    //  - 4 方案段每张 ok 卡: 主页 2 row(1 warn 5h + 1 ok 周) + BarRowTooltip 2 micro(1 warn 5h + 1 ok 周)
    //    → 每卡 2 warn + 2 ok, 4 卡 = 8 warn + 8 ok
    //  - B 触发器内 2 BarRowTooltip: 1 warn + 1 ok
    //  - D 头部触发器内 1 BarRowTooltip: warn (最紧窗 5h)
    //  - 异常段: 0
    // 总 ok = 10 + 8 + 1 = 19; warn = 5 + 8 + 1 + 1 = 15; bad = 5
    expect(byHealth("ok")).toBe(19);
    expect(byHealth("warn")).toBe(15);
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

/** t_85237167 9/5 重建: 4 方案 (A/B/C/D) + 异常段 mock, 全部基于 tooltip QuotaMeter 原语 */
describe("QuotaGallery Provider 卡片卡内排版方案段 v2(t_85237167 9/5 重建)", () => {
  function variantCanvas(key: string): HTMLElement {
    return container.querySelector<HTMLElement>(`[data-testid='qvar-canvas-cards2-${key}']`)!;
  }
  function cardsOfCanvas(key: string): HTMLElement[] {
    return Array.from(variantCanvas(key).querySelectorAll<HTMLElement>("[data-testid='qcard2']"));
  }

  it("4 方案 + 异常段渲染: 5 个 qvar-canvas-cards2-* 段, 6 张 qcard2 卡(4 方案各 1 + 异常 2)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    for (const key of ["a", "b", "c", "d"]) {
      const canvas = variantCanvas(key);
      expect(canvas).toBeTruthy();
      const cards = cardsOfCanvas(key);
      expect(cards.length).toBe(1);
      const card = cards[0]!;
      // 卡头组件全在
      expect(card.querySelector("[data-testid='qcard2-head']")).toBeTruthy();
      expect(card.querySelector("[data-testid='qcard2-name']")!.textContent).toBe("Kimi-Code #1");
      expect(card.querySelector("[data-testid='qcard2-handle']")).toBeTruthy();
      // 每张 ok 卡 = 2 窗行, 每行嵌 BarRowTooltip(micro, tooltip 原语契约)
      const rows = card.querySelectorAll<HTMLElement>("[data-testid='qcard2-bar-row']");
      expect(rows.length).toBe(2);
      expect(rows[0]!.querySelectorAll("[data-testid='bar-tooltip']").length).toBe(1);
      expect(rows[1]!.querySelectorAll("[data-testid='bar-tooltip']").length).toBe(1);
      // 4 元素契约保留: 每行有 progressbar + title; usage 在 hideUsage(D 方案最紧窗)时缺省不渲染
      for (const r of rows) {
        const meter = r.querySelector("[data-testid='quota-meter']")!;
        expect(meter.querySelectorAll('[role="progressbar"]').length).toBe(1);
        expect(meter.querySelector(".quota-title")!.textContent!.length).toBeGreaterThan(0);
      }
      // D 卡: 主页最紧窗行 hideUsage=true, QuotaMeter 不渲染 .quota-usage(契约: used undefined 缺省不渲染);
      // 但行内 BarRowTooltip(micro) 仍渲染自己的 .quota-usage(BarRowTooltip 不传 hideUsage, 是独立 QuotaMeter)
      // → tightestRow 下 2 个 QuotaMeter: 主页的没 .quota-usage, micro 的有
      if (key === "d") {
        const tightestRow = card.querySelector<HTMLElement>("[data-testid='qcard2-bar-row'][data-metric='rolling_5h']")!;
        // 主页 QuotaMeter(layout=row, hideUsage) 无 .quota-usage
        const mainMeter = tightestRow.querySelector<HTMLElement>("[data-testid='quota-meter'][data-layout='row']")!;
        expect(mainMeter.querySelector(".quota-usage")).toBeNull();
        // micro QuotaMeter 在 BarRowTooltip 内(layout=micro) 有 .quota-usage
        const microMeter = tightestRow.querySelector<HTMLElement>("[data-testid='quota-meter'][data-layout='micro']")!;
        expect(microMeter.querySelector(".quota-usage")).toBeTruthy();
        // 周窗行(非最紧窗)hideUsage=false → 主页 QuotaMeter 有 .quota-usage
        const otherRow = card.querySelector<HTMLElement>("[data-testid='qcard2-bar-row'][data-metric='weekly']")!;
        expect(otherRow.querySelector("[data-testid='quota-meter'][data-layout='row'] .quota-usage")).toBeTruthy();
      }
    }
    // 异常段: 2 张卡(auth_expired + error), 都用 VariantA 共用骨架
    const abnCanvas = container.querySelector<HTMLElement>("[data-testid='qvar-canvas-cards2-abn']")!;
    expect(abnCanvas).toBeTruthy();
    const abnCards = Array.from(abnCanvas.querySelectorAll<HTMLElement>("[data-testid='qcard2']"));
    expect(abnCards.length).toBe(2);
    expect(abnCards[0]!.getAttribute("data-health")).toBe("warn"); // auth_expired
    expect(abnCards[1]!.getAttribute("data-health")).toBe("bad"); // error
    expect(abnCards[0]!.querySelectorAll("[data-testid='qcard2-hint']").length).toBe(1);
    expect(abnCards[1]!.querySelectorAll("[data-testid='qcard2-hint']").length).toBe(0);
    // 异常段无 progressbar(共用 AbnormalBody, 不渲染假窗口行 §2.1)
    expect(abnCanvas.querySelectorAll('[role="progressbar"]').length).toBe(0);
  });

  it("方案 B 头部综合态: 灯+综合态文字同行, 整卡含 ⓘ 触发器", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const card = cardsOfCanvas("b")[0]!;
    // 头部模式 = expanded, 应有 .qcard2-status-group 而非裸 dot+badge
    expect(card.querySelector(".qcard2-head--expanded")).toBeTruthy();
    expect(card.querySelector("[data-testid='qcard2-status-group']")).toBeTruthy();
    expect(card.querySelector("[data-testid='qcard2-trigger']")).toBeTruthy();
    // ⓘ 触发器内嵌合并 tooltip 容器(双 BarRowTooltip)
    const trigger = card.querySelector<HTMLElement>("[data-testid='qcard2-trigger']")!;
    expect(trigger.querySelectorAll("[data-testid='qcard2-merged-tip'] [data-testid='bar-tooltip']").length).toBe(2);
  });

  it("方案 C 状态色条 + 锁住态容器: tabIndex + status-bar modifier, .qcard2--status-bar::before 由 data-health 决定颜色", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const card = cardsOfCanvas("c")[0]!;
    expect(card.classList.contains("qcard2--status-bar")).toBe(true);
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("data-pinnable")).toBe("true");
    // data-health=warn (kimi 最紧窗 5h 80%)
    expect(card.getAttribute("data-health")).toBe("warn");
  });

  it("方案 D 头部承担最紧窗: 头部 qcard2-headline + head-trigger 内嵌 BarRowTooltip", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const card = cardsOfCanvas("d")[0]!;
    expect(card.querySelector(".qcard2-headline")).toBeTruthy();
    expect(card.querySelector("[data-testid='qcard2-headline']")).toBeTruthy();
    expect(card.querySelector(".qcard2-headline-window")!.textContent!.length).toBeGreaterThan(0);
    expect(card.querySelector(".qcard2-headline-usage")!.textContent!.length).toBeGreaterThan(0);
    const trigger = card.querySelector<HTMLElement>("[data-testid='qcard2-head-trigger']")!;
    // 头部触发器只嵌 1 个 BarRowTooltip(最紧窗), 不像 B 嵌 2 个
    expect(trigger.querySelectorAll("[data-testid='bar-tooltip']").length).toBe(1);
  });

  it("方案 A 基线: 无 status-bar / headline / 触发器, 纯窗口行", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const card = cardsOfCanvas("a")[0]!;
    expect(card.classList.contains("qcard2--baseline")).toBe(true);
    expect(card.querySelector(".qcard2-headline")).toBeFalsy();
    expect(card.querySelector(".qcard2-status-group")).toBeFalsy();
    expect(card.querySelector("[data-testid='qcard2-trigger']")).toBeFalsy();
    expect(card.getAttribute("tabindex")).toBeFalsy();
  });
});
