/**
 * MCP daemon 退出侧停止决策(t_d59a9ad8, D-059):
 * - 与 mcpAutostart(D-055 Q1)正交: 一个管「何时拉起」, 一个管「app 退出时是否带走」,
 *   互不读写对方的字段/联动链(禁改 mcpAutostart 既有语义, D-055 不动)
 * - 默认 false = app 退出后 daemon 孤儿存活(D-055 系设计: app 关后 hook 上报不断流),
 *   不静默改变存量用户行为; 只有显式 true 才在 will-quit 停 daemon
 * - 设置载体: settings.json mcpStopOnAppQuit 字段(同 mcpAutostart 的 read/write 模式,
 *   settings.json merge 读 + 原子写)
 */
import { atomicWrite, readSettingsFile } from "./persist";

/** will-quit 停止等待上限(ms) — 卡体硬约束: 退出路径禁被 daemon 卡死, 超时放行退出 */
export const MCP_STOP_ON_QUIT_TIMEOUT_MS = 3000;

/** 决策纯函数: 读设置 → 是否停。缺省 false(现状语义: 退出保持 daemon 运行)。 */
export function shouldStopDaemonOnAppQuit(mcpStopOnAppQuit: boolean): boolean {
  return mcpStopOnAppQuit === true;
}

/** 从 settings.json 读 mcpStopOnAppQuit; 缺省 false(卡体钉死: 存量用户行为不变)。 */
export function readMcpStopOnAppQuit(settingsFilePath: string): boolean {
  const parsed = readSettingsFile(settingsFilePath);
  return (parsed as { mcpStopOnAppQuit?: boolean }).mcpStopOnAppQuit === true;
}

/** 写 mcpStopOnAppQuit 到 settings.json(复用 mcpAutostart 同款 atomic RMW 模式)。 */
export function writeMcpStopOnAppQuit(settingsFilePath: string, stopOnQuit: boolean): void {
  const existing = readSettingsFile(settingsFilePath);
  const merged = { ...existing, version: 1, mcpStopOnAppQuit: stopOnQuit };
  atomicWrite(settingsFilePath, JSON.stringify(merged, null, 2));
}
