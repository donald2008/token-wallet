import { expect as pwExpect } from "@playwright/test";
import { getCapturedInvokes } from "@srsholmes/tauri-playwright";
import { test } from "./fixtures";

/**
 * browser 模式冒烟(L2): mock IPC 注入 + 自动导航由 tauriPage fixture 完成;
 * 断言走原生 page(fixture 底层就是同一个 Playwright Page), 用标准 expect。
 * tauri/cdp 模式复用本用例时再切 tauriPage API(后置)。
 */

/** L2 冒烟: 窗口标题 + 首开隐私声明(D-021) */
test("首开: 隐私声明必须同意才能进面板", async ({ tauriPage, page }) => {
  void tauriPage;
  await pwExpect(page).toHaveTitle(/token-wallet/);
  await pwExpect(page.getByTestId("consent-page")).toBeVisible();
  await pwExpect(page.getByTestId("card-list")).toHaveCount(0);
  await page.getByTestId("consent-agree").click();
  // 初始零 provider 配置(§10): 同意后进入空态
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
});

/** L2 冒烟: 主题切换 + D-016 双 token 语义 */
test("主题切换: system→light/dark 生效且双 token 语义正确", async ({ tauriPage, page }) => {
  void tauriPage;
  // 固定系统主题为 dark, 让 system 模式的解析结果确定
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByTestId("consent-agree").click();

  const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme ?? "");
  const initial = await themeOf();
  pwExpect(initial).toBe("dark"); // system → 追随 prefers-color-scheme(dark)

  // 切换: system → light(覆盖), 必须脱离系统值
  await page.getByTestId("theme-toggle").click();
  const next = await themeOf();
  pwExpect(next).toBe("light");
  pwExpect(next).not.toBe(initial);

  // 双 token(D-016): --warn(填充) 与 --warn-fg(文字) 必须都有定义且不相等
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      warn: cs.getPropertyValue("--warn").trim(),
      warnFg: cs.getPropertyValue("--warn-fg").trim(),
    };
  });
  pwExpect(tokens.warn).toBeTruthy();
  pwExpect(tokens.warnFg).toBeTruthy();
  pwExpect(tokens.warn).not.toBe(tokens.warnFg);

  // 浅色主题下 warn 文字必须压深(D-016: 亮黄填充上文字深色)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  const lightWarnFg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--warn-fg").trim(),
  );
  pwExpect(lightWarnFg).toBe("#92600a");
});

/** L2 冒烟: 四色场景切换 → 标题栏全局状态点 + update_tray_status IPC(D-003) */
test("托盘四色联动: 场景切换驱动标题栏状态点与托盘 IPC", async ({ tauriPage, page }) => {
  void tauriPage;
  await page.getByTestId("consent-agree").click();
  const dot = page.getByTestId("status-dot").first();

  const cases: [string, string][] = [
    ["scenario-all-ok", "ok"],
    // auth_expired 定黄(§2.1 + P0-3 验收): 登录态失效非配额耗尽
    ["scenario-warn", "warn"],
    ["scenario-expired", "warn"],
    ["scenario-stale", "unknown"],
    ["scenario-error", "bad"],
  ];
  for (const [testid, expected] of cases) {
    await page.getByTestId(testid).click();
    await pwExpect(dot).toHaveAttribute("data-health", expected);
  }

  // 托盘 IPC: 前端把全局最差状态 + tooltip 摘要推给 Rust 侧
  const calls = await getCapturedInvokes(page);
  pwExpect(calls).toContainEqual(
    pwExpect.objectContaining({
      cmd: "update_tray_status",
      args: pwExpect.objectContaining({ status: "bad" }),
    }),
  );
  pwExpect(calls).toContainEqual(
    pwExpect.objectContaining({
      cmd: "update_tray_status",
      args: pwExpect.objectContaining({ status: "ok" }),
    }),
  );

  // tooltip 摘要语义("1偏低"类文案, §6.2)
  const warnCall = calls.find(
    (c) => c.cmd === "update_tray_status" && (c.args as { status?: string }).status === "warn",
  );
  pwExpect(warnCall).toBeTruthy();
  pwExpect(String((warnCall!.args as { tooltip?: string }).tooltip)).toContain("偏低");
});

/** L2 冒烟: mock 面板渲染 — 健康度排序 + 异常卡整卡文字, 不显示假数据(§2.1/§6.1) */
test("混合场景: auth_expired 黄灯+setup_hint 置顶, 异常卡不显示假数据", async ({ tauriPage, page }) => {
  void tauriPage;
  await page.getByTestId("consent-agree").click();
  await page.getByTestId("scenario-mixed").click();

  const cards = page.getByTestId("provider-card");
  await pwExpect(cards).toHaveCount(4);

  // 最坏情况优先: auth_expired 卡(黄 warn)置顶, 因 status 严重度排在 ok 态黄卡之前
  await pwExpect(cards.first()).toHaveAttribute("data-health", "warn");
  await pwExpect(cards.first()).toContainText("登录态过期");
  // auth_expired 亮黄灯 + setup_hint 恢复指引(§2.1)
  await pwExpect(cards.first().locator(`[data-lamp="auth_expired"]`)).toBeVisible();
  await pwExpect(cards.first().getByTestId("setup-hint")).toContainText("bl auth login --console");
  // 异常卡整卡文字替代图表: 不出现进度条/余额大数字(不显示假数据)
  await pwExpect(cards.first().locator(".progress")).toHaveCount(0);
  await pwExpect(cards.first().locator(".ticker-number")).toHaveCount(0);

  // 窗口卡(ok 态)有手写进度条(D-002)
  await pwExpect(page.getByTestId("bars-template").first().locator(".progress").first()).toBeVisible();
});

/** L2 冒烟: bars + ticker 两模板在 mock 数据下正确渲染(§6.3 / D-004) */
test("bars+ticker 模板: 进度条/倒计时/最紧标红 + 余额预计可用天数", async ({ tauriPage, page }) => {
  void tauriPage;
  await page.getByTestId("consent-agree").click();
  await page.getByTestId("scenario-mixed").click();

  // ticker 模板(balance): 剩余大数字 + 近 7 天速率预计可用天数
  const ticker = page.getByTestId("ticker-template");
  await pwExpect(ticker).toBeVisible();
  await pwExpect(ticker.getByTestId("ticker-days")).toContainText(/预计可用约 [\d.]+ 天/);
  await pwExpect(ticker.locator(".ticker-number")).toContainText("¥");

  // bars 模板(window): 多窗口各一条进度条 + 重置倒计时
  const bars = page.getByTestId("bars-template");
  await pwExpect(bars).toHaveCount(2); // kimi(window) + ark(window)
  const kimiBars = bars.first();
  await pwExpect(kimiBars.locator(".progress")).toHaveCount(2); // rolling_5h + weekly 两窗
  // 最紧窗口(rolling_5h 剩余<30%)置顶标红
  await pwExpect(kimiBars.locator(".bar-row[data-tightest] .bar-label")).toContainText("rolling_5h");
  // 重置倒计时("分钟后重置")存在
  await pwExpect(kimiBars.locator(".bar-reset").first()).toContainText("重置");
});
