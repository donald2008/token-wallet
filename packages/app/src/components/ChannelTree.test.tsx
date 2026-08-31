// @vitest-environment jsdom
/**
 * P1(t_696ec820) 品牌卡片网格 — 方案 A 重设计后的测试契约:
 * - testid 锚点保留(channel-tree / tree-platform-* / tree-product-*, e2e 60 条不破前提)
 * - 默认全展开(产品 chips 可见, e2e 直接点) → 点平台头收起为紧凑卡(产品消失) → 再点展开
 * - 展开态跨满整行(.collapsed 无 + grid-column 1/-1), 收起参与网格列
 * - chip 点击 → onSelect(描述符)对齐既有契约; 计费形态徽章「窗口/余额」
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelTree } from "./ChannelTree";
import type { ChannelDescriptor } from "@token-wallet/core/channels";

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

function renderTree(): { selected: ChannelDescriptor | null } {
  const state: { selected: ChannelDescriptor | null } = { selected: null };
  act(() => {
    root.render(
      <ChannelTree
        onSelect={(d) => {
          state.selected = d;
        }}
      />,
    );
  });
  return state;
}

describe("品牌卡片网格(P1): testid 锚点保留 + 展开/收起交互 + chip 选中", () => {
  it("锚点保留: channel-tree / tree-platform-* / tree-product-* 存在(e2e 60 条不破前提)", () => {
    renderTree();
    const tree = container.querySelector<HTMLElement>('[data-testid="channel-tree"]');
    expect(tree, "channel-tree 锚点必须存在").toBeTruthy();
    const platformBtn = tree!.querySelector<HTMLButtonElement>('[data-testid="tree-platform-aliyun-bailian"]');
    expect(platformBtn, "tree-platform-aliyun-bailian 锚点必须存在").toBeTruthy();
    // 默认展开 → 产品 chip 可见
    const leaf = tree!.querySelector<HTMLButtonElement>('[data-testid="tree-product-aliyun-bailian-token-plan"]');
    expect(leaf, "tree-product-aliyun-bailian-token-plan 锚点默认必须出现").toBeTruthy();
    expect(leaf!.textContent).toContain("Token Plan");
  });

  it("默认展开(产品可见) → 点平台头收起(产品消失+翻 compact) → 再点展开", () => {
    renderTree();
    const tree = container.querySelector<HTMLElement>('[data-testid="channel-tree"]')!;
    const platformBtn = tree.querySelector<HTMLButtonElement>('[data-testid="tree-platform-deepseek"]')!;
    const product = () => tree.querySelector('[data-testid="tree-product-deepseek-balance"]');

    // 默认展开
    expect(platformBtn.getAttribute("aria-expanded")).toBe("true");
    expect(product(), "默认产品可见").toBeTruthy();
    const card = platformBtn.closest<HTMLElement>(".brand-grid-card")!;
    expect(card.classList.contains("collapsed")).toBe(false);

    // 点平台头 → 收起
    act(() => {
      platformBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(platformBtn.getAttribute("aria-expanded")).toBe("false");
    expect(product(), "收起后产品消失").toBeNull();
    expect(card.classList.contains("collapsed")).toBe(true);
    // 收起态 grid-column: auto(紧凑格参与网格列) —— JS 无法测 CSS 值, 断言 class 契约即可(样式见 app.css)

    // 再点 → 展开
    act(() => {
      platformBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(platformBtn.getAttribute("aria-expanded")).toBe("true");
    expect(product()).toBeTruthy();
  });

  it("chip 点击 → onSelect(描述符), 计费形态徽章「窗口/余额」", () => {
    const state = renderTree();
    const tree = container.querySelector<HTMLElement>('[data-testid="channel-tree"]')!;

    const windowChip = tree.querySelector<HTMLButtonElement>('[data-testid="tree-product-aliyun-bailian-token-plan"]')!;
    expect(windowChip.querySelector(".chip-type")!.textContent).toBe("窗口");
    act(() => {
      windowChip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(state.selected?.channel).toBe("aliyun-bailian/token-plan");
    expect(state.selected?.adapter).toBe("command");
    expect(state.selected?.params_schema).toEqual([]);

    const balanceChip = tree.querySelector<HTMLButtonElement>('[data-testid="tree-product-deepseek-balance"]')!;
    expect(balanceChip.querySelector(".chip-type")!.textContent).toBe("余额");
    act(() => {
      balanceChip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(state.selected?.channel).toBe("deepseek/balance");
  });

  it("网格默认展开下跨满整行、收起时参与网格列(文案角标=产品数)", () => {
    renderTree();
    const tree = container.querySelector<HTMLElement>('[data-testid="channel-tree"]')!;
    const platformBtn = tree.querySelector<HTMLButtonElement>('[data-testid="tree-platform-deepseek"]')!;
    const card = platformBtn.closest<HTMLElement>(".brand-grid-card")!;
    // 角标显示产品数(deepseek=1)
    expect(platformBtn.querySelector(".brand-grid-count")!.textContent).toBe("1");
    // 计数 = PRESET_CHANNELS 内 deepseek 平台产品数
    act(() => {
      platformBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(card.classList.contains("collapsed")).toBe(true);
  });
});