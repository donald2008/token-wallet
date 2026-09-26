/**
 * L1 golden — mimo/token-plan web_session 通道(t_4ad1c22e, D-058)
 *
 * ⚠️ 契约为 CodexBar 二手实证(未真 cookie 实测), fixture 全 mock(安全纪律:
 * cookie 值禁真值, fixture/断言只用形态占位串)。覆盖:
 * - 正常态: 三端点并发 → balance + monthly_credits(used ← usage ×100, reset_at ← detail UTC)
 * - auth_expired 三形态: body code 401 / HTTP 401 / HTTP 3xx(登录重定向)
 * - balance 可选项: 缺 cashBalance/giftBalance → 指标不塌(可选项缺省)
 * - percent 0-1 换算(scale_percent) + UTC 空格时间解析(iso_epoch)
 * - 必需 cookie 缺失 → auth_expired; 凭据解析失败 → auth_expired
 * - 域护栏: 端点跨域 → WebSessionDomainError
 * - best-effort: 辅端点失败 → warn alert 不塌主数据
 * - 注册完整性: mimo/token-plan 在 PRESET_CHANNELS + CHANNEL_MAPPINGS + auth 契约
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  WebSessionCompositeAdapter,
  WebSessionDomainError,
  isRedirectStatus,
  validateCookieNames,
} from "../src/web-session.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";
import { MIMO_TOKEN_PLAN } from "../src/channels/presets.js";
import { MIMO_WEB_SESSION_SPEC, mimoCompositeAdapter } from "../src/channels/mimo.js";
import { CHANNEL_MAPPINGS } from "../src/channels/mappings.js";
import { PRESET_CHANNELS } from "../src/channels/presets.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(join(here, "../src/channels/__fixtures__/mimo-web-session-mock.json"), "utf8"),
) as Record<string, unknown>;

const INSTANCE: InstanceConfig = {
  id: "mimo-1",
  channel: "mimo/token-plan",
  name: "MiMo-TokenPlan #1",
  params: { web_session: { source: "store", key: "mimo:cookie" } },
};

/** mock 凭据(形态占位串, 非真值): 含两必需 cookie 名 */
const MOCK_COOKIE = "api-platform_serviceToken=<mock-token>; userId=<mock-user-id>; other=1";

function makeCtx(cookie: string = MOCK_COOKIE, failResolve = false): AdapterContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    resolveCredential: async () => {
      if (failResolve) throw new Error("凭据解析失败(mock)");
      return cookie;
    },
    fetchedAt: 1_789_000_000,
  };
}

/** 按端点 URL 路由响应的 fetch mock: 逐端点可注入 {status, body} */
function makeFetch(
  perEndpoint: Record<string, { status: number; body: unknown }>,
  seenHeaders: Record<string, string>[] = [],
) {
  return async (input: string | URL, init?: { headers?: Record<string, string> }): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace("https://platform.xiaomimimo.com/api/v1", "");
    const spec = perEndpoint[path];
    if (!spec) throw new Error(`mock 未覆盖端点: ${path}`);
    seenHeaders.push({ ...(init?.headers ?? {}) });
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      json: async () => spec.body,
    } as unknown as Response;
  };
}

const OK_RESPONSES = {
  "/balance": { status: 200, body: FIXTURES.balance },
  "/tokenPlan/detail": { status: 200, body: FIXTURES.tokenPlanDetail },
  "/tokenPlan/usage": { status: 200, body: FIXTURES.tokenPlanUsage },
};

describe("mimo/token-plan web_session golden(mock fixtures)", () => {
  it("正常态: 三端点并发 → balance + monthly_credits 聚合(used ×100, reset_at UTC)", async () => {
    const seen: Record<string, string>[] = [];
    const adapter = mimoCompositeAdapter(makeFetch(OK_RESPONSES, seen) as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(MIMO_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("ok");
    // 请求头契约: Cookie 注入 + 公共头写死
    expect(seen.length).toBe(3); // 三端点各一请求
    for (const h of seen) {
      expect(h["Cookie"]).toBe(MOCK_COOKIE);
      expect(h["x-timeZone"]).toBe("UTC+01:00");
      expect(h["Origin"]).toBe("https://platform.xiaomimimo.com");
      expect(h["Referer"]).toBe("https://platform.xiaomimimo.com/#/console/balance");
      expect(h["User-Agent"]).toContain("Chrome/143");
      expect(h["Accept"]).toBe("application/json, text/plain, */*");
      expect(h["Accept-Language"]).toBe("en-US,en;q=0.9");
    }
    const byKey = Object.fromEntries(snap.metrics.map((m) => [m.key, m]));
    // balance: 字符串金额 → number
    expect(byKey["balance"]!.remaining).toBe(25.51);
    expect(byKey["balance"]!.currency).toBe("CNY");
    expect(byKey["balance"]!.granted).toBe(5.51);
    expect(byKey["balance"]!.topped_up).toBe(20.0);
    // monthly_credits: used = 0.32 ×100 = 32, limit 100(usage 端点 patches 覆写)
    expect(byKey["monthly_credits"]!.used).toBe(32);
    expect(byKey["monthly_credits"]!.limit).toBe(100);
    expect(byKey["monthly_credits"]!.unit).toBe("credits");
    // reset_at: "2026-10-31 23:59:59" UTC(空格分隔)→ unix 秒
    // 现算真值: timegm(2026-10-31 23:59:59 UTC) = 1793491199
    expect(byKey["monthly_credits"]!.reset_at).toBe(1_793_491_199);
  });

  it("auth_expired 形态①: body code 401(HTTP 200 业务码判态)", async () => {
    const authBody = { code: 401, message: "invalidCookie" };
    const adapter = mimoCompositeAdapter(
      makeFetch({
        "/balance": { status: 200, body: authBody },
        "/tokenPlan/detail": { status: 200, body: authBody },
        "/tokenPlan/usage": { status: 200, body: authBody },
      }) as unknown as typeof fetch,
    );
    const snap = await adapter.fetchSnapshot(MIMO_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toBeTruthy();
    expect(snap.metrics).toEqual([]);
  });

  it("auth_expired 形态②: HTTP 401", async () => {
    const adapter = mimoCompositeAdapter(
      makeFetch({
        "/balance": { status: 401, body: { message: "unauthorized" } },
        "/tokenPlan/detail": { status: 200, body: FIXTURES.tokenPlanDetail },
        "/tokenPlan/usage": { status: 200, body: FIXTURES.tokenPlanUsage },
      }) as unknown as typeof fetch,
    );
    const snap = await adapter.fetchSnapshot(MIMO_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("auth_expired");
  });

  it("auth_expired 形态③: HTTP 3xx 登录重定向(302, 不跟随)", async () => {
    const adapter = mimoCompositeAdapter(
      makeFetch({
        "/balance": { status: 302, body: "" },
        "/tokenPlan/detail": { status: 200, body: FIXTURES.tokenPlanDetail },
        "/tokenPlan/usage": { status: 200, body: FIXTURES.tokenPlanUsage },
      }) as unknown as typeof fetch,
    );
    const snap = await adapter.fetchSnapshot(MIMO_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("auth_expired");
    expect(snap.metrics).toEqual([]);
  });

  it("balance 可选项: 缺 cashBalance/giftBalance → 余额指标不塌, 可选字段缺省", async () => {
    const adapter = mimoCompositeAdapter(
      makeFetch({
        "/balance": { status: 200, body: FIXTURES.balanceOptionalMissing },
        "/tokenPlan/detail": { status: 200, body: FIXTURES.tokenPlanDetail },
        "/tokenPlan/usage": { status: 200, body: FIXTURES.tokenPlanUsage },
      }) as unknown as typeof fetch,
    );
    const snap = await adapter.fetchSnapshot(MIMO_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("ok");
    const balance = snap.metrics.find((m) => m.key === "balance")!;
    expect(balance.remaining).toBe(25.51);
    expect(balance.currency).toBe("CNY");
    expect(balance.granted).toBeUndefined();
    expect(balance.topped_up).toBeUndefined();
    // monthly_credits 不受影响(独立端点)
    const credits = snap.metrics.find((m) => m.key === "monthly_credits")!;
    expect(credits.used).toBe(32);
  });

  it("percent 0-1 换算边界: 0→0, 1→100, 0.075→7.5(scale_percent ×100)", async () => {
    const { applyPipe } = await import("../src/mapping/jsonpath.js");
    expect(applyPipe(0, ["number", "scale_percent"])).toBe(0);
    expect(applyPipe(1, ["number", "scale_percent"])).toBe(100);
    expect(applyPipe(0.075, ["number", "scale_percent"])).toBe(7.5);
    expect(applyPipe(0.32, ["number", "scale_percent"])).toBeCloseTo(32, 10);
  });

  it("best-effort: 辅端点失败不塌主数据(warn alert); 辅端点 auth_expired 则整卡失效", async () => {
    // usage 500 → balance 主数据存活, monthly_credits.used 停留骨架 0 + warn
    const adapter = mimoCompositeAdapter(
      makeFetch({
        "/balance": { status: 200, body: FIXTURES.balance },
        "/tokenPlan/detail": { status: 200, body: FIXTURES.tokenPlanDetail },
        "/tokenPlan/usage": { status: 500, body: { message: "boom" } },
      }) as unknown as typeof fetch,
    );
    const snap = await adapter.fetchSnapshot(MIMO_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("ok");
    expect(snap.metrics.find((m) => m.key === "balance")!.remaining).toBe(25.51);
    expect(snap.alerts.some((a) => a.code === "endpoint_best_effort")).toBe(true);

    // detail 401(会话级事实)→ 整卡 auth_expired
    const adapter2 = mimoCompositeAdapter(
      makeFetch({
        "/balance": { status: 200, body: FIXTURES.balance },
        "/tokenPlan/detail": { status: 401, body: {} },
        "/tokenPlan/usage": { status: 200, body: FIXTURES.tokenPlanUsage },
      }) as unknown as typeof fetch,
    );
    const snap2 = await adapter2.fetchSnapshot(MIMO_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap2.status).toBe("auth_expired");
  });

  it("必需 cookie 缺失 → auth_expired; 凭据解析失败 → auth_expired", async () => {
    const adapter = mimoCompositeAdapter(makeFetch(OK_RESPONSES) as unknown as typeof fetch);
    const bad = await adapter.fetchSnapshot(
      MIMO_TOKEN_PLAN,
      INSTANCE,
      makeCtx("api-platform_serviceToken=<mock-token>"),
    );
    expect(bad.status).toBe("auth_expired");
    const noCred = await adapter.fetchSnapshot(MIMO_TOKEN_PLAN, INSTANCE, makeCtx("", true));
    expect(noCred.status).toBe("auth_expired");
    expect(noCred.setup_hint).toBeTruthy();
  });

  it("域护栏: 端点跨出 cookie 域 → 构造期 WebSessionDomainError(禁外发第三方域)", () => {
    const evilSpec = {
      ...MIMO_WEB_SESSION_SPEC,
      endpoints: [
        ...MIMO_WEB_SESSION_SPEC.endpoints,
        {
          name: "evil",
          mapping: { url: "https://evil.example.com/api/v1/steal", metrics: [] },
        },
      ],
    };
    expect(() => new WebSessionCompositeAdapter(evilSpec)).toThrow(WebSessionDomainError);
  });

  it("工具函数: validateCookieNames 只看名不看值; isRedirectStatus 判 3xx", () => {
    expect(validateCookieNames(MOCK_COOKIE, ["api-platform_serviceToken", "userId"])).toBe(true);
    expect(validateCookieNames("userId=1", ["api-platform_serviceToken", "userId"])).toBe(false);
    expect(validateCookieNames("", ["api-platform_serviceToken"])).toBe(false);
    expect(isRedirectStatus(301)).toBe(true);
    expect(isRedirectStatus(302)).toBe(true);
    expect(isRedirectStatus(200)).toBe(false);
    expect(isRedirectStatus(401)).toBe(false);
  });

  it("注册完整性: mimo/token-plan 在目录 + 映射 + auth 契约齐备", () => {
    const desc = PRESET_CHANNELS.find((d) => d.channel === "mimo/token-plan");
    expect(desc).toBeDefined();
    expect(desc!.auth?.kind).toBe("web_session");
    expect(desc!.auth!.required_cookies).toEqual(["api-platform_serviceToken", "userId"]);
    expect(desc!.auth!.cookie_domain).toBe("platform.xiaomimimo.com");
    expect(desc!.auth!.login_url).toBeTruthy();
    expect(CHANNEL_MAPPINGS["mimo/token-plan"]).toBeDefined();
    // 全部 PRESET_CHANNELS(http 类)必须都有映射(既有注册纪律不回归)
    for (const d of PRESET_CHANNELS) {
      if (d.adapter === "http") expect(CHANNEL_MAPPINGS[d.channel]).toBeDefined();
    }
  });

  it("安全纪律: 源码与 fixture 零真 cookie 值(mock 占位串形态)", () => {
    const mimoSrc = readFileSync(join(here, "../src/channels/mimo.ts"), "utf8");
    const fixtureSrc = readFileSync(
      join(here, "../src/channels/__fixtures__/mimo-web-session-mock.json"),
      "utf8",
    );
    // 真值形态启发式: 64+ 连续 base62/hex 串(真实 serviceToken 形态)
    for (const src of [mimoSrc, fixtureSrc]) {
      expect(src).not.toMatch(/["'=][A-Za-z0-9]{64,}["';]/);
    }
  });
});
