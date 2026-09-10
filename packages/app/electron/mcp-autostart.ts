/**
 * MCP daemon autostart 决策(D-055, t_4bd214de Q1 决议 B):
 * - MCP 自启态独立于 D-024 app autostart(后者控制 token-wallet 自身开机启动)
 * - 但「daemon 需 token-wallet 已启动才能 spawn」→ MCP autostart 默认开时, 若 app
 *   autostart 未开, 写 OS 自启项时**连带把 app autostart 也开**(联动)
 * - 用户单独关 MCP autostart 不影响 app autostart
 * - 用户单独开 MCP autostart 时若 app 未开 → 引导/自动把 app 也开
 *
 * 记录载体: settings.json 新增 mcpAutostart 字段(同 recordAutostart 模式)。
 * OS 自启项: 同 D-024 走 app.setLoginItemSettings(openAtLogin=true) + 提示性 args,
 *   daemon 自身在 token-wallet 启动后由 main 进程的 app.whenReady 钩子按 mcpAutostart
 *   spawn(后续卡实现; 本卡只落 settings.json + IPC 桥)。
 */
import { atomicWrite, readSettingsFile, recordAutostart } from "./persist";

export interface McpAutostartDecision {
  /** mcp autostart 用户期望值(由 SettingsView 开关驱动) */
  mcpAutostart: boolean;
  /** 当前 app autostart OS 实际值(由 setLoginItemSettings 校正) */
  appAutostart: boolean;
  /** 最终要写入 OS 的 openAtLogin 值(mcp 开 ⇒ app 必须开; mcp 关 ⇒ 保持 app 原态) */
  osAutostart: boolean;
}

/** 给定 mcp autostart + 当前 app autostart, 返回要写 OS 的目标值 */
export function resolveOsAutostart(mcpAutostart: boolean, appAutostart: boolean): boolean {
  // mcp 开 ⇒ 必须把 app 也开(token-wallet 不在, daemon 无 spawn 主)
  if (mcpAutostart) return true;
  // mcp 关 ⇒ 不动 app 原态(用户可能仍想开 app 自身启动, 不被 mcp 关意外覆盖)
  return appAutostart;
}

/** 从 settings.json 读 mcpAutostart 字段; 缺省按卡体钉死 = true */
export function readMcpAutostart(settingsFilePath: string): boolean {
  const parsed = readSettingsFile(settingsFilePath);
  // 缺省 true(卡体钉死); 只有显式 false 才算关
  return (parsed as { mcpAutostart?: boolean }).mcpAutostart !== false;
}

/** 写 mcpAutostart 到 settings.json(用 atomicWrite 的 atomic RMW 模式)。
 *  ⚠️ mcpAutostart 字段挂在 settings.json, 与 autostart 字段同 JSON;
 *  复用 defaultSettings() 兜底 + spread merged(透传 consent/alwaysOnTop 等前瞻字段)。 */
export function writeMcpAutostart(settingsFilePath: string, mcpAutostart: boolean): void {
  // 复用 SettingsFile 默认结构(避免直接构造 SettingsFile 漏字段), 再 spread parsed 透传前瞻
  const existing = readSettingsFile(settingsFilePath);
  const merged = { ...existing, version: 1, mcpAutostart };
  atomicWrite(settingsFilePath, JSON.stringify(merged, null, 2));
}

/** 重导出 recordAutostart 供 main.ts 联动开 app 自启时用 */
export { recordAutostart };
