/**
 * L1 单元: consent 持久化(P0-7, §10) — 浏览器降级链(无桌面桥 → localStorage)。
 * 桌面壳真链路(settings.json)由主进程 persist.ts 实现 + L2 e2e(mock record_consent)覆盖。
 *
 * 独立成文件: persistence.test.ts 对 ../ipc 有 hoisted vi.mock, 同文件 unmock 不可靠。
 */
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  // node 环境模拟浏览器: 无桌面桥, localStorage 内存实现
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("consent 持久化(浏览器降级)", () => {
  it("同意前 firstRun=true → persistConsent → 重启(再次 getBootstrap) firstRun=false", async () => {
    const { getBootstrap, persistConsent } = await import("../ipc");
    const before = await getBootstrap();
    expect(before.firstRun).toBe(true);
    await persistConsent();
    const after = await getBootstrap(); // 模拟重启后再次调用
    expect(after.firstRun).toBe(false);
  });
});
