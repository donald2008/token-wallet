/* eslint-disable no-console */
/**
 * README 大屏截图产图 (t_9fdd07b5 B-1 收口): dashboard dark/light/glass 三张 → docs/screenshots/
 * 用法: 先起 dev server (`pnpm dev:web`, 默认 :5173; 自定端口 `vite --port N` 后
 *       `BASE=http://localhost:N node e2e/capture-readme.cjs`), 再跑本脚本。
 *
 * 口径对齐 SL-07 交付物 (1de4dd0) 与 e2e/agent-card.spec.ts:
 * - standalone 产品路径 `?view=agent-dashboard&standalone=1` (真壳 main.ts 打开大屏同款 URL)
 * - 900×560 视口 (electron/main.ts 窗口壳尺寸) + deviceScaleFactor 2 → 1800×1120 PNG
 * - e2e 同源 mock 桥 (e2e/fixtures.ts ipcMocks) + fakeSummary 同源数据 — 数据单一事实源,
 *   本脚本经 esbuild 转译直接 import e2e/fixtures.ts 与 e2e/agent-card.spec.ts, 不复制数据
 * - 三主题: dark (产品默认) / light / glass (dark-glass 玻璃叠加层, alpha 0.5 演示)
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { buildSync } = require("esbuild");

const APP = path.join(__dirname, "..");
const BASE = process.env.BASE || "http://localhost:5173";
const OUT = path.join(APP, "..", "..", "docs", "screenshots");
// playwright 自带 chromium 优先, 兜底本机缓存路径(取证机无浏览器安装时)
const CHROME_CACHED = "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

/** e2e/agent-card.spec.ts 内嵌 fakeSummary + deriveMultiFromSingle 提取 (数据与 e2e 断言同源, 不复制) */
function loadFakeSummary() {
  const src = fs.readFileSync(path.join(APP, "e2e", "agent-card.spec.ts"), "utf8");
  const start = src.indexOf("const fakeSummary = {");
  if (start < 0) throw new Error("fakeSummary not found in agent-card.spec.ts");
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("fakeSummary braces unbalanced");
  // eslint-disable-next-line no-eval
  return eval(`(${src.slice(open, end)})`);
}

/** e2e/agent-card.spec.ts 内嵌 deriveMultiFromSingle 提取 (多维派生逻辑单一事实源, 不复制) */
function loadDeriveMulti() {
  const src = fs.readFileSync(path.join(APP, "e2e", "agent-card.spec.ts"), "utf8");
  const start = src.indexOf("function deriveMultiFromSingle(");
  if (start < 0) throw new Error("deriveMultiFromSingle not found in agent-card.spec.ts");
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("deriveMultiFromSingle braces unbalanced");
  // spec 源码是 TS: 剥参数注解后转 esbuild 转译再 eval (函数体含 (model: string) 等 TS 注解)
  const jsSrc = src
    .slice(start, end)
    .replace(/\(\s*base:\s*typeof fakeSummary\s*\)/, "(base)");
  const { code: tfCode } = require("esbuild").transformSync(jsSrc, {
    loader: "ts",
    format: "cjs",
  });
  // eslint-disable-next-line no-eval
  const fn = eval(`(${tfCode.replace(/^var deriveMultiFromSingle = /, "").replace(/;?\s*$/, "")})`);
  return fn;
}

/** e2e/fixtures.ts 的 ipcMocks + hostPage 初始化脚本经 esbuild 转译成 CJS 加载 (mock 桥单一事实源) */
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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fakeSummary = loadFakeSummary();
  // 多维 seed (agent + agent,model + day 三维度, 与 e2e L2 冒烟 2 同源):
  // Model 分布面板渲染 glm+kimi 两行 — 单维 seed 会让 Model 面板落空态(实测咬过)。
  const multiSeed = loadDeriveMulti()(fakeSummary);
  const seedJson = JSON.stringify({ byGroupBy: multiSeed });
  const initScript = buildIpcInitScript();
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_CACHED) ? CHROME_CACHED : undefined,
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  });

  for (const [name, theme] of [
    ["dashboard-dark", { theme: "dark", glass: false }],
    ["dashboard-light", { theme: "light", glass: false }],
    ["dashboard-glass", { theme: "dark", glass: true }],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: 900, height: 560 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
    });
    // e2e 同源: mock 桌面桥(转译自 fixtures.ts) + consent 已过 + mcp usage seed + 主题/glass 预置。
    // 全部走 addInitScript 页面加载前落位(渲染首帧即读到数据, 无需首载+reload)。
    await ctx.addInitScript(initScript);
    await ctx.addInitScript(
      ([t, glassOn, seed]) => {
        localStorage.setItem("token-wallet.mock.consent.v1", "1");
        localStorage.setItem("token-wallet.theme.v1", t);
        localStorage.setItem("token-wallet.glass.v1", glassOn ? "1" : "0");
        if (glassOn) localStorage.setItem("token-wallet.glassAlpha.v1", "0.5");
        localStorage.setItem("token-wallet.mock.mcp.usage", seed);
      },
      [theme.theme, theme.glass, seedJson],
    );
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    // standalone 产品路径 = electron/main.ts 打开大屏窗口同款 URL(?view=agent-dashboard&standalone=1)
    await page.goto(`${BASE}/?view=agent-dashboard&standalone=1`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="agent-dashboard-c"]', { state: "visible", timeout: 10000 });
    // 等 chart.js 异步渲染 + 字体/动画落定
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log("shot:", name);
    await ctx.close();
  }

  await browser.close();
  console.log("DONE ->", OUT);
})().catch((e) => {
  console.error("CAPTURE FAILED:", e);
  process.exit(1);
});
