import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthExpiredError, Scheduler } from "../src/scheduler.js";
import type { ProviderSnapshot } from "../src/schema.js";

const okSnap = (id = "p1"): ProviderSnapshot => ({
  provider_id: id,
  display_name: id,
  plan_type: "balance",
  fetched_at: 1724900000,
  status: "ok",
  metrics: [{ key: "remaining", kind: "balance", unit: "cny", used: 10 }],
  alerts: [],
});

/** 手动控制 resolve/reject 的 fetch */
function deferredFetch() {
  let resolve!: (s: ProviderSnapshot) => void;
  let reject!: (e: Error) => void;
  const fn = vi.fn(
    () =>
      new Promise<ProviderSnapshot>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return { fn, resolve: (s?: ProviderSnapshot) => resolve(s ?? okSnap()), reject };
}

function makeScheduler(random = () => 0) {
  return new Scheduler({
    defaultIntervalMs: 1_000,
    jitterMaxMs: 30_000,
    backoffBaseMs: 5_000,
    backoffMaxMs: 30_000,
    httpTimeoutMs: 10_000,
    commandTimeoutMs: 15_000,
    random,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("调度器 — 启动抖动(0~30s)", () => {
  it("random=0.5 → 首跑在 15s; 抖动期内不采集", async () => {
    const sch = makeScheduler(() => 0.5);
    const { fn, resolve } = deferredFetch();
    sch.add({ id: "a", fetch: fn });
    sch.start("a");
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(sch.stats("a").successes).toBe(1);
    sch.stopAll();
  });
});

describe("调度器 — 防重叠(记 skipped)", () => {
  it("采集 2.5s > 周期 1s → 两个周期被跳过, 不叠加调用", async () => {
    const sch = makeScheduler();
    const { fn, resolve } = deferredFetch();
    sch.add({ id: "a", fetch: fn, intervalMs: 1_000 });
    sch.start("a"); // jitter=0
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sch.stats("a").state).toBe("running");

    await vi.advanceTimersByTimeAsync(1_000); // 第2周期到期 → 跳过
    expect(sch.stats("a").skipped).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000); // 第3周期到期 → 跳过
    expect(sch.stats("a").skipped).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1); // 没有叠加

    resolve();
    await vi.advanceTimersByTimeAsync(0);
    const st = sch.stats("a");
    expect(st.state).toBe("idle");
    expect(st.successes).toBe(1);
    expect(st.skipped).toBe(2);
    sch.stopAll();
  });
});

describe("调度器 — 超时硬切断", () => {
  it("http 默认 10s: abort 触发 + 转失败 + 进入退避", async () => {
    const sch = makeScheduler();
    let aborted = false;
    const hang = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<ProviderSnapshot>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    );
    sch.add({ id: "a", fetch: hang, kind: "http", intervalMs: 60_000 });
    sch.start("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(sch.stats("a").state).toBe("running");

    await vi.advanceTimersByTimeAsync(9_999);
    expect(sch.stats("a").state).toBe("running"); // 9.999s 还活着
    await vi.advanceTimersByTimeAsync(1); // 到 10s 硬切
    const st = sch.stats("a");
    expect(aborted).toBe(true); // AbortSignal 已发
    expect(st.state).toBe("idle"); // 循环不被拖死
    expect(st.failures).toBe(1);
    expect(st.consecutiveFailures).toBe(1);
    expect(st.nextRunAt).toBe(Date.now() + 5_000); // 退避 base 5s
    sch.stopAll();
  });

  it("command 默认 15s, http 默认 10s", async () => {
    const sch = makeScheduler();
    const hang = () => new Promise<ProviderSnapshot>(() => {});
    sch.add({ id: "h", fetch: hang, kind: "http" });
    sch.add({ id: "c", fetch: hang, kind: "command" });
    sch.startAll();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sch.stats("h").failures).toBe(1); // http 已超时
    expect(sch.stats("c").failures).toBe(0); // command 还没
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sch.stats("c").failures).toBe(1);
    sch.stopAll();
  });
});

describe("调度器 — 失败指数退避(5→10→20→封顶30)", () => {
  it("连续失败间隔翻倍, 封顶后稳定, 成功后回正常周期", async () => {
    const sch = makeScheduler();
    const boom = vi.fn(() => Promise.reject<ProviderSnapshot>(new Error("http 500")));
    sch.add({ id: "a", fetch: boom, intervalMs: 60_000 });
    sch.start("a");

    await vi.advanceTimersByTimeAsync(0); // 第1次失败
    let st = sch.stats("a");
    expect(st.consecutiveFailures).toBe(1);
    expect(st.nextRunAt).toBe(Date.now() + 5_000);

    await vi.advanceTimersByTimeAsync(5_000); // 第2次失败
    expect(sch.stats("a").nextRunAt).toBe(Date.now() + 10_000);

    await vi.advanceTimersByTimeAsync(10_000); // 第3次失败
    expect(sch.stats("a").nextRunAt).toBe(Date.now() + 20_000);

    await vi.advanceTimersByTimeAsync(20_000); // 第4次失败 → 40s 封顶 30s
    st = sch.stats("a");
    expect(st.consecutiveFailures).toBe(4);
    expect(st.nextRunAt).toBe(Date.now() + 30_000);

    await vi.advanceTimersByTimeAsync(30_000); // 第5次失败 → 仍 30s
    expect(sch.stats("a").nextRunAt).toBe(Date.now() + 30_000);
    expect(boom).toHaveBeenCalledTimes(5);
    sch.stopAll();
  });

  it("成功一次即回正常周期", async () => {
    const sch = makeScheduler();
    let fail = true;
    const fn = vi.fn(() =>
      fail ? Promise.reject<ProviderSnapshot>(new Error("x")) : Promise.resolve(okSnap()),
    );
    sch.add({ id: "a", fetch: fn, intervalMs: 60_000 });
    sch.start("a");
    await vi.advanceTimersByTimeAsync(0); // 失败 → +5s
    expect(sch.stats("a").consecutiveFailures).toBe(1);

    fail = false;
    await vi.advanceTimersByTimeAsync(5_000); // 成功
    const st = sch.stats("a");
    expect(st.successes).toBe(1);
    expect(st.consecutiveFailures).toBe(0);
    expect(st.nextRunAt).toBe(Date.now() + 60_000); // 回正常 interval
    sch.stopAll();
  });
});

describe("调度器 — auth_expired 停摆", () => {
  it("快照 auth_expired → halted + setup_hint, 时间流逝不再采集; resume 恢复", async () => {
    const sch = makeScheduler();
    let expired = true;
    const fn = vi.fn(() =>
      expired
        ? Promise.resolve<ProviderSnapshot>({
            ...okSnap(),
            status: "auth_expired",
            setup_hint: "bl auth login --console",
            metrics: [],
          })
        : Promise.resolve(okSnap()),
    );
    sch.add({ id: "a", fetch: fn, intervalMs: 1_000 });
    sch.start("a");
    await vi.advanceTimersByTimeAsync(0);
    const st = sch.stats("a");
    expect(st.state).toBe("halted");
    expect(st.haltReason).toBe("bl auth login --console");
    expect(st.nextRunAt).toBeUndefined();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(1); // 停摆, 不再采集

    sch.resume("a"); // 用户处理完凭据
    expired = false;
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sch.stats("a").state).toBe("idle");
    expect(sch.stats("a").successes).toBe(1);
    sch.stopAll();
  });

  it("AuthExpiredError 异常入口同样停摆", async () => {
    const sch = makeScheduler();
    const fn = vi.fn(() => Promise.reject(new AuthExpiredError("401", "re-login")));
    sch.add({ id: "a", fetch: fn });
    sch.start("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(sch.stats("a").state).toBe("halted");
    expect(sch.stats("a").haltReason).toBe("re-login");
    sch.stopAll();
  });
});

describe("调度器 — 全异步并发/故障隔离", () => {
  it("一个实例持续失败不影响另一实例正常周期", async () => {
    const sch = makeScheduler();
    const boom = vi.fn(() => Promise.reject<ProviderSnapshot>(new Error("down")));
    const { fn: goodFn, resolve } = deferredFetch();
    sch.add({ id: "bad", fetch: boom, intervalMs: 1_000 });
    sch.add({ id: "good", fetch: goodFn, intervalMs: 1_000 });
    sch.startAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(sch.stats("bad").consecutiveFailures).toBe(1);
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(sch.stats("good").successes).toBe(1);
    expect(sch.stats("good").nextRunAt).toBe(Date.now() + 1_000);
    // bad 在退避(5s), good 在 1s 正常周期 — 互不干扰
    expect(sch.stats("bad").nextRunAt).toBe(Date.now() + 5_000);
    sch.stopAll();
  });

  it("onResult 回调收到快照与 meta(宿主写库钩子)", async () => {
    const sch = makeScheduler();
    const results: Array<[ProviderSnapshot, { consecutiveFailures: number }]> = [];
    sch.add({
      id: "a",
      fetch: () => Promise.resolve(okSnap("a")),
      onResult: (s, m) => results.push([s, m]),
    });
    sch.start("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(1);
    expect(results[0][0].provider_id).toBe("a");
    expect(results[0][1].consecutiveFailures).toBe(0);
    sch.stopAll();
  });
});
