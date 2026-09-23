/**
 * dist:win 打包入口 — 网络镜像自动探测
 *
 * 问题：electron-builder 拉 electron 二进制/nsis 工具走 github.com:443，
 * 墙内网络直连 GitHub 经常 ETIMEDOUT（20.205.243.166 等），导致打包失败。
 * 手动设 ELECTRON_MIRROR 又要求用户背系统知识（用户 9/8 拍板：零命令行）。
 *
 * 方案：启动打包前先探 github.com:443 连通性 ——
 *   - 可达 → 保持官方源（用户可能已配代理，不乱动）
 *   - 不可达 → 自动注入 npmmirror 镜像到子进程 env
 *
 * 用法：package.json "dist:win": "node electron/scripts/dist-win.mjs"
 *   （替代 electron-builder --win nsis）
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
const BUILDER_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/";

/** TCP 连通性探测（3s 超时）—— 不依赖 curl/外部命令，跨平台 */
function probeTcp(host, port = 443, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function main() {
  // ---- lite-01(t_aeb0447b): daemon sidecar 随包分发 ----
  // 独立产品铁律: daemon = app 托管 sidecar, 必须随 NSIS 安装包分发(设置页 MCP 服务
  // 面板探测 <appRoot>/resources/token-wallet-mcp.exe, mcp-daemon.ts defaultPathShim)。
  // 打包前先构建 daemon(Windows 宿主自动跑 PyInstaller onefile), 缺产物 → fail-closed。
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
      "[dist:win] 中止: daemon sidecar 未就绪 — NSIS 安装包缺它时设置页 MCP 服务必然 not_installed。",
    );
    process.exit(1);
  }

  const githubReachable = await probeTcp("github.com", 443);

  // 子进程 env（含注入的镜像变量）
  const env = { ...process.env };

  if (githubReachable) {
    console.log("[mirror] github.com:443 可达 → 使用官方源");
  } else {
    console.log("[mirror] github.com:443 不可达 → 自动启用 npmmirror 镜像");
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
      console.log("[dist:win] 打包完成");
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
