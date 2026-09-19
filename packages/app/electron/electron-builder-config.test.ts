import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * lite-01(t_aeb0447b): daemon sidecar 随包分发 — electron-builder 配置门禁。
 *
 * 历史欠账: defaultPathShim(mcp-daemon.ts) 探测 <appRoot>/resources/token-wallet-mcp.exe,
 * 但打包配置从未把 daemon 产物收进包 → 装出的 app 必然 not_installed。
 * 本测试锁死三件契约, 防回归:
 *   1. build.files 收 resources/token-wallet-mcp*(进 asar, appRoot=asar 根即探测根)
 *   2. build.asarUnpack 排除同 glob(原生 PE 无法从 asar 内 spawn, 必须落实体文件;
 *      Electron fs 透明重定向保持 resolveDaemonPath 的 existsSync 语义不变)
 *   3. dist:win 构建链串联 daemon PyInstaller 构建(fail-closed + TW_SKIP_DAEMON_BUILD 豁免阀)
 *      —— 产物经 gitignore 不入库, 故此处断言脚本接线(静态)而非 exe 本体。
 */

const pkgJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

describe("lite-01: daemon sidecar 随包分发接线(electron-builder)", () => {
  it("build.files 收录 resources/token-wallet-mcp*(探测路径 = asar 根/resources)", () => {
    const files: string[] = pkgJson.build?.files ?? [];
    const hit = files.find((f) => f.includes("resources/token-wallet-mcp"));
    expect(hit, "build.files 缺 resources/token-wallet-mcp* — daemon 不进包").toBeTruthy();
  });

  it("build.asarUnpack 排除 resources/token-wallet-mcp*(原生 PE 必须落实体文件)", () => {
    const unpack: string[] = pkgJson.build?.asarUnpack ?? [];
    const hit = unpack.find((f) => f.includes("resources/token-wallet-mcp"));
    expect(
      hit,
      "asarUnpack 缺 resources/token-wallet-mcp* — exe 若留在 asar 内无法 spawn",
    ).toBeTruthy();
  });

  it("defaultPathShim 探测路径与打包落点对齐(join(appRoot,'resources',exe))", () => {
    // 契约锚: mcp-daemon.ts defaultPathShim 的 candidate = path.join(appRoot,"resources",exe)
    // 打包态 appRoot = app.getAppPath() = resources/app.asar → files 收进 asar 根 resources/。
    // 本断言锁 glob 与探测目录一致, 改探测逻辑或改打包落点任一侧都必须同步此测试。
    const files: string[] = pkgJson.build?.files ?? [];
    const hit = files.find((f) => f === "resources/token-wallet-mcp*");
    expect(hit).toBe("resources/token-wallet-mcp*");
  });

  it("dist:win 串联 daemon 构建(fail-closed, TW_SKIP_DAEMON_BUILD 豁免阀)", async () => {
    const script = readFileSync(
      new URL("../electron/scripts/dist-win.mjs", import.meta.url),
      "utf-8",
    );
    expect(script).toContain("build-exe.ps1");
    expect(script).toContain("TW_SKIP_DAEMON_BUILD");
    expect(script).toContain("token-wallet-mcp.exe");
  });
});
