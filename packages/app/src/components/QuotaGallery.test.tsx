// L2(QuotaGallery Provider 卡片排版方案页, t_73c110ea 9/7 重建):
// - 3 排版段 (P1/P2/P4) + 异常段 (auth_expired + error 共用骨架), 全部基于真排版维度
// - P3 双列 grid 在 360px 屏实测文字重叠 + 列被裁切 —— 本轮不交付(留 3 个真维度: 空间结构/信息层级/头部承载)
// - 同一套三窗真实数据 (kimi-code rolling_5h + weekly + monthly, unit=requests)
// - 三窗 QuotaMeter(layout=micro) **常驻直显** = 卡片信息主体(无 hover 依赖, 修订 #1116)
// - micro = BarRowTooltip 内 QuotaMeter 同一形态, 共享 `.quota-meter--layout-micro` CSS
// - 不再单独挂 <BarRowTooltip>: 信息全靠悬浮才见 = 不合格
// - 旧 5 排版对比段(A/B/C/D/E QuotaMeter 单元素 layout)整段删除
// - 异常段无 progressbar(共用 AbnormalBody, 不渲染假窗口行 §2.1)
//
// 契约计数(ok 卡 = 三窗):
//   每张 ok 卡 = 3 bar-row, 每行嵌 1 个 QuotaMeter(micro) = 3 progressbar
//   3 ok 卡 × 3 = 9 progressbar
//   异常段 0 progressbar
//   总 progressbar = 9
//
// 健康分布(同数据三窗):
//   rolling_5h 80% (960/1200) → warn × 3 卡 = 3 warn
//   weekly 20% (1200/6000) → ok × 3 卡 = 3 ok
//   monthly 30% (1800/6000) → ok × 3 卡 = 3 ok
//   总: ok 6, warn 3, bad 0 (无 bad 数据)
//
// 渲染数据(title/usage 文案)在 3 张 ok 卡内一致(同一份 metrics 喂 3 个 render)
//
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

const SCHEMES = ["p1", "p2", "p4", "p5"] as const;

function canvasOf(key: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-testid='qvar-canvas-cards3-${key}']`)!;
}
function cardOf(key: string): HTMLElement {
  return canvasOf(key).querySelector<HTMLElement>("[data-testid='qcard3']")!;
}
function metersOfCard(key: string): HTMLElement[] {
  return Array.from(cardOf(key).querySelectorAll<HTMLElement>("[data-testid='quota-meter']"));
}
function barsOfCard(key: string): HTMLElement[] {
  return Array.from(cardOf(key).querySelectorAll<HTMLElement>("[data-testid='qcard3-bar-row']"));
}

/** 三窗真实数据契约(同套 kimi-code 数据, 与 getProviderCardMockProviders() 对齐) */
const EXPECTED_TITLES = ["5 小时窗", "周窗", "月窗"];
const EXPECTED_USAGES = [
  usageText(960, 1200, "requests"),
  usageText(1200, 6000, "requests"),
  usageText(1800, 6000, "requests"),
];

describe("QuotaGallery Provider 卡片排版方案页 v2 (t_73c110ea 9/7 重建)", () => {
  it("3 排版段 (P1/P2/P4) + 异常段渲染: 4 个 qvar-canvas-cards3-* 段, 共 5 张 qcard3 卡 (3 ok + 2 异常)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    // 3 排版段
    for (const key of SCHEMES) {
      const canvas = canvasOf(key);
      expect(canvas, `canvas for ${key}`).toBeTruthy();
      const cards = Array.from(canvas.querySelectorAll<HTMLElement>("[data-testid='qcard3']"));
      expect(cards.length, `card count for ${key}`).toBe(1);
    }
    // 异常段
    const abnCanvas = container.querySelector<HTMLElement>("[data-testid='qvar-canvas-cards3-abn']")!;
    expect(abnCanvas).toBeTruthy();
    const abnCards = Array.from(abnCanvas.querySelectorAll<HTMLElement>("[data-testid='qcard3']"));
    expect(abnCards.length).toBe(2);
  });

  it("三窗 QuotaMeter(micro) 常驻直显: 每张 ok 卡 = 3 行 bar-row, 每行 1 个 QuotaMeter(micro) = 3 progressbar (修订 #1116, 不再挂 BarRowTooltip)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    for (const key of SCHEMES) {
      const card = cardOf(key);
      const bars = barsOfCard(key);
      expect(bars.length, `bar-row count for ${key}`).toBe(3);
      // 每行 1 个 QuotaMeter(layout=micro) = 信息主体(无 hover 依赖, 修订 #1116)
      const meters = metersOfCard(key);
      expect(meters.length, `quota-meter count for ${key}`).toBe(3);
      // 行内 QuotaMeter 必须 layout=micro(用户硬约束: 修订 #1116)
      const microMeters = meters.filter((m) => m.getAttribute("data-layout") === "micro");
      expect(microMeters.length, `micro layout meters for ${key}`).toBe(3);
      // 不再挂 BarRowTooltip: 整卡零 layout=row QuotaMeter, 零 .bar-tooltip 节点
      const rowMeters = meters.filter((m) => m.getAttribute("data-layout") === "row");
      expect(rowMeters.length, `row layout meters for ${key}`).toBe(0);
      expect(card.querySelectorAll(".bar-tooltip").length, `bar-tooltip count for ${key}`).toBe(0);
      // DOM 契约零破: .progress + role=progressbar
      const progresses = card.querySelectorAll(".progress");
      expect(progresses.length, `.progress count for ${key}`).toBe(3);
      const progressbars = card.querySelectorAll('[role="progressbar"]');
      expect(progressbars.length, `progressbar count for ${key}`).toBe(3);
    }
  });

  it("同一套三窗真实数据喂 P1/P2 两张 ok 卡: title 与 usage 文案两张一致(P4 因 hideUsage 单独验证)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    // P1/P2 两张卡都完整渲染 .quota-usage; P4 hideUsage 不在此断言(P4 单独 it)
    const titlesPerCard: string[][] = [];
    const usagesPerCard: string[][] = [];
    for (const key of ["p1", "p2"] as const) {
      const card = cardOf(key);
      const microMeters = Array.from(card.querySelectorAll<HTMLElement>("[data-testid='quota-meter'][data-layout='micro']"));
      titlesPerCard.push(microMeters.map((m) => m.querySelector(".quota-title")!.textContent!));
      usagesPerCard.push(microMeters.map((m) => m.querySelector(".quota-usage")!.textContent!));
    }
    // 3 张卡 3 标题相同
    const firstTitles = titlesPerCard[0]!;
    for (let i = 1; i < titlesPerCard.length; i++) {
      expect(titlesPerCard[i]).toEqual(firstTitles);
    }
    expect(firstTitles).toEqual(EXPECTED_TITLES);
    // 用量文案一致(同 kimi-code 三窗真实数据)
    const firstUsages = usagesPerCard[0]!;
    for (let i = 1; i < usagesPerCard.length; i++) {
      expect(usagesPerCard[i]).toEqual(firstUsages);
    }
    expect(firstUsages).toEqual(EXPECTED_USAGES);
    // 计数制语义: 含本地化单位词(不硬编码「次」由数据决定; zh=次, en=requests)
    expect(firstUsages[0]).toMatch(/次|requests/);
    expect(firstUsages[0]).toContain("(80%)");
    expect(firstUsages[1]).toContain("(20%)");
    expect(firstUsages[2]).toContain("(30%)");
  });

  it("健康分布(同三窗真实数据): ok 8 + warn 4 + bad 0 (4 张 ok 卡各 1 warn + 2 ok, P5 同 kimi 三窗)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const fills = Array.from(container.querySelectorAll(".progress-fill"));
    const byHealth = (h: string) => fills.filter((f) => f.getAttribute("data-health") === h).length;
    // 4 张 ok 卡: 每张 3 个 progress-fill(3 行内 micro), 总 12
    // 健康分布: rolling_5h 80% warn(4) + weekly 20% ok(4) + monthly 30% ok(4)
    expect(byHealth("ok")).toBe(8);
    expect(byHealth("warn")).toBe(4);
    expect(byHealth("bad")).toBe(0);
  });

  it("总 progressbar = 12 (4 ok 卡 × 3 窗 × 1 micro QuotaMeter, P5 是 t_5b092750 9/7 加的方案),  异常段 = 0", () => {
    render(<QuotaGallery onBack={() => {}} />);
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(12);
    expect(container.querySelectorAll(".progress").length).toBe(12);
    // 异常段无 progressbar
    const abnCanvas = container.querySelector<HTMLElement>("[data-testid='qvar-canvas-cards3-abn']")!;
    expect(abnCanvas.querySelectorAll('[role="progressbar"]').length).toBe(0);
  });

  it("P1 基线: 卡头 qcard3-badge + 三窗 micro 经典布局, 无 headline/rollup/grid", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const card = cardOf("p1");
    expect(card.classList.contains("qcard3--baseline")).toBe(true);
    expect(card.getAttribute("data-variant")).toBe("baseline");
    // 基线含 .qcard3-badge + .qcard3-windows, 不含 headline/status-group/grid
    expect(card.querySelector(".qcard3-badge")).toBeTruthy();
    expect(card.querySelector(".qcard3-windows")).toBeTruthy();
    expect(card.querySelector(".qcard3-headline")).toBeFalsy();
    expect(card.querySelector(".qcard3-status-group")).toBeFalsy();
    expect(card.querySelector(".qcard3-grid-3col")).toBeFalsy();
  });

  it("P2 头部综合态: 卡头含 qcard3-status-group(StatusDot+综合态文字同行), 三窗 micro 经典布局", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const card = cardOf("p2");
    expect(card.classList.contains("qcard3--head-rollup")).toBe(true);
    expect(card.getAttribute("data-variant")).toBe("head-rollup");
    // 含 status-group(Dot+label 同行)
    const statusGroup = card.querySelector<HTMLElement>("[data-testid='qcard3-status-group']");
    expect(statusGroup).toBeTruthy();
    expect(statusGroup!.querySelector("[data-testid='status-dot']")).toBeTruthy();
    expect(card.querySelector(".qcard3-status-label")!.textContent!.length).toBeGreaterThan(0);
    // 三窗 micro 仍走 .qcard3-windows(非 grid)
    expect(card.querySelector(".qcard3-windows")).toBeTruthy();
    expect(card.querySelector(".qcard3-grid-3col")).toBeFalsy();
    expect(card.querySelector(".qcard3-headline")).toBeFalsy();
  });


  it("P4 头部数字: 卡头含 qcard3-headline(最紧窗窗名+数字), 最紧窗(rolling_5h)行 QuotaMeter(micro) hideUsage 不渲染 .quota-usage", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const card = cardOf("p4");
    expect(card.classList.contains("qcard3--head-number")).toBe(true);
    expect(card.getAttribute("data-variant")).toBe("head-number");
    // headline = 窗名 + 数字
    const headline = card.querySelector<HTMLElement>("[data-testid='qcard3-headline']");
    expect(headline).toBeTruthy();
    expect(headline!.querySelector(".qcard3-headline-window")!.textContent!.length).toBeGreaterThan(0);
    expect(headline!.querySelector(".qcard3-headline-usage")!.textContent!.length).toBeGreaterThan(0);
    // headline-usage 含 requests 单位(最紧窗 = rolling_5h 80%, 数字 "960 / 1200 requests")
    expect(headline!.querySelector(".qcard3-headline-usage")!.textContent).toContain("requests");
    // 最紧窗行(r5h)的行内 QuotaMeter(micro) 不渲染 .quota-usage(hideUsage)
    const tightestRow = card.querySelector<HTMLElement>("[data-testid='qcard3-bar-row'][data-metric='rolling_5h']")!;
    const tightestRowMeter = tightestRow.querySelector<HTMLElement>("[data-testid='quota-meter'][data-layout='micro']")!;
    expect(tightestRowMeter.querySelector(".quota-usage")).toBeNull();
    // 非最紧窗行(weekly/monthly)行内 QuotaMeter 有 .quota-usage
    for (const key of ["weekly", "monthly"]) {
      const row = card.querySelector<HTMLElement>(`[data-testid='qcard3-bar-row'][data-metric='${key}']`)!;
      const rowMeter = row.querySelector<HTMLElement>("[data-testid='quota-meter'][data-layout='micro']")!;
      expect(rowMeter.querySelector(".quota-usage")).toBeTruthy();
    }
  });

  it("P5 短窗并排: 卡头同 P1, .qcard3-windows-row 两列含 5h+周, .qcard3-windows-row--wide 独占月; 三窗 micro 复用, .progress/role=progressbar 契约零破(t_5b092750 用户 9/7 拍板)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const card = cardOf("p5");
    // 卡头同 P1: qcard3-badge + qcard3-head; 无 headline/status-group(无 4 方案语义)
    expect(card.classList.contains("qcard3--monitor-short-side")).toBe(true);
    expect(card.getAttribute("data-variant")).toBe("monitor-short-side");
    expect(card.querySelector(".qcard3-badge")).toBeTruthy();
    expect(card.querySelector(".qcard3-headline")).toBeFalsy();
    expect(card.querySelector(".qcard3-status-group")).toBeFalsy();
    // 旧 P1 经典容器 .qcard3-windows 不存在(本卡专属 .qcard3-windows-row)
    expect(card.querySelector(".qcard3-windows")).toBeFalsy();
    // 第一行: 两列 grid 含 5h + 周
    const row2 = card.querySelector<HTMLElement>("[data-testid='qcard3-windows-row']");
    expect(row2).toBeTruthy();
    const row2Bars = Array.from(row2!.querySelectorAll<HTMLElement>("[data-testid='qcard3-bar-row']"));
    expect(row2Bars.map((b) => b.getAttribute("data-metric"))).toEqual(["rolling_5h", "weekly"]);
    // 第二行: 全宽 wide 修饰符 + 独占 monthly
    const wideRow = card.querySelector<HTMLElement>("[data-testid='qcard3-windows-row-wide']");
    expect(wideRow).toBeTruthy();
    expect(wideRow!.classList.contains("qcard3-windows-row--wide")).toBe(true);
    expect(wideRow!.querySelector("[data-metric='monthly']")).toBeTruthy();
    // 三窗全复用 micro QuotaMeter(layout="micro", .progress + role=progressbar 契约零破)
    const meters = Array.from(card.querySelectorAll<HTMLElement>("[data-testid='quota-meter'][data-layout='micro']"));
    expect(meters.length).toBe(3);
    expect(card.querySelectorAll(".progress").length).toBe(3);
    expect(card.querySelectorAll('[role="progressbar"]').length).toBe(3);
    // 与 P1 标题/用量一致(同数据快照)
    const titles = meters.map((m) => m.querySelector(".quota-title")!.textContent!);
    expect(titles).toEqual(EXPECTED_TITLES);
  });

  it("异常段: auth_expired 卡含 status-line + setup_hint(hint-copy-btn); error 卡无 hint 但含 status-line", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const abnCanvas = container.querySelector<HTMLElement>("[data-testid='qvar-canvas-cards3-abn']")!;
    const abnCards = Array.from(abnCanvas.querySelectorAll<HTMLElement>("[data-testid='qcard3']"));
    expect(abnCards.length).toBe(2);
    // auth_expired: warn health + status-line + setup_hint(hint-copy-btn)
    const authCard = abnCards[0]!;
    expect(authCard.getAttribute("data-health")).toBe("warn");
    expect(authCard.querySelector(".qcard3-status-line")).toBeTruthy();
    expect(authCard.querySelector(".qcard3-lamp")).toBeTruthy();
    expect(authCard.querySelector(".qcard3-hint")).toBeTruthy();
    expect(authCard.querySelector("[data-testid='qcard3-hint']")).toBeTruthy();
    expect(authCard.querySelectorAll("[data-testid='hint-copy-btn']").length).toBe(1);
    // error: bad health + status-line, 无 hint
    const errorCard = abnCards[1]!;
    expect(errorCard.getAttribute("data-health")).toBe("bad");
    expect(errorCard.querySelector(".qcard3-status-line")).toBeTruthy();
    expect(errorCard.querySelector(".qcard3-hint")).toBeFalsy();
  });

  it("每张 ok 卡的卡头含 name = 'Kimi-Code #1'(同 ProviderSnapshot), 健康由 kimi 最紧窗 5h 80% 决定为 warn", () => {
    render(<QuotaGallery onBack={() => {}} />);
    for (const key of SCHEMES) {
      const card = cardOf(key);
      const name = card.querySelector<HTMLElement>("[data-testid='qcard3-name']")!.textContent;
      expect(name).toBe("Kimi-Code #1");
      // kimi-code 三窗最紧 = rolling_5h 80% (warn), providerHealth 选最紧窗 → warn
      expect(card.getAttribute("data-health")).toBe("warn");
    }
  });

  it("返回钮回调 onBack", () => {
    const back = vi.fn();
    render(<QuotaGallery onBack={back} />);
    container.querySelector<HTMLButtonElement>('[data-testid="quota-back"]')!.click();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("旧 5 排版对比段已清空: qvar-row/duo/hero/micro/ticker + qcard2/qvar-canvas--cards2 全无残留", () => {
    render(<QuotaGallery onBack={() => {}} />);
    // 旧 5 段 testid 不应存在
    for (const old of ["row", "duo", "hero", "micro", "ticker"]) {
      expect(
        container.querySelector(`[data-testid='qvar-${old}']`),
        `legacy qvar-${old} should be gone`,
      ).toBeFalsy();
    }
    // 旧 4 方案 + 异常段 testid 不应存在
    for (const old of ["a", "b", "c", "d", "abn"]) {
      expect(
        container.querySelector(`[data-testid='qvar-canvas-cards2-${old}']`),
        `legacy cards2 canvas ${old} should be gone`,
      ).toBeFalsy();
    }
    // ProviderCardVariants.tsx 已删: 无 qcard2 残留
    expect(container.querySelectorAll("[data-testid='qcard2']").length).toBe(0);
    expect(container.querySelectorAll(".qcard2").length).toBe(0);
  });
});