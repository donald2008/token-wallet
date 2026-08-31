/**
 * P1 回归 — add-kimi 全链路(t_5b52b633 验收 2)
 *
 * 用户真机 bug: 添加 kimi 通道 + 有效 key → 实例添加成功但面板整卡缺失
 * (连错误卡都没有)。本文件钉死全链路关键段:
 *   添加(saveInstance → liveProviders 注册表含 id)
 *   → 失败快照落地(错误卡也落库 + 进面板数据源, 绝不静默)
 *   → kimi 限流态真实响应经修复后的映射层照常出卡
 */
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc", () => ({
  httpGetJson: vi.fn(async () => ({ status: 200, body: "{}" })),
  commandRun: vi.fn(async () => null),
  instancesLoad: vi.fn(async () => null),
  instancesSave: vi.fn(async () => {}),
  keyringGet: vi.fn(async () => null),
  keyringSet: vi.fn(async () => {}),
  keyringDelete: vi.fn(async () => {}),
  isDesktopHost: () => false,
}));

import { saveInstance, getSharedStore, getSharedKeyring, MemoryKeyring } from "../../instances/store";
import { liveProviderIds, resetLiveProviders } from "../../runtime/liveProviders";
import { getSharedStorage, resetSharedStorage } from "../../runtime/storage";
import { RuntimeEngine } from "../../runtime/engine";
import type { InstanceConfig } from "../../instances/schema";

/** 2026-08-31 真 key 探针(限流态)脱敏体 —— 与 core 测试 fixture 同源 */
const KIMI_RATE_LIMITED_BODY = JSON.stringify({
  user: { userId: "<redacted>", region: "REGION_CN", membership: { level: "LEVEL_INTERMEDIATE" }, businessId: "" },
  usage: { limit: "100", used: "100", resetTime: "2026-09-04T01:21:10.687248Z" },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      // ⚠️ 限流态实锤: detail 缺 used 字段
      detail: { limit: "100", remaining: "0", resetTime: "2026-08-31T09:21:10.687248Z" },
    },
  ],
  parallel: { limit: "20" },
  totalQuota: {},
  authentication: { method: "METHOD_API_KEY", scope: "FEATURE_CODING" },
  subType: "TYPE_PURCHASE",
  boosterWallet: { status: "STATUS_DISABLED", allowTopup: true },
  domain: "DOMAIN_NEXUS",
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetLiveProviders();
  resetSharedStorage();
  getSharedStore().hydrate([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getSharedStore().hydrate([]);
  resetLiveProviders();
  resetSharedStorage();
});

describe("add-kimi 全链路(t_5b52b633): 添加 → 注册表 → 落地 → 渲染", () => {
  it("saveInstance 后 liveProviders 注册表含新实例 id(写库守卫放行)", async () => {
    const inst = await saveInstance({
      id: "inst-kimi-1",
      channel: "kimi/coding",
      name: "Kimi Coding #1",
      params: { api_key: "sk-test" },
      secretFields: ["api_key"],
      keyring: new MemoryKeyring(),
    });

    expect(inst.id).toBe("inst-kimi-1");
    expect(getSharedStore().list().map((i) => i.id)).toContain("inst-kimi-1");
    // 写库守卫已准入: 快照不会被静默吞掉
    expect(liveProviderIds()).toContain("inst-kimi-1");
  });

  it("失败快照(错误卡)也走完整链路: 引擎真实采集 → 落库成功 + latest 含卡(端到端)", async () => {
    const inst = await saveInstance({
      id: "inst-kimi-2",
      channel: "kimi/coding",
      name: "Kimi Coding #2",
      params: { api_key: "sk-test" },
      secretFields: ["api_key"],
      keyring: getSharedKeyring(), // 共享 keyring: 引擎 resolveCredential 读得到
    });

    const engine = new RuntimeEngine([inst as InstanceConfig], getSharedStorage());
    engine.subscribe(() => {});
    engine.start();

    // mocked httpGetJson 返回 status=200 + body "{}" → kimi 映射全部指标失败 →
    // 修复后产出显式 error 快照(旧代码此处 MappingError 抛出 → 调度器静默 → 整卡蒸发)。
    // 端到端断言: 错误卡必须出现在面板数据源(调度器 onResult → 落库 → latest → emit)。
    await act(async () => {
      await vi.waitFor(() => {
        if (!engine.snapshots.some((s) => s.provider_id === "inst-kimi-2")) {
          throw new Error("错误卡未出现(静默蒸发回归?)");
        }
      });
    });

    const card = engine.snapshots.find((s) => s.provider_id === "inst-kimi-2");
    expect(card?.status).toBe("error");
    expect(card?.error_message ?? "").toContain("指标映射失败");

    // 落库成功(写库守卫放行 —— bug 原场景里这一步静默 return)
    const history = await getSharedStorage().history("inst-kimi-2");
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.every((h) => h.status === "error")).toBe(true);
    engine.stop();
  });

  it("钥匙串条目缺失(采集抛异常)也出显式错误卡(engine 装配层兜底)", async () => {
    const inst = await saveInstance({
      id: "inst-kimi-4",
      channel: "kimi/coding",
      name: "Kimi Coding #4",
      params: { api_key: "sk-lost" },
      secretFields: ["api_key"],
      keyring: new MemoryKeyring(), // 独立实例: 引擎读取时条目不存在 → resolveCredential 抛错
    });

    const engine = new RuntimeEngine([inst as InstanceConfig], getSharedStorage());
    engine.subscribe(() => {});
    engine.start();

    await act(async () => {
      await vi.waitFor(() => {
        if (!engine.snapshots.some((s) => s.provider_id === "inst-kimi-4")) {
          throw new Error("错误卡未出现(静默蒸发回归?)");
        }
      });
    });

    const card = engine.snapshots.find((s) => s.provider_id === "inst-kimi-4");
    expect(card?.status).toBe("error");
    expect(card?.error_message ?? "").toContain("钥匙串条目不存在");
    engine.stop();
  });

  it("kimi 限流态真实响应(2026-08-31 探针) → weekly 卡照常出 + rolling_5h 跳过(不再整卡蒸发)", async () => {
    const { GenericHttpAdapter } = await import("@token-wallet/core/generic-http");
    const { KIMI_CODING_MAPPING, KIMI_CODING } = await import("@token-wallet/core/channels");

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(KIMI_RATE_LIMITED_BODY)),
      } as Response),
    );
    const adapter = new GenericHttpAdapter(KIMI_CODING_MAPPING, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(KIMI_CODING, {
      id: "inst-kimi-3",
      channel: "kimi/coding",
      name: "Kimi Coding #3",
      params: { api_key: { source: "store", key: "inst-kimi-3:api_key" } },
    }, {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      fetchedAt: Math.floor(Date.now() / 1000),
      resolveCredential: () => Promise.resolve("«redacted»"),
    });

    // 修复语义: 整卡 ok(weekly 可用), 缺失窗口跳过并带 warn —— 不再抛异常
    expect(snap.status).toBe("ok");
    expect(snap.metrics.map((m) => m.key)).toEqual(["weekly"]);
    expect(snap.alerts.some((a) => a.level === "warn")).toBe(true);
  });
});
