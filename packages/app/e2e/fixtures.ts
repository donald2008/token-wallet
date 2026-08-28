import { createTauriTest } from "@srsholmes/tauri-playwright";

/**
 * browser 模式: headless Chromium + mock Tauri IPC。
 * get_bootstrap mock 为首开态(firstRun=true), 与壳的零配置初始状态一致。
 */
export const { test, expect } = createTauriTest({
  devUrl: "http://localhost:1420",
  ipcMocks: {
    get_bootstrap: () => ({ firstRun: true, theme: "system", version: "0.1.0-test" }),
    update_tray_status: () => null,
  },
});
