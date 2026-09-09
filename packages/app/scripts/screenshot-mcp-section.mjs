/**
 * 设置页 MCP 服务区三主题截图脚本(t_4bd214de evidence):
 * - 6 张 PNG(避免 mcp-panel 截 stopped/running 视觉趋同 + glass 主题仅父级 panel 有 backdrop-filter):
 *   - dark × {not-installed, stopped, running}  → 截 mcp-panel(状态点 + 文案明显差异)
 *   - {dark, light, glass} × stopped              → 截 settings-modal(backdrop-filter 差异)
 * - 锚 localStorage token-wallet.theme.v1 + token-wallet.glass.v1 + reload
 * - 落 packages/app/verification/mcp-section/(仓根 tracked)
 * - 验证 md5sum 全部互异(防假三主题循环, skill #73)
 *
 * 用法: cd packages/app && node scripts/screenshot-mcp-section.mjs
 *   前提: vite dev 起着 (pnpm dev:web --port 1501 --strictPort)
 */
import { chromium } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "verification", "mcp-section");

const SCENARIOS = [
  { id: "not-installed", state: { installed: false } },
  { id: "stopped", state: { installed: true, alive: false, reason: "unreachable" } },
  { id: "running", state: { installed: true, alive: true } },
];

const THEMES = [
  { id: "dark", theme: "dark", glass: false },
  { id: "light", theme: "light", glass: false },
  { id: "glass", theme: "dark", glass: true },
];

const PLAN = [
  // dark × 三态: 截 mcp-panel(状态点 + 文案)
  { themeId: "dark", scenario: "not-installed", what: "panel" },
  { themeId: "dark", scenario: "stopped", what: "panel" },
  { themeId: "dark", scenario: "running", what: "panel" },
  // 三主题 × stopped: 截 settings-modal(backdrop-filter 差异)
  { themeId: "dark", scenario: "stopped", what: "modal" },
  { themeId: "light", scenario: "stopped", what: "modal" },
  { themeId: "glass", scenario: "stopped", what: "modal" },
];

const SCENARIO_STATE = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.state]));

function dataThemeAttr(theme) {
  return theme.glass ? `${theme.theme}-glass` : theme.theme;
}

async function capture(ctx, item) {
  const theme = THEMES.find((t) => t.id === item.themeId);
  const state = SCENARIO_STATE[item.scenario];
  const page = await ctx.newPage();
  try {
    await page.goto("http://localhost:1501");
    await page.evaluate(
      ({ themeId, glassOn, st }) => {
        localStorage.setItem("token-wallet.theme.v1", themeId);
        localStorage.setItem("token-wallet.glass.v1", glassOn ? "1" : "0");
        localStorage.setItem("token-wallet.mock.mcp", JSON.stringify(st));
      },
      { themeId: theme.theme, glassOn: theme.glass, st: state },
    );
    // ⚠️ reload: prePaintTheme + useTheme useState 在初次 page load 读 localStorage;
    // evaluate 设的值不会被已挂载的 React 组件感知
    await page.reload();
    await page.waitForSelector('[data-testid="settings-btn"]', { timeout: 5_000 });
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.theme === expected,
      dataThemeAttr(theme),
      { timeout: 5_000 },
    );
    await page.waitForTimeout(300);
    await page.click('[data-testid="settings-btn"]');
    await page.waitForFunction(
      () => !!document.querySelector(".settings-modal"),
      { timeout: 5_000 },
    );
    const expectedStatus = state.installed && state.alive
      ? "running"
      : state.installed
        ? "stopped"
        : "not_installed";
    await page.waitForFunction(
      (expected) => {
        const p = document.querySelector('[data-testid="mcp-panel"]');
        return p?.getAttribute("data-status") === expected;
      },
      expectedStatus,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(500);

    const filename = `mcp-${item.themeId}-${item.scenario}-${item.what}.png`;
    const fullPath = path.join(OUT_DIR, filename);
    let target;
    if (item.what === "modal") {
      target = await page.$(".settings-modal");
    } else {
      target = await page.$('[data-testid="mcp-panel"]');
    }
    if (!target) {
      throw new Error(`target not found for ${filename}`);
    }
    await target.screenshot({ path: fullPath });
    const buf = fs.readFileSync(fullPath);
    const md5 = crypto.createHash("md5").update(buf).digest("hex");
    console.log(
      `✓ ${item.themeId}/${item.scenario}/${item.what} → ${filename} (${buf.length}B md5=${md5})`,
    );
    return { file: filename, md5, bytes: buf.length };
  } finally {
    await page.close();
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 720 },
    locale: "zh-CN",
  });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  // 注入 fixtures mock(vite dev mode 不走 playwright init script)
  await ctx.addInitScript(() => {
    const w = window;
    if (w.tokenWallet) return;
    const handlers = {
      get_bootstrap: () => ({ firstRun: false, theme: "system", version: "0.2.8" }),
      get_storage_paths: () => ({
        configDir: "/home/test/.config/token-wallet",
        dataDir: "/home/test/.local/share/token-wallet",
      }),
      get_launch_at_login: () => false,
      set_launch_at_login: () => null,
      record_consent: () => null,
      instances_load: () => null,
      instances_save: () => null,
      get_sort_config: () => ({ key: "manual", dir: "asc" }),
      set_sort_config: () => null,
      get_lang: () => "zh",
      set_lang: () => null,
      updater_check: () => ({ status: "up-to-date" }),
      updater_download: () => ({ status: "downloading", percent: 10 }),
      updater_install: () => null,
      mcp_probe: () => {
        const raw = localStorage.getItem("token-wallet.mock.mcp");
        const s = raw ? JSON.parse(raw) : { installed: false };
        if (!s.installed) return { alive: false, reason: "unreachable", installed: false };
        return {
          alive: s.alive === true,
          reason: s.alive ? undefined : s.reason ?? "unreachable",
          installed: true,
        };
      },
      mcp_start: () => {
        const raw = localStorage.getItem("token-wallet.mock.mcp");
        const s = raw ? JSON.parse(raw) : { installed: false };
        if (s.installed) {
          localStorage.setItem(
            "token-wallet.mock.mcp",
            JSON.stringify({ installed: true, alive: true, pid: 54321 }),
          );
          return { started: true, pid: 54321 };
        }
        return { started: false, reason: "not_installed" };
      },
      mcp_stop: () => {
        const raw = localStorage.getItem("token-wallet.mock.mcp");
        const s = raw ? JSON.parse(raw) : { installed: false };
        if (s.installed) {
          localStorage.setItem(
            "token-wallet.mock.mcp",
            JSON.stringify({ installed: true, alive: false, reason: "stopped" }),
          );
        }
        return { stopped: true };
      },
      mcp_get_config: () => {
        const raw = localStorage.getItem("token-wallet.mock.mcp");
        const s = raw ? JSON.parse(raw) : { installed: false };
        return {
          TOKEN_WALLET_MCP_KEY: "0123456789abcdef0123456789abcdef",
          TOKEN_WALLET_PORT: 9131,
          TOKEN_WALLET_HOST: "127.0.0.1",
          TOKEN_WALLET_DB_PATH: "/data/token-wallet/token-wallet.db",
          USAGE_TTL_DAYS: 90,
          mcpEnvPath: "/home/test/.config/token-wallet/mcp.env",
          installed: s.installed === true,
        };
      },
      mcp_gen_key: () => ({
        key: "fedcba9876543210fedcba9876543210",
        daemonWasRunning: false,
      }),
      mcp_get_autostart: () => {
        const raw = localStorage.getItem("token-wallet.mock.mcp.autostart");
        const s = raw ? JSON.parse(raw) : {};
        return {
          mcpAutostart: s.mcpAutostart !== false,
          osAutostart: s.osAutostart === true,
        };
      },
      mcp_set_autostart: (args) => {
        const enabled = Boolean(args?.enabled);
        localStorage.setItem(
          "token-wallet.mock.mcp.autostart",
          JSON.stringify({ mcpAutostart: enabled, osAutostart: enabled }),
        );
        return { mcpAutostart: enabled, osAutostart: enabled };
      },
      mcp_get_guide: () => {
        const raw = localStorage.getItem("token-wallet.mock.mcp");
        const s = raw ? JSON.parse(raw) : { alive: false };
        if (s.alive) {
          return {
            agents: [
              {
                id: "hermes",
                name: "Hermes",
                plugin_url: "https://example.com/hermes",
                configure: "Configure Hermes with endpoint http://127.0.0.1:9131/mcp",
                verify: "curl http://127.0.0.1:9131/mcp -X POST",
              },
              {
                id: "claude-code",
                name: "Claude Code",
                plugin_url: "https://example.com/claude-code",
                configure: "Configure Claude Code MCP integration",
              },
            ],
          };
        }
        return { agents: [], reason: "daemon_not_running" };
      },
    };
    w.tokenWallet = {
      invoke: (channel, payload) => Promise.resolve(handlers[channel]?.(payload)),
      onUpdaterEvent: () => () => {},
    };
  });

  const hashes = [];
  for (const item of PLAN) {
    const r = await capture(ctx, item);
    hashes.push(r);
  }

  await browser.close();

  // md5 互异校验(假三主题循环防线)
  const md5Set = new Set(hashes.map((h) => h.md5));
  console.log(`\nTotal: ${hashes.length} files, ${md5Set.size} unique md5`);
  if (md5Set.size !== hashes.length) {
    console.error("❌ FAIL: duplicate md5 → 假三主题循环 / 假场景");
    const dupes = hashes.filter(
      (h, i) => hashes.findIndex((x) => x.md5 === h.md5) !== i,
    );
    console.error("Duplicates:", dupes.map((d) => d.file));
    process.exit(1);
  }
  console.log("✓ All screenshots byte-distinct (防假三主题/scenario)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
