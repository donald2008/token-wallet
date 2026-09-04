// L1(t_d086543b): sortProviders —— 卡间排序只留手动(order 交集语义, 名称/紧要度自动排序已移除)。
// 覆盖: order 交集 / 尾部名称正排追加 / 幽灵 id 忽略 / order 缺失退化 / normalizeSortConfig 全归一 manual /
// 旧持久化 name|urgency 配置 → manual(order 保留) / reorderByIds / sortByHealth 保留回归。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT_CONFIG,
  normalizeSortConfig,
  reorderByIds,
  sortByHealth,
  sortProviders,
} from "./health";
import type { Metric, ProviderSnapshot, ProviderStatus } from "./types";

const NOW = 1_780_000_000;

function metric(used: number, limit?: number): Metric {
  return { key: "rolling_5h", kind: "window", unit: "requests", used, limit, reset_at: NOW + 3600 };
}

function snap(name: string, status: ProviderStatus = "ok", metrics: Metric[] = []): ProviderSnapshot {
  return {
    provider_id: name,
    display_name: name,
    plan_type: "window",
    fetched_at: NOW - 60,
    status,
    metrics,
    alerts: [],
  };
}

function names(list: ProviderSnapshot[]): string[] {
  return list.map((p) => p.display_name);
}

describe("sortProviders: manual 只留手动(t_d086543b)", () => {
  const A = snap("a", "ok", [metric(50, 100)]);
  const B = snap("b", "ok", [metric(50, 100)]);
  const C = snap("c", "ok", [metric(50, 100)]);
  // 注: snap(id) 的 display_name = id(拉丁), NAME_COLLATOR(zh) 对拉丁串按码位序: a<b<c<d

  it("缺省 = manual; 无 order 时按名称正排(与旧缺省视觉一致)", () => {
    expect(DEFAULT_SORT_CONFIG).toEqual({ key: "manual", dir: "asc" });
    expect(names(sortProviders([C, A, B]))).toEqual(["a", "b", "c"]);
    expect(names(sortProviders([C, A, B], { key: "manual", dir: "asc" }))).toEqual(["a", "b", "c"]);
  });

  it("按 order 顺序排(交集); 恒 asc 语义(不反转)", () => {
    expect(names(sortProviders([A, B, C], { key: "manual", dir: "asc", order: ["c", "a", "b"] }))).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(names(sortProviders([A, B, C], { key: "manual", dir: "asc", order: ["c", "a"] }))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("order 里没有的 id(历史漂移/从未拖过)按名称正排追加尾部", () => {
    // order 只有 c; a/b 不在 order → 尾部按名称正排: a < b
    expect(names(sortProviders([A, B, C], { key: "manual", dir: "asc", order: ["c"] }))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("order 里的幽灵 id(已删除)忽略, 不丢现有卡", () => {
    expect(
      names(sortProviders([A, B], { key: "manual", dir: "asc", order: ["ghost-1", "a", "ghost-2"] })),
    ).toEqual(["a", "b"]);
  });

  it("order 缺失/空 → 名称正排(实例集合是真相源)", () => {
    expect(names(sortProviders([A, B, C], { key: "manual", dir: "asc" }))).toEqual(["a", "b", "c"]);
    expect(names(sortProviders([A, B, C], { key: "manual", dir: "asc", order: [] }))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("新 provider 置顶 = order 首插(由 App 保存回调写入); 尾部规则不吞新卡", () => {
    // 模拟 App onProviderSaved: order = [newId, ...旧 order]
    const D = snap("d", "ok", [metric(50, 100)]);
    const cards = [A, B, C, D];
    const cfg = { key: "manual" as const, dir: "asc" as const, order: ["d", "b", "a"] };
    expect(names(sortProviders(cards, cfg))).toEqual(["d", "b", "a", "c"]);
  });
});

describe("normalizeSortConfig: 全归一 manual(t_d086543b)", () => {
  it("旧持久化 name/urgency → manual; dir 固定 asc; order 保留", () => {
    expect(normalizeSortConfig({ key: "name", dir: "asc" })).toEqual({ key: "manual", dir: "asc" });
    expect(normalizeSortConfig({ key: "urgency", dir: "desc" })).toEqual({ key: "manual", dir: "asc" });
    expect(normalizeSortConfig({ key: "urgency", dir: "desc", order: ["a", "b"] })).toEqual({
      key: "manual",
      dir: "asc",
      order: ["a", "b"],
    });
    expect(normalizeSortConfig({ key: "manual", dir: "desc", order: ["b", "a"] })).toEqual({
      key: "manual",
      dir: "asc",
      order: ["b", "a"],
    });
  });

  it("非法 key/非对象/null/缺失 → 缺省 manual, 不抛错", () => {
    for (const raw of [
      null,
      undefined,
      "manual",
      [],
      { key: "size", dir: "asc" },
      { key: "manual", dir: "up" },
      { key: "manual" },
      { dir: "asc" },
      {},
    ]) {
      expect(normalizeSortConfig(raw)).toEqual(DEFAULT_SORT_CONFIG);
    }
  });

  it("order 非数组/空数组/含非字符串 → 过滤或省略, 不崩", () => {
    expect(normalizeSortConfig({ key: "manual", order: "nope" })).toEqual({ key: "manual", dir: "asc" });
    expect(normalizeSortConfig({ key: "manual", order: [] })).toEqual({ key: "manual", dir: "asc" });
    expect(normalizeSortConfig({ key: "manual", order: ["a", 42, "b", null] })).toEqual({
      key: "manual",
      dir: "asc",
      order: ["a", "b"],
    });
  });
});

describe("reorderByIds(D-039 拖动落点)", () => {
  it("把 dragId 移到 overIndex, 其余保持原相对顺序", () => {
    expect(reorderByIds(["a", "b", "c"], "b", 0)).toEqual(["b", "a", "c"]);
    expect(reorderByIds(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(reorderByIds(["a", "b", "c"], "c", 1)).toEqual(["a", "c", "b"]);
    expect(reorderByIds(["a", "b", "c"], "b", 2)).toEqual(["a", "c", "b"]);
  });

  it("overIndex 越界钳制(0..others.length)", () => {
    expect(reorderByIds(["a", "b", "c"], "a", -5)).toEqual(["a", "b", "c"]);
    expect(reorderByIds(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(reorderByIds(["a", "b", "c"], "b", 99)).toEqual(["a", "c", "b"]);
  });
});

describe("sortByHealth 保留回归(历史次级稳定键来源, 保留不删)", () => {
  it("健康带 > status 严重度 > 剩余比例 的三级次序不变", () => {
    const okTight = snap("ok-tight", "ok", [metric(50, 100)]); // 剩余 50% → ok 带
    const warnExpired = snap("warn-expired", "auth_expired"); // warn 带
    const badErr = snap("bad-err", "error"); // bad 带
    expect(names(sortByHealth([okTight, warnExpired, badErr]))).toEqual([
      "bad-err",
      "warn-expired",
      "ok-tight",
    ]);
  });
});
