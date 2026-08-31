/**
 * L1 映射能力扩展(本卡 4 项): percent unit / iso_epoch pipe / FieldMapping.const / 三者组合。
 * 边界: 毫秒小数两种精度(.879Z / .687248Z)、Z 与偏移时区、数字直通、非法输入报 MappingError。
 */
import { describe, expect, it, vi } from "vitest";
import { applyPipe, MappingError } from "../src/mapping/jsonpath.js";
import { GenericHttpAdapter } from "../src/generic-http.js";
import type { AdapterContext, GenericHttpMapping, InstanceConfig } from "../src/generic-http.js";
import { safeParseSnapshot, MetricUnitSchema } from "../src/schema.js";

describe("MetricUnitSchema 新增 percent", () => {
  it("percent 是合法单位, 快照可携带 percent 指标", () => {
    expect(MetricUnitSchema.safeParse("percent").success).toBe(true);
    const snap = {
      provider_id: "p",
      display_name: "P",
      plan_type: "window",
      fetched_at: 1,
      status: "ok",
      metrics: [{ key: "weekly", kind: "window", unit: "percent", used: 48, limit: 100 }],
      alerts: [],
    };
    expect(safeParseSnapshot(snap).success).toBe(true);
  });
});

describe("iso_epoch pipe(ISO 8601 → unix 秒)", () => {
  it("毫秒小数 .879Z(3 位精度) → 秒级 epoch", () => {
    expect(applyPipe("2026-08-29T13:26:59.879Z", ["iso_epoch"])).toBe(1_788_010_019);
  });

  it("毫秒小数 .687248Z(6 位精度) → 秒级 epoch(容忍高位小数)", () => {
    expect(applyPipe("2026-09-04T01:21:10.687248Z", ["iso_epoch"])).toBe(1_788_484_870);
  });

  it("偏移时区 ±HH:MM 归一化为 UTC(与 Z 同刻)", () => {
    expect(applyPipe("2026-09-04T09:21:10.687248+08:00", ["iso_epoch"])).toBe(1_788_484_870);
    expect(applyPipe("2026-09-04T01:21:10.687248+00:00", ["iso_epoch"])).toBe(1_788_484_870);
  });

  it("无毫秒 + Z → 整秒 epoch", () => {
    expect(applyPipe("2026-08-31T00:00:00Z", ["iso_epoch"])).toBe(1_788_134_400);
  });

  it("数字输入直接透传(防御)", () => {
    expect(applyPipe(1_788_134_400, ["iso_epoch"])).toBe(1_788_134_400);
  });

  it("非法输入抛 MappingError(不静默)", () => {
    expect(() => applyPipe("not-a-date", ["iso_epoch"])).toThrow(MappingError);
    expect(() => applyPipe("2026-08-31", ["iso_epoch"])).toThrow(MappingError);
    expect(() => applyPipe(undefined, ["iso_epoch"])).toThrow(MappingError);
  });
});

describe("ms_epoch pipe(毫秒 epoch → unix 秒, zai nextResetTime D-0xx)", () => {
  it("毫秒 epoch 除以 1000 取整", () => {
    expect(applyPipe(1_788_192_250_348, ["ms_epoch"])).toBe(1_788_192_250);
    expect(applyPipe(1_788_578_665_998, ["ms_epoch"])).toBe(1_788_578_665);
  });

  it("数字字符串同样处理; 非法输入抛 MappingError", () => {
    expect(applyPipe("1788192250348", ["ms_epoch"])).toBe(1_788_192_250);
    expect(() => applyPipe("not-a-number", ["ms_epoch"])).toThrow(MappingError);
    expect(() => applyPipe(undefined, ["ms_epoch"])).toThrow(MappingError);
  });
});

describe("FieldMapping.const + percent + iso_epoch 组合(GenericHttpAdapter 全链路)", () => {
  const MAPPING: GenericHttpMapping = {
    url: "https://example.test/usage",
    method: "GET",
    headers: { Authorization: "Bearer {{api_key}}" },
    metrics: [
      {
        key: "weekly",
        kind: "window",
        unit: "percent",
        used: { path: "$.usage.weekly.percent" },
        limit: { const: 100 },
        reset_at: { path: "$.usage.weekly.resetsAt", pipes: ["iso_epoch"] },
      },
      {
        key: "monthly",
        kind: "window",
        unit: "percent",
        used: { path: "$.usage.monthly.percent" },
        limit: { const: 100 },
        reset_at: { path: "$.usage.monthly.resetsAt", pipes: ["iso_epoch"] },
      },
    ],
  };

  const INSTANCE: InstanceConfig = {
    id: "demo",
    channel: "demo/go",
    name: "Demo #1",
    params: { api_key: { source: "store", key: "demo:api_key" } },
  };

  function makeCtx(fetchedAt = 1_724_900_000): AdapterContext {
    return {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      fetchedAt,
      resolveCredential: () => Promise.resolve("sk-test"),
    };
  }

  it("percent 直读 + const limit + iso_epoch reset_at 三者组合 → 合法快照", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            usage: {
              weekly: { percent: 100, resetsAt: "2026-08-31T00:00:00.879Z" },
              monthly: { percent: 48, resetsAt: "2026-09-25T06:07:28.879Z" },
            },
          }),
      } as Response),
    );
    const adapter = new GenericHttpAdapter(MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(
      { channel: "demo/go", plan_type: "window" } as never,
      INSTANCE,
      makeCtx(),
    );

    expect(snap.status).toBe("ok");
    expect(snap.metrics).toHaveLength(2);
    const [weekly, monthly] = snap.metrics;
    expect(weekly).toMatchObject({ key: "weekly", unit: "percent", used: 100, limit: 100, reset_at: 1_788_134_400 });
    expect(monthly).toMatchObject({ key: "monthly", unit: "percent", used: 48, limit: 100, reset_at: 1_790_316_448 });
    // 快照通过 schema(percent unit + const limit + reset_at 均为合法)
    expect(safeParseSnapshot(snap).success).toBe(true);
  });

  it("FieldMapping 既无 path 也无 const → 配置错误抛 MappingError(不静默兜底)", async () => {
    const bad: GenericHttpMapping = {
      ...MAPPING,
      metrics: [{ key: "x", kind: "window", unit: "percent", used: { pipes: ["number"] } }],
    };
    const adapter = new GenericHttpAdapter(bad, fetch as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot({ channel: "demo/go", plan_type: "window" } as never, INSTANCE, makeCtx());
    // 异常不外泄: adapter 捕获为 error 快照
    expect(snap.status).toBe("error");
  });
});
