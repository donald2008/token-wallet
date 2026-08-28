import { describe, expect, it, afterEach } from "vitest";
import { SqliteStore } from "../src/storage/sqlite.js";
import { SCHEMA_SQL } from "../src/storage/schema-sql.js";
import type { ProviderSnapshot } from "../src/schema.js";
import type { UsageRecord } from "../src/storage/backend.js";

function snap(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    provider_id: "deepseek",
    display_name: "DeepSeek-按量 #1",
    plan_type: "balance",
    fetched_at: 1724900000,
    status: "ok",
    metrics: [{ key: "remaining", kind: "balance", unit: "cny", used: 42.5 }],
    alerts: [],
    ...overrides,
  };
}

let store: SqliteStore | null = null;
afterEach(async () => {
  await store?.close();
  store = null;
});

describe("SqliteStore — snapshots", () => {
  it("落库 + latestSnapshot 读回(字段全等)", async () => {
    store = new SqliteStore(":memory:");
    const s = snap();
    await store.saveSnapshot(s);
    const back = await store.latestSnapshot("deepseek");
    expect(back).toEqual(s);
  });

  it("latestSnapshot 取最新 fetched_at; 无记录返回 null", async () => {
    store = new SqliteStore(":memory:");
    expect(await store.latestSnapshot("deepseek")).toBeNull();
    await store.saveSnapshot(snap({ fetched_at: 100 }));
    await store.saveSnapshot(snap({ fetched_at: 300, status: "stale" }));
    await store.saveSnapshot(snap({ fetched_at: 200 }));
    const latest = await store.latestSnapshot("deepseek");
    expect(latest?.fetched_at).toBe(300);
    expect(latest?.status).toBe("stale");
  });

  it("latestSnapshots 每 provider 各一条最新", async () => {
    store = new SqliteStore(":memory:");
    await store.saveSnapshot(snap({ fetched_at: 100 }));
    await store.saveSnapshot(snap({ fetched_at: 200 }));
    await store.saveSnapshot(
      snap({ provider_id: "kimi", display_name: "Kimi Code #1", plan_type: "window", fetched_at: 150 }),
    );
    const all = await store.latestSnapshots();
    expect(all).toHaveLength(2);
    const ds = all.find((s) => s.provider_id === "deepseek")!;
    expect(ds.fetched_at).toBe(200);
  });

  it("snapshotHistory 时间倒序 + since/limit 过滤", async () => {
    store = new SqliteStore(":memory:");
    for (const t of [100, 200, 300, 400]) {
      await store.saveSnapshot(snap({ fetched_at: t }));
    }
    const hist = await store.snapshotHistory("deepseek", { since: 200, limit: 2 });
    expect(hist.map((s) => s.fetched_at)).toEqual([400, 300]);
  });

  it("非法快照拒绝落库(入口 zod 再校验)", async () => {
    store = new SqliteStore(":memory:");
    await expect(
      store.saveSnapshot({ ...snap(), status: "bogus" } as unknown as ProviderSnapshot),
    ).rejects.toThrow();
    expect(await store.latestSnapshot("deepseek")).toBeNull();
  });
});

describe("SqliteStore — usage_records", () => {
  const rec = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
    provider_id: "local-hermes",
    model: "k3",
    window_start: 1724900000,
    window_end: 1724903600,
    tokens: 15230,
    credits: null,
    cost_cny: null,
    ...overrides,
  });

  it("批量落库 + 条件查询读回", async () => {
    store = new SqliteStore(":memory:");
    await store.saveUsageRecords([
      rec(),
      rec({ model: "deepseek-v4-pro", tokens: 9000 }),
      rec({ provider_id: "kimi", model: null, credits: 120, window_start: 1724907200, window_end: 1724910800 }),
    ]);
    const all = await store.queryUsage();
    expect(all).toHaveLength(3);

    const byProvider = await store.queryUsage({ providerId: "local-hermes" });
    expect(byProvider).toHaveLength(2);
    expect(byProvider.every((r) => r.provider_id === "local-hermes")).toBe(true);

    const byModel = await store.queryUsage({ model: "k3" });
    expect(byModel).toHaveLength(1);
    expect(byModel[0].tokens).toBe(15230);

    const bySince = await store.queryUsage({ since: 1724907000 });
    expect(bySince).toHaveLength(1);
    expect(bySince[0].provider_id).toBe("kimi");
    expect(bySince[0].model).toBeNull();
    expect(bySince[0].credits).toBe(120);
  });

  it("空数组不落库不报错; 非法记录整批回滚(原子)", async () => {
    store = new SqliteStore(":memory:");
    await store.saveUsageRecords([]);
    expect(await store.queryUsage()).toHaveLength(0);

    await expect(
      store.saveUsageRecords([
        rec(),
        { ...rec(), provider_id: "" }, // 非法: 空 provider_id
      ]),
    ).rejects.toThrow();
    // zod 在事务前批量校验, 一条不进
    expect(await store.queryUsage()).toHaveLength(0);
  });
});

describe("SCHEMA_SQL", () => {
  it("包含 §7 约定的两表与全部列", () => {
    expect(SCHEMA_SQL).toContain("snapshots");
    expect(SCHEMA_SQL).toContain("usage_records");
    for (const col of ["provider_id", "fetched_at", "status", "raw_json"]) {
      expect(SCHEMA_SQL).toContain(col);
    }
    for (const col of ["model", "window_start", "window_end", "tokens", "credits", "cost_cny"]) {
      expect(SCHEMA_SQL).toContain(col);
    }
  });
});
