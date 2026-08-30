// @vitest-environment jsdom
// L1(D-038): 左侧窄功能侧栏 — 三钮顺序/行为/tooltip + 手绘 SVG 图标(D-002) +
// CSS 契约(44px 定宽 / no-drag / --border 分隔 / hover-active 用既有 token)。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SideBar } from "./SideBar";

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

interface Calls {
  add: number;
  refresh: number;
  settings: number;
}

function renderSideBar(refreshing = false): { bar: HTMLElement; calls: Calls } {
  const calls: Calls = { add: 0, refresh: 0, settings: 0 };
  act(() => {
    root.render(
      <SideBar
        onAdd={() => (calls.add += 1)}
        onRefresh={() => (calls.refresh += 1)}
        onOpenSettings={() => (calls.settings += 1)}
        refreshing={refreshing}
      />,
    );
  });
  return { bar: container.querySelector<HTMLElement>('[data-testid="sidebar"]')!, calls };
}

function click(bar: HTMLElement, testid: string): void {
  const btn = bar.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!;
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("侧栏结构(D-038)", () => {
  it("三钮顺序 上→下 = 添加 / 刷新 / (弹性空隙) / 设置", () => {
    const { bar } = renderSideBar();
    expect([...bar.querySelectorAll("button")].map((b) => b.dataset.testid)).toEqual([
      "sidebar-add",
      "refresh-btn",
      "settings-btn",
    ]);
    // 弹性空隙把设置钮推到底部
    const children = [...bar.children].map((el) => el.className);
    expect(children[2]).toContain("sidebar-spacer");
  });

  it("每钮有 title tooltip + aria-label(窄栏纯图标必须可读)", () => {
    const { bar } = renderSideBar();
    const expected: [string, string][] = [
      ["sidebar-add", "添加 Provider"],
      ["refresh-btn", "刷新"],
      ["settings-btn", "设置"],
    ];
    for (const [id, title] of expected) {
      const btn = bar.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
      expect(btn.getAttribute("title")).toBe(title);
      expect(btn.getAttribute("aria-label")).toBe(title);
    }
  });

  it("图标是手绘 inline SVG(D-002 不引组件库), 无图标字体/图片", () => {
    const { bar } = renderSideBar();
    expect(bar.querySelectorAll("svg").length).toBe(3);
    expect(bar.querySelectorAll("img").length).toBe(0);
    // 与标题栏图钉同风格: stroke=currentColor + strokeWidth 1.2
    for (const svg of bar.querySelectorAll("svg")) {
      expect(svg.innerHTML).toContain('stroke="currentColor"');
      expect(svg.innerHTML).toContain('stroke-width="1.2"');
    }
  });

  it("三钮点击各自触发对应回调(添加/刷新/设置)", () => {
    const { bar, calls } = renderSideBar();
    click(bar, "sidebar-add");
    click(bar, "refresh-btn");
    click(bar, "settings-btn");
    click(bar, "settings-btn");
    expect(calls).toEqual({ add: 1, refresh: 1, settings: 2 });
  });

  it("refreshing=true → 刷新钮带 spinning 类(图标旋转)", () => {
    expect(
      renderSideBar(true).bar.querySelector('[data-testid="refresh-btn"]')!.className,
    ).toContain("spinning");
    expect(
      renderSideBar(false).bar.querySelector('[data-testid="refresh-btn"]')!.className,
    ).not.toContain("spinning");
  });
});

// ---- CSS 契约(源码级; 真实布局/可点性由 e2e 兜底) ----
const css = readFileSync(resolve(process.cwd(), "src/app.css"), "utf8");

function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(m, `CSS 规则 ${selector} 必须存在`).toBeTruthy();
  return m![1];
}

describe("侧栏 CSS 契约(D-038)", () => {
  it(".sidebar: 44px 定宽 + 与内容区 --border 分隔 + no-drag(按钮可点)", () => {
    const block = ruleBlock(".sidebar");
    expect(block).toContain("width: 44px");
    expect(block).toContain("flex: 0 0 44px");
    expect(block).toContain("border-right: 1px solid var(--border)");
    // 无边框窗 drag 区不得吃掉侧栏点击
    expect(block).toContain("-webkit-app-region: no-drag");
  });

  it(".sidebar-spacer flex:1 → 设置钮沉底", () => {
    expect(ruleBlock(".sidebar-spacer")).toContain("flex: 1");
  });

  it("hover/active 态用既有 token(--bg-hover / --accent), 不新增强调色", () => {
    expect(ruleBlock(".sidebar-btn:hover")).toContain("var(--bg-hover)");
    const activeAt = css.indexOf(".sidebar-btn:active");
    expect(activeAt, ".sidebar-btn:active 规则必须存在").toBeGreaterThan(-1);
    const activeBlock = css.slice(activeAt, css.indexOf("}", activeAt));
    expect(activeBlock).toContain("var(--accent)");
  });
});
