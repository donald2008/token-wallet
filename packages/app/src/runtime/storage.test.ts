// @vitest-environment jsdom
/**
 * L1(t_2ac39613 #2): app 侧快照存储 purgeProvider ——
 * - HostSqliteStore(生产): 走既有 sqlite IPC 通道, 对 snapshots/usage_records 各发一条 DELETE
 * - MemorySqliteStore(浏览器兜底): 内存行过滤, 其余 provider 不受影响
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const execMock = vi.fn<(...args: unknown[]) => Promise<number>>();

vi.mock("../ipc", () => ({
  isDesktopHost: () => true,
  sqliteBatch: async () => {},
  sqliteExec: (...args: unknown[]) => execMock(...args),
  sqliteQuery: async () => [],
}));

import { HostSqliteStore, MemorySqliteStore } from "./storage";
import {
  removeLiveProvider,
  resetLiveProviders,
  setLiveProviders,
} from "./liveProviders";
import type { ProviderSnapshot } from "../types";

function snap(providerId: string, fetchedAt = 1_700_000_000): ProviderSnapshot {
  return {
    provider_id: providerId,
    display_name: "DeepSeek-按量 #1",
    plan_type: "balance",
    fetched_at: fetchedAt,
    status: "ok",
    metrics: [{ key: "remaining", kind: "balance", unit: "cny", used: 42.5 }],
    alerts: [],
  };
}

beforeEach(() => {
  execMock.mockReset();
  execMock.mockResolvedValue(0);
  resetLiveProviders(); // 每例从"未初始化(不过滤)"起, 避免用例间串味
});

describe("HostSqliteStore.purgeProvider(t_2ac39613)", () => {
  it("对 snapshots 与 usage_records 各发一条 DELETE(走既有 sqlite_exec 通道)", async () => {
    const store = new HostSqliteStore();
    await store.purgeProvider("inst-a");

    expect(execMock).toHaveBeenCalledTimes(2);
    const [first, second] = execMock.mock.calls;
    expect(first?.[0]).toContain("DELETE FROM snapshots");
    expect(first?.[1]).toEqual(["inst-a"]);
    expect(second?.[0]).toContain("DELETE FROM usage_records");
    expect(second?.[1]).toEqual(["inst-a"]);
  });
});

describe("MemorySqliteStore.purgeProvider(t_2ac39613)", () => {
  it("清除该 provider 全部行, 其他 provider 保留", async () => {
    const store = new MemorySqliteStore();
    await store.saveSnapshot(snap("inst-a", 100));
    await store.saveSnapshot(snap("inst-a", 200));
    await store.saveSnapshot(snap("inst-b", 150));

    expect(await store.latestSnapshots()).toHaveLength(2);
    await store.purgeProvider("inst-a");

    const remaining = await store.latestSnapshots();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.provider_id).toBe("inst-b");
    expect(await store.history("inst-a")).toHaveLength(0);
  });

  it("purge 不存在的 provider 是 no-op", async () => {
    const store = new MemorySqliteStore();
    await store.saveSnapshot(snap("inst-a"));
    await store.purgeProvider("ghost");
    expect(await store.latestSnapshots()).toHaveLength(1);
  });
});

/**
 * B-3(契约追加): 写库守卫 —— 删除实例后, 旧引擎在途采集的**迟到响应**若仍走到
 * saveSnapshot, 必须被静默丢弃, 否则 purge 之后幽灵行重新落库 → 面板复活。
 * 真相源 = liveProviders 注册表(store.remove 第 1 步「先停源」即剔除该 id)。
 */
describe("B-3 写库守卫: 已删除 provider 的迟到写入被静默丢弃", () => {
  it("HostSqliteStore: 删除后迟到 saveSnapshot 不发 INSERT(purge 后不重生幽灵行)", async () => {
    setLiveProviders(["inst-a", "inst-b"]);
    const store = new HostSqliteStore();

    // 删除 inst-a: 停源(第 1 步) → purge(两条 DELETE)
    removeLiveProvider("inst-a");
    await store.purgeProvider("inst-a");
    expect(execMock).toHaveBeenCalledTimes(2);
    execMock.mockClear();

    // 旧引擎在途采集的迟到响应回来了 → 必须被丢弃, 一条 SQL 都不发
    await store.saveSnapshot(snap("inst-a"));
    expect(execMock).not.toHaveBeenCalled();

    // 对照: 仍在实例集合内的 provider 正常落库
    await store.saveSnapshot(snap("inst-b"));
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0]?.[0]).toContain("INSERT INTO snapshots");
    expect((execMock.mock.calls[0]?.[1] as unknown[])[0]).toBe("inst-b");
  });

  it("MemorySqliteStore: 迟到写入不进内存行, 面板读不到幽灵", async () => {
    setLiveProviders(["inst-a"]);
    const store = new MemorySqliteStore();
    await store.saveSnapshot(snap("inst-a", 100));
    expect(await store.latestSnapshots()).toHaveLength(1);

    removeLiveProvider("inst-a");
    await store.purgeProvider("inst-a");
    // 迟到响应(fetched_at 更新)——无守卫则会重新写入并被 latestSnapshots 读到
    await store.saveSnapshot(snap("inst-a", 200));

    expect(await store.latestSnapshots()).toEqual([]);
    expect(await store.history("inst-a")).toHaveLength(0);
  });

  it("未初始化(无实例集合概念的宿主/单测)时不过滤, 保持原语义", async () => {
    resetLiveProviders();
    const store = new MemorySqliteStore();
    await store.saveSnapshot(snap("any-id"));
    expect(await store.latestSnapshots()).toHaveLength(1);
  });
});
