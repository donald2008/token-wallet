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
    // t_12c28686: 端口可由 PW_PORT 覆盖(与 fixtures.ts 的 hostPage 同源变量)。
    // 背景: 兄弟 session 的 dev server 反复占 1501, reuseExistingServer 会静默复用
    // *别人目录*的旧源码 server, e2e 渲染出与磁盘不符的组件(本卡实测两轮假红)。
    // 隔离端口跑法: PW_PORT=1521 pnpm test:e2e — webServer 与 fixture goto 同端口。
    command: "pnpm dev:web --port ${PW_PORT:-1501} --strictPort",
    port: Number(process.env.PW_PORT ?? 1501),
    reuseExistingServer: true,
  },
});
