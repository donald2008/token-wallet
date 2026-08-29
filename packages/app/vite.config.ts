import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 渲染层 dev server(D-033: Electron 壳经 ELECTRON_RENDERER_URL 加载本 server;
// 浏览器独立预览走 `pnpm dev:web`)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    // 固定端口: dev runner 与 playwright webServer 都按 1420 等待
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_"],
  build: {
    target: "es2021",
    minify: "esbuild",
  },
});
