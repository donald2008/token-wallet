/* eslint-disable no-console */
/**
 * README 截图产图 (t_3e7553e2 开源准备): 面板 dark/light 各一张 → docs/screenshots/
 * 用法: 先起 dev server (:1420, browser-only), 再 node e2e/capture-readme.cjs
 * 注: 适配 D-038 后 UI — 主题切换在设置页 theme-seg, 无 titlebar 主题钮。
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:1420";
const OUT = path.join(__dirname, "..", "..", "..", "docs", "screenshots");
// playwright 自带 chromium 优先, 兜底本机缓存路径(取证机无浏览器安装时)
const CHROME_CACHED = "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_CACHED) ? CHROME_CACHED : undefined,
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 640 },
    deviceScaleFactor: 2,
  });
  // 预置 consent = 已过首开: onAgree 会 setScenario("empty")(首开语义),
  // 预置后 initial scenario "mixed"(演示四态卡片) 得以保留, 走真实启动路径
  await ctx.addInitScript(() =>
    localStorage.setItem("token-wallet.consent.v1", "1"),
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const shot = (n) =>
    page.screenshot({ path: path.join(OUT, `${n}.png`) }).then(() => console.log("shot:", n));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // 生产构建里 ScenarioBar 因 import.meta.env.DEV=false 不渲染(dev-only 组件)。
  // browser 预览无该编译开关, 此处隐藏 = 忠实模拟生产形态, 非修饰。
  await page.addStyleTag({ content: ".scenario-bar { display: none !important; }" });

  // 已预置 consent → 无首开页, 初始场景即 mixed(dev 预览演示数据, App.tsx useState 初始值)
  await page.waitForTimeout(800);
  await shot("panel-light");

  // 设置页 → 主题切 dark → 回面板
  await page.click('[data-testid="settings-btn"]');
  await page.waitForTimeout(400);
  await page.click('[data-testid="theme-dark"]');
  await page.waitForTimeout(400);
  await page.click('[data-testid="add-close"]').catch(async () => {
    await page.keyboard.press("Escape");
  });
  await page.waitForTimeout(600);
  await shot("panel-dark");

  await browser.close();
  console.log("DONE ->", OUT);
})().catch((e) => {
  console.error("CAPTURE FAILED:", e);
  process.exit(1);
});
