#!/usr/bin/env node
/**
 * 截图脚本: 3 个大屏方案 × 2 主题(dark + light), 900×600
 * 落仓 packages/app/verification/agent-dashboard/
 *
 * 策略: file:// 直接打开 HTML, 用 setViewportSize 钉死 900×600,
 * 等 chart.js 渲染完后截图。
 */
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_PAGES = path.resolve(__dirname, "../dev-pages");
const OUT_DIR = path.resolve(__dirname, "../verification/agent-dashboard");

const LAYOUTS = ["A", "B", "C"];
const THEMES = ["dark", "light"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  for (const layout of LAYOUTS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({
        viewport: { width: 900, height: 600 },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      const file = `file://${path.join(DEV_PAGES, `agent-dashboard-${layout}.html`)}`;
      await page.goto(file, { waitUntil: "networkidle" });
      // 切主题
      if (theme === "light") {
        await page.locator('[data-theme="light"]').first().click();
      } else {
        await page.locator('[data-theme="dark"]').first().click();
      }
      // 等 chart.js 真渲染(canvas 已绘制)
      await sleep(800);
      const outFile = path.join(OUT_DIR, `agent-dash-${layout}-${theme}.png`);
      await page.screenshot({ path: outFile, fullPage: false });
      console.log(`OK  ${path.basename(outFile)}`);
      await ctx.close();
    }
  }
  await browser.close();
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});