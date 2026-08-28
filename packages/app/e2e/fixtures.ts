import { createTauriTest } from "@srsholmes/tauri-playwright";

/**
 * browser 模式: headless Chromium + mock Tauri IPC。
 * get_bootstrap mock 为首开态(firstRun=true), 与壳的零配置初始状态一致。
 * 新增 IPC(D-019 存储路径 / D-024 开机自启)mock 为确定性值, 便于断言。
 */
export const { test, expect } = createTauriTest({
  devUrl: "http://localhost:1420",
  ipcMocks: {
    get_bootstrap: () => ({ firstRun: true, theme: "system", version: "0.1.0-test" }),
    update_tray_status: () => null,
    get_storage_paths: () => ({
      configDir: "/home/test/.config/token-wallet",
      dataDir: "/home/test/.local/share/token-wallet",
    }),
    get_launch_at_login: () => false,
    set_launch_at_login: () => null,
  },
});