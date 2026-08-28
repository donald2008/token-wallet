/**
 * L1 golden sample — deepseek/balance 真实通道(D-030 L3 golden 防接口变动)
 *
 * fixture = 2026-08-28 真实 API 响应脱敏(余额 448.45 为真实值, 无 key)。
 * 断言: GenericHttpAdapter 声明式映射 → balance 原型快照(granted/topped_up 拆分+currency);
 * 无 eval(路径映射纯 JSONPath); 错误路径 auth_expired/error; 快照不含凭据。
 */
import { describe, expect, it, vi } from "vitest";
import { GenericHttpAdapter } from "../src/generic-http.js";
import { DEEPSEEK_BALANCE } from "../src/channels/presets.js";
import { DEEPSEEK_BALANCE_MAPPING } from "../src/channels/deepseek.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";
import { redactSecrets, safeStringify } from "../src/redact.js";
import { dailyRateFromHistory, estimatedDays, remainingOf } from "../src/rate.js";
import type { ProviderSnapshot } from "../src/schema.js";

/** 2026-08-28 真实验证脱敏: L3 探针输出(数值真实, 无凭据) */
const GOLDEN_RESPONSE = {
  is_available: true,
  balance_infos: [
    {
      currency: "CNY",
      total_balance: "448.45",
      granted_balance: "0.00",
      topped_up_balance: "448.45",
    },
  ],
};

const INSTANCE: InstanceConfig = {
  id: "deepseek",
  channel: "deepseek/balance",
  name: "DeepSeek-按量 #1",
  params: { api_key: { source: "store", key: "deepseek:api_key" } },
};

function makeCtx(resolve: AdapterContext["resolveCredential"] = () => Promise.resolve("sk-test-secret")): AdapterContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    fetchedAt: 1_724_900_000,
    resolveCredential: resolve,
  };
}

describe("deepseek/balance golden sample(§5.2 T1)", () => {
  it("真实响应 → ok 快照: remaining=448.45, granted/topped_up 拆分, currency=CNY", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(GOLDEN_RESPONSE),
      } as Response),
    );
    const adapter = new GenericHttpAdapter(DEEPSEEK_BALANCE_MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(DEEPSEEK_BALANCE, INSTANCE, makeCtx());

    expect(snap.status).toBe("ok");
    expect(snap.plan_type).toBe("balance");
    expect(snap.provider_id).toBe("deepseek");
    expect(snap.metrics).toHaveLength(1);
    const m = snap.metrics[0];
    expect(m).toMatchObject({
      key: "balance",
      kind: "balance",
      unit: "cny",
      used: 448.45,
      remaining: 448.45,
      granted: 0,
      topped_up: 448.45,
      currency: "CNY",
    });
    // 断言路径是纯 JSONPath, 无脚本求值(§5.1 无 eval)
    expect(DEEPSEEK_BALANCE_MAPPING.metrics[0].used.path).toBe("$.balance_infos[0].total_balance");
  });

  it("请求头 Authorization 用真实 key 且只在请求构造瞬间(D-029); 快照/日志无明文", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchMock = vi.fn((_url: string, init?: { headers?: Record<string, string> }) => {
      capturedHeaders = init?.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(GOLDEN_RESPONSE),
      } as Response);
    });
    const adapter = new GenericHttpAdapter(DEEPSEEK_BALANCE_MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(
      DEEPSEEK_BALANCE,
      INSTANCE,
      makeCtx(() => Promise.resolve("sk-abc1234567890")),
    );

    expect(capturedHeaders?.Authorization).toBe("Bearer sk-abc1234567890");
    // 快照不含 key
    expect(JSON.stringify(snap)).not.toContain("sk-abc");
    expect(JSON.stringify(snap)).not.toContain("sk-***");
  });

  it("401 → auth_expired; 500 → error; is_available=false → 断言拦截 error", async () => {
    const ctx = makeCtx();
    const cases: [number | object, string][] = [
      [401, "auth_expired"],
      [500, "error"],
    ];
    for (const [status, expected] of cases) {
      const fetchMock = vi.fn(() =>
        Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve({}) } as Response),
      );
      const adapter = new GenericHttpAdapter(DEEPSEEK_BALANCE_MAPPING, fetchMock as unknown as typeof fetch);
      const snap = await adapter.fetchSnapshot(DEEPSEEK_BALANCE, INSTANCE, ctx);
      expect(snap.status).toBe(expected);
    }
    // is_available=false → ok_assertions 拦截
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ is_available: false, balance_infos: [] }),
      } as Response),
    );
    const adapter = new GenericHttpAdapter(DEEPSEEK_BALANCE_MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(DEEPSEEK_BALANCE, INSTANCE, ctx);
    expect(snap.status).toBe("error");
    expect(snap.error_message).toContain("状态断言未通过");
  });

  it("网络异常 → error 快照(不抛出)", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    const adapter = new GenericHttpAdapter(DEEPSEEK_BALANCE_MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(DEEPSEEK_BALANCE, INSTANCE, makeCtx());
    expect(snap.status).toBe("error");
    expect(snap.error_message).toContain("ECONNREFUSED");
  });
});

describe("D-029 脱敏", () => {
  it("sk- 前缀 key → sk-***; Bearer → Bearer ***; 普通文本不动", () => {
    expect(redactSecrets("key=sk-abc1234567890")).toBe("key=sk-***");
    expect(redactSecrets("Authorization: Bearer sk-live-abcdef")).toContain("Bearer ***");
    expect(redactSecrets("余额 448.45 CNY")).toBe("余额 448.45 CNY");
    expect(safeStringify({ api_key: "sk-xyz987654321" })).not.toContain("sk-xyz");
  });
});

describe("余额速率(§2 ticker 预计可用天数)", () => {
  function snap(provider_id: string, at: number, remaining: number, status: ProviderSnapshot["status"] = "ok"): ProviderSnapshot {
    return {
      provider_id,
      display_name: "DeepSeek-按量 #1",
      plan_type: "balance",
      fetched_at: at,
      status,
      metrics: [{ key: "balance", kind: "balance", unit: "cny", used: remaining, remaining }],
      alerts: [],
    };
  }

  const NOW = 1_730_000_000; // 固定锚点
  it("7 天内两点 → 日速率 = (初-末)/天数", () => {
    const history = [
      snap("deepseek", NOW - 3 * 86_400, 500),
      snap("deepseek", NOW, 460),
    ];
    expect(dailyRateFromHistory(history, NOW)).toBeCloseTo(40 / 3, 5);
  });

  it("不足两点 / 非 ok / 窗口不足 1 天 → null", () => {
    expect(dailyRateFromHistory([snap("deepseek", NOW, 460)], NOW)).toBeNull();
    expect(
      dailyRateFromHistory([snap("deepseek", NOW - 3 * 86_400, 500), snap("deepseek", NOW, 460, "error")], NOW),
    ).toBeNull();
    expect(dailyRateFromHistory([snap("deepseek", NOW - 3600, 500), snap("deepseek", NOW, 460)], NOW)).toBeNull();
  });

  it("余额上升(充值)按 0 计, 不产生负速率", () => {
    const history = [
      snap("deepseek", NOW - 3 * 86_400, 400),
      snap("deepseek", NOW, 600),
    ];
    expect(dailyRateFromHistory(history, NOW)).toBe(0);
  });

  it("预计可用天数 = 剩余 / 日速率; 无速率 → null; 耗尽 → 0", () => {
    expect(estimatedDays(400, 10)).toBe(40);
    expect(estimatedDays(400, null)).toBeNull();
    expect(estimatedDays(0, 10)).toBe(0);
    expect(remainingOf(snap("deepseek", NOW, 448.45))).toBe(448.45);
  });
});
