// @vitest-environment jsdom
/**
 * L1(D-041): 树形通道选择器必须呈现 command 类新通道叶子 ——
 * 「阿里云百炼 → Token Plan」(adapter=command, 零录入 params_schema=[])。
 * 验收#2: 设置页通道树出现「阿里云百炼 → Token Plan」叶子。
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

describe("通道树: aliyun-bailian/token-plan 叶子(D-041)", () => {
  it("平台节点「阿里云百炼」存在, 产品叶子「Token Plan」可点选且描述符正确", () => {
    const state = renderTree();
    const platformBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="tree-platform-aliyun-bailian"]',
    );
    expect(platformBtn, "阿里云百炼 平台节点必须出现").toBeTruthy();
    expect(platformBtn!.textContent).toContain("阿里云百炼");

    const leaf = container.querySelector<HTMLButtonElement>(
      '[data-testid="tree-product-aliyun-bailian-token-plan"]',
    );
    expect(leaf, "Token Plan 叶子必须出现").toBeTruthy();
    expect(leaf!.textContent).toContain("Token Plan");

    act(() => {
      leaf!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(state.selected?.channel).toBe("aliyun-bailian/token-plan");
    expect(state.selected?.adapter).toBe("command");
    expect(state.selected?.params_schema).toEqual([]);
  });
});
