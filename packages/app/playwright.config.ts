import { defineConfig, devices } from "@playwright/test";

/**
 * D-030 / TESTING.md L2: Playwright browser 模式(mock 桌面桥 IPC), Linux/CI 可跑。
 * D-033 起 mock 桥为自家轻量 harness(e2e/fixtures.ts 注入 window.tokenWallet,
 * 与 Electron preload 同形态); 真壳 e2e(Electron)记 P2。
 *
 * t_2520e5f1 L2.5: 新增 electron-shell project(@playwright/test 内置 _electron.launch
 * 驱动真壳 dist-electron/main.cjs)。Electron 驱动仅 Windows 本机可跑(Linux xvfb 下
 * 透明无边框窗口观感不可验, 见 token-wallet skill 环境能力矩阵), Linux 上自动 skip
 * (守卫在 spec 内, project 本体声明无害)。运行:
 *   pnpm --filter app test:e2e                        # 只跑 browser-only(默认不变)
 *   pnpm --filter app test:e2e --project=electron-shell  # Windows 本机真壳视觉验证
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
    {
      name: "electron-shell",
      use: { ...devices["Desktop Chrome"] },
      // 只跑真壳 spec(browser-only 的 123 用例不进此 project);
      // browser-only project 默认全收(testIgnore 未设), shell-visual.spec.ts
      // 内部有 platform 守卫(非 win32 自动 skip), 不会在 Linux/CI 误跑。
      testIgnore: /.*\/(?!shell-visual)[^/]*\.spec\.ts/,
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
