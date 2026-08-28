/**
 * 快照存储 — app 侧(D-020 双宿主: app 走 Rust sqlite, mcp-server 走 node:sqlite)
 *
 * SQL 文本单一来源 = core `SCHEMA_SQL`(本文件 import, 不在 app 重复定义)。
 * 两种后端:
 * - TauriSqliteStore: Rust 侧 rusqlite 经 IPC(sqlite_batch/exec/query)执行 — 生产
 * - MemorySqliteStore: 纯浏览器 dev / Playwright browser 模式(mock IPC 不可用)兜底
 */
import type { ProviderSnapshot } from "../types";
import { SCHEMA_SQL } from "@token-wallet/core/storage/schema-sql";
import { isTauriRuntime, sqliteBatch, sqliteExec, sqliteQuery } from "../ipc";

/** app 侧快照存储契约(D-020 StorageBackend 的 webview 形态, 只读查询按面板需要最小化) */
export interface SnapshotStorage {
  /** 建表(幂等); 启动时调用一次 */
  init(): Promise<void>;
  /** 写一条快照(原子由 Rust 事务保证) */
  saveSnapshot(snap: ProviderSnapshot): Promise<void>;
  /** 每 provider 最新一条(面板渲染用) */
  latestSnapshots(): Promise<ProviderSnapshot[]>;
  /** 某 provider 的历史快照(速率计算用), 默认近 7 天 */
  history(providerId: string, since?: number, limit?: number): Promise<ProviderSnapshot[]>;
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

/** 生产: Rust 侧 rusqlite 执行(SCHEMA_SQL 单一来源) */
export class TauriSqliteStore implements SnapshotStorage {
  private ready: Promise<void> | null = null;

  init(): Promise<void> {
    if (!this.ready) this.ready = sqliteBatch(SCHEMA_SQL);
    return this.ready;
  }

  async saveSnapshot(snap: ProviderSnapshot): Promise<void> {
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
}

/** 纯浏览器 dev / Playwright browser 模式兜底(内存数组) */
export class MemorySqliteStore implements SnapshotStorage {
  private rows: ProviderSnapshot[] = [];

  async init(): Promise<void> {
    /* no-op */
  }

  async saveSnapshot(snap: ProviderSnapshot): Promise<void> {
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
}

let sharedStore: SnapshotStorage | null = null;
/** 全局共享存储(启动时按运行时能力选择后端) */
export function getSharedStorage(): SnapshotStorage {
  if (!sharedStore) {
    // Tauri 运行时(含 Playwright browser mock 经 ipcMocks 拦截)→ Rust sqlite;
    // 纯浏览器 dev → 内存兜底
    sharedStore = isTauriRuntime() ? new TauriSqliteStore() : new MemorySqliteStore();
  }
  return sharedStore;
}

/** 测试/重置用 */
export function resetSharedStorage(): void {
  sharedStore = null;
}
