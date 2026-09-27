#!/usr/bin/env node
/**
 * core build marker 注入(t_4106ff2e) — 构建完成后在 dist/ 旁挂 .tw-build-id:
 *   TW_CORE_BUILD_ID=<git短hash>-<UTC yyyymmddHHMMss>
 * start-dev.mjs 的 coreStaleness() 用它做产物新鲜度判定(vs 当前 HEAD)。
 *
 * 为什么不用 mtime: git checkout 会把文件 mtime 刷成 checkout 时刻, 旧产物反而显"新"。
 * 为什么不写进 dist 文件尾: tsc 产物是 .js/.d.ts 明文, 旁挂 marker 零侵入。
 * git 不可用时写 "nogit" 占位 — start-dev 侧读不到合法 hash 会判陈旧并现场重建, 不静默。
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // packages/core
const distDir = path.join(coreDir, "dist");
if (!fs.existsSync(path.join(distDir, "index.js"))) {
  console.error("[stamp-build-id] dist/index.js 不存在 — build 未产出, 不写 marker");
  process.exit(1);
}
let gitShort = "nogit";
try {
  gitShort =
    spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: coreDir, encoding: "utf8" }).stdout.trim() ||
    "nogit";
} catch {
  /* keep nogit */
}
const buildId = `${gitShort}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
fs.writeFileSync(path.join(distDir, ".tw-build-id"), `TW_CORE_BUILD_ID=${buildId}\n`);
console.log(`[stamp-build-id] dist/.tw-build-id = ${buildId}`);
