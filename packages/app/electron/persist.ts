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

/** 卡间排序配置值(#829 R1 + D-039): key(名称|紧要度|手动) × dir(正排|倒排) 两正交参数 + order(手动顺序) */
export interface SortConfigValue {
  key: "name" | "urgency" | "manual";
  dir: "asc" | "desc";
  /** 手动排序顺序(providerId 数组, D-039): 仅 key=manual 时生效; 非 manual 也保留在盘上(切回可恢复) */
  order?: string[];
}

/** 排序配置缺省 = 名称正排(#829 R1); 与 renderer 侧 health.ts DEFAULT_SORT_CONFIG 同值(双端各一份, 互不 import) */
export const DEFAULT_SORT_CONFIG_VALUE: SortConfigValue = { key: "name", dir: "asc" };

/** 从未知值提取合法的 order 数组(非数组/含非字符串 → 过滤; 空/非法 → undefined) */
function normalizeOrderValue(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const order = raw.filter((x): x is string => typeof x === "string");
  return order.length > 0 ? order : undefined;
}

/** 排序配置归一化: 非对象/非法 key/非法 dir → 缺省, 不抛错(损坏配置不崩 UI)。
 * key=manual 接受(D-039): dir 强制 asc; order 按字符串过滤保留。 */
export function normalizeSortConfigValue(raw: unknown): SortConfigValue {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const key =
      o.key === "name" ? "name" : o.key === "urgency" ? "urgency" : o.key === "manual" ? "manual" : null;
    const dir = o.dir === "asc" ? "asc" : o.dir === "desc" ? "desc" : null;
    if (key) {
      const order = normalizeOrderValue(o.order);
      if (key === "manual") return { key, dir: "asc", ...(order ? { order } : {}) };
      if (dir) return { key, dir, ...(order ? { order } : {}) };
    }
  }
  return DEFAULT_SORT_CONFIG_VALUE;
}

/** 全局设置文件形态(§5.0.1 三层之 settings 层); 未知键经 RMW 合并直通透传 */
export interface SettingsFile {
  version: number;
  consentAgreed: boolean;
  /** 同意时间(unix 秒) */
  consentAt: number | null;
  /** 开机自启开关(D-024, 默认关); 记录用户期望, 查询时以 OS 实际为准校正 */
  autostart?: boolean;
  /** 窗口置顶开关(P1, 默认关); 用户可切换, createWindow 时读回应用 */
  alwaysOnTop?: boolean;
  /** 卡间排序配置(P1 #829 R1, 缺省名称正排) */
  sortConfig?: SortConfigValue;
  /** 界面语言(Phase B i18n, 缺省 zh); renderer 启动读回覆盖 localStorage 旧值 */
  language?: Lang;
  /** 前瞻字段(theme/轮询等)透传位 */
  [extra: string]: unknown;
}

export function defaultSettings(): SettingsFile {
  return { version: 1, consentAgreed: false, consentAt: null, autostart: false, alwaysOnTop: false };
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

/**
 * autostart 落盘的 read-modify-write 核心(纯函数, 可单测):
 * 与 consent 同模式 — 只改 autostart 字段, 既有/前瞻字段(consent/theme/轮询等)
 * JSON 合并透传(OCP), 杜绝"开一次自启把 consent 清回默认"。
 * 损坏时保守回退仅含 autostart 的合法对象重写(不抛)。
 */
export function autostartSettingsJson(existing: string | null, enabled: boolean): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {}; // 损坏 → 仅保留本次字段
    }
  }
  const merged = { ...base, version: 1, autostart: enabled };
  return JSON.stringify(merged, null, 2);
}

/** set_launch_at_login 全链路: RMW + 原子写 */
export function recordAutostart(filePath: string, enabled: boolean): void {
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(filePath, "utf8");
  } catch {
    existing = null; // 不存在/读失败 → 首开态
  }
  atomicWrite(filePath, autostartSettingsJson(existing, enabled));
}

/**
 * alwaysOnTop 落盘的 read-modify-write 核心(P1, 与 autostart 同款模式):
 * 只改 alwaysOnTop 字段, 既有/前瞻字段(consent/autostart/theme 等)JSON 合并透传;
 * 损坏时保守回退仅含 alwaysOnTop 的合法对象重写(不抛)。
 */
export function alwaysOnTopSettingsJson(existing: string | null, enabled: boolean): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {}; // 损坏 → 仅保留本次字段
    }
  }
  const merged = { ...base, version: 1, alwaysOnTop: enabled };
  return JSON.stringify(merged, null, 2);
}

/** win_set_always_on_top 全链路: RMW + 原子写 */
export function recordAlwaysOnTop(filePath: string, enabled: boolean): void {
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(filePath, "utf8");
  } catch {
    existing = null; // 不存在/读失败 → 首开态
  }
  atomicWrite(filePath, alwaysOnTopSettingsJson(existing, enabled));
}

/**
 * sortConfig 落盘的 read-modify-write 核心(#829 R1 + D-039, 与 autostart/alwaysOnTop 同款模式):
 * 只改 sortConfig 字段, 既有/前瞻字段(consent/autostart/alwaysOnTop/theme 等)JSON 合并透传;
 * 损坏时保守回退仅含 sortConfig 的合法对象重写(不抛)。
 * ⚠️ D-039: order(手动顺序)必须一并落盘 —— 非 manual 模式下切回 manual 要靠它恢复自定义顺序;
 * 若在此丢弃 order, 用户切到名称/紧要度再切回手动, 自定义顺序就丢了。
 */
export function sortConfigSettingsJson(existing: string | null, config: SortConfigValue): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {}; // 损坏 → 仅保留本次字段
    }
  }
  const merged = {
    ...base,
    version: 1,
    sortConfig: {
      key: config.key,
      dir: config.dir,
      ...(config.order && config.order.length > 0 ? { order: config.order } : {}),
    },
  };
  return JSON.stringify(merged, null, 2);
}

/** set_sort_config 全链路: RMW + 原子写(入参先归一化, 非法值落缺省) */
export function recordSortConfig(filePath: string, config: unknown): void {
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(filePath, "utf8");
  } catch {
    existing = null; // 不存在/读失败 → 首开态
  }
  atomicWrite(filePath, sortConfigSettingsJson(existing, normalizeSortConfigValue(config)));
}

// ---- Phase B(i18n): 界面语言(zh/en)落盘, 与 autostart/sortConfig 同款 RMW 模式 ----

/** 界面语言(Phase B); 与 renderer 侧 i18n.ts Lang 同值(双端各一份, 互不 import) */
export type Lang = "zh" | "en";

/** 语言归一化: 非法/缺失 → zh(当前缺省) */
export function normalizeLangValue(raw: unknown): Lang {
  return raw === "en" ? "en" : "zh";
}

/**
 * language 落盘的 read-modify-write 核心(Phase B, 与 autostart/sortConfig 同款模式):
 * 只改 language 字段, 既有/前瞻字段(consent/autostart/theme/sortConfig 等)JSON 合并透传;
 * 损坏时保守回退仅含 language 的合法对象重写(不抛)。
 */
export function langSettingsJson(existing: string | null, lang: Lang): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {}; // 损坏 → 仅保留本次字段
    }
  }
  const merged = { ...base, version: 1, language: lang };
  return JSON.stringify(merged, null, 2);
}

/** set_lang 全链路: RMW + 原子写(入参先归一化, 非法值落 zh) */
export function recordLang(filePath: string, lang: unknown): void {
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(filePath, "utf8");
  } catch {
    existing = null; // 不存在/读失败 → 首开态
  }
  atomicWrite(filePath, langSettingsJson(existing, normalizeLangValue(lang)));
}
