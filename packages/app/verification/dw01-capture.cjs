/* DW-01 取证: 双分辨率(900×640 + 1920×1080) × 三主题截图 + hover 联动探针 + 零滚动断言
 * 配方复用 capture-readme.cjs(e2e 同源 mock 桥 + fakeSummary 单一事实源)。
 * 产出: packages/app/verification/dw01/ 目录。 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { buildSync } = require("esbuild");

const APP = path.join("/root/work/token-wallet-t_b646f98e", "packages", "app");
const BASE = process.env.BASE || "http://127.0.0.1:1522";
const OUT = path.join(APP, "verification", "dw01");
const CHROME_CACHED = "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

function loadFakeSummary() {
  const src = fs.readFileSync(path.join(APP, "e2e", "agent-card.spec.ts"), "utf8");
  const start = src.indexOf("const fakeSummary = {");
  const open = src.indexOf("{", start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return eval(`(${src.slice(open, end)})`);
}
function loadDeriveMulti() {
  const src = fs.readFileSync(path.join(APP, "e2e", "agent-card.spec.ts"), "utf8");
  const start = src.indexOf("function deriveMultiFromSingle(");
  const open = src.indexOf("{", start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const jsSrc = src.slice(start, end).replace(/\(\s*base:\s*typeof fakeSummary\s*\)/, "(base)");
  const { code } = require("esbuild").transformSync(jsSrc, { loader: "ts", format: "cjs" });
  return eval(`(${code.replace(/^var deriveMultiFromSingle = /, "").replace(/;?\s*$/, "")})`);
}
function buildIpcInitScript() {
  const { outputFiles } = require("esbuild").buildSync({
    entryPoints: [path.join(APP, "e2e", "fixtures.ts")],
    bundle: true, write: false, format: "cjs", platform: "node",
    external: ["@playwright/test"],
  });
  const code = outputFiles[0].text;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(require, mod, mod.exports);
  const entries = Object.entries(mod.exports.ipcMocks)
    .map(([channel, fn]) => `${JSON.stringify(channel)}: (${fn.toString()})`).join(",\n");
  return `(() => {
      const handlers = {\n${entries}\n};
      window.__capturedInvokes = [];
      window.tokenWallet = {
        invoke: (channel, payload) => {
          window.__capturedInvokes.push({ cmd: channel, args: payload });
          const h = handlers[channel];
          return Promise.resolve(h ? h(payload) : null);
        },
        onUpdaterEvent: () => {},
      };
    })()`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fakeSummary = loadFakeSummary();
  const multiSeed = loadDeriveMulti()(fakeSummary);
  const seedJson = JSON.stringify({ byGroupBy: multiSeed });
  const initScript = buildIpcInitScript();
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_CACHED) ? CHROME_CACHED : undefined,
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  });

  const results = [];
  for (const [w, h] of [[900, 640], [1920, 1080]]) {
    for (const [name, theme] of [
      ["dark", { theme: "dark", glass: false }],
      ["light", { theme: "light", glass: false }],
      ["glass", { theme: "dark", glass: true }],
    ]) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        deviceScaleFactor: w >= 1920 ? 1 : 2,
        colorScheme: "dark",
      });
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
      await page.goto(`${BASE}/?view=agent-dashboard&standalone=1`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="agent-dashboard-c"]', { state: "visible", timeout: 10000 });
      await page.waitForTimeout(1200);

      // 零滚动探针(布局物理约束)
      const probe = await page.evaluate(() => {
        const dash = document.querySelector(".agent-dashboard-c");
        const footer = document.querySelector(".agent-dashboard-c-footer");
        return {
          scrollH: dash ? dash.scrollHeight : -1,
          clientH: dash ? dash.clientHeight : -1,
          footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : -1,
          vh: window.innerHeight,
        };
      });
      const shotName = `dw01-dash-${w}x${h}-${name}.png`;
      await page.screenshot({ path: path.join(OUT, shotName) });

      // hover 联动取证(仅 900×640 dark): hover 图例行 → is-hover 类 + 详情行更新
      let hoverEvidence = null;
      if (w === 900 && name === "dark") {
        const glmRow = page.locator('[data-testid="agent-dashboard-c-model-row-glm-5.3-flash"]');
        await glmRow.hover();
        await page.waitForTimeout(300);
        hoverEvidence = await page.evaluate(() => {
          const li = document.querySelector('[data-testid="agent-dashboard-c-model-row-glm-5.3-flash"]');
          const detail = document.querySelector('[data-testid="agent-dashboard-c-model-hoverdetail"]');
          return {
            liHasHoverClass: li?.classList.contains("is-hover") ?? false,
            detailText: detail?.textContent ?? "",
          };
        });
        await page.screenshot({ path: path.join(OUT, "dw01-hover-legend-900x640-dark.png") });
        // hover canvas 扇区联动反向取证
        const canvas = page.locator('[data-testid="agent-dashboard-c-chart-model"] canvas');
        const box = await canvas.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.2); // 环上沿=第一扇区
          await page.waitForTimeout(300);
          hoverEvidence.canvasHoverDetail = await page.evaluate(() =>
            document.querySelector('[data-testid="agent-dashboard-c-model-hoverdetail"]')?.textContent ?? "");
          hoverEvidence.canvasHoverLiClass = await page.evaluate(() =>
            document.querySelector('[data-testid="agent-dashboard-c-model-row-glm-5.3-flash"]')?.classList.contains("is-hover") ?? false);
        }
      }
      results.push({ shot: shotName, w, h, theme: name, probe, hoverEvidence });
      console.log(JSON.stringify({ shot: shotName, ...probe, hover: hoverEvidence ? { liHover: hoverEvidence.liHasHoverClass, detail: hoverEvidence.detailText?.slice(0, 60), canvasHover: hoverEvidence.canvasHoverLiClass } : undefined }));
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "dw01-probe-results.json"), JSON.stringify(results, null, 2));
  console.log("DONE ->", OUT);
})().catch((e) => { console.error("CAPTURE FAILED:", e); process.exit(1); });
