/**
 * E1 持久化语义移植(D-033, 自 src-tauri f318b3c 的 W1/W2/W3 逐字对齐, 不许退化):
 *
 * - 原子写 = tmp 写入 + fsync + rename 覆盖
 *   rename 覆盖语义跨平台背书:
 *   - POSIX: rename(2) 原子替换既有目标
 *   - Windows: Node/libuv 用 MoveFileExW(MOVEFILE_REPLACE_EXISTING), 与 Unix 行为一致
 *   ⚠️ 禁止改回"先 remove 再 rename"(remove-then-rename):
 *   remove 成功、rename 前崩溃/断电 → 配置文件彻底消失 → 载入走"文件不存在"
 *   分支被当首开零配置**静默吞掉**, 比半写损坏(解析失败 fail-fast)后果严重得多。
 * - consent read-modify-write: 只改 consent 两字段, 既有/前瞻字段(theme/轮询等)
 *   JSON 合并透传(OCP), 杜绝"同意一次把其他设置清回默认"
 * - settings 损坏 fail-open 回首开态(重弹 consent, 不崩应用)
 *
 * 本文件零 electron 依赖(纯 node:fs), 供主进程与 node vitest 单测共用。
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** 全局设置文件形态(§5.0.1 三层之 settings 层); 未知键经 RMW 合并直通透传 */
export interface SettingsFile {
  version: number;
  consentAgreed: boolean;
  /** 同意时间(unix 秒) */
  consentAt: number | null;
  /** 前瞻字段(theme/轮询等)透传位 */
  [extra: string]: unknown;
}

export function defaultSettings(): SettingsFile {
  return { version: 1, consentAgreed: false, consentAt: null };
}

/**
 * 原子写(tmp + fsync + rename 覆盖替换), instances.yaml / settings.json 共用。
 * 断电语义: rename 前 tmp 已 fsync 落盘, 崩溃时要么旧文件完整、要么新文件完整,
 * 不存在"半写"; 且无 remove-then-rename 的"文件消失"窗口。
 */
export function atomicWrite(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, contents, "utf8");
    // 写完先 fsync 到盘再 rename, 保证断电时 tmp 内容完整(真原子替换)
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // rename 直接覆盖既有文件(见文件头跨平台背书), 严禁先 remove
  fs.renameSync(tmp, filePath);
}

/** 读 settings; 不存在/读失败/JSON 损坏 → 保守回首开态(重弹 consent, 不崩应用) */
export function readSettingsFile(filePath: string): SettingsFile {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return defaultSettings();
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultSettings();
    return { ...defaultSettings(), ...(parsed as Record<string, unknown>) };
  } catch {
    return defaultSettings();
  }
}

/**
 * consent 落盘的 read-modify-write 核心(纯函数, 可单测):
 * 只改 consent 两字段, 既有/前瞻字段原样保留; 损坏时保守回退首开态重写。
 */
export function consentSettingsJson(existing: string | null, now: number): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {}; // 损坏 → 首开态
    }
  }
  const merged = { ...base, version: 1, consentAgreed: true, consentAt: now };
  return JSON.stringify(merged, null, 2);
}

/** record_consent 全链路: RMW + 原子写 */
export function recordConsent(filePath: string, now: number): void {
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(filePath, "utf8");
  } catch {
    existing = null; // 不存在/读失败 → 首开态
  }
  atomicWrite(filePath, consentSettingsJson(existing, now));
}
