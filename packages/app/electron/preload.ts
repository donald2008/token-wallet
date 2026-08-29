/**
 * E1 preload(D-033): contextBridge 注入 window.tokenWallet.invoke,
 * renderer 侧 ipc.ts 统一走此桥(替代旧 window.__TAURI__ 通道)。
 * contextIsolation 开启, 渲染进程零 node 能力。
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tokenWallet", {
  invoke: (channel: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload),
});
