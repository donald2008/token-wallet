/* eslint-disable no-console */
/**
 * README 截图产图 (v0.2.8 更新): 面板 dark/light/glass 三张 → docs/screenshots/
 * 用法: 先起 dev server (:1420, browser-only), 再 node e2e/capture-readme.cjs
 * 口径: 360×720 视口 (README 所述桌面部件尺寸), deviceScaleFactor 2 高清
 * 三主题: light(默认) / dark / glass(玻璃 50% 透明度演示)
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
    viewport: { width: 360, height: 720 },
    deviceScaleFactor: 2,
  });
  // 预置 consent = 已过首开 + 默认 light 主题 + glass 默认关
  await ctx.addInitScript(() => {
    localStorage.setItem("token-wallet.consent.v1", "1");
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const shot = (n) =>
    page.screenshot({ path: path.join(OUT, `${n}.png`) }).then(() => console.log("shot:", n));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // 生产构建里 ScenarioBar 因 import.meta.env.DEV=false 不渲染(dev-only 组件)。
  // browser 预览无该编译开关, 此处隐藏 = 忠实模拟生产形态, 非修饰。
  await page.addStyleTag({ content: ".scenario-bar { display: none !important; }" });
  await page.waitForTimeout(800);

  // ① Light（默认）
  await shot("panel-light");

  // ② Dark：设置页 → theme-dark
  await page.click('[data-testid="settings-btn"]');
  await page.waitForTimeout(400);
  await page.click('[data-testid="theme-dark"]');
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
  await shot("panel-dark");

  // ③ Glass：设置页 → 保持 dark（glass 是 dark/light 上的叠加层）+ 勾 glass-toggle + 滑槽 50%
  await page.click('[data-testid="settings-btn"]');
  await page.waitForTimeout(400);
  await page.click('[data-testid="glass-toggle"]');
  await page.waitForTimeout(400);
  // 透明度滑槽: 拖到中间 (50%) —— data-testid="glass-alpha-input"
  const slider = await page.$('#glass-alpha-input');
  if (slider) {
    const box = await slider.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
      await page.waitForTimeout(400);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
  await shot("panel-glass");

  await browser.close();
  console.log("DONE ->", OUT);
})().catch((e) => {
  console.error("CAPTURE FAILED:", e);
  process.exit(1);
});
