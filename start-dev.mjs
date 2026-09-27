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
 * - 产物新鲜度: core dist / MCP daemon 构建产物落后于 git HEAD 时启动前自动重建
 *   (marker 对比, 禁 mtime; TW_SKIP_CORE_BUILD=1 / TW_SKIP_DAEMON_BUILD=1 豁免)
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

// core dist 新鲜度判定路径(5.5 段实现; --check 块在 5.5 之前执行, 常量必须在此声明)
const coreDistDir = path.join(ROOT, "packages", "core", "dist");
const coreMarkerPath = path.join(coreDistDir, ".tw-build-id");

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

if (CHECK_ONLY && !WEB_MODE) {
  // --check 也报告产物新鲜度(只报告不构建 — CI/首次准备场景需要知道会不会卡构建)
  info("检查 core dist 产物新鲜度");
  const cs = coreStaleness();
  if (!cs.stale) {
    ok(cs.reason === "fresh" ? `core dist 与当前代码一致(${cs.builtHash})` : "git 不可用, 跳过新鲜度判定");
  } else {
    const why =
      cs.reason === "missing"
        ? "产物不存在(起壳时将自动构建)"
        : cs.reason === "no_marker"
          ? "产物无构建标记(起壳时将自动重建)"
          : `产物构建于 ${cs.builtHash} ≠ 当前 ${cs.headHash}(起壳时将自动重建)`;
    console.log(`    ${yellow("!")} core dist 陈旧 — ${why}`);
  }
  info("检查 MCP daemon 产物新鲜度");
  const st = daemonStaleness();
  if (!st.stale) {
    ok(st.reason === "fresh" ? `daemon 与当前代码一致(${st.builtHash})` : "git 不可用, 跳过新鲜度判定");
  } else {
    const why = st.reason === "missing" ? "产物不存在(起壳时将自动构建)" : st.reason === "no_marker" ? "产物无构建标记(起壳时将自动重建)" : `产物构建于 ${st.builtHash} ≠ 当前 ${st.headHash}(起壳时将自动重建)`;
    console.log(`    ${yellow("!")} daemon 陈旧 — ${why}`);
  }
  console.log(`\n${green("环境就绪")} — 起壳请运行: ${bold(`${pmName} dev`)}`);
  process.exit(0);
}

// ---- 5.5 core dist 产物新鲜度(t_4106ff2e: 9/27 真机第三实例) -----------------
// 问题背景: app/mcp-server 经 exports 解析 packages/core/dist/*.js, dist 不进 git —
// git pull 前进后 dist 不跟着变 → 用户真机踩实锤(pull 了 login_url 修复源码, app 读旧
// dist, 授权窗仍开旧地址); CI 全新 checkout 同款坑(skill 已记档)。pnpm run dev 不 build core。
// 新鲜度判定: 读 dist/.tw-build-id marker 的 <git短hash> 段 vs 当前 HEAD 短hash —
//   一致 → 新鲜跳过(日常启动零等待); 不一致/缺失/解析失败 → 陈旧, 现场重建。
//   禁 mtime 对比(git checkout 会把 mtime 刷成 checkout 时刻, 旧产物反而显"新")。
// marker 注入: packages/core build 脚本构建完成后写(stamp-build-id.mjs), 不依赖调用方。
// 豁免: TW_SKIP_CORE_BUILD=1(与 TW_SKIP_DAEMON_BUILD 同款约定)。
// --check: 只报告不构建; --web 模式同样生效(vite dev:web 也解析 core dist)。
// (coreDistDir/coreMarkerPath 声明在文件头, --check 块先行消费)

function readCoreGitHash() {
  try {
    const text = fs.readFileSync(coreMarkerPath, "utf8");
    const m = text.match(/TW_CORE_BUILD_ID=([0-9a-f]+)-/);
    return m ? m[1] : null;
  } catch {
    return null; // 文件不存在/不可读 → 无 marker
  }
}

function coreStaleness() {
  const entry = path.join(coreDistDir, "index.js");
  if (!fs.existsSync(entry)) return { stale: true, reason: "missing" };
  const builtHash = readCoreGitHash();
  if (!builtHash) return { stale: true, reason: "no_marker" };
  let headHash = null;
  try {
    headHash = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  } catch { /* git 不可用 → 视为无法判定 */ }
  if (!headHash) return { stale: false, reason: "no_git" }; // 无法判定时不折腾(保守跳过)
  return { stale: builtHash !== headHash, reason: builtHash !== headHash ? "stale_hash" : "fresh", builtHash, headHash };
}

function buildCore() {
  console.log(dim(`    ${pmName} -C packages/core build…`));
  if (run(pmName, ["-C", path.join("packages", "core"), "build"]).code !== 0) return false;
  // 复验 marker 在位(构建脚本自带注入, 缺失 = 脚本被改动, 显式报错不静默)
  return fs.existsSync(coreMarkerPath);
}

if (process.env.TW_SKIP_CORE_BUILD !== "1") {
  info("检查 core dist 产物新鲜度");
  const cs = coreStaleness();
  if (!cs.stale) {
    ok(cs.reason === "fresh" ? `core dist 与当前代码一致(${cs.builtHash})` : "git 不可用, 跳过新鲜度判定");
  } else {
    const why =
      cs.reason === "missing"
        ? "产物不存在"
        : cs.reason === "no_marker"
          ? "产物无构建标记(太旧)"
          : `产物构建于 ${cs.builtHash}, 当前代码 ${cs.headHash}`;
    console.log(`    ${yellow("!")} core dist 陈旧 — ${why}`);
    console.log(dim("    提示: core build 约 10-30 秒; 跳过请设 TW_SKIP_CORE_BUILD=1"));
    if (!buildCore()) {
      fail("core dist 重建失败", [
        "看上方 tsc 报错; 或手动执行: corepack pnpm -C packages/core build",
        "确认要用旧产物启动可设 TW_SKIP_CORE_BUILD=1(app 可能行为不符)",
      ]);
    }
    // 复验: 重建后产物必须在位且标记与 HEAD 一致
    const after = coreStaleness();
    if (after.stale) {
      fail("core dist 重建后仍陈旧", [`build_id=${after.builtHash ?? "(无)"} vs HEAD=${after.headHash ?? "(无)"} — 检查 packages/core build 脚本的 marker 注入段`]);
    }
    ok(`core dist 已重建(${after.headHash})`);
  }
} else {
  info("core dist 构建检查 — TW_SKIP_CORE_BUILD=1 豁免跳过");
}

// ---- 5.6 MCP daemon 产物新鲜度(9/24 老大提议: 「启动前重新构建 mcp 服务(如果需要的话)」) ----
// 问题背景: daemon = resources/ 下的 PyInstaller 现场构建产物(不进 git), 代码前进后 exe 不会跟着变 —
// 两次真机事故同根(置顶折线 hour 维缺数据 / guide 旧版): UI 新 daemon 旧, 排障绕远。
// 新鲜度判定: 读产物尾部 TW_MCP_BUILD_ID marker 的 <git短hash> 段 vs 当前 HEAD 短hash —
//   一致 → 新鲜跳过(日常启动零等待); 不一致/缺失/解析失败 → 陈旧, 现场重建。
// 豁免: TW_SKIP_DAEMON_BUILD=1(与 dist:win 同款约定); --web 模式无 daemon 不检查。
// 跨平台: win=build-exe.ps1; linux/mac=PyInstaller 直调(exe-entry.py 平台无关)。
function daemonExePath() {
  return path.join(ROOT, "packages", "app", "resources", IS_WIN ? "token-wallet-mcp.exe" : "token-wallet-mcp");
}

function readDaemonGitHash(exePath) {
  try {
    const fd = fs.openSync(exePath, "r");
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(4096, size); // marker 附着在文件尾(最后一个写入块)
    const buf = Buffer.alloc(tailLen);
    fs.readSync(fd, buf, 0, tailLen, size - tailLen);
    fs.closeSync(fd);
    const m = buf.toString("latin1").match(/TW_MCP_BUILD_ID=([0-9a-f]+)-/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function daemonStaleness() {
  const exePath = daemonExePath();
  if (!fs.existsSync(exePath)) return { stale: true, reason: "missing" };
  const builtHash = readDaemonGitHash(exePath);
  if (!builtHash) return { stale: true, reason: "no_marker" };
  let headHash = null;
  try {
    headHash = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  } catch { /* git 不可用 → 视为无法判定 */ }
  if (!headHash) return { stale: false, reason: "no_git" }; // 无法判定时不折腾(保守跳过)
  return { stale: builtHash !== headHash, reason: builtHash !== headHash ? "stale_hash" : "fresh", builtHash, headHash };
}

function buildDaemon() {
  const ps1 = path.join(ROOT, "packages", "mcp-server", "deploy", "build-exe.ps1");
  if (IS_WIN) {
    if (!fs.existsSync(ps1)) {
      warn(`daemon 构建脚本缺失: ${ps1}`);
      return false;
    }
    console.log(dim("    powershell -ExecutionPolicy Bypass -File packages\\mcp-server\\deploy\\build-exe.ps1"));
    const r = spawnSync(
      "powershell",
      ["-ExecutionPolicy", "Bypass", "-File", ps1],
      { stdio: "inherit" },
    );
    return r.status === 0;
  }
  // linux/mac: PyInstaller 直调(与 build-exe.ps1 同参, exe-entry.py 平台无关)
  console.log(dim("    python -m PyInstaller --onefile … (deploy/exe-entry.py)"));
  const specDir = path.join(ROOT, "packages", "mcp-server", "build");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(
    path.join(specDir, "token-wallet-mcp.spec"),
    `# -*- mode: python ; coding: utf-8 -*-\n` +
    `from PyInstaller.utils.hooks import copy_metadata\n` +
    `MD_PKGS = ['fastmcp','fastmcp-slim','mcp','mcp-types','pydantic','pydantic-settings','anyio','starlette','sse-starlette','uvicorn','httpx','httpcore','click','h11','certifi','idna','sniffio','typing_extensions','annotated_types']\n` +
    `def _has(p):\n` +
    `    try:\n` +
    `        copy_metadata(p); return True\n` +
    `    except Exception: return False\n` +
    `def _extra_datas():\n` +
    `    return []\n` +
    `a = Analysis(['${path.join(ROOT, "packages", "mcp-server", "deploy", "exe-entry.py")}'],\n` +
    `    pathex=['${path.join(ROOT, "packages", "mcp-server", "src")}'],\n` +
    `    hiddenimports=['fastmcp','fastmcp.server','fastmcp.client','fastmcp.tools','fastmcp.prompts',\n` +
    `      'fastmcp.resources','fastmcp.server.server','fastmcp.server.http','fastmcp.server.middleware',\n` +
    `      'fastmcp.server.auth','fastmcp.exceptions','fastmcp.mcp_config','fastmcp.utilities',\n` +
    `      'mcp','mcp.server','mcp.server.fastmcp','mcp.shared','tzdata','uvicorn',\n` +
    `      'uvicorn.logging','uvicorn.loops.auto','uvicorn.protocols.http.auto',\n` +
    `      'uvicorn.protocols.websockets.auto','uvicorn.lifespan.on','uvicorn.lifespan.off',\n` +
    `      'anyio._backends._asyncio','email_validator','pydantic','pydantic_settings'],\n` +
    `    noarchive=False,\n` +
    `    datas=[md_t for p in MD_PKGS if _has(p) for md_t in copy_metadata(p)] + _extra_datas(),\n` +
    `pyz = PYZ(a.pure)\n` +
    `exe = EXE(pyz, a.scripts, a.binaries, a.datas, name='token-wallet-mcp', console=True,\n` +
    `    distpath='${path.join(ROOT, "packages", "app", "resources")}', workpath='${specDir}')\n`,
  );
  const r = spawnSync("python3", ["-m", "PyInstaller", "--noconfirm", path.join(specDir, "token-wallet-mcp.spec")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (r.status !== 0) return false;
  // PyInstaller spec 模式忽略 EXE(distpath=...) → 产物固定落 <cwd>/dist/, 手动移入 resources/
  const built = path.join(ROOT, "dist", "token-wallet-mcp");
  if (!fs.existsSync(built)) {
    warn(`构建完成但未找到产物: ${built}`);
    return false;
  }
  fs.mkdirSync(distDir, { recursive: true });
  fs.renameSync(built, path.join(distDir, "token-wallet-mcp"));
  // marker 附着(与 build-exe.ps1 同格式): <git短hash>-<UTC ts>, 追加到产物尾 —
  // 新鲜度判定(daemonStaleness)与 app 侧 build_id 比对都依赖它, 缺失 = 每次启动都判陈旧
  let gitShort = "nogit";
  try {
    gitShort = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim() || "nogit";
  } catch { /* keep nogit */ }
  const buildId = `${gitShort}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  const exePath = path.join(distDir, "token-wallet-mcp");
  fs.appendFileSync(exePath, `\n# TW_MCP_BUILD_ID=${buildId}\n`);
  return true;
}

if (!WEB_MODE && process.env.TW_SKIP_DAEMON_BUILD !== "1") {
  info("检查 MCP daemon 产物新鲜度");
  const st = daemonStaleness();
  if (!st.stale) {
    ok(st.reason === "fresh" ? `daemon 与当前代码一致(${st.builtHash})` : "git 不可用, 跳过新鲜度判定");
  } else {
    const why = st.reason === "missing" ? "产物不存在" : st.reason === "no_marker" ? "产物无构建标记(太旧)" : `产物构建于 ${st.builtHash}, 当前代码 ${st.headHash}`;
    console.log(`    ${yellow("!")} daemon 陈旧 — ${why}`);
    if (process.env.TW_SKIP_DAEMON_BUILD_PROMPT !== "1") {
      console.log(dim("    提示: 重建约 2-5 分钟; 跳过请设 TW_SKIP_DAEMON_BUILD=1"));
    }
    if (!buildDaemon()) {
      fail("MCP daemon 重建失败", [
        "看上方 PyInstaller/PowerShell 报错; 常见为缺 python 依赖(脚本会自动 pip 装)",
        "确认要跳过可设 TW_SKIP_DAEMON_BUILD=1(将用旧产物启动, MCP 面板可能行为不符)",
      ]);
    }
    // 复验: 重建后产物必须在位且标记与 HEAD 一致
    const after = daemonStaleness();
    if (after.stale) {
      fail("daemon 重建后仍陈旧", [`build_id=${after.builtHash ?? "(无)"} vs HEAD=${after.headHash ?? "(无)"} — 检查 build-exe 脚本的 marker 注入段`]);
    }
    ok(`daemon 已重建(${after.headHash})`);
  }
} else if (!WEB_MODE) {
  info("MCP daemon 构建检查 — TW_SKIP_DAEMON_BUILD=1 豁免跳过");
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
