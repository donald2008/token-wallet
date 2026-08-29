import { defineConfig, devices } from "@playwright/test";

/**
 * D-030 / TESTING.md L2: Playwright browser 模式(mock 桌面桥 IPC), Linux/CI 可跑。
 * D-033 起 mock 桥为自家轻量 harness(e2e/fixtures.ts 注入 window.tokenWallet,
 * 与 Electron preload 同形态); 真壳 e2e(Electron)记 P2。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  projects: [
    {
      name: "browser-only",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev:web",
    port: 1420,
    reuseExistingServer: !process.env.CI,
  },
});
