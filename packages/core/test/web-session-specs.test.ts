/**
 * 通道通用组合器工厂 — t_7672da28 U2(清 t_e371caca round-1 P2-2)
 *
 * 覆盖:
 * - mimo/token-plan → 返回组合器且功能可用(fetchImpl 注入, 全链路聚合含套餐元信息)
 * - 同域校验在工厂产出上生效(注册表被塞入跨域 spec → 构造期 WebSessionDomainError)
 * - 未知通道 / 非 web_session 通道 → 显式抛 CompositeAdapterError(不静默兜底 MiMo spec)
 * - 注册表不变量: PRESET_CHANNELS 中 auth.kind=web_session 的通道 ⊆ WEB_SESSION_CHANNEL_SPECS
 *   (单一事实源 = 通道目录, 禁平行第二张表漂移)
 */
import { describe, expect, it } from "vitest";
import { compositeAdapterFor, WEB_SESSION_CHANNEL_SPECS, CompositeAdapterError } from "../src/channels/web-session-specs.js";
import { WebSessionCompositeAdapter, WebSessionDomainError } from "../src/web-session.js";
import { PRESET_CHANNELS } from "../src/channels/presets.js";
import { CHANNEL_MAPPINGS } from "../src/channels/mappings.js";
import { MIMO_WEB_SESSION_SPEC } from "../src/channels/mimo.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";

const INSTANCE: InstanceConfig = {
  id: "mimo-1",
  channel: "mimo/token-plan",
  name: "MiMo-TokenPlan #1",
  params: { web_session: { source: "store", key: "mimo:cookie" } },
};

/** mock 凭据(形态占位串, 非真值) */
const MOCK_COOKIE = "api-platform_serviceToken=<mock-token>; userId=<mock-user-id>";

function makeCtx(): AdapterContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    resolveCredential: async () => MOCK_COOKIE,
    fetchedAt: 1_789_000_000,
  };
}

/** 按端点 URL 路由的 fetch mock(零真 cookie 值) */
function makeFetch(perEndpoint: Record<string, { status: number; body: unknown }>) {
  return async (input: string | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace("https://platform.xiaomimimo.com/api/v1", "");
    const spec = perEndpoint[path];
    if (!spec) throw new Error(`mock 未覆盖端点: ${path}`);
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      json: async () => spec.body,
    } as unknown as Response;
  };
}

describe("compositeAdapterFor 通道通用组合器工厂(t_7672da28 U2)", () => {
  it("mimo/token-plan → 返回组合器, fetchImpl 注入后全链路聚合可用(含套餐元信息)", async () => {
    const adapter = compositeAdapterFor(
      "mimo/token-plan",
      makeFetch({
        "/balance": {
          status: 200,
          body: { code: 0, data: { balance: "25.51", currency: "CNY" } },
        },
        "/tokenPlan/detail": {
          status: 200,
          body: { code: 0, data: { planCode: "Standard", currentPeriodEnd: "2026-10-31 23:59:59", expired: false } },
        },
        "/tokenPlan/usage": {
          status: 200,
          body: { code: 0, data: { monthUsage: { percent: 0.32, items: [{ name: "coding", used: 3200000, limit: 10000000, percent: 0.32 }] } } },
        },
      }) as unknown as typeof fetch,
    );
    expect(adapter).toBeInstanceOf(WebSessionCompositeAdapter);
    const descriptor = PRESET_CHANNELS.find((d) => d.channel === "mimo/token-plan")!;
    const snap = await adapter.fetchSnapshot(descriptor, INSTANCE, makeCtx());
    expect(snap.status).toBe("ok");
    const credits = snap.metrics.find((m) => m.key === "monthly_credits")!;
    expect(credits.used).toBe(3_200_000);
    expect(credits.limit).toBe(10_000_000);
    expect(credits.plan_code).toBe("Standard");
    expect(credits.expired).toBe(false);
  });

  it("同域校验在工厂产出上生效: 注册表被塞入跨域 spec → 构造期 WebSessionDomainError", () => {
    const evil = {
      ...MIMO_WEB_SESSION_SPEC,
      endpoints: [
        ...MIMO_WEB_SESSION_SPEC.endpoints,
        { name: "evil", mapping: { url: "https://evil.example.com/api/v1/steal", metrics: [] } },
      ],
    };
    const original = WEB_SESSION_CHANNEL_SPECS["mimo/token-plan"];
    (WEB_SESSION_CHANNEL_SPECS as Record<string, typeof original>)["mimo/token-plan"] = evil;
    try {
      expect(() => compositeAdapterFor("mimo/token-plan")).toThrow(WebSessionDomainError);
    } finally {
      (WEB_SESSION_CHANNEL_SPECS as Record<string, typeof original>)["mimo/token-plan"] = original;
    }
  });

  it("未知通道 → 显式抛 CompositeAdapterError(不静默兜底 MiMo spec)", () => {
    expect(() => compositeAdapterFor("nonexistent/channel")).toThrow(CompositeAdapterError);
    expect(() => compositeAdapterFor("nonexistent/channel")).toThrow(/无 web_session spec/);
  });

  it("非 web_session 通道(api_key 既有通道) → 显式抛 CompositeAdapterError", () => {
    // deepseek/balance 在 PRESET_CHANNELS 与 CHANNEL_MAPPINGS 都在, 但无 web_session spec
    expect(PRESET_CHANNELS.find((d) => d.channel === "deepseek/balance")).toBeTruthy();
    expect(CHANNEL_MAPPINGS["deepseek/balance"]).toBeTruthy();
    expect(() => compositeAdapterFor("deepseek/balance")).toThrow(CompositeAdapterError);
  });

  it("注册表不变量: PRESET_CHANNELS 中 web_session 通道 ⊆ WEB_SESSION_CHANNEL_SPECS(单一事实源)", () => {
    const webSessionChannels = PRESET_CHANNELS
      .filter((d) => d.auth?.kind === "web_session")
      .map((d) => d.channel);
    expect(webSessionChannels.length).toBeGreaterThan(0);
    for (const ch of webSessionChannels) {
      expect(WEB_SESSION_CHANNEL_SPECS[ch]).toBeTruthy();
      // 双注册面一致性: web_session 通道同样在 CHANNEL_MAPPINGS 有数据面声明(注册完整性)
      expect(CHANNEL_MAPPINGS[ch]).toBeTruthy();
    }
  });
});
