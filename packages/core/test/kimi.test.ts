/**
 * L1 golden sample — kimi/coding 真实通道(D-030 L3 golden 防接口变动)
 *
 * fixture = 2026-08-29 真实 API 响应脱敏(userId/walletId 一律 <redacted>)。
 * 断言: 双窗 used/limit 经 number pipe 转数值、resetTime iso_epoch → 合理 epoch。
 *
 * ⚠️ 不确定性记录(任务卡点名): kimi 主窗 `usage` 的窗口周期文档未明确
 * (实测 resetTime 距取证约 6 天, 推断 7 天窗) —— 本 fixture 只断言映射正确,
 * 不断言窗口语义; 上游若改周期, 唯一变化是 reset_at 数值, 断言仍绿但需人工复核。
 */
import { describe, expect, it, vi } from "vitest";
import { GenericHttpAdapter } from "../src/generic-http.js";
import { KIMI_CODING } from "../src/channels/presets.js";
import { KIMI_CODING_MAPPING } from "../src/channels/kimi.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";
import { PRESET_CHANNELS } from "../src/channels/presets.js";
import { CHANNEL_MAPPINGS } from "../src/channels/mappings.js";

/** 2026-08-29 真实验证脱敏: 数值真实(主窗 71/100, 5h 窗 100/100 受限), id 类一律 <redacted> */
const GOLDEN_RESPONSE = {
  user: { userId: "<redacted>", region: "REGION_CN", membership: { level: "LEVEL_INTERMEDIATE" } },
  limited: true,
  usage: { limit: "100", used: "71", remaining: "29", resetTime: "2026-09-04T01:21:10.687248Z" },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      detail: { limit: "100", used: "100", resetTime: "2026-08-29T09:21:10.687248Z" },
    },
  ],
  parallel: { limit: "20" },
  authentication: { method: "METHOD_API_KEY", scope: "FEATURE_CODING" },
  subType: "TYPE_PURCHASE",
  boosterWallet: {
    id: "<redacted>",
    balance: { feature: "FEATURE_OMNI", type: "BOOSTER", unit: "UNIT_CURRENCY" },
    status: "STATUS_DISABLED",
    allowTopup: true,
  },
};

const INSTANCE: InstanceConfig = {
  id: "kimi",
  channel: "kimi/coding",
  name: "Kimi-Coding #1",
  params: { api_key: { source: "store", key: "kimi:api_key" } },
};

function makeCtx(): AdapterContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    fetchedAt: 1_788_000_000,
    resolveCredential: () => Promise.resolve("«redacted:km-…»"),
  };
}

describe("kimi/coding golden sample(§5.2 T3 双窗)", () => {
  it("真实响应 → ok 快照: 字符串数值经 number pipe、resetTime iso_epoch", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(GOLDEN_RESPONSE),
      } as Response),
    );
    const adapter = new GenericHttpAdapter(KIMI_CODING_MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(KIMI_CODING, INSTANCE, makeCtx());

    expect(snap.status).toBe("ok");
    expect(snap.plan_type).toBe("window");
    expect(snap.metrics).toHaveLength(2);

    const byKey = Object.fromEntries(snap.metrics.map((m) => [m.key, m]));
    // rolling_5h ← limits[0].detail: 5h 窗 100/100(字符串 → number pipe)
    expect(byKey["rolling_5h"]).toMatchObject({
      kind: "window",
      unit: "percent",
      used: 100,
      limit: 100,
      reset_at: 1_787_995_270,
    });
    // weekly ← usage 主窗: 71/100, reset .687248Z(6 位毫秒)
    expect(byKey["weekly"]).toMatchObject({
      kind: "window",
      unit: "percent",
      used: 71,
      limit: 100,
      reset_at: 1_788_484_870,
    });
  });

  it("fixture 已脱敏: 无 userId/walletId 明文", () => {
    const raw = JSON.stringify(GOLDEN_RESPONSE);
    expect(raw).not.toMatch(/"userId":"(?!<redacted>)/);
    expect(raw).not.toMatch(/"id":"(?!<redacted>)/);
  });

  it("通道目录不变量: PRESET_CHANNELS 每个通道都有真实映射(选得到即采得到, D-036)", () => {
    const mappingKeys = Object.keys(CHANNEL_MAPPINGS);
    for (const d of PRESET_CHANNELS) {
      expect(mappingKeys).toContain(d.channel);
    }
    // 反向: 映射注册的通道也都在目录里(无幽灵映射)
    for (const k of mappingKeys) {
      expect(PRESET_CHANNELS.some((d) => d.channel === k)).toBe(true);
    }
  });
});
