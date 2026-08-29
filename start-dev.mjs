#!/usr/bin/env node
/**
 * token-wallet 一键开发启动 — 环境检查 → 依赖就绪 → 起 Electron dev 壳。
 *
 * 用法:
 *   node start-dev.mjs           # 全流程: 检查 → 安装 → 起真壳(pnpm dev)
 *   node start-dev.mjs --check   # 只检查+安装依赖, 不起壳(首次准备 / CI 冒烟)
 *   node start-dev.mjs --web     # 起浏览器预览(pnpm dev:web) —— 无主进程, 不能联调
 *   node start-dev.mjs --force   # 强制重装依赖(node_modules 疑似脏时)
 *
 * Windows 可直接双击 start-dev.cmd。
 *
 * 设计约束:
 * - 零第三方依赖(纯 node stdlib), 与 D-002"不引组件库"同精神
 * - 版本要求不硬编码: Node 下限读 package.json engines.node, pnpm 版本读 packageManager
 * - 幂等: 重复运行安全; 依赖已就绪时跳过安装
 * - D-034 后无原生模块 → 不需要任何 rebuild 步骤; 若检测到 better-sqlite3 残留会提示清理
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const IS_WIN = process.platform === "win32";
const argv = new Set(process.argv.slice(2));
const CHECK_ONLY = argv.has("--check");
const WEB_MODE = argv.has("--web");
const FORCE_INSTALL = argv.has("--force");

// ---- 输出 ----------------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);
const green = (s) => c("32", s);
const yellow = (s) => c("33", s);
const red = (s) => c("31", s);

let step = 0;
const info = (msg) => console.log(`${bold(`[${++step}]`)} ${msg}`);
const ok = (msg) => console.log(`    ${green("✓")} ${msg}`);
const warn = (msg) => console.log(`    ${yellow("!")} ${msg}`);

/** 失败即停，并给出可操作的下一步（而不是丢一个栈） */
function fail(what, hints = []) {
  console.error(`\n${red("✗ 启动中止:")} ${what}`);
  for (const h of hints) console.error(`  → ${h}`);
  process.exit(1);
}

/** 同步执行并返回 {code, stdout}; 失败不抛，由调用方决定 */
function run(cmd, args, { capture = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    shell: IS_WIN, // Windows 下 pnpm/corepack 是 .cmd shim，必须过 shell
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  return { code: r.status, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

// ---- 1. 读项目声明（单一真相源，不硬编码版本） ----------------------------
info("读取项目版本声明");
const pkgPath = path.join(ROOT, "package.json");
if (!fs.existsSync(pkgPath)) {
  fail(`未找到 package.json（当前目录: ${ROOT}）`, [
    "请把本脚本放在 token-wallet 仓库根目录后再运行",
  ]);
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const nodeReq = pkg.engines?.node ?? ">=22";
const pmSpec = pkg.packageManager ?? "pnpm@9"; // 形如 pnpm@9.15.0
const [pmName, pmVersion] = pmSpec.split("@");
ok(`要求 Node ${nodeReq} · 包管理器 ${pmSpec}`);

// ---- 2. Node 版本 --------------------------------------------------------
info("检查 Node 版本");
const minMajor = Number(String(nodeReq).replace(/[^\d.]/g, "").split(".")[0] || 22);
const curMajor = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(minMajor) && curMajor < minMajor) {
  fail(`Node 版本过低: 当前 v${process.versions.node}，需要 ${nodeReq}`, [
    "从 https://nodejs.org 安装 LTS（22 或更高）后重开终端",
    "已装多版本可用 nvm/fnm 切换",
  ]);
}
ok(`Node v${process.versions.node}`);

// ---- 3. pnpm 就绪（corepack 激活声明版本） --------------------------------
info(`检查 ${pmName}`);
let pm = run(pmName, ["--version"], { capture: true });
if (pm.code !== 0 || !pm.stdout) {
  warn(`${pmName} 不可用，尝试用 corepack 启用`);
  if (run("corepack", ["enable"], { capture: true }).code !== 0) {
    fail("corepack enable 失败", [
      "Windows 请以管理员身份重开一个终端后重试",
      `或手动安装: npm i -g ${pmSpec}`,
    ]);
  }
  run("corepack", ["prepare", pmSpec, "--activate"], { capture: true });
  pm = run(pmName, ["--version"], { capture: true });
  if (pm.code !== 0) {
    fail(`${pmName} 仍不可用`, [`手动安装后重试: npm i -g ${pmSpec}`]);
  }
}
if (pmVersion && pm.stdout !== pmVersion) {
  warn(`${pmName} 当前 ${pm.stdout}，项目声明 ${pmVersion} — 用 corepack 对齐`);
  run("corepack", ["enable"], { capture: true });
  run("corepack", ["prepare", pmSpec, "--activate"], { capture: true });
  const after = run(pmName, ["--version"], { capture: true });
  ok(`${pmName} ${after.stdout || pm.stdout}${after.stdout === pmVersion ? "（已对齐）" : ""}`);
} else {
  ok(`${pmName} ${pm.stdout}`);
}

// ---- 4. 历史残留体检（D-034 前的原生模块） --------------------------------
info("检查依赖树健康度");
const appNativeLink = path.join(ROOT, "packages", "app", "node_modules", "better-sqlite3");
if (fs.existsSync(appNativeLink)) {
  warn("检测到 better-sqlite3 残留（D-034 已改用内置 node:sqlite）");
  warn("这通常是从旧版本升上来的脏 node_modules，建议清理后重装：");
  console.log(
    dim(
      IS_WIN
        ? '      rmdir /s /q node_modules packages\\app\\node_modules && node start-dev.mjs'
        : "      rm -rf node_modules packages/*/node_modules && node start-dev.mjs",
    ),
  );
} else {
  ok("无原生模块残留（node:sqlite 内置，无需 rebuild）");
}

// ---- 5. 依赖安装（幂等：已就绪则跳过） ------------------------------------
info("准备依赖");
const lockPath = path.join(ROOT, "pnpm-lock.yaml");
const nmPath = path.join(ROOT, "node_modules");
const mtime = (p) => (fs.existsSync(p) ? fs.statSync(p).mtimeMs : 0);
const needInstall = FORCE_INSTALL || !fs.existsSync(nmPath) || mtime(lockPath) > mtime(nmPath);

if (needInstall) {
  console.log(dim(`    ${pmName} install${FORCE_INSTALL ? "（--force）" : ""}…`));
  if (run(pmName, ["install"]).code !== 0) {
    fail(`${pmName} install 失败`, [
      "检查网络 / 代理；国内可设镜像后重试：",
      `  ${pmName} config set registry https://registry.npmmirror.com`,
      "Electron 二进制下载慢可加环境变量 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/",
    ]);
  }
  ok("依赖安装完成");
} else {
  ok("依赖已就绪（lock 未变动，跳过安装）");
}

if (CHECK_ONLY) {
  console.log(`\n${green("环境就绪")} — 起壳请运行: ${bold(`${pmName} dev`)}`);
  process.exit(0);
}

// ---- 6. 起壳 ------------------------------------------------------------
const target = WEB_MODE ? "dev:web" : "dev";
info(WEB_MODE ? "启动浏览器预览（无主进程）" : "启动 Electron dev 壳");
if (WEB_MODE) {
  warn("dev:web 无主进程 → 无钥匙串/无 SQLite，仅看 UI，不能做真链路联调");
} else {
  console.log(dim("    esbuild 主进程/preload → vite :1420 → Electron 起窗"));
  console.log(dim("    首开会出隐私声明页；托盘图标在系统托盘区。Ctrl+C 结束"));
}

const child = spawn(pmName, ["run", target], {
  cwd: ROOT,
  shell: IS_WIN,
  stdio: "inherit",
});
const stop = (sig) => () => {
  try {
    child.kill(sig);
  } catch {
    /* already gone */
  }
};
process.on("SIGINT", stop("SIGINT"));
process.on("SIGTERM", stop("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (e) =>
  fail(`无法启动 ${pmName} run ${target}: ${e.message}`, [
    `手动运行看详细报错: ${pmName} run ${target}`,
  ]),
);
