/**
 * P1 bug 复现 — kimi(coding) 限流态响应缺 limits[0].detail.used → 快照静默蒸发
 *
 * 用户真机现象(2026-08-31): 添加 kimi 通道 + 有效 key, 实例添加成功但面板连
 * 错误卡都不出现(整卡缺失)。对照 aliyun bl 失败出「待授权」卡 → 问题在
 * 注册/落地链路, 不在网络。
 *
 * 根因(2026-08-31 真 key 探针实锤, key 未落库):
 * kimi 限流态(usage.used=100/100)响应中 limits[0].detail = {limit, remaining,
 * resetTime} —— **没有 used 字段**(未受限时才有)。于是:
 *   1. $.limits[0].detail.used → JSONPath 无匹配 → undefined
 *   2. number pipe: Number(undefined) = NaN → MappingError
 *   3. GenericHttpAdapter.fetchSnapshot 的 metrics 段无 try/catch → 异常抛出
 *   4. Scheduler.run() 失败路径只在「适配器返回了快照」时才调 onResult ——
 *      fetch 抛异常且无快照 → onResult 不调用 → 快照静默蒸发 → 卡片永不出现
 *
 * 本文件钉两条契约:
 *   A. 单指标映射失败不得炸整卡(generic-http 层): 跳过该指标 + warn alert,
 *      其余窗口照常映射(「单窗口数据缺失是数据, 不是故障」, 对齐 D-036
 *      opencode 单窗 status 协议); 全部指标失败才转 error 卡。
 *   B. 采集异常必须落一条显式 error 快照, 绝不静默蒸发(scheduler 层)。
 */
import { describe, expect, it, vi } from "vitest";
import { GenericHttpAdapter } from "../src/generic-http.js";
import { KIMI_CODING } from "../src/channels/presets.js";
import { KIMI_CODING_MAPPING } from "../src/channels/kimi.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";

/** 2026-08-31 真 key 探针(限流态)脱敏: userId 一律 <redacted>。
 *  与 2026-08-29 golden(健康态)的差异: detail 无 used、usage.used=100、无 limited 字段以外的结构变化 */
const RATE_LIMITED_RESPONSE = {
  user: { userId: "<redacted>", region: "REGION_CN", membership: { level: "LEVEL_INTERMEDIATE" }, businessId: "" },
  usage: { limit: "100", used: "100", resetTime: "2026-09-04T01:21:10.687248Z" },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      // ⚠️ 限流态实锤: detail 缺 used 字段(健康态 golden 里有 used:"100")
      detail: { limit: "100", remaining: "0", resetTime: "2026-08-31T09:21:10.687248Z" },
    },
  ],
  parallel: { limit: "20" },
  totalQuota: {},
  authentication: { method: "METHOD_API_KEY", scope: "FEATURE_CODING" },
  subType: "TYPE_PURCHASE",
  boosterWallet: { status: "STATUS_DISABLED", allowTopup: true },
  domain: "DOMAIN_NEXUS",
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

function fetchJson(json: unknown) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(json),
    } as Response),
  ) as unknown as typeof fetch;
}

describe("kimi/coding 限流态(整卡缺失 bug 复现, t_5b52b633)", () => {
  it("A. 限流态响应: rolling_5h 缺 used → 跳过该指标 + warn alert, weekly 窗照常出数", async () => {
    const adapter = new GenericHttpAdapter(KIMI_CODING_MAPPING, fetchJson(RATE_LIMITED_RESPONSE));
    const snap = await adapter.fetchSnapshot(KIMI_CODING, INSTANCE, makeCtx());

    // 整卡不是 error(采集本身成功; 单窗口字段缺失是数据形态, 不是故障)
    expect(snap.status).toBe("ok");
    // weekly 主窗(usage.used 存在)照常映射
    const byKey = Object.fromEntries(snap.metrics.map((m) => [m.key, m]));
    expect(byKey["weekly"]).toMatchObject({ used: 100, limit: 100 });
    // rolling_5h 缺 used → 跳过, 不产出假数据
    expect(byKey["rolling_5h"]).toBeUndefined();
    // 跳过原因对用户可见(warn alert)
    expect(snap.alerts.some((a) => a.level === "warn")).toBe(true);
  });

  it("A2. 全部指标都映射失败 → 显式 error 快照(不抛异常, 不静默)", async () => {
    // usage 与 limits[0].detail 全缺 → 每个指标都取不到数
    const broken = { user: { userId: "<redacted>" }, totalQuota: {} };
    const adapter = new GenericHttpAdapter(KIMI_CODING_MAPPING, fetchJson(broken));
    const snap = await adapter.fetchSnapshot(KIMI_CODING, INSTANCE, makeCtx());

    expect(snap.status).toBe("error");
    expect(snap.metrics).toEqual([]);
    expect((snap.error_message ?? "").length).toBeGreaterThan(0);
  });

  it("A3. resp.json() 解析失败 → 显式 error 快照(非 2xx 之外的第二类解析错误)", async () => {
    const fetchBadJson = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("Unexpected token < in JSON")),
      } as unknown as Response),
    ) as unknown as typeof fetch;
    const adapter = new GenericHttpAdapter(KIMI_CODING_MAPPING, fetchBadJson);
    const snap = await adapter.fetchSnapshot(KIMI_CODING, INSTANCE, makeCtx());

    expect(snap.status).toBe("error");
    expect(snap.metrics).toEqual([]);
  });
});
