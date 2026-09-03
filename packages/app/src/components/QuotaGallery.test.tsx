// L1(QuotaGallery 方案页, t_af01e265): 完整四元素组件实例竖排展示。
// - N 条完整实例, 每条 = 标题 + 重置时间 + 进度条 + 用量(四元素齐全, 非半成品/非表格)
// - 三种状态色(ok/warn/bad)在数据集中各自出现(数据驱动)
// - 不同实例喂不同形态(variant)的条
// - e2e DOM 契约(.progress/.progress-fill[data-health]/role=progressbar)完整保留
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

describe("QuotaGallery 方案页(完整实例竖排)", () => {
  it("渲染多个完整四元素实例(role=progressbar = 实例数), 每实例四元素齐全", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const instances = Array.from(container.querySelectorAll<HTMLElement>(".quota-instance"));
    // 5 条实例(数据驱动)
    expect(instances.length).toBe(5);
    // 每条实例都有 1 根条 + 标题 + 重置 + 用量(四元素齐全, 非只渲染条)
    for (const inst of instances) {
      expect(inst.querySelectorAll('[role="progressbar"]').length).toBe(1);
      expect(inst.querySelector(".quota-title")!.textContent!.length).toBeGreaterThan(0);
      expect(inst.querySelector(".quota-reset")!.textContent!.length).toBeGreaterThan(0);
      expect(inst.querySelector(".quota-usage")!.textContent!.length).toBeGreaterThan(0);
    }
    // progressbar 总数 = 实例数(不是矩阵的 12)
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(5);
  });

  it("三态色齐全: ok/warn/bad 填充在数据集中各出现(数据驱动 mock 含 ok/warn/bad)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const fills = Array.from(container.querySelectorAll(".progress-fill"));
    const byHealth = (h: string) => fills.filter((f) => f.getAttribute("data-health") === h).length;
    expect(byHealth("ok")).toBeGreaterThan(0); // flash_40 / perf_23
    expect(byHealth("warn")).toBeGreaterThan(0); // deep_58 / week_72
    expect(byHealth("bad")).toBeGreaterThan(0); // month_91
  });

  it("mock 数据: 各实例宽度/状态与数据组合一致(非表格, 每实例独立完整)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const inst = (key: string) =>
      Array.from(container.querySelectorAll<HTMLElement>(".quota-instance")).find(
        (el) => el.getAttribute("data-instance") === key,
      )!;
    const fill = (el: HTMLElement) => el.querySelector<HTMLElement>(".progress-fill");
    expect(fill(inst("flash_40"))!.getAttribute("data-health")).toBe("ok");
    expect(fill(inst("flash_40"))!.style.width).toBe("40%");
    expect(fill(inst("deep_58"))!.getAttribute("data-health")).toBe("warn");
    expect(fill(inst("deep_58"))!.style.width).toBe("58%");
    expect(fill(inst("month_91"))!.getAttribute("data-health")).toBe("bad");
    expect(fill(inst("month_91"))!.style.width).toBe("91%");
    // 用量行展示 used/limit/pct 派生文案
    expect(inst("month_91").querySelector(".quota-usage")!.textContent).toBe("91 / 100 (91%)");
  });

  it("不同实例喂不同形态(variant)的条(形态保留在组件内部, 非表格行维度)", () => {
    render(<QuotaGallery onBack={() => {}} />);
    const inst = (key: string) =>
      Array.from(container.querySelectorAll<HTMLElement>(".quota-instance")).find(
        (el) => el.getAttribute("data-instance") === key,
      )!;
    const variantOf = (key: string) =>
      inst(key).querySelector("[data-testid='quota-meter']")!.getAttribute("data-variant");
    expect(variantOf("flash_40")).toBe("slim");
    expect(variantOf("deep_58")).toBe("thick");
    expect(variantOf("week_72")).toBe("segmented");
    expect(variantOf("month_91")).toBe("flow");
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