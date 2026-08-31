/**
 * P1 bug 复现 — Scheduler.run() 异常路径静默蒸发(t_5b52b633 契约 B)
 *
 * 现状: fetch 抛异常时 run() 的失败路径只在 `if (snapshot)` 时才调 onResult。
 * 异常 + 无快照 → onResult 不调用 → 该实例本周期零快照 → 面板整卡缺失
 * (kimi 限流态 MappingError 炸出后正是走到这条路径)。
 *
 * 契约 B: 采集异常必须转显式 error 快照走 onResult, 绝不静默蒸发 ——
 * 「无快照 = 面板永远空态的实锤 bug」(P0-8 同一纪律的调度器半边)。
 */
import { describe, expect, it, vi } from "vitest";
import { Scheduler, AuthExpiredError } from "../src/scheduler.js";
import type { ProviderSnapshot } from "../src/schema.js";

const baseSnap = (status: ProviderSnapshot["status"]): ProviderSnapshot => ({
  provider_id: "p1",
  display_name: "P1",
  plan_type: "window",
  fetched_at: 1_788_000_000,
  status,
  metrics: [],
  alerts: [],
});

interface Harness {
  onResult: ReturnType<typeof vi.fn>;
  tick: () => Promise<void>;
}

/** 单实例调度器 harness: interval 极短, tick() 直接触发一轮采集 */
function harness(fetchImpl: () => Promise<ProviderSnapshot>): Harness {
  const s = new Scheduler({ jitterMaxMs: 0, backoffBaseMs: 60_000, random: () => 0 });
  const onResult = vi.fn();
  s.add({ id: "p1", fetch: fetchImpl, intervalMs: 60_000, onResult });
  const tick = async () => {
    s.startAll();
    await vi.waitFor(() => {
      if (onResult.mock.calls.length === 0 && (s.stats("p1").runs ?? 0) === 0) {
        throw new Error("run not started");
      }
    });
    await vi.waitFor(() => {
      // run 结束的标志: state 回到 idle/halted 且不再 running
      const st = s.stats("p1");
      if (st.state === "running") throw new Error("still running");
    });
  };
  return { onResult, tick };
}

describe("Scheduler 异常路径不静默蒸发(t_5b52b633 契约 B)", () => {
  it("fetch 抛异常 → onResult 收到显式 error 快照(不再是无快照静默)", async () => {
    const h = harness(() => Promise.reject(new Error("映射爆炸: 无法转 number: undefined")));
    await h.tick();

    expect(h.onResult).toHaveBeenCalledTimes(1);
    const [snap] = h.onResult.mock.calls[0]! as [ProviderSnapshot, unknown];
    expect(snap.provider_id).toBe("p1");
    expect(snap.status).toBe("error");
    expect(snap.error_message).toContain("映射爆炸");
  });

  it("正常 ok 快照路径不受影响(仍直接透传)", async () => {
    const h = harness(() => Promise.resolve(baseSnap("ok")));
    await h.tick();

    expect(h.onResult).toHaveBeenCalledTimes(1);
    const [snap] = h.onResult.mock.calls[0]! as [ProviderSnapshot, unknown];
    expect(snap.status).toBe("ok");
  });

  it("适配器返回 error 快照的既有路径不受影响(仍透传, 不重复包一层)", async () => {
    const h = harness(() => Promise.resolve({ ...baseSnap("error"), error_message: "http 500" }));
    await h.tick();

    expect(h.onResult).toHaveBeenCalledTimes(1);
    const [snap] = h.onResult.mock.calls[0]! as [ProviderSnapshot, unknown];
    expect(snap.status).toBe("error");
    expect(snap.error_message).toBe("http 500");
  });

  it("AuthExpiredError 停摆语义不变(不新增快照, 只 halt)", async () => {
    const s = new Scheduler({ jitterMaxMs: 0, random: () => 0 });
    const onResult = vi.fn();
    s.add({
      id: "p1",
      fetch: () => Promise.reject(new AuthExpiredError("key 失效", "重新生成 API Key")),
      intervalMs: 60_000,
      onResult,
    });
    s.startAll();
    await vi.waitFor(() => expect(s.stats("p1").state).toBe("halted"));

    // 既有语义: AuthExpiredError 无快照可传 → 不调 onResult, 只停摆
    expect(onResult).not.toHaveBeenCalled();
    expect(s.stats("p1").haltReason).toBe("重新生成 API Key");
  });
});
