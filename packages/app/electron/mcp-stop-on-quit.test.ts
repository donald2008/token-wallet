// @vitest-environment node
/**
 * mcp-stop-on-quit 单测(t_d59a9ad8):
 * - 决策纯函数 shouldStopDaemonOnAppQuit(读设置 → 是否停)
 * - settings.json 读写(默认 false / 显式 true / 往返)
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  MCP_STOP_ON_QUIT_TIMEOUT_MS,
  readMcpStopOnAppQuit,
  shouldStopDaemonOnAppQuit,
  writeMcpStopOnAppQuit,
} from "./mcp-stop-on-quit";

function tempSettingsFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-stop-on-quit-"));
  return path.join(dir, "settings.json");
}

describe("mcp-stop-on-quit: 决策纯函数", () => {
  it("true → 停", () => {
    expect(shouldStopDaemonOnAppQuit(true)).toBe(true);
  });
  it("false → 不停(现状语义: daemon 孤儿存活)", () => {
    expect(shouldStopDaemonOnAppQuit(false)).toBe(false);
  });
  it("超时常量 = 3000ms(卡体硬约束: 退出等待 ≤3s)", () => {
    expect(MCP_STOP_ON_QUIT_TIMEOUT_MS).toBe(3000);
  });
});

describe("mcp-stop-on-quit: settings.json 读写", () => {
  it("settings 不存在 → false(缺省不动存量用户行为)", () => {
    expect(readMcpStopOnAppQuit(tempSettingsFile())).toBe(false);
  });
  it("显式 true → true; 缺字段 → false(只有显式 true 才停)", () => {
    const p = tempSettingsFile();
    writeMcpStopOnAppQuit(p, true);
    expect(readMcpStopOnAppQuit(p)).toBe(true);
    const p2 = tempSettingsFile();
    fs.writeFileSync(p2, JSON.stringify({ version: 1, autostart: true }));
    expect(readMcpStopOnAppQuit(p2)).toBe(false);
  });
  it("往返写读 + 同文件其他字段透传(merge 语义同 mcpAutostart)", () => {
    const p = tempSettingsFile();
    fs.writeFileSync(p, JSON.stringify({ version: 1, consentAgreed: true, mcpAutostart: false }));
    writeMcpStopOnAppQuit(p, true);
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    expect(parsed.mcpStopOnAppQuit).toBe(true);
    expect(parsed.consentAgreed).toBe(true);
    expect(parsed.mcpAutostart).toBe(false);
    writeMcpStopOnAppQuit(p, false);
    expect(readMcpStopOnAppQuit(p)).toBe(false);
  });
});
