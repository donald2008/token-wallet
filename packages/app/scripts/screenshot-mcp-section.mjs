/**
 * 设置页 MCP 服务区三主题截图脚本(t_4bd214de evidence):
 * - 三主题 dark / light / glass × 三态 not-installed / stopped / running = 9 张
 * - 锚 localStorage token-wallet.theme.v1 + token-wallet.glass.v1 + reload + 等卡
 * - 落到仓根 tracked packages/app/verification/mcp-section/
 * - 验证 md5sum 全部互异(防假三主题循环, skill #73)
 *
 * 用法: cd packages/app && node scripts/screenshot-mcp-section.mjs
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
  { id: "not-installed", state: { installed: false }, label: "未运行" },
  { id: "stopped", state: { installed: true, alive: false, reason: "unreachable" }, label: "未运行" },
  { id: "running", state: { installed: true, alive: true }, label: "运行中" },
];

const THEMES = [
  { id: "dark", theme: "dark", glass: "0" },
  { id: "light", theme: "light", glass: "0" },
  { id: "glass", theme: "dark", glass: "1" },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 720 }, // 真面板 ~336 宽 + 边距, 模拟实设备
    locale: "zh-CN",
  });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  // 注入 fixtures mock(参考 packages/app/e2e/_glass-alpha-shots.spec.ts 模式):
  // vite dev mode 下没走 playwright webServer 的 init script, 需手动注入
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window;
    if (!w.tokenWallet) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // D-048 MCP 7 通道 mock
        mcp_probe: () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = localStorage.getItem("token-wallet.mock.mcp");
          const s = raw ? JSON.parse(raw) : { alive: false };
          if (s.alive) {
            return {
              agents: [
                {
                  id: "hermes",
                  name: "Hermes",
                  plugin_url: "https://example.com/hermes",
                  configure: "Configure Hermes with endpoint",
                },
                {
                  id: "claude-code",
                  name: "Claude Code",
                  plugin_url: "https://example.com/claude-code",
                },
              ],
            };
          }
          return { agents: [], reason: "daemon_not_running" };
        },
      };
      w.tokenWallet = {
        invoke: (channel, payload) =>
          Promise.resolve(handlers[channel]?.(payload)),
        onUpdaterEvent: () => () => {},
      };
    }
  });

  const hashes = [];
  for (const theme of THEMES) {
    for (const scenario of SCENARIOS) {
      await page.goto("http://localhost:1501");
      // 三主题显式锚(避假循环:t_c20d4d11 round-5 教训) — 一次 evaluate 串写 3 个 localStorage key
      await page.evaluate(
        ({ themeId, glassId, state }) => {
          localStorage.setItem("token-wallet.theme.v1", themeId);
          localStorage.setItem("token-wallet.glass.v1", glassId);
          localStorage.setItem("token-wallet.mock.mcp", JSON.stringify(state));
        },
        { themeId: theme.theme, glassId: theme.glass, state: scenario.state },
      );
      await page.reload();
      // 等卡渲染
      await page.waitForSelector('[data-testid="mcp-panel"]', { timeout: 5000 });
      // 开设置页
      await page.click('[data-testid="settings-btn"]');
      await page.waitForSelector('[data-testid="settings-view"]', { timeout: 3000 });
      // mcp-panel 应自动渲染在 settings-view 内
      await page.waitForTimeout(200);

      const filename = `mcp-${theme.id}-${scenario.id}.png`;
      const fullPath = path.join(OUT_DIR, filename);
      const panel = await page.$('[data-testid="mcp-panel"]');
      if (!panel) {
        throw new Error(`mcp-panel not found for ${theme.id}/${scenario.id}`);
      }
      await panel.screenshot({ path: fullPath });
      const buf = fs.readFileSync(fullPath);
      const md5 = crypto.createHash("md5").update(buf).digest("hex");
      hashes.push({ file: filename, md5, bytes: buf.length });
      console.log(`✓ ${theme.id}/${scenario.id} → ${filename} (${buf.length}B md5=${md5})`);
    }
  }

  await browser.close();

  // md5 互异校验(假三主题循环防线)
  const md5Set = new Set(hashes.map((h) => h.md5));
  console.log(`\nTotal: ${hashes.length} files, ${md5Set.size} unique md5`);
  if (md5Set.size !== hashes.length) {
    console.error("❌ FAIL: duplicate md5 → 假三主题循环 / 假场景");
    const dupes = hashes.filter((h, i) => hashes.findIndex((x) => x.md5 === h.md5) !== i);
    console.error("Duplicates:", dupes.map((d) => d.file));
    process.exit(1);
  }
  console.log("✓ All screenshots byte-distinct (防假三主题/scenario)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
