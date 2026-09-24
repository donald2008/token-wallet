#!/usr/bin/env node
/**
 * 设计基线截图产图（docs/design-baseline/_shots/）
 *
 * 用途：为「基线缺口」界面补锁定视觉基准（首页卡列表 / 添加向导 / 设置页 / 标题栏），
 * 三主题（dark / light / glass）× 各界面一张，供 design-baseline 注册表引用与后续对稿比对。
 *
 * 同源纪律：mock 桌面桥经 esbuild 转译自 e2e/fixtures.ts（与 e2e 单一事实源），
 * 页面走同一 dev server + localStorage seed 路径，截图即真实渲染（非手绘稿）。
 *
 * 用法:
 *   node e2e/capture-baseline.cjs                 # BASE=http://localhost:5173
 *   BASE=http://localhost:1555 node e2e/capture-baseline.cjs
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..");
const BASE = process.env.BASE || "http://localhost:5173";
const OUT = path.join(APP, "..", "..", "docs", "design-baseline", "_shots");
const CHROME_CACHED = "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

/** fixtures.ts 的 ipcMocks 经 esbuild 转译成 CJS 加载（mock 桥单一事实源） */
function buildIpcInitScript() {
  const { outputFiles } = require("esbuild").buildSync({
    entryPoints: [path.join(APP, "e2e", "fixtures.ts")],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    external: ["@playwright/test"],
  });
  const code = outputFiles[0].text;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(require, mod, mod.exports);
  const { ipcMocks } = mod.exports;
  if (!ipcMocks) throw new Error("ipcMocks not exported from e2e/fixtures.ts");
  const entries = Object.entries(ipcMocks)
    .map(([channel, fn]) => `${JSON.stringify(channel)}: (${fn.toString()})`)
    .join(",\n");
  return `(() => {
      const handlers = {\n${entries}\n};
      window.__capturedInvokes = [];
      window.__updaterListeners = [];
      window.__pushUpdaterEvent = (event) => {
        for (const cb of window.__updaterListeners) cb(event);
      };
      window.tokenWallet = {
        invoke: (channel, payload) => {
          window.__capturedInvokes.push({ cmd: channel, args: payload });
          const h = handlers[channel];
          return Promise.resolve(h ? h(payload) : null);
        },
        onUpdaterEvent: (callback) => {
          window.__updaterListeners.push(callback);
        },
      };
    })()`;
}

/** 首页卡列表 seed：2 实例（kimi/coding 健康 + deepseek/balance），keyring 已配 */
const INSTANCES_SEED = {
  version: 1,
  instances: [
    {
      id: "inst-kimi-1",
      channel: "kimi/coding",
      name: "Kimi-Code #1",
      params: { api_key: { source: "store", key: "inst-kimi-1:api_key" } },
    },
    {
      id: "inst-deepseek-1",
      channel: "deepseek/balance",
      name: "DeepSeek 主号",
      params: { api_key: { source: "store", key: "inst-deepseek-1:api_key" } },
    },
  ],
};

const THEMES = [
  ["dark", { theme: "dark", glass: false }],
  ["light", { theme: "light", glass: false }],
  ["glass", { theme: "dark", glass: true }],
];

async function newCtx(browser, initScript, theme, glass) {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 720 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  await ctx.addInitScript(initScript);
  await ctx.addInitScript(
    ([t, glassOn, seed]) => {
      localStorage.setItem("token-wallet.mock.consent.v1", "1");
      localStorage.setItem("token-wallet.theme.v1", t);
      localStorage.setItem("token-wallet.glass.v1", glassOn ? "1" : "0");
      if (glassOn) localStorage.setItem("token-wallet.glassAlpha.v1", "0.5");
      localStorage.setItem("token-wallet.mock.instances.v1", JSON.stringify(seed));
      localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-kimi-1:api_key", "sk-kimi-1");
      localStorage.setItem(
        "token-wallet.mock.keyring.token-wallet:inst-deepseek-1:api_key",
        "sk-deepseek-1",
      );
    },
    [theme, glass, INSTANCES_SEED],
  );
  return ctx;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const initScript = buildIpcInitScript();
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_CACHED) ? CHROME_CACHED : undefined,
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  });

  let shotCount = 0;
  for (const [tname, tcfg] of THEMES) {
    // ---- 1. 首页（Provider 卡列表）+ 标题栏（同页顶部区域）----
    {
      const ctx = await newCtx(browser, initScript, tcfg.theme, tcfg.glass);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log("[pageerror]", e.message));
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="card-list"], [data-testid="empty-state"]', {
        state: "visible",
        timeout: 10000,
      });
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, `home-${tname}.png`) });
      console.log("shot:", `home-${tname}`);
      shotCount++;
      // 标题栏特写（顶栏 32px + 紧邻区域）
      await page.screenshot({
        path: path.join(OUT, `titlebar-${tname}.png`),
        clip: { x: 0, y: 0, width: 360, height: 120 },
      });
      console.log("shot:", `titlebar-${tname}`);
      shotCount++;

      // ---- 2. 添加向导（同 ctx 内点添加钮）----
      const addBtn = page.getByTestId("add-btn");
      if (await addBtn.count()) {
        await addBtn.click();
        await page.waitForSelector('[data-testid="add-wizard"]', { state: "visible", timeout: 8000 });
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT, `wizard-${tname}.png`) });
        console.log("shot:", `wizard-${tname}`);
        shotCount++;
        // 通道选择 → 展开平台 → 点产品 → 配置表单步（D-025 树形两段式）
        const step = page.getByTestId("add-channel-step");
        const btns = step.locator("button");
        if (await btns.count()) {
          await btns.first().click().catch(() => {}); // 展开平台
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(OUT, `wizard-expanded-${tname}.png`) });
          console.log("shot:", `wizard-expanded-${tname}`);
          shotCount++;
          const btns2 = step.locator("button");
          // 展开后多出的按钮即产品项(点最后一个 = 新展开的产品)
          await btns2.last().click().catch(() => {});
          await page.waitForTimeout(800);
          if (await page.getByTestId("dynamic-form").count()) {
            await page.screenshot({ path: path.join(OUT, `wizard-form-${tname}.png`) });
            console.log("shot:", `wizard-form-${tname}`);
            shotCount++;
          }
        }
        await page.getByTestId("add-close").click().catch(() => {});
        await page.waitForTimeout(400);
      } else {
        console.log("warn: add-btn 未找到，跳过向导截图", tname);
      }

      // ---- 3. 设置页（顶部 + 底部两屏覆盖全量区块）----
      await page.getByTestId("settings-btn").click();
      await page.waitForSelector('[data-testid="settings-view"]', { state: "visible", timeout: 8000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `settings-top-${tname}.png`) });
      console.log("shot:", `settings-top-${tname}`);
      shotCount++;
      // 中段: 存储路径 + 关于/版本 区(MCP 之前)
      await page.getByTestId("about-section").scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `settings-mid-${tname}.png`) });
      console.log("shot:", `settings-mid-${tname}`);
      shotCount++;
      // 底部: MCP 区(最后一块) — 覆盖 主题/语言/排序/自启/存储/关于/MCP 全量
      await page.evaluate(() => {
        const b = document.querySelector('[data-testid="settings-body"]');
        if (b) b.scrollTop = b.scrollHeight;
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `settings-bottom-${tname}.png`) });
      console.log("shot:", `settings-bottom-${tname}`);
      shotCount++;
      await ctx.close();
    }
  }

  await browser.close();
  console.log(`DONE: ${shotCount} shots ->`, OUT);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
