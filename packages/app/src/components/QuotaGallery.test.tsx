// L1(QuotaGallery 方案页, t_37416b22): 画廊视图数据契约与三态渲染。
// - 3 条典型窗口 × 4 形态 = 12 条进度条; 三种状态色(ok/warn/bad)各出现 4 次
// - 数据驱动 mock(pct/state 硬编码常量), 每格都是「条本体」(QuotaMeter)
// - 返回按钮回调
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuotaGallery } from "./QuotaGallery";

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

describe("QuotaGallery 方案页", () => {
  it("渲染 4 形态 × 3 窗口 = 12 条进度条(role=progressbar)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(12);
    // 4 个 variant 列头
    expect(container.querySelectorAll(".quota-vhead").length).toBe(4);
    // 3 行窗口
    expect(container.querySelectorAll('.quota-row[data-metric]').length).toBe(3);
  });

  it("三态色齐全: ok/warn/bad 填充各 4 条(数据驱动)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const fills = Array.from(container.querySelectorAll(".progress-fill"));
    const byHealth = (h: string) => fills.filter((f) => f.getAttribute("data-health") === h).length;
    expect(byHealth("ok")).toBe(4);
    expect(byHealth("warn")).toBe(4);
    expect(byHealth("bad")).toBe(4);
  });

  it("mock 数据: 5h 40% ok / 周 72% warn / 月 91% bad", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.quota-row[data-metric]'));
    const row = (key: string) => rows.find((r) => r.getAttribute("data-metric") === key)!;
    const fill = (el: HTMLElement) => el.querySelector<HTMLElement>(".progress-fill");
    // 使用 slim(default) 列的首格验证宽度与状态
    expect(fill(row("rolling_5h"))!.getAttribute("data-health")).toBe("ok");
    expect(fill(row("rolling_5h"))!.style.width).toBe("40%");
    expect(fill(row("weekly"))!.getAttribute("data-health")).toBe("warn");
    expect(fill(row("weekly"))!.style.width).toBe("72%");
    expect(fill(row("monthly"))!.getAttribute("data-health")).toBe("bad");
    expect(fill(row("monthly"))!.style.width).toBe("91%");
  });

  it("返回钮回调 onBack", () => {
    const back = vi.fn();
    render(<QuotaGallery onBack={back} />);
    container.querySelector<HTMLButtonElement>('[data-testid="quota-back"]')!.click();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("种形态列头展示(名称 + 一句话)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const heads = Array.from(container.querySelectorAll(".quota-vhead"));
    expect(heads.length).toBe(4);
    for (const h of heads) {
      expect(h.querySelector(".quota-vname")!.textContent!.length).toBeGreaterThan(0);
      expect(h.querySelector(".quota-vnote")!.textContent!.length).toBeGreaterThan(0);
    }
  });
});