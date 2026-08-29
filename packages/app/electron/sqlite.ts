/**
 * E2 SQLite 服务(主进程侧, D-020/D-033) — node:sqlite 同步 API 接真(D-034):
 *
 * - SCHEMA_SQL 单一来源 = @token-wallet/core 的 `storage/schema-sql`(D-020 等价):
 *   本文件 import core 导出的 SCHEMA_SQL 执行建表, 严禁复制第二份 DDL。
 *   core 以源码 subpath 引入(esbuild 打进 main.cjs), 与 renderer 侧
 *   `../src/runtime/storage.ts` 引的是同一份导出 → 字面单源, 无编译物时序问题。
 * - db 文件落 dataDir(D-019 配置/数据分家, 大文件不进 Roaming):
 *   `<dataDir>/token-wallet.db`; 目录不存在自动创建(mkdir recursive)。
 * - 连接生命周期: 模块级按 dataDir 缓存单例(同步 API 无并发驱动问题),
 *   app 退出时 close()(will-quit 钩子, main.ts 调 sqliteServiceCloseAll)。
 * - WAL + NORMAL synchronous: 部件场景读多写少, WAL 提升并发读; 断电安全语义
 *   与 persist.ts 的原子写对齐(掉电最多丢最后一条快照, 不损坏库)。
 * - SQL 执行契约(renderer ipc.ts sqliteBatch/exec/query 逐字对齐, 不动通道语义):
 *   - sqlite_batch(sql): 多语句 exec(建表), 无返回
 *   - sqlite_exec(sql, params): INSERT/UPDATE/DELETE → run().changes
 *   - sqlite_query(sql, params): SELECT → all(), 行=数组(列序), 值原样
 * - 错误结构化: node:sqlite 抛错原样上抛(Error, code=ERR_SQLITE_ERROR),
 *   ipcMain.handle 转结构化 reject(沿 E1 约定: 面板出错误卡, 不静默空返回)。
 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

import { SCHEMA_SQL } from "@token-wallet/core/storage/schema-sql";

export interface SqliteRows {
  rows: unknown[][];
}

const openDbs = new Map<string, DatabaseSync>();

/** db 文件路径派生(零硬编码盘符, 由调用方传 storagePaths().dataDir) */
export function dbFilePath(dataDir: string): string {
  return path.join(dataDir, "token-wallet.db");
}

/** 打开(或复用)dataDir 下的连接: 建目录 → 开库 → WAL → SCHEMA_SQL 建表(幂等) */
export function openDb(dataDir: string): DatabaseSync {
  const existing = openDbs.get(dataDir);
  if (existing) return existing;

  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dbFilePath(dataDir));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  // SCHEMA_SQL 单源执行(D-020): CREATE TABLE/INDEX IF NOT EXISTS, 幂等可重入
  db.exec(SCHEMA_SQL);

  openDbs.set(dataDir, db);
  return db;
}

/** sqlite_batch: 多语句执行(建表/批处理); renderer HostSqliteStore.init() 用 */
export function batch(dataDir: string, sql: string): void {
  openDb(dataDir).exec(sql);
}

/** sqlite_exec: INSERT/UPDATE/DELETE → 影响行数 */
export function exec(dataDir: string, sql: string, params: unknown[]): number {
  // node:sqlite run() 返回 {changes: number|bigint, lastInsertRowid}, IPC 侧统一 number
  return Number(openDb(dataDir).prepare(sql).run(...(params as never[])).changes);
}

/** sqlite_query: SELECT → 行数组(每行按列序的数组, 与 ipc.ts 契约一致) */
export function query(dataDir: string, sql: string, params: unknown[]): unknown[][] {
  const stmt = openDb(dataDir).prepare(sql);
  // node:sqlite setReturnArrays(true) 返回按列序的数组行(而非对象行), 对齐 renderer 解析;
  // 重复列名不丢列(Object.values 方案会丢, 已否决)。BLOB 本就返回 Uint8Array, 无需转换。
  stmt.setReturnArrays(true);
  return stmt.all(...(params as never[])) as unknown as unknown[][];
}

/** app 退出时关闭全部连接(will-quit); 防御式: 失败不阻断退出流程 */
export function closeAll(): void {
  for (const [dir, db] of openDbs) {
    try {
      db.close();
    } catch (e) {
      console.warn(`[token-wallet] sqlite close failed (${dir}):`, e);
    }
  }
  openDbs.clear();
}

/** 测试用: 仅测试进程调用(真 app 走 closeAll), 语义同 closeAll */
export const _resetForTests = closeAll;
