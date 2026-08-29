/** 生产构建: 主进程/preload 打包(vite build 由 package.json scripts 串行接上) */
import { buildElectron } from "./esbuild.config.mjs";

await buildElectron();
console.log("[electron] main/preload → dist-electron/*.cjs");
