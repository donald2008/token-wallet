// t_73c110ea + t_5b092750 截图脚本 — 4 排版 × 3 主题 × 360×600 视口
// t_5b092750 9/7 加 P5(短窗并排): 5h+周两列 grid, 月独占一行全宽
// 不依赖 e2e fixtures，直接走 vite dev URL + 同序列 UI 步骤
// 主题切换: localStorage token-wallet.theme.v1 + token-wallet.glass.v1(theme.ts 实际键名)
// 修订 #1116: 三窗 QuotaMeter(layout=micro) 常驻直显, 不再挂 BarRowTooltip
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const URL = process.env.URL || "http://127.0.0.1:8893/";
const OUT = "/root/work/token-wallet/verification/quota-cards3";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  // 主题组: dark 强制 / light 强制 / dark + glass(玻璃开关是 glass 主题唯一区分)
  const themes = [
    { name: "dark", mode: "dark", glass: false },
    { name: "light", mode: "light", glass: false },
    { name: "glass", mode: "dark", glass: true }, // glass 必须在 dark 或 light 上叠加, 这里选 dark 看透明感
  ];
  for (const theme of themes) {
    const ctx = await browser.newContext({
      viewport: { width: 360, height: 600 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    // 1. 进入主页, 在首帧前写入主题(theme.ts main.tsx 首帧脚本读 localStorage)
    // 用 addInitScript 在每次导航前注入, 比 localStorage + reload 更稳
    await ctx.addInitScript((args) => {
      try {
        localStorage.setItem("token-wallet.theme.v1", args.mode);
        localStorage.setItem("token-wallet.glass.v1", args.glass ? "1" : "0");
      } catch {}
    }, { mode: theme.mode, glass: theme.glass });
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    // 2. 同意首开(如未同意)
    const consent = page.getByTestId("consent-agree");
    if (await consent.count()) {
      await consent.click();
      await page.waitForTimeout(300);
    }
    // 3. 进入设置 → 排版方案
    const settingsBtn = page.getByTestId("settings-btn");
    await settingsBtn.click();
    await page.waitForTimeout(300);
    const quotaOpen = page.getByTestId("quota-open");
    await quotaOpen.click();
    await page.waitForTimeout(700); // 等 grow-in 动画落定
    // 4. 校验 data-theme 应用
    const htmlTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log(`[${theme.name}] html data-theme = ${htmlTheme}`);
    // 5. 各排版段截图
    const schemes = ["p1", "p2", "p4", "p5", "abn"];
    for (const key of schemes) {
      const section = page.getByTestId(`qvar-cards3-${key}`);
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await section.screenshot({ path: `${OUT}/quota-cards-${key}-${theme.name}.png` });
    }
    // 全页截图(顶部)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.getByTestId("quota-gallery").screenshot({
      path: `${OUT}/quota-gallery-${theme.name}-top.png`,
    });
    await ctx.close();
  }
  await browser.close();
  console.log(`[ok] screenshots written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});