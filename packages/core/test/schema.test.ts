import { describe, expect, it } from "vitest";
import {
  MetricSchema,
  parseSnapshot,
  safeParseSnapshot,
} from "../src/schema.js";

const validWindowSnapshot = {
  provider_id: "kimi-code",
  display_name: "Kimi Code",
  plan_type: "window",
  fetched_at: 1724900000,
  status: "ok",
  metrics: [
    {
      key: "rolling_5h",
      kind: "window",
      unit: "requests",
      used: 820,
      limit: 1200,
      reset_at: 1724903600,
    },
  ],
  alerts: [],
};

describe("ProviderSnapshotSchema", () => {
  it("接受合法 window 快照(DESIGN.md §2.1 示例)", () => {
    const snap = parseSnapshot(validWindowSnapshot);
    expect(snap.provider_id).toBe("kimi-code");
    expect(snap.plan_type).toBe("window");
    expect(snap.metrics).toHaveLength(1);
  });

  it("接受 balance 原型(无 limit/reset_at 的剩余额度指标)", () => {
    const snap = parseSnapshot({
      provider_id: "deepseek",
      display_name: "DeepSeek-按量 #1",
      plan_type: "balance",
      fetched_at: 1724900000,
      status: "ok",
      metrics: [{ key: "remaining", kind: "balance", unit: "cny", used: 3.21 }],
      alerts: [],
    });
    expect(snap.metrics[0].limit).toBeUndefined();
  });

  it("接受全部五种 status 与异常扩展字段", () => {
    for (const status of ["ok", "stale", "auth_expired", "unsupported", "error"]) {
      const r = safeParseSnapshot({ ...validWindowSnapshot, status });
      expect(r.success).toBe(true);
    }
    const withHint = safeParseSnapshot({
      ...validWindowSnapshot,
      status: "auth_expired",
      metrics: [],
      setup_hint: "arkcli auth login --no-browser",
    });
    expect(withHint.success).toBe(true);
    const withErr = safeParseSnapshot({
      ...validWindowSnapshot,
      status: "error",
      metrics: [],
      error_message: "http 403",
    });
    expect(withErr.success).toBe(true);
  });

  it("接受 local 原型(per model 时段用量)", () => {
    const snap = parseSnapshot({
      provider_id: "local-hermes",
      display_name: "Hermes Agent",
      plan_type: "local",
      fetched_at: 1724900000,
      status: "ok",
      metrics: [{ key: "k3:today", kind: "usage", unit: "tokens", used: 15230 }],
      alerts: [{ level: "info", message: "normal" }],
    });
    expect(snap.plan_type).toBe("local");
  });

  it("拒绝非法快照: 缺字段/坏枚举/负用量/空 metrics 键", () => {
    // 缺 provider_id
    expect(
      safeParseSnapshot({ ...validWindowSnapshot, provider_id: undefined }).success,
    ).toBe(false);
    // 坏 status 枚举
    expect(
      safeParseSnapshot({ ...validWindowSnapshot, status: "unknown" }).success,
    ).toBe(false);
    // 坏 plan_type
    expect(
      safeParseSnapshot({ ...validWindowSnapshot, plan_type: "hourly" }).success,
    ).toBe(false);
    // 负用量
    expect(
      safeParseSnapshot({
        ...validWindowSnapshot,
        metrics: [{ key: "w", kind: "window", unit: "requests", used: -1 }],
      }).success,
    ).toBe(false);
    // 空 key
    expect(
      safeParseSnapshot({
        ...validWindowSnapshot,
        metrics: [{ key: "", kind: "window", unit: "requests", used: 1 }],
      }).success,
    ).toBe(false);
    // fetched_at 非整数
    expect(
      safeParseSnapshot({ ...validWindowSnapshot, fetched_at: 1.5 }).success,
    ).toBe(false);
    // 完全非对象
    expect(safeParseSnapshot("nope").success).toBe(false);
    expect(safeParseSnapshot(null).success).toBe(false);
  });

  it("parseSnapshot 抛错, safeParseSnapshot 不抛", () => {
    expect(() => parseSnapshot({})).toThrow();
    expect(safeParseSnapshot({}).success).toBe(false);
  });
});

describe("MetricSchema", () => {
  it("unit 枚举限定 requests/credits/cny/tokens", () => {
    const base = { key: "k", kind: "window", used: 1 };
    for (const unit of ["requests", "credits", "cny", "tokens"]) {
      expect(MetricSchema.safeParse({ ...base, unit }).success).toBe(true);
    }
    expect(MetricSchema.safeParse({ ...base, unit: "gb" }).success).toBe(false);
  });
});
