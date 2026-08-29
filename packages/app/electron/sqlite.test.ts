/**
 * E2 sqlite.ts 主进程服务单测(node vitest) — 验收断言(本卡):
 *
 * 1. SCHEMA_SQL 单源: 应用内实际 schema 与 core 导出一致(防第二份 DDL 混入)
 *    — 建库后 introspect 表/列/索引, 与"直接拿 SCHEMA_SQL 建的内存库"逐项比对
 * 2. 建库 → 基本读写通过(batch/exec/query 三通道语义)
 * 3. db 文件落 dataDir(断言 token-wallet.db 存在于指定 dataDir 下)
 * 4. 幂等重入: 同 dataDir 复用连接; closeAll 后文件仍完整
 * 5. 损坏 SQL 结构化上抛(不静默)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SCHEMA_SQL } from "@token-wallet/core/storage/schema-sql";
import { _resetForTests, batch, closeAll, dbFilePath, exec, openDb, query } from "./sqlite";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-electron-sqlite-"));
});

afterEach(() => {
  closeAll();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** 拿 core SCHEMA_SQL 建的"权威内存库", 作为单源比对的基准 */
function referenceDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  return db;
}

describe("SCHEMA_SQL 单源(D-020)", () => {
  it("应用库表结构与 core 导出 SCHEMA_SQL 建出的基准完全一致", () => {
    openDb(dataDir); // 用 SCHEMA_SQL 建表
    const dbFile = new DatabaseSync(dbFilePath(dataDir)); // 只读比对, 不再执行任何 DDL

    const ref = referenceDb();
    const introspect = (d: DatabaseSync) => {
      const tables = d
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
      const indexes = d
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name",
        )
        .all();
      const cols = d
        .prepare(
          `SELECT m.name AS table_name, p.name, p.type, p.\"notnull\", p.pk
           FROM sqlite_master m JOIN pragma_table_info(m.name) p
           WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'
           ORDER BY m.name, p.cid`,
        )
        .all();
      return { tables, indexes, cols };
    };

    expect(introspect(dbFile)).toEqual(introspect(ref));
    ref.close();
    dbFile.close();
  });

  it("SCHEMA_SQL 文本可直接建表且重复执行幂等", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    expect(() => db.exec(SCHEMA_SQL)).not.toThrow(); // IF NOT EXISTS 幂等
    db.close();
  });
});

describe("建库落 dataDir(D-019)", () => {
  it("db 文件落指定 dataDir 下, 目录不存在自动创建", () => {
    const nested = path.join(dataDir, "a", "b");
    openDb(nested);
    expect(fs.existsSync(dbFilePath(nested))).toBe(true);
    expect(fs.statSync(dbFilePath(nested)).size).toBeGreaterThan(0);
  });

  it("同 dataDir 复用同一连接(缓存单例)", () => {
    const a = openDb(dataDir);
    expect(openDb(dataDir)).toBe(a);
  });
});

describe("基本读写(三通道语义)", () => {
  beforeEach(() => {
    batch(dataDir, SCHEMA_SQL);
  });

  it("batch 建表 + exec 插入返回影响行数", () => {
    const snap = JSON.stringify({ provider_id: "deepseek", status: "ok" });
    const changes = exec(
      dataDir,
      "INSERT INTO snapshots(provider_id, fetched_at, status, raw_json) VALUES (?, ?, ?, ?)",
      ["deepseek", 1_700_000_000, "ok", snap],
    );
    expect(changes).toBe(1);
  });

  it("query 返回行数组(列序), 与 renderer HostSqliteStore 的取数 SQL 兼容", () => {
    exec(
      dataDir,
      "INSERT INTO snapshots(provider_id, fetched_at, status, raw_json) VALUES (?, ?, ?, ?)",
      ["deepseek", 1_700_000_000, "ok", '{"provider_id":"deepseek"}'],
    );
    const rows = query(
      dataDir,
      "SELECT s.raw_json FROM snapshots s WHERE s.provider_id = ? AND s.fetched_at >= ? ORDER BY fetched_at DESC, id DESC LIMIT ?",
      ["deepseek", 0, 100],
    );
    expect(rows).toEqual([['{"provider_id":"deepseek"}']]);
  });

  it("空结果返回空数组, 参数化查询不吃注入", () => {
    expect(query(dataDir, "SELECT raw_json FROM snapshots WHERE provider_id = ?", ["none"])).toEqual(
      [],
    );
    exec(
      dataDir,
      "INSERT INTO snapshots(provider_id, fetched_at, status, raw_json) VALUES (?, ?, ?, ?)",
      ["deepseek", 1, "ok", "x"],
    );
    const rows = query(dataDir, "SELECT raw_json FROM snapshots WHERE provider_id = ?", [
      "' OR 1=1 --",
    ]);
    expect(rows).toEqual([]);
  });

  it("损坏 SQL 结构化上抛, 不静默", () => {
    expect(() => exec(dataDir, "INSERT INTO no_such_table(a) VALUES (?)", [1])).toThrow();
    expect(() => query(dataDir, "SELEC broken", [])).toThrow();
  });
});

describe("生命周期", () => {
  it("closeAll 后数据仍落盘完整, 重开可读(既库迁移路径)", () => {
    batch(dataDir, SCHEMA_SQL);
    exec(
      dataDir,
      "INSERT INTO snapshots(provider_id, fetched_at, status, raw_json) VALUES (?, ?, ?, ?)",
      ["deepseek", 42, "ok", '{"v":1}'],
    );
    closeAll();
    // 重开(模拟 app 二次启动): 数据仍在
    const db = new DatabaseSync(dbFilePath(dataDir), { readOnly: true });
    const row = db.prepare("SELECT raw_json FROM snapshots WHERE fetched_at = 42").get();
    expect(row).toEqual({ raw_json: '{"v":1}' });
    db.close();
  });
});
