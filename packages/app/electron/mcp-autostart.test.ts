// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readMcpAutostart, resolveOsAutostart, writeMcpAutostart } from "./mcp-autostart";
import { readSettingsFile } from "./persist";

function tempSettingsFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-autostart-"));
  return path.join(dir, "settings.json");
}

describe("mcp-autostart: resolveOsAutostart (Q1 决议 B 联动逻辑)", () => {
  it("mcp 开 + app 关 → OS 必须开(token-wallet 不在 daemon 无法 spawn)", () => {
    expect(resolveOsAutostart(true, false)).toBe(true);
  });
  it("mcp 开 + app 开 → OS 保持开", () => {
    expect(resolveOsAutostart(true, true)).toBe(true);
  });
  it("mcp 关 + app 开 → OS 保持开(用户原意, 不被 mcp 关意外覆盖)", () => {
    expect(resolveOsAutostart(false, true)).toBe(true);
  });
  it("mcp 关 + app 关 → OS 保持关", () => {
    expect(resolveOsAutostart(false, false)).toBe(false);
  });
});

describe("mcp-autostart: 读 settings.json 缺省 = true(卡体钉死)", () => {
  it("settings 不存在 → true", () => {
    const fp = tempSettingsFile();
    expect(readMcpAutostart(fp)).toBe(true);
  });

  it("settings 存在但无 mcpAutostart 字段 → true", () => {
    const fp = tempSettingsFile();
    fs.writeFileSync(fp, JSON.stringify({ version: 1, consentAgreed: true, autostart: false }));
    expect(readMcpAutostart(fp)).toBe(true);
  });

  it("settings 显式 mcpAutostart:true → true", () => {
    const fp = tempSettingsFile();
    fs.writeFileSync(fp, JSON.stringify({ version: 1, mcpAutostart: true }));
    expect(readMcpAutostart(fp)).toBe(true);
  });

  it("settings 显式 mcpAutostart:false → false", () => {
    const fp = tempSettingsFile();
    fs.writeFileSync(fp, JSON.stringify({ version: 1, mcpAutostart: false }));
    expect(readMcpAutostart(fp)).toBe(false);
  });

  it("settings 损坏 → true(保守默认, 卡体钉死)", () => {
    const fp = tempSettingsFile();
    fs.writeFileSync(fp, "{ corrupted json");
    expect(readMcpAutostart(fp)).toBe(true);
  });
});

describe("mcp-autostart: 写 settings.json 保留其他字段", () => {
  it("首次写 mcpAutostart=true, consent 字段保留", () => {
    const fp = tempSettingsFile();
    fs.writeFileSync(
      fp,
      JSON.stringify({ version: 1, consentAgreed: true, consentAt: 1234567890, autostart: false }),
    );
    writeMcpAutostart(fp, true);
    const reread = readSettingsFile(fp);
    expect((reread as { mcpAutostart?: boolean }).mcpAutostart).toBe(true);
    expect(reread.consentAgreed).toBe(true);
    expect(reread.consentAt).toBe(1234567890);
    expect(reread.autostart).toBe(false); // 不被覆盖
  });

  it("写 mcpAutostart=false 覆盖旧值", () => {
    const fp = tempSettingsFile();
    fs.writeFileSync(fp, JSON.stringify({ version: 1, mcpAutostart: true, autostart: true }));
    writeMcpAutostart(fp, false);
    const reread = readSettingsFile(fp);
    expect((reread as { mcpAutostart?: boolean }).mcpAutostart).toBe(false);
    expect(reread.autostart).toBe(true); // 不被覆盖
  });

  it("settings 不存在时建文件", () => {
    const fp = tempSettingsFile();
    writeMcpAutostart(fp, true);
    expect(fs.existsSync(fp)).toBe(true);
    const reread = readSettingsFile(fp);
    expect((reread as { mcpAutostart?: boolean }).mcpAutostart).toBe(true);
  });
});
