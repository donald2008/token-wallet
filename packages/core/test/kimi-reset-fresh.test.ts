/**
 * P1 bug 复现 — kimi(coding) 周期重置后 used 字段整体消失 → 双窗 0%(假数据/假 error)
 *
 * 用户真机现象(2026-09-18): kimi coding 整个周期重置后, 5 小时窗与周窗都是 0%,
 * 卡片疑似显示假 0 数据(另一路表现: 旧映射下直接 MappingError 出 error 卡,
 * 文案「指标映射失败: rolling_5h: 无法转 number: undefined; weekly: ...」)。
 *
 * 根因(2026-09-18 njbx02 真 key 实测, /tmp/kimi-usage-raw.json 用后即弃未落库):
 * kimi API 在周期重置后改变了响应形态 —— usage 与 limits[0].detail 都只剩
 * limit/remaining/resetTime, **used 字段整体消失**。旧映射取 $.usage.used /
 * $.limits[0].detail.used → JSONPath miss → Number(undefined)=NaN → MappingError。
 *
 * 三形态对照(全部真 key 实测, 详见 src/channels/kimi.ts 头注释):
 *   健康有用量(8/29): usage/detail 有 limit/used/remaining —— remaining:"29"
 *   限流态(8/31):     detail 缺 used, remaining:"0"
 *   重置后(9/18):     只剩 limit/remaining/resetTime, remaining:"100"
 * → remaining 是唯一三形态恒存在的字段, 修复=used 由 remaining 反推
 *   (invert_percent), 见 kimi.ts。
 *
 * 本文件钉重置期新形态契约(fixture=2026-09-18 真实响应脱敏):
 *   rolling_5h.used≈0(<0.01 可断言 0)、weekly.used=0、reset_at 正确、status=ok
 *   无假 error —— 重置期显示 0% 是真实数据不是 bug。
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GenericHttpAdapter } from "../src/generic-http.js";
import { KIMI_CODING } from "../src/channels/presets.js";
import { KIMI_CODING_MAPPING } from "../src/channels/kimi.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";

const here = dirname(fileURLToPath(import.meta.url));

/** 2026-09-18 真实响应脱敏(period-reset 形态): 数值真实(双窗 remaining=100/100), id 类一律 <redacted> */
const RESET_FRESH_RESPONSE = JSON.parse(
  readFileSync(join(here, "../src/channels/__fixtures__/kimi-usage-reset-fresh.json"), "utf8"),
) as Record<string, unknown>;

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
    fetchedAt: 1_789_700_000,
    resolveCredential: () => Promise.resolve("«redacted:km-…»"),
  };
}

describe("kimi/coding 周期重置后形态(t_be136794, used 字段消失)", () => {
  it("重置期真实响应 → ok 快照: used 由 remaining=100 反推为 0, 双窗齐全无假 error", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(RESET_FRESH_RESPONSE),
      } as Response),
    );
    const adapter = new GenericHttpAdapter(KIMI_CODING_MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(KIMI_CODING, INSTANCE, makeCtx());

    // 重置期 0% 是真实数据: 不是 MappingError error 卡, 也不是指标跳过
    expect(snap.status).toBe("ok");
    expect(snap.metrics).toHaveLength(2);

    const byKey = Object.fromEntries(snap.metrics.map((m) => [m.key, m]));
    // rolling_5h ← limits[0].detail: remaining "100" → number 100 → invert_percent 0
    expect(byKey["rolling_5h"]).toMatchObject({
      kind: "window",
      unit: "percent",
      used: 0,
      limit: 100,
      reset_at: 1_789_723_270, // 2026-09-18T09:21:10.687248Z
    });
    // weekly ← usage 主窗: remaining "100" → 0, reset .687248Z(6 位毫秒)
    expect(byKey["weekly"]).toMatchObject({
      kind: "window",
      unit: "percent",
      used: 0,
      limit: 100,
      reset_at: 1_790_299_270, // 2026-09-25T01:21:10.687248Z
    });
    // 重置期不应有告警(数据形态完整, used 缺失属预期)
    expect(snap.alerts).toEqual([]);
  });

  it("fixture 已脱敏: 无 userId/walletId 明文", () => {
    const raw = JSON.stringify(RESET_FRESH_RESPONSE);
    expect(raw).not.toMatch(/"userId":"(?!<redacted>)/);
    expect(raw).not.toMatch(/"id":"(?!<redacted>)/);
  });
});
