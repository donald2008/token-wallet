// @vitest-environment jsdom
/**
 * L1(D-038): 设置页瘦身为**纯偏好页** —— provider 管理(添加入口 / 实例列表 / 增删按钮)
 * 必须彻底消失, 通用偏好(主题/排序/开机自启/存储路径)必须全在;
 * 弹窗结构(head 固定 + body 滚动)不变(#829 R3)。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc", () => ({
  getStoragePaths: async () => ({ configDir: "/cfg/token-wallet", dataDir: "/data/token-wallet" }),
  getLaunchAtLogin: async () => false,
  setLaunchAtLogin: async () => undefined,
}));

import { SettingsView } from "./SettingsView";
import type { SortConfig } from "../health";

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

async function renderSettings(variant: "page" | "modal" = "modal"): Promise<HTMLElement> {
  await act(async () => {
    root.render(
      <SettingsView
        variant={variant}
        themeMode="system"
        onThemeMode={() => {}}
        sortConfig={{ key: "name", dir: "asc" }}
        onSortConfig={() => {}}
        onBack={() => {}}
      />,
    );
  });
  // storagePaths / autostart 的异步读回落定
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container.querySelector<HTMLElement>('[data-testid="settings-view"]')!;
}

describe("设置页瘦身(D-038)", () => {
  it("无 provider 增删元素: 添加入口 / 实例列表 / 删除钮 全部消失", async () => {
    const view = await renderSettings();
    for (const id of ["add-instance", "instance-list", "no-instances", "add-channel-step"]) {
      expect(view.querySelector(`[data-testid="${id}"]`), `${id} 不应再在设置页`).toBeNull();
    }
    // 任何形如 del-xxx / confirm-del-xxx 的实例删除钮都不得存在
    expect(view.querySelectorAll('[data-testid^="del-"]').length).toBe(0);
    expect(view.querySelectorAll('[data-testid^="confirm-del-"]').length).toBe(0);
    expect(view.textContent).not.toContain("实例管理");
  });

  it("通用偏好全在: 主题 / 排序(key×dir) / 开机自启 / 存储路径", async () => {
    const view = await renderSettings();
    for (const id of [
      "theme-seg",
      "sort-sec",
      "sort-key-seg",
      "sort-dir-seg",
      "autostart-sec",
      "autostart-toggle",
      "storage-paths",
      "config-dir",
      "data-dir",
    ]) {
      expect(view.querySelector(`[data-testid="${id}"]`), `${id} 必须保留`).toBeTruthy();
    }
    // 主题三态入口在设置页(标题栏入口已删, 此处是唯一入口)
    for (const id of ["theme-system", "theme-light", "theme-dark"]) {
      expect(view.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
    }
  });

  it("弹窗结构不变(#829 R3): head 固定不在滚动容器 body 内, modal 渲染 ×", async () => {
    const view = await renderSettings("modal");
    const head = view.querySelector(".settings-head")!;
    const body = view.querySelector('[data-testid="settings-body"]')!;
    expect(body.contains(head)).toBe(false);
    expect(view.querySelector('[data-testid="settings-close"]')).toBeTruthy();
    expect(view.querySelector('[data-testid="settings-back"]')).toBeNull();
  });

  it("page variant 渲染返回钮(页内导航形态保留)", async () => {
    const view = await renderSettings("page");
    expect(view.querySelector('[data-testid="settings-back"]')).toBeTruthy();
    expect(view.querySelector('[data-testid="settings-close"]')).toBeNull();
  });
});

// ---- D-039: 排序第三档「手动」+ manual 时方向禁用 + order 保留切换恢复 ----
describe("排序第三档「手动」(D-039)", () => {
  async function renderWithConfig(
    sortConfig: SortConfig,
    onSortConfig: (c: SortConfig) => void,
  ): Promise<HTMLElement> {
    await act(async () => {
      root.render(
        <SettingsView
          variant="modal"
          themeMode="system"
          onThemeMode={() => {}}
          sortConfig={sortConfig}
          onSortConfig={onSortConfig}
          onBack={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return container.querySelector<HTMLElement>('[data-testid="settings-view"]')!;
  }

  it("排序键控件含第三档「手动」", async () => {
    const view = await renderWithConfig({ key: "name", dir: "asc" }, () => {});
    const manualBtn = view.querySelector<HTMLButtonElement>('[data-testid="sort-key-manual"]')!;
    expect(manualBtn).toBeTruthy();
    expect(manualBtn.textContent).toBe("手动");
  });

  it("manual 激活时方向控件禁用(manual 按拖拽顺序, dir 无意义)", async () => {
    const view = await renderWithConfig({ key: "manual", dir: "asc" }, () => {});
    expect(view.querySelector<HTMLButtonElement>('[data-testid="sort-key-manual"]')!.className).toContain(
      "active",
    );
    for (const id of ["sort-dir-asc", "sort-dir-desc"]) {
      expect(view.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.disabled).toBe(true);
    }
  });

  it("切到名称/紧要度时 order 保留不清(再切回手动恢复自定义顺序)", async () => {
    const calls: SortConfig[] = [];
    const order = ["c", "a", "b"];
    const view = await renderWithConfig({ key: "manual", dir: "asc", order }, (c) => calls.push(c));
    // 从 manual 切到 name: onSortConfig 收到的配置必须带原 order
    act(() => {
      view.querySelector<HTMLButtonElement>('[data-testid="sort-key-name"]')!.click();
    });
    expect(calls).toEqual([{ key: "name", dir: "asc", order }]);
    // 从 name 切回 manual: order 仍在, dir 由控件当前值决定(这里切回 manual 保留 order)
    act(() => {
      view.querySelector<HTMLButtonElement>('[data-testid="sort-key-manual"]')!.click();
    });
    expect(calls[1]).toEqual({ key: "manual", dir: "asc", order });
  });
});
