import { defineConfig, devices } from "@playwright/test";

/**
 * D-030 / TESTING.md L2: Playwright browser 模式(mock Tauri IPC), Linux/CI 可跑。
 * tauri 真 webview 项目后置(需真机 + cargo tauri dev --features e2e-testing)。
 *
 * 注: `mode` 是 @srsholmes/tauri-playwright 注入的 fixture(运行时有效),
 * 其类型未 augment Playwright UseOptions, 故此处断言绕过。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  projects: [
    {
      name: "browser-only",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      use: { ...devices["Desktop Chrome"], mode: "browser" } as any,
    },
    {
      name: "tauri",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      use: { mode: "tauri" } as any,
    },
  ],
  webServer: {
    command: "pnpm dev",
    port: 1420,
    reuseExistingServer: !process.env.CI,
  },
});
