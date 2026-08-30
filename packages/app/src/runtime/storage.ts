/**
 * 快照存储 — app 侧(D-020 双宿主: app 走主进程 sqlite, mcp-server 走 node:sqlite)
 *
 * SQL 文本单一来源 = core `SCHEMA_SQL`(本文件 import, 不在 app 重复定义)。
 * 两种后端:
 * - HostSqliteStore: 主进程经 IPC(sqlite_batch/exec/query)执行 — 生产(E2 卡接真)
 * - MemorySqliteStore: 纯浏览器 dev(无桌面桥)兜底
 */
import type { ProviderSnapshot } from "../types";
import { SCHEMA_SQL } from "@token-wallet/core/storage/schema-sql";
import { isDesktopHost, sqliteBatch, sqliteExec, sqliteQuery } from "../ipc";
import { isLiveProvider } from "./liveProviders";

/** app 侧快照存储契约(D-020 StorageBackend 的 webview 形态, 只读查询按面板需要最小化) */
export interface SnapshotStorage {
  /** 建表(幂等); 启动时调用一次 */
  init(): Promise<void>;
  /**
   * 写一条快照(原子由主进程事务保证)。
   * B-3 写库守卫: provider 已不在当前实例集合(删除后的迟到响应)→ 静默丢弃, 不落库。
   */
  saveSnapshot(snap: ProviderSnapshot): Promise<void>;
  /** 每 provider 最新一条(面板渲染用) */
  latestSnapshots(): Promise<ProviderSnapshot[]>;
  /** 某 provider 的历史快照(速率计算用), 默认近 7 天 */
  history(providerId: string, since?: number, limit?: number): Promise<ProviderSnapshot[]>;
  /**
   * 删除一个 provider 的全部历史数据(快照 + 用量记录)。
   * 删除实例时调用(t_2ac39613: D-029 对称清理, keyring 已清余额历史不再残留)。
   */
  purgeProvider(providerId: string): Promise<void>;
}

function parseRow(raw: unknown): ProviderSnapshot | null {
  if (typeof raw !== "string") return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj as ProviderSnapshot;
  } catch {
    return null;
  }
}

/** 生产: 主进程执行(SCHEMA_SQL 单一来源) */
export class HostSqliteStore implements SnapshotStorage {
  private ready: Promise<void> | null = null;

  init(): Promise<void> {
    if (!this.ready) this.ready = sqliteBatch(SCHEMA_SQL);
    return this.ready;
  }

  async saveSnapshot(snap: ProviderSnapshot): Promise<void> {
    // B-3 写库守卫(兜底层): 该 provider 已被删除(不在当前实例集合)→ 静默丢弃。
    // 防「purge 先跑 → 旧引擎在途采集的迟到响应后写」把幽灵快照重新落库。
    if (!isLiveProvider(snap.provider_id)) return;
    await this.init();
    await sqliteExec(
      "INSERT INTO snapshots(provider_id, fetched_at, status, raw_json) VALUES (?, ?, ?, ?)",
      [snap.provider_id, snap.fetched_at, snap.status, JSON.stringify(snap)],
    );
  }

  async latestSnapshots(): Promise<ProviderSnapshot[]> {
    await this.init();
    const rows = await sqliteQuery(
      `SELECT s.raw_json FROM snapshots s
       JOIN (SELECT provider_id, MAX(fetched_at) AS max_at FROM snapshots GROUP BY provider_id) m
         ON s.provider_id = m.provider_id AND s.fetched_at = m.max_at
       GROUP BY s.provider_id HAVING s.id = MAX(s.id)
       ORDER BY s.provider_id`,
      [],
    );
    return rows.map((r) => parseRow(r[0])).filter((x): x is ProviderSnapshot => x !== null);
  }

  async history(providerId: string, since = 0, limit = 1000): Promise<ProviderSnapshot[]> {
    await this.init();
    const rows = await sqliteQuery(
      "SELECT raw_json FROM snapshots WHERE provider_id = ? AND fetched_at >= ? ORDER BY fetched_at DESC, id DESC LIMIT ?",
      [providerId, since, limit],
    );
    return rows.map((r) => parseRow(r[0])).filter((x): x is ProviderSnapshot => x !== null);
  }

  async purgeProvider(providerId: string): Promise<void> {
    // 走既有 sqlite IPC 通道(与 sqlite_exec 同通道, 主进程 node:sqlite 执行 DELETE)
    await this.init();
    await sqliteExec("DELETE FROM snapshots WHERE provider_id = ?", [providerId]);
    await sqliteExec("DELETE FROM usage_records WHERE provider_id = ?", [providerId]);
  }
}

/** 纯浏览器 dev / Playwright browser 模式兜底(内存数组) */
export class MemorySqliteStore implements SnapshotStorage {
  private rows: ProviderSnapshot[] = [];

  async init(): Promise<void> {
    /* no-op */
  }

  async saveSnapshot(snap: ProviderSnapshot): Promise<void> {
    // B-3 写库守卫(与 HostSqliteStore 同语义): 已删除 provider 的迟到写入静默丢弃
    if (!isLiveProvider(snap.provider_id)) return;
    this.rows.push(snap);
  }

  async latestSnapshots(): Promise<ProviderSnapshot[]> {
    const latest = new Map<string, ProviderSnapshot>();
    for (const r of this.rows) {
      const prev = latest.get(r.provider_id);
      if (!prev || r.fetched_at > prev.fetched_at) latest.set(r.provider_id, r);
    }
    return [...latest.values()];
  }

  async history(providerId: string, since = 0, limit = 1000): Promise<ProviderSnapshot[]> {
    return this.rows
      .filter((r) => r.provider_id === providerId && r.fetched_at >= since)
      .sort((a, b) => b.fetched_at - a.fetched_at)
      .slice(0, limit);
  }

  async purgeProvider(providerId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.provider_id !== providerId);
  }
}

let sharedStore: SnapshotStorage | null = null;
/** 全局共享存储(启动时按运行时能力选择后端) */
export function getSharedStorage(): SnapshotStorage {
  if (!sharedStore) {
    // 桌面宿主(含 Playwright browser mock 桥)→ 主进程 sqlite;
    // 纯浏览器 dev → 内存兜底
    sharedStore = isDesktopHost() ? new HostSqliteStore() : new MemorySqliteStore();
  }
  return sharedStore;
}

/** 测试/重置用 */
export function resetSharedStorage(): void {
  sharedStore = null;
}
