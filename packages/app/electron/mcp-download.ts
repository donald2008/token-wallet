/**
 * daemon 下载实现(Electron net) — DownloadShim 的生产注入(mcp-ipc 装配)。
 *
 * net.request 走 Chromium 网络栈(系统代理/证书链与 app 其他请求一致)。
 * 零依赖原则互补: mcp-daemon.ts 保持纯净, electron 相关全部收在本文件。
 * gitee release 下载会 302 到 cdn 域 — net.request 默认跟随重定向(勿改 manual)。
 */
import { net } from "electron";
import { createWriteStream, unlinkSync } from "node:fs";
import type { DownloadShim } from "./mcp-daemon";

export function netDownloadShim(): DownloadShim {
  return {
    download: (url, destPath, onProgress) =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (e: Error) => {
          if (settled) return;
          settled = true;
          try {
            unlinkSync(destPath);
          } catch {
            /* 半文件清理尽力而为 */
          }
          reject(e);
        };
        const request = net.request(url);
        request.on("response", (response) => {
          if (response.statusCode !== 200) {
            fail(new Error(`http_${response.statusCode}`));
            request.abort();
            return;
          }
          const cl = response.headers["content-length"];
          const total = typeof cl === "string" ? Number(cl) : 0;
          let received = 0;
          const ws = createWriteStream(destPath);
          ws.on("error", fail);
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (total > 0) onProgress(Math.min(99, Math.round((received / total) * 100)));
            // Electron net(37) 无 pause/pipe 流控 API(实证): 30MB 量级直接写,
            // 缓冲上限=文件大小, 可接受; 超大文件场景应换 node:http 模块。
            ws.write(chunk);
          });
          response.on("end", () => ws.end());
          ws.on("finish", () => {
            if (settled) return;
            settled = true;
            onProgress(100);
            resolve();
          });
          response.on("error", fail);
        });
        request.on("error", (e: Error) => fail(e));
        request.end();
      }),
  };
}
