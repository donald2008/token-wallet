// @vitest-environment jsdom
// L1(t_05271be0/t_2ac39613 回归 + t_66b67453 契约1): 标题栏瘦身后只剩 图钉/最小化/关闭,
// hover 显隐逻辑整体移除(CSS 无 toolbar-btn 淡出规则); t_66b67453 契约1 起标题栏
// .panel 内独占第一行(全宽), .panel 重排 column + panel-body 行布局锁定;
// 标题不断词换行 + 进度条对齐占位等既有 CSS 契约继续锁定(布局行为由 e2e boundingBox 兜底)。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TitleBar } from "./TitleBar";

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

function renderTitleBar(pinned = false) {
  act(() => {
    root.render(
      <TitleBar health="ok" tooltip="" pinned={pinned} onTogglePin={() => {}} />,
    );
  });
  return container.querySelector<HTMLElement>(".titlebar")!;
}

describe("标题栏瘦身(D-038)", () => {
  it("只剩 3 个控件: 图钉 / 最小化 / 关闭(+ app-title, 非按钮)", () => {
    const bar = renderTitleBar();
    const buttons = [...bar.querySelectorAll("button")];
    expect(buttons.map((b) => b.dataset.testid)).toEqual([
      "pin-btn",
      "win-min-btn",
      "win-close-btn",
    ]);
    expect(bar.querySelector(".app-title")!.textContent).toBe("token-wallet");
  });

  it("刷新 / 设置 / 主题切换三钮已移除(迁侧栏 + 设置页)", () => {
    const bar = renderTitleBar();
    for (const id of ["refresh-btn", "settings-btn", "theme-toggle"]) {
      expect(bar.querySelector(`[data-testid="${id}"]`), `${id} 不应再在标题栏`).toBeNull();
    }
  });

  it("按钮不带 toolbar-btn 淡出类(hover 显隐整体移除, 全部常显)", () => {
    const bar = renderTitleBar();
    expect(bar.querySelectorAll(".toolbar-btn").length).toBe(0);
  });

  it("图钉置顶态: data-pinned / aria-pressed 同步(无常显特判, 本就常显)", () => {
    expect(renderTitleBar(false).querySelector("[data-testid=pin-btn]")!.getAttribute("aria-pressed")).toBe("false");
    const pinned = renderTitleBar(true).querySelector("[data-testid=pin-btn]")!;
    expect(pinned.getAttribute("aria-pressed")).toBe("true");
    expect(pinned.getAttribute("data-pinned")).toBe("true");
  });
});

// ---- CSS 契约断言(源码级, 布局行为由 e2e boundingBox 兜底) ----
// vitest jsdom 下 import.meta.url 非 file: scheme, 用 process.cwd()(=packages/app) 解析
const css = readFileSync(resolve(process.cwd(), "src/app.css"), "utf8");

function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(m, `CSS 规则 ${selector} 必须存在`).toBeTruthy();
  return m![1];
}

describe("CSS 契约(D-038 + t_05271be0 #1/#2 回归)", () => {
  it("hover 显隐规则已整体移除(无 toolbar-btn opacity 淡出)", () => {
    expect(css).not.toContain("toolbar-btn");
    expect(css).not.toContain('.titlebar .btn-pin[data-pinned="true"]');
  });

  it(".btn 有 white-space: nowrap(防按钮文字换行撑高 titlebar)", () => {
    expect(ruleBlock(".btn")).toContain("white-space: nowrap");
  });

  it(".app-title 禁止断词换行 + 截断省略(t_2ac39613 #1: token-wallet 不换行撑高)", () => {
    const block = ruleBlock(".app-title");
    expect(block).toContain("white-space: nowrap");
    expect(block).toContain("min-width: 0");
    expect(block).toContain("overflow: hidden");
    expect(block).toContain("text-overflow: ellipsis");
    // spacer 允许收缩是截断生效的前提(否则 min-width:auto 阻止标题收缩)
    expect(ruleBlock(".titlebar .spacer")).toContain("min-width: 0");
  });

  it(".panel 横向布局 + .panel-main 可收缩(侧栏定宽, 内容区不横向溢出)", () => {
    // t_66b67453 契约1: .panel 重排 column(标题栏全宽第一行) + .panel-body 行(侧栏|内容)
    expect(ruleBlock(".panel")).toContain("flex-direction: column");
    expect(ruleBlock(".panel-body")).toContain("flex-direction: row");
    const main = ruleBlock(".panel-main");
    expect(main).toContain("min-width: 0");
    expect(main).toContain("overflow: hidden");
  });

  it("标题栏全宽(t_66b67453 契约1): .panel 无 row 布局, 侧栏从第二行开始", () => {
    // 旧布局的判别特征: .panel flex-direction: row(侧栏与标题栏同行)必须消失
    expect(ruleBlock(".panel")).not.toContain("flex-direction: row");
    // 拖拽区仍在标题栏整行(现 = 全宽), 侧栏保持 no-drag
    expect(ruleBlock(".titlebar")).toContain("-webkit-app-region: drag");
    expect(ruleBlock(".sidebar")).toContain("-webkit-app-region: no-drag");
  });

  it(".bar-row 无透明左缘占位(评审③④: 2px border 对齐漂移源已移除, audit §2.1 L300 收敛)", () => {
    const block = ruleBlock(".bar-row");
    expect(block).toContain("gap: var(--gap)");
    expect(block).not.toContain("border-left");
    expect(block).not.toContain("padding-left");
  });

  it(".bar-row[data-tightest] 最紧窗标记 = 标签加粗变色(不再用 border/padding)", () => {
    const block = ruleBlock(".bar-row[data-tightest] .bar-label");
    expect(block).toContain("font-weight: 700");
    expect(block).toContain("color: var(--bad-fg)");
    expect(block).not.toContain("padding-left");
  });

  it(".bar-label 定宽 72px + 全局 border-box(label 侧无漂移源, 嫌疑②核查固化)", () => {
    expect(ruleBlock(".bar-label")).toContain("width: 72px");
    expect(ruleBlock("*")).toContain("box-sizing: border-box");
  });
});
