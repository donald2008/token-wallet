/**
 * SQLite schema 权威 SQL 文本 — DESIGN.md §7 (D-020)
 *
 * 双宿主共享同一 schema: app(主进程 sqlite IPC, D-033) 与
 * mcp-server(node:sqlite) 都从这里取 SCHEMA_SQL, 保证两侧建表一致。
 * 本模块零 Node 依赖(browser-safe), app 可经 subpath export 安全 import。
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_provider_time
  ON snapshots(provider_id, fetched_at);

CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  model TEXT,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  tokens REAL,
  credits REAL,
  cost_cny REAL
);
CREATE INDEX IF NOT EXISTS idx_usage_provider_time
  ON usage_records(provider_id, window_start);
`;
