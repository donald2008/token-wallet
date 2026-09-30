/**
 * dist:win 打包入口 — 网络镜像自动探测
 *
 * 问题：electron-builder 拉 electron 二进制/nsis 工具走 github.com:443，
 * 墙内网络直连 GitHub 经常 ETIMEDOUT（20.205.243.166 等），导致打包失败。
 * 手动设 ELECTRON_MIRROR 又要求用户背系统知识（用户 9/8 拍板：零命令行）。
 *
 * 方案：启动打包前先探 github.com HTTPS 可达性（HEAD 真请求）——
 *   TCP 握手下中间设备可伪装「可达」而不通数据（2026-09-30 实锤卡死），不作数。
 *   - 可达 → 保持官方源（用户可能已配代理，不乱动）
 *   - 不可达 → 自动注入 npmmirror 镜像到子进程 env
 *
 * 用法：package.json "dist:win": "node electron/scripts/dist-win.mjs"
 *   （替代 electron-builder --win nsis）
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
const BUILDER_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/";

/** GitHub 可达探测（5s 超时）—— TCP 握手 ≠ 可下载: 墙内存在「握手成功但 TLS/数据流
 * 被阻断」的伪装场景（2026-09-30 实锤: TCP 探测判「可达」→ 官方源 → 下载卡死 SYN_SENT）。
 * 改用 HTTPS HEAD 真请求: 与 electron 下载同面, 重定向链首跳拿到响应头即视为可达
 * （2xx/3xx）; 任何异常（TLS reset/abort/DNS）→ 不可达 → 镜像。 */
async function probeGithubReachable(timeoutMs = 5000) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch("https://github.com/", {
      method: "HEAD",
      redirect: "manual",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  // ---- daemon 外置分发(2026-09-30): 构建产物作为发布附件物料, 不进安装包 ----
  // gitee release 附件 100MB 硬限: 内置 daemon 后安装包 118.5MB 超限被拒;
  // 故 daemon 独立附件分发(stable 固定名 token-wallet-mcp-win-x64.exe), 设置页
  // 一键下载到 <userData>/mcp/(mcp-daemon.ts installDaemon + defaultPathShim 候选)。
  // 打包前构建/校验 daemon(Windows 宿主自动跑 PyInstaller onefile), 打包成功后
  // 无条件复制为 release/ 物料; 缺产物 → fail-closed(发布链不完整)。
  const daemonExe = path.resolve(__dirname, "..", "..", "resources", "token-wallet-mcp.exe");
  const daemonBuildPs1 = path.resolve(
    __dirname, "..", "..", "..", "mcp-server", "deploy", "build-exe.ps1",
  );

  async function buildDaemon() {
    if (process.env.TW_SKIP_DAEMON_BUILD === "1") {
      console.log("[dist:win] TW_SKIP_DAEMON_BUILD=1 → 跳过 daemon 构建(显式豁免)");
      return true;
    }
    if (process.platform !== "win32") {
      // PyInstaller .exe 构建只能在 Windows 宿主跑; 非 win32 仅校验产物已在位
      // (跨机分工: WSL 侧开发/门禁, Windows 侧出包 — 见 README 构建链节)
      if (existsSync(daemonExe)) return true;
      console.error(
        `[dist:win] 非 Windows 宿主且缺 ${daemonExe} — 请先在 Windows 侧运行\n` +
        `  powershell -ExecutionPolicy Bypass -File packages\\mcp-server\\deploy\\build-exe.ps1\n` +
        `或设 TW_SKIP_DAEMON_BUILD=1 显式跳过(产物将 not_installed, 不建议)`,
      );
      return false;
    }
    if (!existsSync(daemonBuildPs1)) {
      console.error(`[dist:win] daemon 构建脚本缺失: ${daemonBuildPs1}`);
      return false;
    }
    console.log("[dist:win] 构建 MCP daemon sidecar (PyInstaller onefile)…");
    return new Promise((resolve) => {
      const ps = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", daemonBuildPs1],
        { stdio: "inherit" },
      );
      ps.on("exit", (code) => {
        if (code === 0 && existsSync(daemonExe)) return resolve(true);
        console.error(`[dist:win] daemon 构建失败 code=${code} 或产物缺失`);
        resolve(false);
      });
      ps.on("error", (err) => {
        console.error("[dist:win] 无法启动 powershell 构建 daemon:", err.message);
        resolve(false);
      });
    });
  }

  if (!(await buildDaemon())) {
    console.error(
      "[dist:win] 中止: daemon 产物未就绪 — release/ 附件物料无法生成, 用户端一键安装将 404。",
    );
    process.exit(1);
  }

  // 跨平台产物混放守卫: resources/ 只允许 .exe 形态 daemon 产物。
  // 2026-09-30 实锤: files 通配曾把 Linux 产物(无后缀, ~80MB)打入包体(94MB→207MB);
  // 现 daemon 已外置(files 不再收 resources/), 守卫防物料复制误用/未来 files 回归再踩。
  const resourcesDir = path.resolve(__dirname, "..", "..", "resources");
  if (existsSync(resourcesDir)) {
    const stray = readdirSync(resourcesDir).filter(
      (f) => f.startsWith("token-wallet-mcp") && !f.endsWith(".exe"),
    );
    if (stray.length > 0) {
      console.error(
        `[dist:win] 中止: resources/ 存在非 Windows 平台 daemon 产物 ${JSON.stringify(stray)} — ` +
          `物料复制/回归打包都会误用(错误分发或包体虚胖)。` +
          `请先移走(如 packages/mcp-server/build/)再重试。`,
      );
      process.exit(1);
    }
  }

  // 保险绳(9/30): 探测万一仍假阳性(握手层伪装), 显式 TW_FORCE_MIRROR=1 强制镜像
  const forceMirror = process.env.TW_FORCE_MIRROR === "1";
  if (forceMirror) console.log("[mirror] TW_FORCE_MIRROR=1 → 强制 npmmirror 镜像");
  const githubReachable = forceMirror ? false : await probeGithubReachable();

  // 子进程 env（含注入的镜像变量）
  const env = { ...process.env };

  if (githubReachable) {
    console.log("[mirror] github.com HTTPS 可达 → 使用官方源");
  } else {
    console.log("[mirror] github.com HTTPS 不可达 → 自动启用 npmmirror 镜像");
    env.ELECTRON_MIRROR = env.ELECTRON_MIRROR || ELECTRON_MIRROR;
    env.ELECTRON_BUILDER_BINARIES_MIRROR =
      env.ELECTRON_BUILDER_BINARIES_MIRROR || BUILDER_MIRROR;
    console.log(`[mirror] ELECTRON_MIRROR = ${env.ELECTRON_MIRROR}`);
    console.log(
      `[mirror] ELECTRON_BUILDER_BINARIES_MIRROR = ${env.ELECTRON_BUILDER_BINARIES_MIRROR}`,
    );
  }

  // electron-builder 二进制解析: pnpm 默认把 app 的 devDep shim 放
  // packages/app/node_modules/.bin(不提升); 仓库根 .bin 仅在提升场景存在。
  // 旧实现只查根路径 → 非提升安装直接 ENOENT(v0.2.9 发版实测)。
  // 候选按 [app 侧, 仓库根] 顺序取第一个存在的, 双缺 → 首选(保留原报错语义)。
  const binName = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
  const candidates = [
    path.resolve(__dirname, "..", "..", "node_modules", ".bin", binName),
    path.resolve(__dirname, "..", "..", "..", "..", "node_modules", ".bin", binName),
  ];
  const builderBin = candidates.find((p) => existsSync(p)) ?? candidates[0];

  console.log(`[dist:win] electron-builder → ${builderBin}`);
  const child = spawn(builderBin, ["--win", "nsis"], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });

  child.on("exit", (code, signal) => {
    if (code === 0) {
      // daemon 独立附件物料: 发布时上传 gitee stable 固定名(URL 与 mcp-daemon.ts
      // DEFAULT_DAEMON_DOWNLOAD_URL 常量对齐; 每次发版同名替换保持 URL 稳定)
      const artifact = path.resolve(
        __dirname, "..", "..", "release", "token-wallet-mcp-win-x64.exe",
      );
      try {
        copyFileSync(daemonExe, artifact);
        console.log(`[dist:win] 打包完成; daemon 附件物料 → ${artifact}`);
      } catch (err) {
        console.error(`[dist:win] daemon 物料复制失败: ${err.message}`);
        process.exit(1);
      }
    } else {
      console.error(
        `[dist:win] 打包失败 code=${code} signal=${signal ?? ""}`,
      );
      process.exit(code ?? 1);
    }
  });
  child.on("error", (err) => {
    console.error("[dist:win] 无法启动 electron-builder:", err.message);
    process.exit(1);
  });
}

main();
