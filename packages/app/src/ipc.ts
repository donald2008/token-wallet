import type { Bootstrap, HealthLevel } from "./types";

/**
 * Tauri IPC 封装 — 浏览器降级:
 * - Tauri webview: withGlobalTauri 注入 window.__TAURI__
 * - Playwright browser 模式(D-030): @srsholmes/tauri-playwright 注入 mock __TAURI__, ipcMocks 拦截
 * - 纯浏览器 `pnpm dev`: 无 __TAURI__, 走本地 fallback 让壳可独立预览
 */

interface TauriGlobal {
  core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
}

interface TauriInternals {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

/**
 * invoke 双通道:
 * 1. window.__TAURI__.core.invoke — withGlobalTauri 注入(真实 Tauri webview)
 * 2. window.__TAURI_INTERNALS__.invoke — 底层入口; @tauri-apps/api 与
 *    tauri-playwright 的 browser mock 都走这一层(D-030 L2)
 */
function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> | null {
  const w = window as unknown as {
    __TAURI__?: TauriGlobal;
    __TAURI_INTERNALS__?: TauriInternals;
  };
  if (w.__TAURI__?.core?.invoke) return w.__TAURI__.core.invoke<T>(cmd, args);
  if (w.__TAURI_INTERNALS__?.invoke) return w.__TAURI_INTERNALS__.invoke<T>(cmd, args);
  return null;
}

const CONSENT_KEY = "token-wallet.consent.v1";

export async function getBootstrap(): Promise<Bootstrap> {
  const viaTauri = await tauriInvoke<Bootstrap>("get_bootstrap");
  if (viaTauri) return viaTauri;
  // 纯浏览器 fallback: 用 localStorage 模拟首开判定
  return {
    firstRun: !localStorage.getItem(CONSENT_KEY),
    theme: "system",
    version: "0.1.0-dev",
  };
}

/** 托盘四色状态点 + tooltip 摘要同步到 Rust 侧 */
export async function updateTrayStatus(status: HealthLevel, tooltip: string): Promise<void> {
  const viaTauri = tauriInvoke<void>("update_tray_status", { status, tooltip });
  if (viaTauri) return viaTauri;
  // 纯浏览器 fallback: 记录在 window 上便于人工预览确认
  (window as unknown as { __trayStatus?: unknown }).__trayStatus = { status, tooltip };
  return Promise.resolve();
}

export function persistConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, "1");
  } catch {
    /* webview 隐私模式下忽略 */
  }
}

/** 运行时解析的存储路径(D-019): 配置与数据分家, 零硬编码字面量 */
export interface StoragePaths {
  configDir: string;
  dataDir: string;
}

async function detectPlatformBase(): Promise<StoragePaths> {
  // 浏览器降级: 按 D-019 约定 banner(config=Roaming, 数据=Local)。
  // 真实 Tauri 下走 Rust path API(app_config_dir / app_data_dir); 此分支仅为独立 dev 预览。
  const home = "/root";
  return { configDir: `${home}/.config/token-wallet`, dataDir: `${home}/.local/share/token-wallet` };
}

export async function getStoragePaths(): Promise<StoragePaths> {
  const viaTauri = await tauriInvoke<StoragePaths>("get_storage_paths");
  if (viaTauri) return viaTauri;
  return detectPlatformBase();
}

/** 开机自启(D-024): 默认关。browser 降级用 localStorage 记录偏好(真 Tauri 走 autostart plugin) */
const AUTOSTART_KEY = "token-wallet.autostart.v1";

export async function getLaunchAtLogin(): Promise<boolean> {
  const viaTauri = await tauriInvoke<boolean>("get_launch_at_login");
  if (viaTauri !== null) return viaTauri;
  return localStorage.getItem(AUTOSTART_KEY) === "1";
}

export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  const viaTauri = await tauriInvoke<void>("set_launch_at_login", { enabled });
  if (viaTauri) {
    void viaTauri;
    return;
  }
  try {
    if (enabled) localStorage.setItem(AUTOSTART_KEY, "1");
    else localStorage.removeItem(AUTOSTART_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------- P0-5 真实链路桥接(Rust 侧执行, D-029/D-020) ----------------

/** 是否处于 Tauri 运行时(真 webview 或 Playwright browser mock); 纯浏览器 dev 为 false */
export function isTauriRuntime(): boolean {
  const w = window as unknown as {
    __TAURI__?: TauriGlobal;
    __TAURI_INTERNALS__?: TauriInternals;
  };
  return Boolean(w.__TAURI__?.core?.invoke || w.__TAURI_INTERNALS__?.invoke);
}

/** OS 钥匙串读取(null=条目不存在) */
export async function keyringGet(service: string, key: string): Promise<string | null> {
  const viaTauri = await tauriInvoke<string | null>("keyring_get", { service, key });
  if (viaTauri !== null) return viaTauri;
  return null;
}

/** OS 钥匙串写入(D-029) */
export async function keyringSet(service: string, key: string, value: string): Promise<void> {
  const viaTauri = await tauriInvoke<void>("keyring_set", { service, key, value });
  if (viaTauri) await viaTauri;
}

/** OS 钥匙串删除(删实例同步清条目) */
export async function keyringDelete(service: string, key: string): Promise<void> {
  const viaTauri = await tauriInvoke<void>("keyring_delete", { service, key });
  if (viaTauri) await viaTauri;
}

/** 真实 http GET — Rust reqwest 执行, 规避 webview CORS/CSP。body 已脱敏(D-029) */
export interface HttpJsonResponse {
  status: number;
  body: string;
}

export async function httpGetJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<HttpJsonResponse> {
  const viaTauri = await tauriInvoke<HttpJsonResponse>("http_get_json", { url, headers, timeoutMs });
  if (viaTauri) return viaTauri;
  // 纯浏览器 dev 降级: 直接 fetch(仅本地预览用; 生产走 Rust 命令)
  const resp = await fetch(url, { headers });
  return { status: resp.status, body: await resp.text() };
}

/** SQLite 批量执行(建表); SQL 文本单一来源 = core SCHEMA_SQL */
export async function sqliteBatch(sql: string): Promise<void> {
  const viaTauri = await tauriInvoke<void>("sqlite_batch", { sql });
  if (viaTauri) await viaTauri;
}

/** SQLite 单条 SQL + 参数(INSERT/UPDATE/DELETE) */
export async function sqliteExec(sql: string, params: unknown[]): Promise<number> {
  const viaTauri = await tauriInvoke<number>("sqlite_exec", { sql, params });
  if (viaTauri !== null) return viaTauri;
  return 0;
}

/** SQLite 查询; 返回行数组(每行数组, 与列序一致) */
export async function sqliteQuery(sql: string, params: unknown[]): Promise<unknown[][]> {
  const viaTauri = await tauriInvoke<unknown[][]>("sqlite_query", { sql, params });
  if (viaTauri) return viaTauri;
  return [];
}
