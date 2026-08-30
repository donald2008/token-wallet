import type { Bootstrap, HealthLevel } from "./types";
import { DEFAULT_SORT_CONFIG, normalizeSortConfig, type SortConfig } from "./health";

/**
 * 桌面壳 IPC 封装(D-033: Electron 壳) — 浏览器降级:
 * - Electron 窗口: preload contextBridge 注入 window.tokenWallet.invoke(channel, payload)
 * - Playwright browser 模式(D-030): e2e/fixtures.ts 注入同形态 mock window.tokenWallet
 * - 纯浏览器 `pnpm dev:web`: 无 tokenWallet 桥, 走本地 fallback 让壳可独立预览
 *
 * 通道名契约保全(换壳不变): get_bootstrap / instances_load / instances_save /
 * record_consent / keyring_get|set|delete / http_get_json / sqlite_batch|exec|query /
 * get_storage_paths / update_tray_status / get_launch_at_login / set_launch_at_login /
 * win_minimize / win_close(E1 新增) / win_get_always_on_top / win_set_always_on_top(P1 新增) /
 * get_sort_config / set_sort_config(P1 #829 R1 新增)。
 */

interface TokenWalletBridge {
  invoke?: <T>(channel: string, payload?: Record<string, unknown>) => Promise<T>;
}

function bridge(): TokenWalletBridge | null {
  // node 环境(部分 L1 测试无 jsdom)下 window 不存在, 直接判非桌面宿主
  if (typeof window === "undefined") return null;
  const w = window as unknown as { tokenWallet?: TokenWalletBridge };
  return w.tokenWallet?.invoke ? w.tokenWallet : null;
}

/** 桌面宿主(Electron)统一 invoke 入口; 无桥(纯浏览器)→ null, 调用方走降级 */
function hostInvoke<T>(channel: string, payload?: Record<string, unknown>): Promise<T> | null {
  const b = bridge();
  if (b?.invoke) return b.invoke<T>(channel, payload);
  return null;
}

const CONSENT_KEY = "token-wallet.consent.v1";

export async function getBootstrap(): Promise<Bootstrap> {
  const viaHost = await hostInvoke<Bootstrap>("get_bootstrap");
  if (viaHost) return viaHost;
  // 纯浏览器 fallback: 用 localStorage 模拟首开判定
  return {
    firstRun: !localStorage.getItem(CONSENT_KEY),
    theme: "system",
    version: "0.1.0-dev",
  };
}

/** 托盘四色状态点 + tooltip 摘要同步到主进程 */
export async function updateTrayStatus(status: HealthLevel, tooltip: string): Promise<void> {
  const viaHost = hostInvoke<void>("update_tray_status", { status, tooltip });
  if (viaHost) return viaHost;
  // 纯浏览器 fallback: 记录在 window 上便于人工预览确认
  (window as unknown as { __trayStatus?: unknown }).__trayStatus = { status, tooltip };
  return Promise.resolve();
}

export function persistConsent(): Promise<void> {
  // 桌面运行时: consent 落 configDir/settings.json(record_consent, D-019 配置侧)
  if (isDesktopHost()) {
    return hostInvoke<void>("record_consent")!.then(() => undefined);
  }
  // 纯浏览器 fallback: localStorage 模拟首开判定
  try {
    localStorage.setItem(CONSENT_KEY, "1");
  } catch {
    /* webview 隐私模式下忽略 */
  }
  return Promise.resolve();
}

// ---------------- 实例配置持久化(§5.0.1/D-019/D-032) ----------------
// instances.yaml 读写走主进程(YAML 解析/生成, 原子写); 前端零 YAML 依赖,
// IPC 传 JSON, zod(schema.ts)仍是唯一校验权威。纯浏览器 dev 降级 localStorage。

const INSTANCES_FALLBACK_KEY = "token-wallet.instances.v1";

/**
 * 加载 instances.yaml → JSON 值。返回 null = 文件不存在(首开零配置)。
 * YAML 语法损坏 / JSON 损坏 → reject(fail-fast, 由调用方转成配置错误页, 不静默丢配置)。
 */
export async function instancesLoad(): Promise<unknown | null> {
  if (isDesktopHost()) {
    // 注意: 不能用 invoke 返回值判空区分运行时(null 同时是"文件不存在"的合法值)
    return (await hostInvoke<unknown | null>("instances_load")) as unknown | null;
  }
  const raw = localStorage.getItem(INSTANCES_FALLBACK_KEY);
  if (!raw) return null;
  return JSON.parse(raw); // 损坏即抛错 = fail-fast
}

/** 写回 instances.yaml(入参须已过 InstancesFileSchema); 浏览器降级写 localStorage */
export async function instancesSave(file: unknown): Promise<void> {
  if (isDesktopHost()) {
    await hostInvoke<void>("instances_save", { file });
    return;
  }
  try {
    localStorage.setItem(INSTANCES_FALLBACK_KEY, JSON.stringify(file));
  } catch {
    /* 隐私模式等写入失败: 内存仍在, 下次启动丢失由用户感知 */
  }
}

/** 运行时解析的存储路径(D-019): 配置与数据分家, 零硬编码字面量 */
export interface StoragePaths {
  configDir: string;
  dataDir: string;
}

async function detectPlatformBase(): Promise<StoragePaths> {
  // 浏览器降级: 按 D-019 约定 banner(config=Roaming, 数据=Local)。
  // 真实桌面壳下主进程按平台解析(D-019); 此分支仅为独立 dev 预览。
  const home = "/root";
  return { configDir: `${home}/.config/token-wallet`, dataDir: `${home}/.local/share/token-wallet` };
}

export async function getStoragePaths(): Promise<StoragePaths> {
  const viaHost = await hostInvoke<StoragePaths>("get_storage_paths");
  if (viaHost) return viaHost;
  return detectPlatformBase();
}

/** 开机自启(D-024): 默认关。browser 降级用 localStorage 记录偏好(真壳走 OS login item) */
const AUTOSTART_KEY = "token-wallet.autostart.v1";

export async function getLaunchAtLogin(): Promise<boolean> {
  const viaHost = await hostInvoke<boolean>("get_launch_at_login");
  if (viaHost !== null) return viaHost;
  return localStorage.getItem(AUTOSTART_KEY) === "1";
}

export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  const viaHost = hostInvoke<void>("set_launch_at_login", { enabled });
  if (viaHost) {
    void (await viaHost);
    return;
  }
  try {
    if (enabled) localStorage.setItem(AUTOSTART_KEY, "1");
    else localStorage.removeItem(AUTOSTART_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------- 真实链路桥接(主进程侧执行, D-029/D-020) ----------------

/**
 * 是否处于桌面宿主运行时(Electron 窗口或 Playwright browser mock 桥);
 * 纯浏览器 dev 为 false
 */
export function isDesktopHost(): boolean {
  return bridge() !== null;
}

/** OS 钥匙串读取(null=条目不存在) */
export async function keyringGet(service: string, key: string): Promise<string | null> {
  const viaHost = await hostInvoke<string | null>("keyring_get", { service, key });
  if (viaHost !== null) return viaHost;
  return null;
}

/** OS 钥匙串写入(D-029) */
export async function keyringSet(service: string, key: string, value: string): Promise<void> {
  const viaHost = hostInvoke<void>("keyring_set", { service, key, value });
  if (viaHost) await viaHost;
}

/** OS 钥匙串删除(删实例同步清条目) */
export async function keyringDelete(service: string, key: string): Promise<void> {
  const viaHost = hostInvoke<void>("keyring_delete", { service, key });
  if (viaHost) await viaHost;
}

/** 真实 http GET — 主进程执行, 规避 webview CORS/CSP。body 已脱敏(D-029) */
export interface HttpJsonResponse {
  status: number;
  body: string;
}

export async function httpGetJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<HttpJsonResponse> {
  const viaHost = await hostInvoke<HttpJsonResponse>("http_get_json", { url, headers, timeoutMs });
  if (viaHost) return viaHost;
  // 纯浏览器 dev 降级: 直接 fetch(仅本地预览用; 生产走主进程)
  const resp = await fetch(url, { headers });
  return { status: resp.status, body: await resp.text() };
}

/** SQLite 批量执行(建表); SQL 文本单一来源 = core SCHEMA_SQL */
export async function sqliteBatch(sql: string): Promise<void> {
  const viaHost = hostInvoke<void>("sqlite_batch", { sql });
  if (viaHost) await viaHost;
}

/** SQLite 单条 SQL + 参数(INSERT/UPDATE/DELETE) */
export async function sqliteExec(sql: string, params: unknown[]): Promise<number> {
  const viaHost = await hostInvoke<number>("sqlite_exec", { sql, params });
  if (viaHost !== null) return viaHost;
  return 0;
}

/** SQLite 查询; 返回行数组(每行数组, 与列序一致) */
export async function sqliteQuery(sql: string, params: unknown[]): Promise<unknown[][]> {
  const viaHost = await hostInvoke<unknown[][]>("sqlite_query", { sql, params });
  if (viaHost) return viaHost;
  return [];
}

// ---------------- D-042: command 类通道执行桥(主进程真实 spawn) ----------------

/**
 * command 类通道采集载荷(D-042): renderer 把通道 + 实例 + 采集上下文传给主进程,
 * 主进程内 COMMAND_ADAPTERS[channel]() 构造真实适配器(缺省 runner=真实 spawn)
 * 执行 fetchSnapshot, 返回 ProviderSnapshot。renderer 零 Node 能力(P0-4 同族纪律)。
 */
export interface CommandRunPayload {
  channel: string;
  descriptor?: unknown;
  instance?: unknown;
  fetchedAt?: number;
  timeoutMs?: number;
}

/**
 * command 类通道采集 — 主进程 command_run 桥。
 * 返回 ProviderSnapshot(JSON 序列化; status=ok/auth_expired/error 全由 core 适配器分类)。
 * 纯浏览器 dev(无桌面桥)→ null 语义: command 无法在浏览器执行, 由引擎侧转 error 快照。
 */
export async function commandRun(payload: CommandRunPayload): Promise<unknown | null> {
  const viaHost = await hostInvoke<unknown>("command_run", payload as unknown as Record<string, unknown>);
  return viaHost;
}

// ---------------- E1 新增: 窗口控制(HTML TitleBar 的 min/close) ----------------

/** 最小化窗口(无边框窗的 HTML TitleBar 按钮); 浏览器降级 no-op */
export async function winMinimize(): Promise<void> {
  const viaHost = hostInvoke<void>("win_minimize");
  if (viaHost) await viaHost;
}

/** 关闭 = 隐藏到托盘(D-003); 浏览器降级 no-op */
export async function winClose(): Promise<void> {
  const viaHost = hostInvoke<void>("win_close");
  if (viaHost) await viaHost;
}

// ---------------- P1: 窗口置顶开关(标题栏图钉, 默认关, 持久化 settings.json) ----------------

/** 浏览器降级 localStorage 键(真壳置顶态在主进程 settings.json, D-019) */
const ALWAYS_ON_TOP_KEY = "token-wallet.always-on-top.v1";

/** 查询当前置顶态; 浏览器降级读 localStorage */
export async function winGetAlwaysOnTop(): Promise<boolean> {
  const viaHost = await hostInvoke<boolean>("win_get_always_on_top");
  if (viaHost !== null) return viaHost;
  try {
    return localStorage.getItem(ALWAYS_ON_TOP_KEY) === "1";
  } catch {
    return false;
  }
}

// ---------------- P1(#829 R1): 卡间排序配置(真壳 settings.json RMW / 浏览器 localStorage 降级) ----------------

/** 浏览器降级 localStorage 键(整体一个配置 {key,dir}, #829 R1) */
const SORT_CONFIG_KEY = "token-wallet.sortConfig.v1";

/** 读排序配置; 真壳读 settings.json(主进程归一化), 浏览器读 localStorage; 非法/缺失 → 缺省名称正排 */
export async function getSortConfig(): Promise<SortConfig> {
  const viaHost = await hostInvoke<unknown>("get_sort_config");
  if (viaHost !== null) return normalizeSortConfig(viaHost);
  try {
    const raw = localStorage.getItem(SORT_CONFIG_KEY);
    if (raw) return normalizeSortConfig(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return DEFAULT_SORT_CONFIG;
}

/** 写排序配置; 真壳 RMW 落 settings.json, 浏览器降级 localStorage */
export async function setSortConfig(config: SortConfig): Promise<void> {
  const viaHost = hostInvoke<void>("set_sort_config", { config });
  if (viaHost) {
    await viaHost;
    return;
  }
  try {
    localStorage.setItem(SORT_CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

/** 切换置顶并回写持久化; 浏览器降级记 localStorage + no-op 窗口行为 */
export async function winSetAlwaysOnTop(enabled: boolean): Promise<void> {
  const viaHost = hostInvoke<void>("win_set_always_on_top", { enabled });
  if (viaHost) {
    await viaHost;
    return;
  }
  try {
    if (enabled) localStorage.setItem(ALWAYS_ON_TOP_KEY, "1");
    else localStorage.removeItem(ALWAYS_ON_TOP_KEY);
  } catch {
    /* ignore */
  }
}
