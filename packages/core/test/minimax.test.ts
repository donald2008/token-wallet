/**
 * L1 golden sample — minimax/token-plan 真实通道(2026-09-01 L3 真 key 实测)
 *
 * fixture = 2026-09-01 用户真机 Token Plan key 实测响应(api.minimaxi.com 国内区域,
 * sk-cp- 前缀订阅 key)。断言:
 * - 双窗映射: 5h 窗 + 周窗, percent 直给剩余 → used=100-remaining(invert_percent pipe)
 * - body_code 判态: HTTP 恒 200, base_resp.status_code 0=ok / 2049=auth_expired
 * - reset_at: 毫秒 epoch → unix 秒(ms_epoch pipe)
 * - 双模型取 general(首个), video 不展开(P2)
 * - PRESET_CHANNELS ⊆ CHANNEL_MAPPINGS 注册完整性
 */
import { describe, expect, it } from "vitest";
import { GenericHttpAdapter, type AdapterContext, type InstanceConfig } from "../src/generic-http.js";
import { MINIMAX_TOKEN_PLAN } from "../src/channels/presets.js";
import { MINIMAX_TOKEN_PLAN_MAPPING } from "../src/channels/minimax.js";
import { CHANNEL_MAPPINGS } from "../src/channels/mappings.js";
import { PRESET_CHANNELS } from "../src/channels/presets.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
/** 2026-09-01 真机响应(未脱敏数值, 无 id 类敏感字段) */
const GOLDEN = JSON.parse(
  readFileSync(join(here, "../src/channels/__fixtures__/minimax-tokenplan-real.json"), "utf8"),
) as Record<string, unknown>;

const INSTANCE: InstanceConfig = {
  id: "minimax",
  channel: "minimax/token-plan",
  name: "MiniMax-TokenPlan #1",
  params: { api_key: { source: "store", key: "minimax:api_key" } },
};

function makeCtx(): AdapterContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    resolveCredential: async () => "sk-cp-test",
    fetchedAt: 1788290000,
  };
}

/** 构造 adapter, 注入固定响应 fetch(模拟真实 Response: ok + json()) */
function makeAdapter(body: unknown, status = 200) {
  const fetchMock = async () =>
    ({
      status,
      ok: status >= 200 && status < 400,
      json: async () => body,
    }) as unknown as Response;
  return new GenericHttpAdapter(
    MINIMAX_TOKEN_PLAN_MAPPING,
    fetchMock as unknown as typeof fetch,
  );
}

describe("minimax/token-plan golden(真机 2026-09-01)", () => {
  it("真机响应 → 双窗映射, 5h 剩余 99%→used 1%, 周窗 98%→used 2%", async () => {
    const snap = await makeAdapter(GOLDEN).fetchSnapshot(MINIMAX_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("ok");
    const byKey = Object.fromEntries(snap.metrics.map((m) => [m.key, m]));
    // 5h 窗: general 剩余 99% → used 1, remaining 99
    expect(byKey["rolling_5h"]!.used).toBe(1);
    expect(byKey["rolling_5h"]!.remaining).toBe(99);
    expect(byKey["rolling_5h"]!.limit).toBe(100); // 2026-09-02: percent 通道缺 limit → 进度条空条回归
    expect(byKey["rolling_5h"]!.reset_at).toBe(1788296400); // end_time 毫秒 → 秒
    // 周窗: 剩余 98% → used 2, remaining 98
    expect(byKey["weekly"]!.used).toBe(2);
    expect(byKey["weekly"]!.remaining).toBe(98);
    expect(byKey["weekly"]!.limit).toBe(100);
    expect(byKey["weekly"]!.reset_at).toBe(1788710400);
  });

  it("body_code: 2049 → auth_expired + setup_hint(HTTP 200 但 key 坏)", async () => {
    const snap = await makeAdapter({ base_resp: { status_code: 2049, status_msg: "invalid api key" } })
      .fetchSnapshot(MINIMAX_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toBeTruthy();
    expect(snap.metrics).toEqual([]);
  });

  it("body_code: 非 0/2049 未知码 → error + 业务码信息", async () => {
    const snap = await makeAdapter({ base_resp: { status_code: 5001, status_msg: "rate limited" } })
      .fetchSnapshot(MINIMAX_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("error");
    expect(snap.error_message).toContain("5001");
  });

  it("注册完整性: minimax/token-plan 在 PRESET_CHANNELS 且映射已接", () => {
    const desc = PRESET_CHANNELS.find((d) => d.channel === "minimax/token-plan");
    expect(desc).toBeDefined();
    expect(CHANNEL_MAPPINGS["minimax/token-plan"]).toBeDefined();
    // 全部 PRESET_CHANNELS(http 类)必须都有映射(注册纪律)
    for (const d of PRESET_CHANNELS) {
      if (d.adapter === "http") expect(CHANNEL_MAPPINGS[d.channel]).toBeDefined();
    }
  });

  it("invert_percent pipe 边界: 剩余 0→used 100, 剩余 100→used 0, 越界收敛", async () => {
    const { applyPipe } = await import("../src/mapping/jsonpath.js");
    expect(applyPipe(0, ["number", "invert_percent"])).toBe(100);
    expect(applyPipe(100, ["number", "invert_percent"])).toBe(0);
    expect(applyPipe(120, ["number", "invert_percent"])).toBe(0); // 收敛
    expect(applyPipe(-10, ["number", "invert_percent"])).toBe(100); // 收敛
  });
});
