import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DAEMON_DOWNLOAD_URL, defaultPathShim } from "./mcp-daemon";

/**
 * daemon 分发形态契约门禁(2026-09-30 改: 随包 → 独立附件 + 一键安装)。
 *
 * 起因: gitee release 附件 100MB 硬限, 内置 daemon 后安装包 118.5MB 超限被拒 →
 * daemon 出包为稳定附件, 用户端设置页一键下载到 <userData>/mcp/。
 * 本测试锁死新契约链(与 mcp-daemon.ts installDaemon 同源), 防回归:
 *   1. build.files 不收 resources/token-wallet-mcp*(daemon 不进安装包, 包体瘦身前提)
 *   2. build.asarUnpack 同不收(包内无 exe 即无需解包)
 *   3. dist:win 构建产物复制为 release/ 上传物料(stable 固定名)
 *   4. 下载 URL 常量 ↔ 物料文件名(改任一侧必须同步)
 *   5. defaultPathShim 外置候选(<userData>/mcp/) 与缺省旧行为兼容
 */

const pkgJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

const distWinScript = readFileSync(
  new URL("../electron/scripts/dist-win.mjs", import.meta.url),
  "utf-8",
);

describe("daemon 外置分发接线(electron-builder)", () => {
  it("build.files 不收 daemon(不进安装包; 100MB 附件限的瘦身前提)", () => {
    const files: string[] = pkgJson.build?.files ?? [];
    const hit = files.find((f) => f.includes("token-wallet-mcp"));
    expect(hit, "build.files 仍收 daemon — 包体将超 gitee 附件上限").toBeUndefined();
  });

  it("build.asarUnpack 不含 daemon(包内无 exe 即无需解包)", () => {
    const unpack: string[] = pkgJson.build?.asarUnpack ?? [];
    const hit = unpack.find((f) => f.includes("token-wallet-mcp"));
    expect(hit, "asarUnpack 仍列 daemon — 与 files 契约矛盾(应收 0 项)").toBeUndefined();
  });

  it("dist:win 复制 daemon 为 release/ 上传物料(stable 固定名)", () => {
    expect(distWinScript).toContain("build-exe.ps1");
    expect(distWinScript).toContain("TW_SKIP_DAEMON_BUILD");
    expect(distWinScript).toContain("token-wallet-mcp-win-x64.exe");
    expect(distWinScript, "物料复制步骤缺失 — release/ 将无附件可传").toContain(
      "copyFileSync",
    );
  });

  it("下载 URL 常量 ↔ 物料文件名对齐(改任一侧必须同步)", () => {
    // 契约锚: mcp-daemon.ts DEFAULT_DAEMON_DOWNLOAD_URL 末尾文件名 = dist:win 物料名
    expect(DEFAULT_DAEMON_DOWNLOAD_URL).toContain("token-wallet-mcp-win-x64.exe");
    expect(distWinScript).toContain("token-wallet-mcp-win-x64.exe");
  });

  it("defaultPathShim 外置候选: 包内不存在 → <userData>/mcp/(与 installDaemon 落点同源)", () => {
    const shim = defaultPathShim({ userDataDir: "/u" });
    const p = shim.resolveDaemonPath("win32", true, "/opt/nonexistent/resources/app.asar");
    expect(p).toBe(path.join("/u", "mcp", "token-wallet-mcp.exe"));
  });

  it("defaultPathShim 缺省(无 userDataDir): 保持旧行为(兼容历史调用方/测试)", () => {
    // Electron 不 patch child_process.spawn — 打包态重映射 .asar → .asar.unpacked 的
    // 探测语义在「包内物理存在」分支仍然承载(dev/历史形态)。
    const shim = defaultPathShim();
    const p = shim.resolveDaemonPath("win32", true, "<install>/resources/app.asar");
    expect(p).toContain("app.asar.unpacked/resources/token-wallet-mcp.exe");
  });
});
