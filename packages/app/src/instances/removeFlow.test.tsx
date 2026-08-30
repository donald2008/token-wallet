// @vitest-environment jsdom
/**
 * L1(B-3 契约追加, t_2ac39613): 删除 provider 后 **UI 无旧帧**。
 *
 * 契约(comment #846 第 4 条): `store.remove()` 的内存移除 + emit 必须让面板同一帧摘卡,
 * 不等 React 重建引擎 —— 否则删除瞬间会闪一帧旧数据(已删 provider 的卡仍在)。
 *
 * 本测试驱动真实链路: `useInstances()`(store 订阅) + `useRealEngine()`(App.tsx 导出的
 * 引擎绑定 hook) 组合渲染, 与面板同构。断言:
 * 1. 删除后同一 act 内 DOM 里已无该实例名、无其快照 provider_id(无旧帧)
 * 2. 删除后到达的**迟到采集响应**不会让卡回到 DOM(写库守卫 + 引擎 stop 守卫)
 * 3. 剩余实例不受影响
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 桌面桥不存在 → getSharedStorage 走 MemorySqliteStore; 采集 HTTP 一律不通(本测试只驱动
// store/引擎的删除时序, 不依赖真实采集)
vi.mock("../ipc", () => ({
  isDesktopHost: () => false,
  httpGetJson: async () => ({ status: 500, body: "{}" }),
  keyringGet: async () => null,
  keyringSet: async () => undefined,
  keyringDelete: async () => undefined,
  instancesLoad: async () => null,
  instancesSave: async () => undefined,
}));

import { MemoryKeyring, getSharedStore } from "./store";
import type { InstanceConfig } from "./schema";
import { useInstances } from "./store";
import { useRealEngine } from "../App";
import { getSharedStorage, resetSharedStorage } from "../runtime/storage";
import { resetLiveProviders } from "../runtime/liveProviders";
import type { ProviderSnapshot } from "../types";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const inst = (id: string, name: string): InstanceConfig => ({
  id,
  channel: "deepseek/balance",
  name,
  params: { api_key: { source: "store", key: `${id}:api_key` } },
});

const snap = (providerId: string, name: string): ProviderSnapshot => ({
  provider_id: providerId,
  display_name: name,
  plan_type: "balance",
  fetched_at: Math.floor(Date.now() / 1000),
  status: "ok",
  metrics: [{ key: "remaining", kind: "balance", unit: "cny", used: 42.5 }],
  alerts: [],
});

let container: HTMLDivElement;
let root: Root;

/** 面板同构 harness: 实例名列表 + 引擎快照 id 列表 */
function Panel() {
  const instances = useInstances();
  const { output } = useRealEngine(instances);
  return (
    <div>
      <span data-testid="names">{instances.map((i) => i.name).join("|")}</span>
      <span data-testid="snapshot-ids">
        {output.snapshots.map((s) => s.provider_id).join("|")}
      </span>
    </div>
  );
}

function text(testid: string): string {
  return container.querySelector(`[data-testid="${testid}"]`)!.textContent ?? "";
}

beforeEach(() => {
  resetLiveProviders();
  resetSharedStorage();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getSharedStore().hydrate([]); // 不污染其他用例
  resetLiveProviders();
  resetSharedStorage();
});

describe("B-3 删除 provider 后 UI 无旧帧(React act)", () => {
  it("删除即摘卡: 同一帧内实例名与快照都消失, 剩余实例保留", async () => {
    const store = getSharedStore();
    // 启动预填两实例(hydrate 同时初始化写库守卫的实例集合)
    store.hydrate([inst("inst-a", "已删 A"), inst("inst-b", "保留 B")]);
    // 库里预置两者的最新快照 → 引擎 hydrate 后面板两张卡
    await getSharedStorage().saveSnapshot(snap("inst-a", "已删 A"));
    await getSharedStorage().saveSnapshot(snap("inst-b", "保留 B"));

    await act(async () => {
      root.render(<Panel />);
    });
    // 引擎 start → hydrate(异步)完成后两张卡都在
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(text("names")).toBe("已删 A|保留 B");
    expect(text("snapshot-ids").split("|").sort()).toEqual(["inst-a", "inst-b"]);

    // 删除 A —— 契约第 4 步: 内存移除 + emit, UI 立即更新(不等引擎重建)
    await act(async () => {
      store.remove("inst-a", new MemoryKeyring());
    });

    // 无旧帧: 实例名与快照 id 同时不含 A
    expect(text("names")).toBe("保留 B");
    expect(text("snapshot-ids")).not.toContain("inst-a");
    expect(text("snapshot-ids")).toContain("inst-b");
  });

  it("删除后迟到的采集响应不让卡回到 DOM(写库守卫兜底)", async () => {
    const store = getSharedStore();
    store.hydrate([inst("inst-a", "已删 A"), inst("inst-b", "保留 B")]);
    await getSharedStorage().saveSnapshot(snap("inst-a", "已删 A"));
    await getSharedStorage().saveSnapshot(snap("inst-b", "保留 B"));

    await act(async () => {
      root.render(<Panel />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      store.remove("inst-a", new MemoryKeyring());
    });
    expect(text("snapshot-ids")).not.toContain("inst-a");

    // 模拟旧引擎在途采集的迟到响应落库(守卫应静默丢弃) + 引擎重建后 hydrate 再读库
    await act(async () => {
      await getSharedStorage().saveSnapshot(snap("inst-a", "已删 A"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // 库里没有 A 的行(迟到写入被丢弃), 面板也不复活
    expect(await getSharedStorage().history("inst-a")).toHaveLength(0);
    expect(text("names")).toBe("保留 B");
    expect(text("snapshot-ids")).not.toContain("inst-a");
  });

  it("删除最后一个实例 → 空面板(零快照, 无残帧)", async () => {
    const store = getSharedStore();
    store.hydrate([inst("only", "唯一实例")]);
    await getSharedStorage().saveSnapshot(snap("only", "唯一实例"));

    await act(async () => {
      root.render(<Panel />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(text("snapshot-ids")).toBe("only");

    await act(async () => {
      store.remove("only", new MemoryKeyring());
    });

    expect(text("names")).toBe("");
    expect(text("snapshot-ids")).toBe("");
  });
});
