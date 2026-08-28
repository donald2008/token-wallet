import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  // 防止 vite 遮挡 tauri CLI 输出
  clearScreen: false,
  server: {
    // Tauri 期望的固定端口
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      // src-tauri 的改动不触发 vite reload
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
