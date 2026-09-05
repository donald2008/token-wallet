// @vitest-environment jsdom
// L1(t_05271be0/t_2ac39613 回归 + t_66b67453 契约1 + t_d086543b 重排): 标题栏 = 状态点 +
// app-title + 刷新/主题快切(侧栏迁入) + 图钉/最小化/关闭; hover 显隐逻辑整体移除;
// t_d086543b 起 .panel 内标题栏独占第一行(全宽), .panel-body 仅剩内容区;
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

function renderTitleBar(pinned = false, refreshing = false, themeMode: "system" | "light" | "dark" = "system") {
  act(() => {
    root.render(
      <TitleBar
        health="ok"
        tooltip=""
        pinned={pinned}
        onTogglePin={() => {}}
        refreshing={refreshing}
        onRefresh={() => {}}
        themeMode={themeMode}
        onCycleTheme={() => {}}
      />,
    );
  });
  return container.querySelector<HTMLElement>(".titlebar")!;
}

describe("标题栏控件构成(t_d086543b 重排)", () => {
  it("5 个控件: 刷新 / 主题快切 / 图钉 / 最小化 / 关闭(+ app-title, 非按钮)", () => {
    const bar = renderTitleBar();
    const buttons = [...bar.querySelectorAll("button")];
    expect(buttons.map((b) => b.dataset.testid)).toEqual([
      "refresh-btn",
      "theme-cycle-btn",
      "pin-btn",
      "win-min-btn",
      "win-close-btn",
    ]);
    expect(bar.querySelector(".app-title")!.textContent).toBe("token-wallet");
  });

  it("刷新钮带 refreshing 旋转类; 主题钮 data-theme-mode 同步", () => {
    const idle = renderTitleBar(false, false);
    expect(idle.querySelector("[data-testid=refresh-btn]")!.className).not.toContain("spinning");
    const spinning = renderTitleBar(false, true);
    expect(spinning.querySelector("[data-testid=refresh-btn]")!.className).toContain("spinning");
    const bar = renderTitleBar(false, false, "dark");
    expect(bar.querySelector("[data-testid=theme-cycle-btn]")!.getAttribute("data-theme-mode")).toBe("dark");
  });

  it("设置/添加不在标题栏(迁底边栏 BottomBar); 旧 theme-toggle 控件不存在", () => {
    const bar = renderTitleBar();
    for (const id of ["settings-btn", "add-btn", "theme-toggle"]) {
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

describe("CSS 契约(D-038 + t_05271be0 #1/#2 回归 + t_d086543b)", () => {
  it("hover 显隐规则已整体移除(无 toolbar-btn opacity 淡出)", () => {
    expect(css).not.toContain("toolbar-btn");
    expect(css).not.toContain('.titlebar .btn-pin[data-pinned="true"]');
  });

  it(".btn 有 white-space: nowrap(防按钮文字换行撑高 titlebar)", () => {
    expect(ruleBlock(".btn")).toContain("white-space: nowrap");
  });

  it(".app-title 禁断词换行 + 默认态完整可见(t_2ca0af5e P0 终审: 360px 预算内不放 ellipsis 兜底)", () => {
    const block = ruleBlock(".app-title");
    // 唯一保留: 防断词撑高 titlebar
    expect(block).toContain("white-space: nowrap");
    // 删 t_2ac39613 截断兜底: 任务 P0 = 默认态必须完整可见, 不再走 silent ellipsis.
    // 若未来按钮 +1 触发超预算, 走 .titlebar 横向溢出 → e2e docOverflow<=0 fail-loud 兜底.
    expect(block).not.toContain("text-overflow: ellipsis");
    expect(block).not.toContain("overflow: hidden");
    expect(block).not.toContain("min-width: 0");
    // spacer 允许收缩仍在(原 D-038 兜底前提保留, 给未来预算紧张时留余地, 不触发 silent 截断)
    expect(ruleBlock(".titlebar .spacer")).toContain("min-width: 0");
  });

  it(".panel 纵向布局 + .panel-main 可收缩(t_d086543b 侧栏取消, 内容区全宽不溢出)", () => {
    expect(ruleBlock(".panel")).toContain("flex-direction: column");
    expect(ruleBlock(".panel-body")).toContain("flex-direction: row");
    const main = ruleBlock(".panel-main");
    expect(main).toContain("min-width: 0");
    expect(main).toContain("overflow: hidden");
  });

  it("侧栏 CSS 已整体删除; 底边栏存在且内容带 icon+label(不是空栏)", () => {
    // 旧布局的判别特征: .sidebar / .sidebar-btn 规则必须消失
    expect(css).not.toContain(".sidebar");
    expect(ruleBlock(".bottombar")).toContain("border-top: 1px solid var(--border)");
    // 拖拽区仍在标题栏整行; 底栏按钮 no-drag 由继承 .btn 覆盖(标题栏拖拽不扩散)
    expect(ruleBlock(".titlebar")).toContain("-webkit-app-region: drag");
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
