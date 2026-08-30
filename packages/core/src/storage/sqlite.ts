/**
 * SqliteStore — DESIGN.md §7, D-020
 *
 * node:sqlite(Node 22.5+ 内置)实现。mcp-server 直接用; app 侧由主进程 sqlite IPC
 * 在 Rust 侧执行同一 schema(SQL 文本共享, 见 SCHEMA_SQL 导出)。
 *
 * 写库原子(§3.2): 每次 save 包事务。读回一律 zod 校验, 坏行不污染 UI。
 */
import { DatabaseSync } from "node:sqlite";
import { parseSnapshot, type ProviderSnapshot } from "../schema.js";
import { SCHEMA_SQL } from "./schema-sql.js";
import {
  UsageRecordSchema,
  type SnapshotHistoryQuery,
  type StorageBackend,
  type UsageQuery,
  type UsageRecord,
} from "./backend.js";

interface SnapshotRow {
  raw_json: string;
}

interface UsageRow {
  provider_id: string;
  model: string | null;
  window_start: number;
  window_end: number;
  tokens: number | null;
  credits: number | null;
  cost_cny: number | null;
}

export class SqliteStore implements StorageBackend {
  private readonly db: DatabaseSync;
  /**
   * B-3 写库守卫(t_2ac39613): 当前有效 provider 集合; null = 不过滤(默认, 向后兼容)。
   * 非 null 时 saveSnapshot/saveUsageRecords 丢弃集合外的 providerId ——
   * 防实例删除后在途采集的迟到响应把幽灵行写回库。
   */
  private liveProviders: Set<string> | null = null;

  /**
   * @param path SQLite 文件路径; ":memory:" 供测试
   */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA_SQL);
  }

  /** B-3: 声明当前实例集合(null 关闭过滤) */
  setLiveProviders(ids: Iterable<string> | null): void {
    this.liveProviders = ids === null ? null : new Set(ids);
  }

  /** B-3: 写库准入; 未声明集合时一律放行 */
  private isLive(providerId: string): boolean {
    return this.liveProviders === null || this.liveProviders.has(providerId);
  }

  async saveSnapshot(snapshot: ProviderSnapshot): Promise<void> {
    // B-3 守卫: 已删除 provider 的迟到写入静默丢弃(不抛错, 调用方无需感知)
    if (!this.isLive(snapshot.provider_id)) return;
    // 入口再校验一次, 防止绕过适配器契约的脏数据落库
    const s = parseSnapshot(snapshot);
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO snapshots(provider_id, fetched_at, status, raw_json) VALUES (?, ?, ?, ?)",
        )
        .run(s.provider_id, s.fetched_at, s.status, JSON.stringify(s));
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async latestSnapshot(providerId: string): Promise<ProviderSnapshot | null> {
    const row = this.db
      .prepare(
        "SELECT raw_json FROM snapshots WHERE provider_id = ? ORDER BY fetched_at DESC, id DESC LIMIT 1",
      )
      .get(providerId) as SnapshotRow | undefined;
    return row ? parseSnapshot(JSON.parse(row.raw_json)) : null;
  }

  async latestSnapshots(): Promise<ProviderSnapshot[]> {
    // 每 provider 取 fetched_at 最大的一条(同刻取 id 大者)
    const rows = this.db
      .prepare(
        `SELECT s.raw_json FROM snapshots s
         JOIN (
           SELECT provider_id, MAX(fetched_at) AS max_at FROM snapshots GROUP BY provider_id
         ) m ON s.provider_id = m.provider_id AND s.fetched_at = m.max_at
         GROUP BY s.provider_id
         HAVING s.id = MAX(s.id)
         ORDER BY s.provider_id`,
      )
      .all() as unknown as SnapshotRow[];
    return rows.map((r) => parseSnapshot(JSON.parse(r.raw_json)));
  }

  async snapshotHistory(
    providerId: string,
    q: SnapshotHistoryQuery = {},
  ): Promise<ProviderSnapshot[]> {
    const since = q.since ?? 0;
    const limit = q.limit ?? 1000;
    const rows = this.db
      .prepare(
        "SELECT raw_json FROM snapshots WHERE provider_id = ? AND fetched_at >= ? ORDER BY fetched_at DESC, id DESC LIMIT ?",
      )
      .all(providerId, since, limit) as unknown as SnapshotRow[];
    return rows.map((r) => parseSnapshot(JSON.parse(r.raw_json)));
  }

  async saveUsageRecords(records: UsageRecord[]): Promise<void> {
    if (records.length === 0) return;
    // B-3 守卫: 逐条按 provider 准入, 已删除 provider 的记录静默丢弃
    const parsed = records
      .map((r) => UsageRecordSchema.parse(r))
      .filter((r) => this.isLive(r.provider_id));
    if (parsed.length === 0) return;
    this.db.exec("BEGIN");
    try {
      const stmt = this.db.prepare(
        `INSERT INTO usage_records(provider_id, model, window_start, window_end, tokens, credits, cost_cny)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of parsed) {
        stmt.run(
          r.provider_id,
          r.model,
          r.window_start,
          r.window_end,
          r.tokens,
          r.credits,
          r.cost_cny,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async queryUsage(q: UsageQuery = {}): Promise<UsageRecord[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.providerId !== undefined) {
      where.push("provider_id = ?");
      params.push(q.providerId);
    }
    if (q.model !== undefined) {
      where.push("model = ?");
      params.push(q.model);
    }
    if (q.since !== undefined) {
      where.push("window_end >= ?");
      params.push(q.since);
    }
    if (q.until !== undefined) {
      where.push("window_start <= ?");
      params.push(q.until);
    }
    const sql =
      "SELECT provider_id, model, window_start, window_end, tokens, credits, cost_cny FROM usage_records" +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY window_start DESC, id DESC LIMIT ?";
    params.push(q.limit ?? 1000);
    const rows = this.db.prepare(sql).all(...params) as unknown as UsageRow[];
    return rows.map((r) =>
      UsageRecordSchema.parse({
        provider_id: r.provider_id,
        model: r.model,
        window_start: r.window_start,
        window_end: r.window_end,
        tokens: r.tokens,
        credits: r.credits,
        cost_cny: r.cost_cny,
      }),
    );
  }

  async purgeProvider(providerId: string): Promise<void> {
    // 删除实例对称清理(D-029): keyring 已清, 快照/用量历史一并清除, 不留隐私残留。
    // 原子: 两表同事务, 要么全清要么不动。
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM snapshots WHERE provider_id = ?").run(providerId);
      this.db.prepare("DELETE FROM usage_records WHERE provider_id = ?").run(providerId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
