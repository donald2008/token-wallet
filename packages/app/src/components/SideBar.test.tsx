// @vitest-environment jsdom
// L1(D-038 + t_66b67453 契约2/3): 左侧窄功能侧栏 — 四钮顺序/行为/tooltip + 手绘 SVG 图标
// (D-002) + CSS 契约(44px 定宽 / no-drag / --border 分隔 / hover-active 用既有 token)。
// 契约2: 主题快切钮(spacer 下、设置上, 沿 THEME_CYCLE 循环, 图标随 mode);
// 契约3: 设置钮齿轮 = 经典齿环剪影(与太阳可辨), 不再是「中心圆+八向长齿」。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SideBar } from "./SideBar";
import { THEME_CYCLE, type ThemeMode } from "../theme";

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
  cycle: number;
}

function renderSideBar(refreshing = false, mode: ThemeMode = "system"): { bar: HTMLElement; calls: Calls } {
  const calls: Calls = { add: 0, refresh: 0, settings: 0, cycle: 0 };
  act(() => {
    root.render(
      <SideBar
        onAdd={() => (calls.add += 1)}
        onRefresh={() => (calls.refresh += 1)}
        onOpenSettings={() => (calls.settings += 1)}
        refreshing={refreshing}
        themeMode={mode}
        onCycleTheme={() => (calls.cycle += 1)}
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

describe("侧栏结构(D-038 + t_66b67453 契约2)", () => {
  it("四钮顺序 上→下 = 添加 / 刷新 / (弹性空隙) / 主题快切 / 设置", () => {
    const { bar } = renderSideBar();
    expect([...bar.querySelectorAll("button")].map((b) => b.dataset.testid)).toEqual([
      "sidebar-add",
      "refresh-btn",
      "theme-cycle-btn",
      "settings-btn",
    ]);
    // 弹性空隙把主题快切/设置钮推到底部
    const children = [...bar.children].map((el) => el.className);
    expect(children[2]).toContain("sidebar-spacer");
  });

  it("每钮有 title tooltip + aria-label(窄栏纯图标必须可读)", () => {
    const { bar } = renderSideBar();
    const expected: [string, string][] = [
      ["sidebar-add", "添加 Provider"],
      ["refresh-btn", "刷新"],
      ["theme-cycle-btn", "主题: 跟随系统(点击切换)"],
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
    expect(bar.querySelectorAll("svg").length).toBe(4);
    expect(bar.querySelectorAll("img").length).toBe(0);
    // 与标题栏图钉同风格: stroke 或 fill 均走 currentColor
    for (const svg of bar.querySelectorAll("svg")) {
      const usesCurrentColor =
        svg.innerHTML.includes('stroke="currentColor"') || svg.innerHTML.includes('fill="currentColor"');
      expect(usesCurrentColor).toBe(true);
    }
  });

  it("四钮点击各自触发对应回调(添加/刷新/主题/设置)", () => {
    const { bar, calls } = renderSideBar();
    click(bar, "sidebar-add");
    click(bar, "refresh-btn");
    click(bar, "theme-cycle-btn");
    click(bar, "theme-cycle-btn");
    click(bar, "settings-btn");
    expect(calls).toEqual({ add: 1, refresh: 1, cycle: 2, settings: 1 });
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

describe("主题快切钮(t_66b67453 契约2)", () => {
  it("图标随 themeMode 切换: system/light/dark 三态 DOM 不同 + data-theme-mode 标记", () => {
    const doms = new Set<string>();
    for (const mode of THEME_CYCLE) {
      const { bar } = renderSideBar(false, mode);
      const btn = bar.querySelector<HTMLButtonElement>('[data-testid="theme-cycle-btn"]')!;
      expect(btn.dataset.themeMode).toBe(mode);
      // title 反映当前主题名(与设置页文案同源)
      expect(btn.getAttribute("title")).toContain(
        { system: "跟随系统", light: "浅色", dark: "深色" }[mode],
      );
      doms.add(btn.querySelector("svg")!.innerHTML);
    }
    // 三态图标必须互不相同(图标反映当前 mode 的验收核心)
    expect(doms.size).toBe(3);
  });

  it("light=太阳(实心圆), dark=月亮(无实心盘), system=半实心(半日半月)", () => {
    const light = renderSideBar(false, "light").bar.querySelector('[data-testid="theme-cycle-btn"] svg')!;
    expect(light.innerHTML).toContain("<circle"); // 太阳盘面
    expect(light.innerHTML).toContain('fill="currentColor"');

    const dark = renderSideBar(false, "dark").bar.querySelector('[data-testid="theme-cycle-btn"] svg')!;
    expect(dark.innerHTML).not.toContain('fill="currentColor"'); // crescent 纯描边
    expect(dark.innerHTML).toContain('stroke="currentColor"');

    const system = renderSideBar(false, "system").bar.querySelector('[data-testid="theme-cycle-btn"] svg')!;
    // 半日半月: 既有一个实心半盘, 也有一个描边外圈
    expect(system.innerHTML).toContain('fill="currentColor"');
    expect(system.innerHTML).toContain("<circle");
    expect(system.innerHTML).toContain('stroke="currentColor"');
  });
});

describe("设置齿轮(t_66b67453 契约3)", () => {
  it("经典齿轮剪影: 齿环双子路径 + evenodd 挖孔, 非「中心圆+放射长齿」", () => {
    const { bar } = renderSideBar();
    const svg = bar.querySelector<HTMLButtonElement>('[data-testid="settings-btn"]')!.querySelector("svg")!;
    const path = svg.querySelector("path")!;
    // 齿环轮廓 + 中心孔 = 单 path 双子路径(evenodd)
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    expect(path.getAttribute("d")!.split("M").length).toBeGreaterThanOrEqual(3); // 外轮廓 + 孔
    // 旧画法的判别特征必须消失: <circle> 中心圆 与 八向放射线段(d 里出现 8 段独立 M 的放射线)
    expect(svg.innerHTML).not.toContain("<circle");
    // 新剪影为填充式(fill=currentColor), 不是旧描边式
    expect(path.getAttribute("fill")).toBe("currentColor");
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

  it(".sidebar-spacer flex:1 → 主题快切/设置钮沉底", () => {
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
