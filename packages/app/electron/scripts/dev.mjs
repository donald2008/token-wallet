/**
 * dev  runner: esbuild 编译主进程/preload → 起 vite dev server → 等端口 → 起 Electron。
 * `pnpm dev` = Electron 真壳(D-033); 浏览器独立预览用 `pnpm dev:web`。
 */
import { spawn } from "node:child_process";
import * as http from "node:http";
import { buildElectron } from "./esbuild.config.mjs";

const DEV_URL = "http://127.0.0.1:1420";

function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() > deadline) reject(new Error(`dev server 未就绪: ${url}`));
          else setTimeout(tick, 300);
        });
    };
    tick();
  });
}

const children = [];
function run(cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* already dead */
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await buildElectron();
run("pnpm", ["exec", "vite"]);
await waitForServer(DEV_URL);
const electronBin = process.platform === "win32" ? "electron.cmd" : "electron";
// WSL/容器以 root 跑 dev 时 Chromium sandbox 必须关(仅 dev runner, 生产打包不涉及)
const extraArgs =
  process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0
    ? ["--no-sandbox"]
    : [];
run(electronBin, [".", ...extraArgs], { ELECTRON_RENDERER_URL: DEV_URL }).on("exit", (code) => {
  shutdown(code ?? 0);
});
