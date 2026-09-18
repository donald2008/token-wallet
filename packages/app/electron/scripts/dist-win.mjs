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
