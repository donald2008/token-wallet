/**
 * L1 golden sample — opencode/go 真实通道(D-030 L3 golden 防接口变动)
 *
 * fixture = 2026-08-29 真实 API 响应(percent/resetsAt 数值真实, 无 key)。
 * 断言: 三窗 percent+const limit+iso_epoch reset_at 映射正确;
 * **weekly rate-limited 是单窗受限不污整卡**(整卡仍 ok, 单窗 percent=100
 * 由 metricHealth+bars 自然判红, 见 D-022/D-036) —— 即映射不得有
 * `$.usage.weekly.status == 'ok'` 类 ok_assertions。
 */
import { describe, expect, it, vi } from "vitest";
import { GenericHttpAdapter } from "../src/generic-http.js";
import { OPENCODE_GO } from "../src/channels/presets.js";
import { OPENCODE_GO_MAPPING } from "../src/channels/opencode.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";

/** 2026-08-29 真实验证脱敏(weekly 正处在 rate-limited 100%, 恰用于验单窗限流语义) */
const GOLDEN_RESPONSE = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-08-29T13:26:59.879Z" },
    weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-31T00:00:00.879Z" },
    monthly: { status: "ok", percent: 48, resetsAt: "2026-09-25T06:07:28.879Z" },
  },
};

const INSTANCE: InstanceConfig = {
  id: "opencode",
  channel: "opencode/go",
  name: "opencode-Go Coding #1",
  params: { api_key: { source: "store", key: "opencode:api_key" } },
};

function makeCtx(): AdapterContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    fetchedAt: 1_788_000_000,
    resolveCredential: () => Promise.resolve("«redacted:oc-…»"),
  };
}

describe("opencode/go golden sample(§5.2 T2 三窗)", () => {
  it("真实响应 → ok 快照: 三窗 percent/limit=100(常量)/reset_at=iso_epoch", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(GOLDEN_RESPONSE),
      } as Response),
    );
    const adapter = new GenericHttpAdapter(OPENCODE_GO_MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(OPENCODE_GO, INSTANCE, makeCtx());

    // 整卡 ok: weekly rate-limited 不污整卡(单窗受限 ≠ 整体故障)
    expect(snap.status).toBe("ok");
    expect(snap.plan_type).toBe("window");
    expect(snap.metrics).toHaveLength(3);

    const byKey = Object.fromEntries(snap.metrics.map((m) => [m.key, m]));
    // rolling_5h: percent=0, 常量 limit=100, reset .879Z(3 位毫秒)
    expect(byKey["rolling_5h"]).toMatchObject({
      kind: "window",
      unit: "percent",
      used: 0,
      limit: 100,
      reset_at: 1_788_010_019,
    });
    // weekly: percent=100(rate-limited 单窗) — 数值保留, 由 UI 判红
    expect(byKey["weekly"]).toMatchObject({
      unit: "percent",
      used: 100,
      limit: 100,
      reset_at: 1_788_134_400,
    });
    // monthly: percent=48
    expect(byKey["monthly"]).toMatchObject({
      unit: "percent",
      used: 48,
      limit: 100,
      reset_at: 1_790_316_448,
    });
  });

  it("映射不得对单窗 status 做 ok_assertions(防整卡被单窗拖红)", () => {
    // 本卡契约(D-036): 通道映射零 ok_assertions; 若上游未来断言需求必须逐窗表达,
    // 先在 DESIGN.md 论证再改 —— 当前断言失败即语义回退
    expect(OPENCODE_GO_MAPPING.ok_assertions).toBeUndefined();
    const usedPaths = OPENCODE_GO_MAPPING.metrics.map((m) => m.used.path);
    expect(usedPaths.some((p) => p?.includes("status"))).toBe(false);
  });

  it("401 → auth_expired; 快照无明文凭据", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response),
    );
    const adapter = new GenericHttpAdapter(OPENCODE_GO_MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(OPENCODE_GO, INSTANCE, makeCtx());
    expect(snap.status).toBe("auth_expired");
    expect(JSON.stringify(snap)).not.toContain("oc-");
  });
});
