/** 共享 esbuild 配置: 主进程/preload → dist-electron/*.cjs(electron 外部化, CJS 兼容 sandbox preload) */
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
