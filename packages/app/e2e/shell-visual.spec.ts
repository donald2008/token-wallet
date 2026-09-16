/**
 * L2.5 真壳视觉验证(t_2520e5f1, 9/11 复盘用户拍板「最后一公里交给我」):
 * Playwright _electron.launch 驱动真壳(dist-electron/main.cjs), 在真实 BrowserWindow
 * 360×720 几何下做断言 + 截图。补 browser-only(mock 桥 + Desktop Chrome 默认 1280 视口)
 * 与 L4(Windows 人肉)之间的空洞 — 三连返工(tab 不切换/窗口截断/主题色不生效)都是
 * browser-only 不触发、真壳才现形的缺陷。
 *
 * 运行: pnpm --filter app test:e2e --project=electron-shell
 * 前置: pnpm -C packages/app build(产物 dist-electron/main.cjs + dist/index.html)
 *
 * 覆盖:
 *  ① 真窗口启动 → 主面板渲染(panel 可见 + 窗口内容区 360×720)
 *  ② 三主题(dark/light/glass)各一张截图落 verification/shell-visual/
 *  ③ Agent 卡 → 大屏独立窗口(真桥路径: 主进程 open_agent_dashboard 真开 900×560 窗)
 *  ④ tab 互斥(切「本地 Agent」→ 用量卡区不可见)
 *
 * IPC 策略: **真桥直通**(不用 mock 覆写 window.tokenWallet — preload 先于
 * addInitScript 注册, 覆写 = 真壳 IPC 全断链)。确定性数据从两个口进:
 *  - consent: 隔离 userData 预写 settings.json consentAgreed=true(E3 冒烟同配方)
 *  - daemon 用量: localStorage token-wallet.mock.mcp.usage **在真壳下无效**
 *    (真桥 mcp_usage_summary 读真 daemon)→ 大屏用例改走「数据面容错」断言:
 *    有数据验几何+数字, 无数据(daemon 未连)验空态显式渲染不静默 — 两者都是真壳
 *    真实行为, browser-only 的数据形状契约由 L2 兜底。
 *
 * 断言全部用几何探针(scrollWidth vs clientWidth / getBoundingClientRect / viewportSize)
 * + 截图, 不依赖 vision(vision 判定由 reviewer/老大侧做)。
 * 失败诊断: console error / pageerror 全收集 + 失败截图落 /tmp/shell-visual-fail/, 不静默。
 *
 * ⚠️ platform 守卫: Electron 驱动仅 Windows 本机可跑(见 playwright.config.ts 注释
 * 与 token-wallet skill 环境能力矩阵)。Linux 上本 spec 全部 skip 并输出说明 —
 * project 声明保留(配置无害), Linux/CI 照常全绿。
 * 诊断例外: PLAYWRIGHT_ELECTRON_FORCE=1 时 Linux 也真跑(xvfb 下观感不可信,
 * 断言以几何探针为准, 本机 CI 禁用)。
 */
import { test as electronTest, _electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SHOTS_DIR = path.join(import.meta.dirname, "..", "verification", "shell-visual");

/** 真壳 spec 用独立 test 命名空间(不用 fixtures 的 hostPage — 那是 browser-only 的 webServer 路径) */
const t = electronTest;

/** Linux/CI 守卫: 非 win32 全 skip + 说明(L4 环境能力矩阵)。 */
t.skip(
  process.platform !== "win32" && process.env.PLAYWRIGHT_ELECTRON_FORCE !== "1",
  "electron-shell 真壳视觉验证仅 Windows 本机可跑(Linux xvfb 无边框透明窗口观感不可验); Linux/CI 跑 browser-only project",
);

/** 失败诊断: console error + pageerror 收集, 失败时落 /tmp 诊断截图(不静默) */
const consoleErrors: string[] = [];
const pageErrors: string[] = [];

t.beforeEach(() => {
  consoleErrors.length = 0;
  pageErrors.length = 0;
});

async function diagnoseOnFail(page: Page, testName: string): Promise<void> {
  try {
    const dir = path.join("/tmp", "shell-visual-fail");
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${testName}.png`), fullPage: true });
  } catch {
    /* 窗口可能已关 */
  }
  const report = [
    ...consoleErrors.map((e) => `[console.error] ${e}`),
    ...pageErrors.map((e) => `[pageerror] ${e}`),
  ];
  if (report.length > 0) console.log(`[shell-visual 诊断]\n${report.join("\n")}`);
}

/** 预写隔离 userData settings.json(consentAgreed=true)。
 *  与 E3 生产冒烟测试法同配方: 真桥 get_bootstrap 读 settings.json → firstRun=false,
 *  主面板直接可见(不经首开向导)。每次用例独立临时目录, 互不污染真机数据。
 *  ⚠️ Electron userData 路径 Linux = $XDG_CONFIG_HOME/token-wallet(未设则
 *  $HOME/.config/token-wallet), Windows = %APPDATA%\token-wallet — 只重定向 HOME
 *  不够(实测 userData 仍落 $HOME/.config), 必须显式 XDG_CONFIG_HOME(Win 用 APPDATA)。
 *  双候选预写($HOME/token-wallet + $HOME/.config/token-wallet)是防御性冗余,
 *  写两次零成本, 哪处命中用哪处。 */
function prepareUserData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-shell-visual-"));
  const settings = JSON.stringify({
    version: 1,
    consentAgreed: true,
    consentAt: Math.floor(Date.now() / 1000),
  });
  const candidates =
    process.platform === "win32"
      ? [path.join(dir, "token-wallet")]
      : [
          path.join(dir, ".config", "token-wallet"),
          path.join(dir, "token-wallet"),
        ];
  for (const c of candidates) {
    fs.mkdirSync(c, { recursive: true });
    fs.writeFileSync(path.join(c, "settings.json"), settings);
  }
  return dir;
}

/**
 * 启动真壳: _electron.launch 驱动 dist-electron/main.cjs(package.json main)。
 * userData 隔离: --user-data-dir 不被 Electron 主进程 app.setPath 尊重(token-wallet
 * 显式 app.setName("token-wallet")), 改用 env HOME/APPDATA 重定向 = 跨平台 userData
 * 隔离(Windows 上 APPDATA 重定向即 %APPDATA%\token-wallet 落临时目录)。
 * 不注入 mock 桥 — 真桥(preload)直通主进程, 数据面行为全是真壳真实行为。
 */
async function launchShell(): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const appRoot = path.join(import.meta.dirname, "..");
  const userData = prepareUserData();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  if (process.platform === "win32") {
    env.APPDATA = userData;
  } else {
    env.HOME = userData;
    env.XDG_CONFIG_HOME = path.join(userData, ".config");
  }
  const app = await _electron.launch({ args: [appRoot], env });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return { app, page, userData };
}

/** 三主题统一入口: 预置主题 localStorage → reload → 等 panel-main 渲染。
 *  (theme.ts 走 localStorage, 真桥不参与主题 — browser-only 与真壳同语义)
 *  glassAlpha: 玻璃透明度(0.15~1, 默认 1.0 = 不透明)。默认值下 dark-glass 与 dark
 *  渲染像素完全一致(theme.ts GLASS_ALPHA_DEFAULT=1, t_c20d4d11 用户拍板)——本层要
 *  验「主题真渲染」, 玻璃用例显式给中间值 0.5, 让 glass 截图与 dark 有可判别差异。 */
async function applyTheme(page: Page, theme: string, glass: string, glassAlpha?: string): Promise<void> {
  await page.evaluate(
    ([th, gl, ga]) => {
      localStorage.setItem("token-wallet.theme.v1", th as string);
      localStorage.setItem("token-wallet.glass.v1", gl as string);
      if (ga) localStorage.setItem("token-wallet.glassAlpha.v1", ga as string);
    },
    [theme, glass, glassAlpha ?? ""],
  );
  await page.reload();
  await page.waitForSelector('[data-testid="panel-main"]', { state: "visible", timeout: 15_000 });
}

/** 关壳 + 清理临时 userData(测试结束统一调用, 防泄漏)。
 *  ⚠️ app.close() 在 xvfb/单例锁场景会挂 ~59s(优雅退出等待, 本机实证)→ 30s 测试
 *  超时被 close 拖死。真壳进程直接 SIGKILL(单用例独立 userData, 无状态需要优雅落盘),
 *  Windows 同样适用(process() 返回主进程句柄)。 */
async function closeShell(app: ElectronApplication, userData: string): Promise<void> {
  try {
    app.process().kill("SIGKILL");
    // 等 kill 生效(防下一用例 SingletonLock 残留)
    await new Promise<void>((resolve) => {
      const proc = app.process();
      if (proc.exitCode !== null) return resolve();
      proc.once("exit", () => resolve());
      setTimeout(resolve, 3000);
    });
  } catch {
    try {
      await app.close();
    } catch {
      /* already closed */
    }
  }
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** 几何探针: 元素零横向溢出(360 部件窗口截断类缺陷的判别探针) */
async function noHorizontalOverflow(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5);
}

/** ①+②: 真窗口启动 → 主面板渲染 + 三主题截图门禁。
 *  ⚠️ 真壳跑生产构建(dist/index.html, isProd=true)→ 零实例走 EmptyState(暂无 Provider),
 *  card-list 不渲染(P0-8 生产 mock 门禁); browser-only 跑 vite dev 才有 mixed 演示卡。
 *  本用例断言主面板骨架 + 主题, 不依赖卡片数据。 */
for (const [name, theme, glass, glassAlpha] of [
  ["dark", "dark", "0", ""],
  ["light", "light", "0", ""],
  ["glass", "dark", "1", "0.5"],
] as const) {
  t(`真壳启动 → 主面板渲染 + 三主题截图(${name})`, async () => {
    const { app, page, userData } = await launchShell();
    try {
      await applyTheme(page, theme, glass, glassAlpha);

      // ① 主面板渲染断言: panel + panel-main + bottombar + EmptyState(生产零实例空态)
      const panel = page.locator(".panel");
      await expect(panel).toBeVisible();
      await expect(page.getByTestId("panel-main")).toBeVisible();
      await expect(page.getByTestId("bottombar")).toBeVisible();
      await expect(page.getByTestId("empty-state")).toBeVisible();

      // 窗口几何: frame:false 无边框, Electron 页面无 CSS 视口概念(viewportSize()
      // 返回 null)→ 用 DOM 根元素盒模型测真实窗口内容区(main.ts BrowserWindow 360×720)
      const winBox = await page.evaluate(() => ({
        w: document.documentElement.clientWidth,
        h: document.documentElement.clientHeight,
      }));
      expect(winBox.w, "真壳窗口内容区宽应 = 360").toBe(360);
      expect(winBox.h, "真壳窗口内容区高应 = 720").toBe(720);

      // 几何探针: panel 不横向溢出
      expect(await noHorizontalOverflow(page, ".panel"), "panel 横向溢出(窗口截断类缺陷)").toBe(true);

      // html data-theme 断言(主题真渲染的 DOM 锚, 与截图交叉验证)
      const expectTheme = glass === "1" ? "dark-glass" : theme;
      await expect(page.locator("html")).toHaveAttribute("data-theme", expectTheme);

      // 玻璃用例: alpha 真落到 CSS 变量(theme.ts useEffect → <html style="--glass-alpha">)
      // + 截图与 dark 有可判别差异(主题真渲染, 非仅 DOM 属性)
      if (glass === "1") {
        const alphaVar = await page.evaluate(() =>
          document.documentElement.style.getPropertyValue("--glass-alpha"),
        );
        expect(alphaVar, "玻璃 alpha 未落到 --glass-alpha CSS 变量").toBe(glassAlpha);
      }

      // ② 截图落盘
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      await page.waitForTimeout(700); // 等动画/字体落定
      await page.locator(".panel").screenshot({ path: path.join(SHOTS_DIR, `shell-${name}.png`) });
    } catch (e) {
      await diagnoseOnFail(page, `startup-${name}`);
      throw e;
    } finally {
      await closeShell(app, userData);
    }
  });
}

/** ③: Agent 卡 → 大屏独立窗口(真桥路径)。
 *  daemon 数据面按「有数据/未连接」双态容错断言 — 两者都是真壳真实行为:
 *  - 有数据: 点详情 → 主进程真开 900×560 独立窗 → hero 渲染 + 零溢出
 *  - 未连接: 空态显式渲染(不静默吞成 0), detail 按钮不存在 → 断言空态卡可见 */
t("真壳真桥: Agent 卡详情 → 主进程开 900×560 独立大屏窗", async () => {
  const { app, page, userData } = await launchShell();
  try {
    await applyTheme(page, "dark", "0");
    // 等 Agent 用量区出结果(有数据出卡 / 未连接出空态卡, 二选一)
    await page.waitForSelector(
      '[data-testid="agent-card"], [data-testid="agent-card-empty"]',
      { state: "visible", timeout: 15_000 },
    );
    const hasData = (await page.locator('[data-testid="agent-card"]').count()) > 0;

    if (hasData) {
      // 有 daemon 数据 → 走完整关键路径
      const firstCard = page.locator('[data-testid="agent-card"]').first();
      const agentId = await firstCard.getAttribute("data-agent");
      // token 全数字契约(无 K/M 简写)在真壳同样成立
      const tokensText = (await firstCard.locator('[data-testid="agent-tokens"]').textContent()) ?? "";
      expect(tokensText, "真壳 Agent 卡出现 K/M 简写").not.toMatch(/\d+\.?\d*K\b|\d+\.?\d*M\b/);

      // 点详情 → open_agent_dashboard 真桥 → 主进程开独立窗
      await page.getByTestId(`agent-detail-${agentId}`).click();
      const dashPage = await app.waitForEvent("window", { timeout: 15_000 });
      await dashPage.waitForLoadState("domcontentloaded");

      // 独立窗几何: 900×560(useContentSize: true → 内容区即 900×560)。
      // t_e83ad982: 窗口壳 640→560(高度预算法 comment 1497), 真壳断言同步。
      // Electron 页面无 CSS 视口概念(viewportSize() null)→ DOM 根盒模型测内容区。
      const vp = await dashPage.evaluate(() => ({
        w: document.documentElement.clientWidth,
        h: document.documentElement.clientHeight,
      }));
      expect(vp.w, `大屏独立窗内容区宽应 = 900, 实际 ${vp.w}`).toBe(900);
      expect(vp.h, `大屏独立窗内容区高应 = 560, 实际 ${vp.h}`).toBe(560);

      // 独立窗内大屏渲染(?view=agent-dashboard&standalone=1 双参数)
      await dashPage.waitForSelector('[data-testid="agent-dashboard-c"]', { state: "visible", timeout: 15_000 });
      // standalone 窗口 chrome(dash-chrome)挂载(t_185002af)
      await expect(dashPage.getByTestId("dash-chrome")).toBeVisible();

      // 几何探针: 独立窗内大屏零横向溢出
      const ok = await dashPage
        .getByTestId("agent-dashboard-c")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5);
      expect(ok, "独立 900 窗内大屏横向溢出").toBe(true);

      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      await dashPage.waitForTimeout(900); // chart.js canvas 异步绘制
      await dashPage
        .locator(".panel")
        .screenshot({ path: path.join(SHOTS_DIR, "shell-dashboard-standalone.png") });
    } else {
      // daemon 未连接 → 空态显式渲染契约(真壳行为, 不静默吞成 0)
      await expect(page.getByTestId("agent-card-empty")).toBeVisible();
      await expect(page.getByTestId("agent-empty-reason")).toContainText("daemon");
      expect(await page.locator('[data-testid="agent-card"]').count()).toBe(0);
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      await page.locator(".panel").screenshot({ path: path.join(SHOTS_DIR, "shell-agent-empty.png") });
    }
  } catch (e) {
    await diagnoseOnFail(page, "standalone-window");
    throw e;
  } finally {
    await closeShell(app, userData);
  }
});

/** ④: tab 互斥 — 切「本地 Agent」→ 用量卡区不可见(不依赖 IPC 数据, 真桥/无数据都可断言)。
 *  ⚠️ 真壳生产构建零实例 → EmptyState 非 card-list(P0-8 生产 mock 门禁, probe 实测),
 *  互斥断言锚 LocalAgentSection vs EmptyState + agent-card-section。 */
t("真壳 tab 互斥: 切「本地 Agent」→ 用量视图不可见 + LocalAgentSection 可见", async () => {
  const { app, page, userData } = await launchShell();
  try {
    await applyTheme(page, "dark", "0");

    // 主面板: 用量 tab 默认激活 + 空态(生产零实例)
    await expect(page.getByTestId("main-tab-usage")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("empty-state")).toBeVisible();

    // 切「本地 Agent」→ 用量侧全部卸载 + LocalAgentSection 挂载(互斥, round-4 ④ 契约)
    await page.getByTestId("main-tab-local-agent").click();
    await expect(page.getByTestId("main-tab-local-agent")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("main-tab-usage")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("empty-state")).toHaveCount(0);
    await expect(page.getByTestId("agent-card-section")).toHaveCount(0);
    await expect(page.getByTestId("local-agent-section")).toBeVisible();

    // 几何探针: 切换后 panel 仍零横向溢出
    expect(await noHorizontalOverflow(page, ".panel"), "tab 切换后 panel 横向溢出").toBe(true);

    // 切回用量 → LocalAgentSection 卸载 + EmptyState 回归
    await page.getByTestId("main-tab-usage").click();
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await expect(page.getByTestId("local-agent-section")).toHaveCount(0);
  } catch (e) {
    await diagnoseOnFail(page, "tab-mutex");
    throw e;
  } finally {
    await closeShell(app, userData);
  }
});
