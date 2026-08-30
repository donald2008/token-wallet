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
