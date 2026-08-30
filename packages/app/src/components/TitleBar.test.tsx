// @vitest-environment jsdom
// L1(t_05271be0): 标题栏主题按钮 — ① 文案缩短(system→「自动」), title 提示保留全语义;
// ② CSS 契约: .btn white-space:nowrap 防换行撑高; .bar-row 恒有 2px 透明左缘+4px padding
// 对齐占位, tightest 只换 border-color(进度条左缘逐行对齐)。360px 视口高度稳定由 e2e 兜底。
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

function renderTitleBar(themeMode: "system" | "light" | "dark") {
  act(() => {
    root.render(
      <TitleBar
        health="ok"
        tooltip=""
        themeMode={themeMode}
        refreshing={false}
        pinned={false}
        onTogglePin={() => {}}
        onCycleTheme={() => {}}
        onRefresh={() => {}}
        onOpenSettings={() => {}}
      />,
    );
  });
  return container.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]')!;
}

describe("TitleBar 主题按钮(t_05271be0 #1)", () => {
  it("system 态按钮文案 = 「自动」(2 字, 360px 宽度预算内不换行)", () => {
    const btn = renderTitleBar("system");
    expect(btn.textContent).toBe("自动");
    expect(btn.textContent!.length).toBeLessThanOrEqual(2);
  });

  it("title 提示保留全语义「主题: 跟随系统(点击切换)」", () => {
    const btn = renderTitleBar("system");
    expect(btn.getAttribute("title")).toBe("主题: 跟随系统(点击切换)");
  });

  it("light/dark 态文案与 title 不受影响", () => {
    expect(renderTitleBar("light").textContent).toBe("浅色");
    expect(renderTitleBar("dark").textContent).toBe("深色");
    expect(renderTitleBar("dark").getAttribute("title")).toBe("主题: 深色(点击切换)");
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

describe("CSS 契约(t_05271be0 #1/#2)", () => {
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

  it(".bar-row 恒有 2px 透明左缘 + 4px 左 padding(对齐占位)", () => {
    const block = ruleBlock(".bar-row");
    expect(block).toContain("border-left: 2px solid transparent");
    expect(block).toContain("padding-left: 4px");
  });

  it(".bar-row[data-tightest] 只换 border-color, 不再独有不一致 padding", () => {
    const block = ruleBlock(".bar-row[data-tightest]");
    expect(block).toContain("border-left-color: var(--bad)");
    expect(block).not.toContain("padding-left");
  });

  it(".bar-label 定宽 72px + 全局 border-box(label 侧无漂移源, 嫌疑②核查固化)", () => {
    expect(ruleBlock(".bar-label")).toContain("width: 72px");
    expect(ruleBlock("*")).toContain("box-sizing: border-box");
  });
});
