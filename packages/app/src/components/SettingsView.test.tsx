// @vitest-environment jsdom
/**
 * L1(D-038): 设置页瘦身为**纯偏好页** —— provider 管理(添加入口 / 实例列表 / 增删按钮)
 * 必须彻底消失, 通用偏好(主题/排序/开机自启/存储路径)必须全在;
 * 弹窗结构(head 固定 + body 滚动)不变(#829 R3)。
 * D-046: 关于区自动更新四态(unavailable/检查/发现→下载→就绪/error)由状态机驱动渲染。
 * t_c20d4d11 round-3 B3-2: 玻璃态 overlay backdrop-filter 兜底 CSS 契约。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMocks = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  getStoragePaths: vi.fn(),
  getLaunchAtLogin: vi.fn(),
  setLaunchAtLogin: vi.fn(),
  onUpdaterEvent: vi.fn(() => () => {}),
  updaterCheck: vi.fn(),
  updaterDownload: vi.fn(),
  updaterInstall: vi.fn(),
  // Phase B: 语言持久化(设置页切换时回写, 真壳 settings.json / 浏览器 localStorage)
  setLangPersisted: vi.fn(),
  // D-055 / t_4bd214de: MCP daemon 桥 mock(供 SettingsView 嵌入的 McpServicePanel 调用)
  mcpProbe: vi.fn(),
  mcpStart: vi.fn(),
  mcpStop: vi.fn(),
  mcpGetConfig: vi.fn(),
  mcpGenKey: vi.fn(),
  mcpGetAutostart: vi.fn(),
  mcpSetAutostart: vi.fn(),
  mcpGetGuide: vi.fn(),
  maskMcpKey: (key: string): string => {
    if (key.length <= 12) return "•".repeat(key.length);
    return `${key.slice(0, 4)}-••••-••••-••••-${key.slice(-4)}`;
  },
}));

vi.mock("../ipc", () => ipcMocks);

import { SettingsView } from "./SettingsView";
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
  // 语言态复位(模块级 + localStorage, 防跨用例串扰); D-046 mock 缺省: 真壳形态(版本 0.2.0 / updater 初始 up-to-date)
  setLang("zh");
  ipcMocks.setLangPersisted.mockResolvedValue(undefined);
  ipcMocks.getBootstrap.mockResolvedValue({ firstRun: false, theme: "system", version: "0.2.0" });
  ipcMocks.getStoragePaths.mockResolvedValue({ configDir: "/cfg/token-wallet", dataDir: "/data/token-wallet" });
  ipcMocks.getLaunchAtLogin.mockResolvedValue(false);
  ipcMocks.updaterCheck.mockResolvedValue({ status: "up-to-date" });
  ipcMocks.updaterDownload.mockResolvedValue({ status: "downloading", percent: 0 });
  // D-055 / t_4bd214de: MCP 默认 happy path mock, 各 it 单独覆盖
  ipcMocks.mcpProbe.mockResolvedValue({ alive: true, installed: true });
  ipcMocks.mcpGetConfig.mockResolvedValue({
    TOKEN_WALLET_MCP_KEY: "0123456789abcdef0123456789abcdef",
    TOKEN_WALLET_PORT: 9131,
    TOKEN_WALLET_HOST: "127.0.0.1",
    TOKEN_WALLET_DB_PATH: "/data/tw.db",
    USAGE_TTL_DAYS: 90,
    mcpEnvPath: "/cfg/mcp.env",
    installed: true,
  });
  ipcMocks.mcpGetAutostart.mockResolvedValue({ mcpAutostart: true, osAutostart: true });
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
        glass={false}
        onGlass={() => {}}
        glassAlpha={1.0}
        onGlassAlpha={() => {}}

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

  it("通用偏好全在: 主题 / 排序(仅手动提示, 无选择控件) / 开机自启 / 存储路径", async () => {
    const view = await renderSettings();
    for (const id of [
      "theme-seg",
      "sort-sec",
      "autostart-sec",
      "autostart-toggle",
      "storage-paths",
      "config-dir",
      "data-dir",
    ]) {
      expect(view.querySelector(`[data-testid="${id}"]`), `${id} 必须保留`).toBeTruthy();
    }
    // t_d086543b: 排序只留手动 —— 选择控件(sort-key-*/sort-dir-*)全部移除
    expect(view.querySelector('[data-testid="sort-key-seg"]')).toBeNull();
    expect(view.querySelector('[data-testid="sort-dir-seg"]')).toBeNull();
    expect(view.querySelector('[data-testid^="sort-key-"]')).toBeNull();
    expect(view.querySelector('[data-testid^="sort-dir-"]')).toBeNull();
    // 排序区只有提示性文案(手动 = 拖拽排序)
    expect(view.textContent).toContain("拖动卡片");
    // 主题三态入口在设置页(标题栏 ☀ 快切与此处同 state)
    for (const id of ["theme-system", "theme-light", "theme-dark"]) {
      expect(view.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
    }
    // Phase B: 语言分段控件(zh/en)在设置页
    for (const id of ["lang-sec", "lang-seg", "lang-zh", "lang-en"]) {
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

// ---- t_d086543b: 排序只留手动 —— 设置页排序区只有提示性文案, 无选择控件 ----
describe("排序区只留手动提示(t_d086543b)", () => {
  async function renderSort(): Promise<HTMLElement> {
    await act(async () => {
      root.render(
        <SettingsView
          variant="modal"
          themeMode="system"
          onThemeMode={() => {}}
          glass={false}
          onGlass={() => {}}
        glassAlpha={1.0}
        onGlassAlpha={() => {}}
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

  it("排序段保留(sort-sec), 提示文案含「手动/拖动」; 无任何排序选择控件", async () => {
    const view = await renderSort();
    const sec = view.querySelector('[data-testid="sort-sec"]')!;
    expect(sec).toBeTruthy();
    expect(sec.textContent).toContain("排序");
    expect(sec.textContent).toContain("拖动");
    for (const id of [
      "sort-key-seg",
      "sort-dir-seg",
      "sort-key-name",
      "sort-key-urgency",
      "sort-key-manual",
      "sort-dir-asc",
      "sort-dir-desc",
    ]) {
      expect(view.querySelector(`[data-testid="${id}"]`), `${id} 必须移除`).toBeNull();
    }
  });
});

// ---- D-046: 关于区自动更新(当前版本 + 检查/下载/安装 三动作 + 状态机渲染) ----
describe("自动更新四态(D-046)", () => {
  async function renderForUpdater(): Promise<HTMLElement> {
    await act(async () => {
      root.render(
        <SettingsView
          variant="modal"
          themeMode="system"
          onThemeMode={() => {}}
        glass={false}
        onGlass={() => {}}
        glassAlpha={1.0}
        onGlassAlpha={() => {}}

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

  it("当前版本显示 v0.2.0(来自 get_bootstrap)", async () => {
    const view = await renderForUpdater();
    expect(view.querySelector('[data-testid="about-version"]')!.textContent).toBe("v0.2.0");
  });

  it("dev/unavailable 态: 无更新按钮, 显式文案(不假装能更新)", async () => {
    ipcMocks.updaterCheck.mockResolvedValue({ status: "unavailable" });
    const view = await renderForUpdater();
    const state = view.querySelector('[data-testid="updater-state"]')!;
    expect(state.getAttribute("data-updater-status")).toBe("unavailable");
    expect(view.querySelector('[data-testid="updater-check-btn"]')).toBeNull();
    expect(view.querySelector('[data-testid="updater-download-btn"]')).toBeNull();
  });

  it("up-to-date 态: 渲染「检查更新」钮, 点击触发 updaterCheck", async () => {
    const view = await renderForUpdater();
    const btn = view.querySelector<HTMLButtonElement>('[data-testid="updater-check-btn"]')!;
    expect(btn.textContent).toBe("检查更新");
    ipcMocks.updaterCheck.mockClear();
    act(() => btn.click());
    expect(ipcMocks.updaterCheck).toHaveBeenCalled();
  });

  it("available 态: 「更新到 v0.2.1」钮, 点击触发 updaterDownload", async () => {
    ipcMocks.updaterCheck.mockResolvedValue({ status: "available", version: "0.2.1" });
    const view = await renderForUpdater();
    const btn = view.querySelector<HTMLButtonElement>('[data-testid="updater-download-btn"]')!;
    expect(btn.textContent).toBe("更新到 v0.2.1");
    ipcMocks.updaterDownload.mockClear();
    act(() => btn.click());
    expect(ipcMocks.updaterDownload).toHaveBeenCalled();
  });

  it("downloading 态: 进度文案(主进程事件推送驱动, 无按钮)", async () => {
    ipcMocks.updaterCheck.mockResolvedValue({ status: "downloading", percent: 42 });
    const view = await renderForUpdater();
    const state = view.querySelector('[data-testid="updater-state"]')!;
    expect(state.getAttribute("data-updater-status")).toBe("downloading");
    expect(state.textContent).toContain("42%");
    expect(view.querySelector("button[data-testid^='updater-']")).toBeNull();
  });

  it("ready 态: 「重启安装 v0.2.1」钮, 点击触发 updaterInstall", async () => {
    ipcMocks.updaterCheck.mockResolvedValue({ status: "ready", version: "0.2.1" });
    const view = await renderForUpdater();
    const btn = view.querySelector<HTMLButtonElement>('[data-testid="updater-install-btn"]')!;
    expect(btn.textContent).toBe("重启安装 v0.2.1");
    ipcMocks.updaterInstall.mockClear();
    act(() => btn.click());
    expect(ipcMocks.updaterInstall).toHaveBeenCalled();
  });

  it("error 态: 显式失败文案 + 无危险按钮(可再检查恢复)", async () => {
    ipcMocks.updaterCheck.mockResolvedValue({ status: "error", message: "boom" });
    const view = await renderForUpdater();
    const state = view.querySelector('[data-testid="updater-state"]')!;
    expect(state.getAttribute("data-updater-status")).toBe("error");
    expect(view.querySelector('[data-testid="updater-download-btn"]')).toBeNull();
    expect(view.querySelector('[data-testid="updater-install-btn"]')).toBeNull();
  });

  it("主进程事件推送驱动状态切换(available → downloading 模拟下载进度)", async () => {
    ipcMocks.updaterCheck.mockResolvedValue({ status: "available", version: "0.2.1" });
    const view = await renderForUpdater();
    expect(view.querySelector('[data-testid="updater-download-btn"]')).toBeTruthy();
    // 模拟主进程 webContents.send 推送: 取 onUpdaterEvent 注册的回调直接调
    const register = ipcMocks.onUpdaterEvent as unknown as {
      mock: { calls: [cb: (e: unknown) => void][] };
    };
    const cb = register.mock.calls.at(-1)![0];
    act(() => cb({ status: "downloading", percent: 77 }));
    const state = view.querySelector('[data-testid="updater-state"]')!;
    expect(state.textContent).toContain("77%");
  });
});

// ---- Phase B(i18n): 语言分段控件(zh/en, 主题同款 seg) + 切换即时生效 + settings.json 回写 ----
describe("语言分段控件(Phase B i18n)", () => {
  /** 语言测试必须包 LangProvider: 无 Provider 时 useLang 兜底不触发重渲染 */
  async function renderWithLangProvider(): Promise<HTMLElement> {
    await act(async () => {
      root.render(
        <LangProvider>
          <SettingsView
            variant="modal"
            themeMode="system"
            onThemeMode={() => {}}
        glass={false}
        onGlass={() => {}}
        glassAlpha={1.0}
        onGlassAlpha={() => {}}

            onBack={() => {}}
          />
        </LangProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return container.querySelector<HTMLElement>('[data-testid="settings-view"]')!;
  }

  it("默认 zh: lang-zh active, 标题文案中文", async () => {
    setLang("zh");
    const view = await renderWithLangProvider();
    const zhBtn = view.querySelector<HTMLButtonElement>('[data-testid="lang-zh"]')!;
    const enBtn = view.querySelector<HTMLButtonElement>('[data-testid="lang-en"]')!;
    expect(zhBtn.className).toContain("active");
    expect(enBtn.className).not.toContain("active");
    expect(zhBtn.textContent).toBe("简体中文");
    expect(enBtn.textContent).toBe("English");
    // 设置页标题用字典键(zh)
    expect(view.querySelector("h3")!.textContent).toBe("设置");
  });

  it("点击 en → Provider 重渲染立即生效(标题变 Theme) + setLangPersisted 回写", async () => {
    setLang("zh");
    const view = await renderWithLangProvider();
    ipcMocks.setLangPersisted.mockClear();
    act(() => {
      view.querySelector<HTMLButtonElement>('[data-testid="lang-en"]')!.click();
    });
    // 即时生效: 语言段 active 转移 + 全页文案英文(LangProvider 重渲染)
    expect(view.querySelector<HTMLButtonElement>('[data-testid="lang-en"]')!.className).toContain("active");
    expect(view.querySelector<HTMLButtonElement>('[data-testid="lang-zh"]')!.className).not.toContain("active");
    expect(view.querySelector("h3")!.textContent).toBe("Settings");
    // 各 section 标题: 主题/语言/排序/自启 依序
    const h4s = Array.from(view.querySelectorAll("h4")).map((el) => el.textContent);
    expect(h4s[0]).toBe("Theme");
    expect(h4s[1]).toBe("Language");
    // 持久化回写(真壳 settings.json RMW 由 set_lang 通道完成)
    expect(ipcMocks.setLangPersisted).toHaveBeenCalledWith("en");
    // 主题/排序(手动提示)/更新控件文案同步英文
    expect(view.querySelector('[data-testid="sort-sec"]')!.textContent).toContain("Sort order");
    expect(view.querySelector('[data-testid="sort-sec"]')!.textContent).toContain("drag");
    expect(view.querySelector('[data-testid="updater-check-btn"]')!.textContent).toBe("Check for updates");
    // 复位(防串扰后续用例)
    setLang("zh");
  });

  it("再点 zh → 切回中文 + setLangPersisted('zh') 回写", async () => {
    setLang("en");
    const view = await renderWithLangProvider();
    ipcMocks.setLangPersisted.mockClear();
    act(() => {
      view.querySelector<HTMLButtonElement>('[data-testid="lang-zh"]')!.click();
    });
    expect(view.querySelector<HTMLButtonElement>('[data-testid="lang-zh"]')!.className).toContain("active");
    expect(view.querySelector("h3")!.textContent).toBe("设置");
    expect(ipcMocks.setLangPersisted).toHaveBeenCalledWith("zh");
    setLang("zh");
  });
});

// ---- CSS 契约: 玻璃态 settings-modal backdrop-filter 兜底(t_c20d4d11 round-3 B3-2) ----
describe("玻璃态 settings-modal backdrop-filter 兜底(B3-2, t_c20d4d11 round-3)", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app.css"), "utf8");

  // 玻璃态下 .settings-modal 自身必须挂 backdrop-filter: var(--card-blur), 让透出内容退化为色块。
  // 15% 档 modal 自身 15% 半透明底色 + 背后模糊色块 → 文字可读, 消除 dashboard 锐利叠影。
  // ⚠️ blur 必须挂 modal 而非 overlay: overlay 是 .panel 子级, 而 .panel 已挂 backdrop-filter
  // (L79-82) 成为 backdrop root —— 子级 overlay 再挂 blur 被 Chromium 采样截断(实测无效);
  // blur 挂 modal 自身时 modal 矩形区域背景整块模糊成色块, 前景文字锐利可读。
  // dark/light 玻璃主题共用一套规则(backdrop-filter 与主题色无关, 只对底层内容模糊)。
  it("dark-glass / light-glass 下 .settings-modal 必须挂 backdrop-filter var(--card-blur)", () => {
    expect(css).toMatch(
      /:root\[data-theme="dark-glass"\]\s+\.settings-modal[\s\S]*?backdrop-filter:\s*var\(--card-blur\)/,
    );
    expect(css).toMatch(
      /:root\[data-theme="light-glass"\]\s+\.settings-modal[\s\S]*?backdrop-filter:\s*var\(--card-blur\)/,
    );
    // 同时挂 -webkit-backdrop-filter(覆盖 Safari 旧版 + WebView2 兼容, 与 .panel L81-82 同形态)
    expect(css).toMatch(
      /:root\[data-theme="dark-glass"\]\s+\.settings-modal[\s\S]*?-webkit-backdrop-filter:\s*var\(--card-blur\)/,
    );
    expect(css).toMatch(
      /:root\[data-theme="light-glass"\]\s+\.settings-modal[\s\S]*?-webkit-backdrop-filter:\s*var\(--card-blur\)/,
    );
  });

  // blur 挂 modal 自身而非 overlay: overlay 是 .panel 子级, panel 已挂 blur 成 backdrop root,
  // overlay 再挂 blur 会被 Chromium 采样截断(形同虚设, A/B M3 实测)。modal 自身的 blur 把
  // modal 矩形区域背景(卡片+文字+黑罩)整块模糊 → 透出 dashboard 退化为色块。
  it("glass 态 blur 规则挂 .settings-modal 而非 .settings-overlay", () => {
    // overlay 基块(非 glass 态)保持原样, 不应夹带 glass 态 backdrop-filter
    const overlayBlock = (() => {
      const m = css.match(/\.settings-overlay\s*\{([^}]*)\}/);
      expect(m, ".settings-overlay 规则块必须存在").toBeTruthy();
      return m![1];
    })();
    expect(overlayBlock).not.toContain("backdrop-filter");
    // glass 态下不得再有 .settings-overlay backdrop-filter 规则(旧方案残留, 截断无效)
    expect(css).not.toMatch(
      /:root\[data-theme="(dark|light)-glass"\]\s+\.settings-overlay[\s\S]*?backdrop-filter:/,
    );
  });

  // 兜底必须正交于 alpha 滑槽: backdrop-filter 不依赖 var(--glass-alpha), 即使
  // alpha=1.0(默认不透明)也常开 → 与用户拍板「拖低才出现玻璃感, blur 常开留档」一致
  it("backdrop-filter 不引用 var(--glass-alpha)(兜底常开, 不受滑槽影响)", () => {
    // 抽出所有 dark-glass/light-glass 下的 modal 规则, 验证不含 --glass-alpha
    const modalRule = css.match(
      /:root\[data-theme="(dark|light)-glass"\]\s+\.settings-modal\s*\{([^}]*)\}/g,
    );
    expect(modalRule, "glass 态 settings-modal 规则必须存在").toBeTruthy();
    for (const rule of modalRule!) {
      expect(rule, "modal 兜底规则不应引用 --glass-alpha").not.toContain("--glass-alpha");
    }
  });
});

describe("MCP 服务区块(D-055 / t_4bd214de)", () => {
  it("mcp-sec 区块存在 + 嵌入 McpServicePanel", async () => {
    const view = await renderSettings();
    const sec = view.querySelector('[data-testid="mcp-sec"]');
    expect(sec).toBeTruthy();
    const panel = sec?.querySelector('[data-testid="mcp-panel"]');
    expect(panel, "McpServicePanel 必须嵌入 mcp-sec 内").toBeTruthy();
  });

  it("mcp 区块包含状态点 + 启停按钮 + 自启 toggle + key 行 + 引导入口", async () => {
    const view = await renderSettings();
    const panel = view.querySelector('[data-testid="mcp-panel"]');
    expect(panel?.querySelector('[data-testid="mcp-status"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="mcp-start"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="mcp-stop"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="mcp-autostart"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="mcp-endpoint"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="mcp-key-masked"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="mcp-open-guide"]')).toBeTruthy();
  });
});
