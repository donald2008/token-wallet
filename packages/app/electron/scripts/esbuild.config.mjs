/** 共享 esbuild 配置: 主进程/preload → dist-electron/*.cjs(electron 外部化, CJS 兼容 sandbox preload) */
/**
 * external 说明:
 * - electron: 运行时由 Electron 提供, 不打入 bundle;
 * - better-sqlite3: 原生模块(bindings 加载 build/Release/*.node), 打进 bundle 后
 *   bindings 按 __dirname(dist-electron/) 找 .node 失败 → 运行时报
 *   "Could not locate the bindings file"。保持 external, 运行时按 node_modules
 *   解析(打包阶段 E3 由 electron-builder 处理 asar unpack, 见 D-020 备注)。
 */
import { build } from "esbuild";

export async function buildElectron() {
  await build({
    entryPoints: {
      main: "electron/main.ts",
      preload: "electron/preload.ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron", "better-sqlite3"],
    outdir: "dist-electron",
    outExtension: { ".js": ".cjs" },
    sourcemap: true,
    logLevel: "info",
  });
}
