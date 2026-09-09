// @vitest-environment jsdom
/**
 * AgentGuideModal 单测(D-048 / t_4bd214de Q4 决议 B):
 * - open=false → 不渲染 portal
 * - open=true + daemon 未跑 → 展示 empty 文案
 * - open=true + daemon 在跑 → 渲染 agent 列表
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const ipcMocks = vi.hoisted(() => ({
  mcpGetGuide: vi.fn(),
}));

vi.mock("../ipc", () => ipcMocks);

import { AgentGuideModal } from "./AgentGuideModal";
import { LangProvider } from "../i18nReact";

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
  vi.clearAllMocks();
});

describe("AgentGuideModal", () => {
  it("open=false → 不渲染 portal", async () => {
    await act(async () => {
      root.render(
        <LangProvider>
          <AgentGuideModal open={false} onClose={vi.fn()} />
        </LangProvider>,
      );
    });
    expect(document.querySelector('[data-testid="mcp-guide-overlay"]')).toBeNull();
  });

  it("open=true + daemon 未跑 → 展示 empty 文案", async () => {
    ipcMocks.mcpGetGuide.mockResolvedValue({ agents: [], reason: "daemon_not_running" });
    await act(async () => {
      root.render(
        <LangProvider>
          <AgentGuideModal open onClose={vi.fn()} />
        </LangProvider>,
      );
    });
    // 等异步 mcpGetGuide 完成
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.querySelector('[data-testid="mcp-guide-empty"]')).toBeTruthy();
  });

  it("open=true + daemon 在跑 → 渲染 agent 列表", async () => {
    ipcMocks.mcpGetGuide.mockResolvedValue({
      agents: [
        {
          id: "hermes",
          name: "Hermes",
          plugin_url: "https://example.com/hermes",
          docs_url: "https://example.com/hermes/docs",
          configure: "configure hermes",
          verify: "verify hermes",
        },
        {
          id: "claude",
          name: "Claude Code",
          plugin_url: "https://example.com/claude",
          configure: "configure claude",
        },
      ],
    });
    await act(async () => {
      root.render(
        <LangProvider>
          <AgentGuideModal open onClose={vi.fn()} />
        </LangProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const list = document.querySelector('[data-testid="mcp-guide-list"]');
    expect(list).toBeTruthy();
    expect(document.querySelector('[data-testid="mcp-guide-hermes"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="mcp-guide-claude"]')).toBeTruthy();
  });

  it("点击 × → 触发 onClose", async () => {
    ipcMocks.mcpGetGuide.mockResolvedValue({ agents: [] });
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <LangProvider>
          <AgentGuideModal open onClose={onClose} />
        </LangProvider>,
      );
    });
    const closeBtn = document.querySelector('[data-testid="mcp-guide-close"]') as HTMLButtonElement;
    await act(async () => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击 overlay 背景 → 触发 onClose; 点击 modal 自身不触发", async () => {
    ipcMocks.mcpGetGuide.mockResolvedValue({ agents: [] });
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <LangProvider>
          <AgentGuideModal open onClose={onClose} />
        </LangProvider>,
      );
    });
    const overlay = document.querySelector('[data-testid="mcp-guide-overlay"]') as HTMLElement;
    const modal = document.querySelector('[data-testid="mcp-guide-modal"]') as HTMLElement;
    await act(async () => {
      modal.click();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      overlay.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
