/** 共享 esbuild 配置: 主进程/preload → dist-electron/*.cjs(electron 外部化, CJS 兼容 sandbox preload) */
/**
 * external 说明:
 * - electron: 运行时由 Electron 提供, 不打入 bundle。
 * - (D-034 起无原生模块: SQLite 走 node:sqlite 内置, 不再需要 external 原生依赖)
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
    external: ["electron"],
    outdir: "dist-electron",
    outExtension: { ".js": ".cjs" },
    sourcemap: true,
    logLevel: "info",
  });
}
