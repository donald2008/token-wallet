/**
 * E1 preload(D-033): contextBridge 注入 window.tokenWallet.invoke,
 * renderer 侧 ipc.ts 统一走此桥(替代旧 window.__TAURI__ 通道)。
 * contextIsolation 开启, 渲染进程零 node 能力。
 * D-046: 增 onUpdaterEvent 事件桥 — invoke 只覆盖请求响应, 下载进度是主进程
 * 主动推(webContents.send), 走独立回调注册(on* 形态, 不与 invoke 混流)。
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tokenWallet", {
  invoke: (channel: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload),
  onUpdaterEvent: (callback: (event: unknown) => void): void => {
    ipcRenderer.on("updater_event", (_event, payload) => callback(payload));
  },
});
