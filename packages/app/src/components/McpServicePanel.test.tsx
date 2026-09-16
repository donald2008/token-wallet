// @vitest-environment jsdom
/**
 * McpServicePanel 单测(D-055 / t_4bd214de):
 * - 状态机: loading → running / stopped / not_installed
 * - 操作禁用: running 禁 start / stopped 禁 stop / busy 时全禁
 * - 状态切换: probe 结果驱动按钮 enabled/disabled
 * - 32hex key 复制 + 二次确认重生成
 * - autostart toggle(联动 OS)
 *
 * jsdom + React 19 踩坑笔记(t_c20d4d11 后续):
 * - button.click() 偶发 stale ref, 改用 dispatchEvent 真实事件路径
 * - checkbox click: jsdom 会自动 toggle checked + fire change, 走 click 即触发 onChange
 * - vi.clearAllMocks 清 calls 但保留 mockResolvedValue(beforeEach 重设默认)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const ipcMocks = vi.hoisted(() => ({
  mcpProbe: vi.fn(),
  mcpStart: vi.fn(),
  mcpStop: vi.fn(),
  mcpGetConfig: vi.fn(),
  mcpGenKey: vi.fn(),
  mcpGetAutostart: vi.fn(),
  mcpSetAutostart: vi.fn(),
  mcpGetGuide: vi.fn(),
  mcpRestart: vi.fn(),
  maskMcpKey: (key: string): string => {
    if (key.length <= 12) return "•".repeat(key.length);
    return `${key.slice(0, 4)}-••••-••••-••••-${key.slice(-4)}`;
  },
}));

vi.mock("../ipc", () => ipcMocks);

import { McpServicePanel } from "./McpServicePanel";
import { LangProvider } from "../i18nReact";
import { setLang } from "../i18n";

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
  // 默认 happy path mock(各 it 可单独 mockResolvedValueOnce 覆盖)
  ipcMocks.mcpProbe.mockResolvedValue({ alive: true, installed: true });
  ipcMocks.mcpGetConfig.mockResolvedValue({
    TOKEN_WALLET_MCP_KEY: "0123456789abcdef0123456789abcdef",
    TOKEN_WALLET_PORT: 9131,
    TOKEN_WALLET_HOST: "127.0.0.1",
    TOKEN_WALLET_DB_PATH: "/tmp/tw.db",
    USAGE_TTL_DAYS: 90,
    mcpEnvPath: "/home/test/.config/token-wallet/mcp.env",
    installed: true,
  });
  ipcMocks.mcpGetAutostart.mockResolvedValue({ mcpAutostart: true, osAutostart: true });
  ipcMocks.mcpStart.mockResolvedValue({ started: true, pid: 12345 });
  ipcMocks.mcpStop.mockResolvedValue({ stopped: true });
  ipcMocks.mcpGenKey.mockResolvedValue({
    key: "fedcba9876543210fedcba9876543210",
    daemonWasRunning: true,
  });
  ipcMocks.mcpSetAutostart.mockResolvedValue({ mcpAutostart: true, osAutostart: true });
  ipcMocks.mcpGetGuide.mockResolvedValue({ agents: [] });
  ipcMocks.mcpRestart.mockResolvedValue({ restarted: true, started: true, pid: 12345 });
  // mock clipboard(组件复制用)
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks(); // 清 calls/results, 保留 beforeEach 设的 mockResolvedValue
});

function fireClick(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

async function render() {
  await act(async () => {
    root.render(
      <LangProvider>
        <McpServicePanel onGuideOpen={vi.fn()} />
      </LangProvider>,
    );
  });
  // 等初次 probe/setConfig/setAutostart 异步落定
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("McpServicePanel: 状态机", () => {
  it("probe alive=true → running", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: true, installed: true });
    setLang("zh");
    await render();
    const panel = container.querySelector('[data-testid="mcp-panel"]') as HTMLElement;
    expect(panel.getAttribute("data-status")).toBe("running");
    expect(panel.textContent).toContain("运行中");
  });

  it("probe alive=false + installed=true → stopped", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: false, installed: true, reason: "unreachable" });
    await render();
    const panel = container.querySelector('[data-testid="mcp-panel"]') as HTMLElement;
    expect(panel.getAttribute("data-status")).toBe("stopped");
    expect(panel.textContent).toContain("未运行");
  });

  it("probe installed=false → not_installed", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: false, installed: false });
    await render();
    const panel = container.querySelector('[data-testid="mcp-panel"]') as HTMLElement;
    expect(panel.getAttribute("data-status")).toBe("not_installed");
    expect(panel.textContent).toContain("未找到 daemon");
  });
});

describe("McpServicePanel: 按钮启用矩阵", () => {
  it("running: start 禁用 / stop 启用", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: true, installed: true });
    await render();
    const start = container.querySelector('[data-testid="mcp-start"]') as HTMLButtonElement;
    const stop = container.querySelector('[data-testid="mcp-stop"]') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(stop.disabled).toBe(false);
  });

  it("stopped: start 启用 / stop 禁用", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: false, installed: true });
    await render();
    const start = container.querySelector('[data-testid="mcp-start"]') as HTMLButtonElement;
    const stop = container.querySelector('[data-testid="mcp-stop"]') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(stop.disabled).toBe(true);
  });

  it("not_installed: start 禁用(需先构建 resources/)", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: false, installed: false });
    await render();
    const start = container.querySelector('[data-testid="mcp-start"]') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });
});

describe("McpServicePanel: 端点 + key 遮罩 + 复制", () => {
  it("端点 = http://host:port/mcp", async () => {
    await render();
    const endpoint = container.querySelector('[data-testid="mcp-endpoint"]') as HTMLElement;
    expect(endpoint.textContent).toBe("http://127.0.0.1:9131/mcp");
  });

  it("key 默认遮罩(4-••••-••••-••••-末4)", async () => {
    await render();
    const masked = container.querySelector('[data-testid="mcp-key-masked"]') as HTMLElement;
    expect(masked.textContent).toBe("0123-••••-••••-••••-cdef");
  });

  it("复制 → 调 navigator.clipboard.writeText(明文)", async () => {
    await render();
    const copy = container.querySelector('[data-testid="mcp-key-copy"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(copy);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "0123456789abcdef0123456789abcdef",
    );
  });
});

describe("McpServicePanel: 启动流程", () => {
  it("点击 start → 调 mcpStart + 重 probe", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: false, installed: true });
    await render();
    const start = container.querySelector('[data-testid="mcp-start"]') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    await act(async () => {
      fireClick(start);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(ipcMocks.mcpStart).toHaveBeenCalledTimes(1);
    expect(ipcMocks.mcpProbe.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("start 返 started:false → 展示错误条(probe 不再抹掉错误)", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: false, installed: true });
    ipcMocks.mcpStart.mockResolvedValue({ started: false, reason: "timeout" });
    await render();
    const start = container.querySelector('[data-testid="mcp-start"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(start);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    const err = container.querySelector('[data-testid="mcp-error"]') as HTMLElement | null;
    expect(err?.textContent ?? "").toContain("timeout");
  });

  it("点击 stop → 调 mcpStop(不传 pid 走缓存, round-2 BLOCKING-1)", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: true, installed: true });
    ipcMocks.mcpStop.mockResolvedValue({ stopped: true });
    await render();
    const stopBtn = container.querySelector('[data-testid="mcp-stop"]') as HTMLButtonElement;
    expect(stopBtn.disabled).toBe(false);
    await act(async () => {
      fireClick(stopBtn);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(ipcMocks.mcpStop).toHaveBeenCalledTimes(1);
    expect(ipcMocks.mcpStop).toHaveBeenCalledWith(); // 不传 pid(走主进程缓存)
  });

  it("stop 返 stopped:false → 展示错误条(round-2 BLOCKING-1 不许静默吞)", async () => {
    ipcMocks.mcpProbe.mockResolvedValue({ alive: true, installed: true });
    ipcMocks.mcpStop.mockResolvedValue({ stopped: false, reason: "pid_required" });
    await render();
    const stopBtn = container.querySelector('[data-testid="mcp-stop"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(stopBtn);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    const err = container.querySelector('[data-testid="mcp-error"]') as HTMLElement | null;
    expect(err?.textContent ?? "").toContain("pid_required");
  });
});

describe("McpServicePanel: 32hex key 二次确认 + 重生成", () => {
  it("点击 regen → 弹确认; 取消 → 不调 mcpGenKey", async () => {
    await render();
    const regen = container.querySelector('[data-testid="mcp-key-regen"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(regen);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    const confirmPanel = container.querySelector('[data-testid="mcp-regen-confirm-panel"]');
    expect(confirmPanel).toBeTruthy();
    const cancel = container.querySelector('[data-testid="mcp-regen-cancel"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(cancel);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(ipcMocks.mcpGenKey).not.toHaveBeenCalled();
  });

  it("确认 regen → 调 mcpGenKey + 重读 config + 展示提示", async () => {
    ipcMocks.mcpGetConfig
      .mockResolvedValueOnce({
        TOKEN_WALLET_MCP_KEY: "0123456789abcdef0123456789abcdef",
        TOKEN_WALLET_PORT: 9131,
        TOKEN_WALLET_HOST: "127.0.0.1",
        TOKEN_WALLET_DB_PATH: "/tmp/tw.db",
        USAGE_TTL_DAYS: 90,
        mcpEnvPath: "/x",
        installed: true,
      })
      .mockResolvedValueOnce({
        TOKEN_WALLET_MCP_KEY: "fedcba9876543210fedcba9876543210",
        TOKEN_WALLET_PORT: 9131,
        TOKEN_WALLET_HOST: "127.0.0.1",
        TOKEN_WALLET_DB_PATH: "/tmp/tw.db",
        USAGE_TTL_DAYS: 90,
        mcpEnvPath: "/x",
        installed: true,
      });
    await render();
    const regen = container.querySelector('[data-testid="mcp-key-regen"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(regen);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    const confirm = container.querySelector('[data-testid="mcp-regen-confirm"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(confirm);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(ipcMocks.mcpGenKey).toHaveBeenCalledTimes(1);
    expect(ipcMocks.mcpRestart).toHaveBeenCalledTimes(1); // BLOCKING-1: 真编排 restart
    const hint = container.querySelector('[data-testid="mcp-regen-hint"]') as HTMLElement | null;
    // daemon 在跑 + restart 成功 → 显示「自动重启」」提示文案, 不含「停止」
    expect(hint?.textContent ?? "").not.toContain("停止");
    expect(hint?.textContent ?? "").toContain("自动重启");
  });

  it("确认 regen → daemon 未跑 → 不调 mcpRestart + 提示手动 stop+start", async () => {
    ipcMocks.mcpGenKey.mockResolvedValueOnce({
      key: "fedcba9876543210fedcba9876543210",
      daemonWasRunning: false, // 未跑
    });
    await render();
    const regen = container.querySelector('[data-testid="mcp-key-regen"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(regen);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    const confirm = container.querySelector('[data-testid="mcp-regen-confirm"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(confirm);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(ipcMocks.mcpRestart).not.toHaveBeenCalled(); // 未跑不编排
    const hint = container.querySelector('[data-testid="mcp-regen-hint"]') as HTMLElement | null;
    // daemon 未跑 → 显示原「手动 stop+start」」提示
    expect(hint?.textContent ?? "").toContain("停止");
  });

  it("确认 regen → restart 失败 → 提示手动 + error 条", async () => {
    ipcMocks.mcpRestart.mockResolvedValueOnce({ restarted: false, started: false, reason: "still_alive" });
    await render();
    const regen = container.querySelector('[data-testid="mcp-key-regen"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(regen);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    const confirm = container.querySelector('[data-testid="mcp-regen-confirm"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(confirm);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(ipcMocks.mcpRestart).toHaveBeenCalledTimes(1);
    const hint = container.querySelector('[data-testid="mcp-regen-hint"]') as HTMLElement | null;
    // restart 失败 → 显示「restart failed + 手动 stop+start」文案
    expect(hint?.textContent ?? "").toContain("失败");
    expect(hint?.textContent ?? "").toContain("停止");
    const errEl = container.querySelector('[data-testid="mcp-error"]') as HTMLElement | null;
    expect(errEl?.textContent ?? "").toContain("still_alive");
  });
});

describe("McpServicePanel: autostart toggle", () => {
  it("点击 checkbox → 调 mcpSetAutostart(传新 boolean)", async () => {
    await render();
    const toggle = container.querySelector('[data-testid="mcp-autostart"]') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await act(async () => {
      // jsdom checkbox click: 自动 toggle + fire change, React onChange 接住
      fireClick(toggle);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(ipcMocks.mcpSetAutostart).toHaveBeenCalledWith(false);
  });
});

describe("McpServicePanel: open guide 回调", () => {
  it("点击 [查看安装步骤] → 触发 onGuideOpen", async () => {
    const onGuideOpen = vi.fn();
    await act(async () => {
      root.render(
        <LangProvider>
          <McpServicePanel onGuideOpen={onGuideOpen} />
        </LangProvider>,
      );
    });
    const btn = container.querySelector('[data-testid="mcp-open-guide"]') as HTMLButtonElement;
    await act(async () => {
      fireClick(btn);
    });
    expect(onGuideOpen).toHaveBeenCalledTimes(1);
  });
});
