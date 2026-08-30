// L1 徽章文案语义(t_553dcb5a, D-005 status 一等公民):
// 徽章表达"原因"而非颜色带 —— 配额耗尽≠过期, auth_expired≠偏低。
// 颜色语义(providerHealth 判定)本卡一律不动, 此处固化为回归断言。
import { describe, expect, it } from "vitest";
import { HEALTH_LABEL, providerHealth, statusBadge, tooltipSummary } from "./health";
import type { HealthLevel, Metric, ProviderSnapshot, ProviderStatus } from "./types";

const NOW = 1_780_000_000;

function windowMetric(used: number, limit: number): Metric {
  return { key: "rolling_5h", kind: "window", unit: "requests", used, limit, reset_at: NOW + 3600 };
}

function snap(status: ProviderStatus, metrics: Metric[] = []): ProviderSnapshot {
  return {
    provider_id: "kimi-code",
    display_name: "Kimi-Code #1",
    plan_type: "window",
    fetched_at: NOW - 60,
    status,
    metrics,
    alerts: [],
  };
}

describe("statusBadge — 徽章表达原因, 非颜色带", () => {
  it("ok + 配额充足 → 健康", () => {
    expect(statusBadge(snap("ok", [windowMetric(100, 1200)]))).toBe("健康");
  });

  it("ok + 剩余 ≤30% → 偏低", () => {
    expect(statusBadge(snap("ok", [windowMetric(960, 1200)]))).toBe("偏低");
  });

  it("ok + remaining=0(额度打满) → 已耗尽, 不是\"过期\"", () => {
    const p = snap("ok", [windowMetric(100, 100)]);
    expect(statusBadge(p)).toBe("已耗尽");
    expect(statusBadge(p)).not.toBe("过期");
  });

  it("auth_expired(登录态失效) → 待授权, 不是\"偏低\"", () => {
    const p = snap("auth_expired");
    expect(statusBadge(p)).toBe("待授权");
    expect(statusBadge(p)).not.toBe("偏低");
  });

  it("stale(数据陈旧) → 已陈旧, 不是\"未知\"", () => {
    expect(statusBadge(snap("stale"))).toBe("已陈旧");
  });

  it("unsupported(未接入) → 未接入, 不是\"未知\"", () => {
    expect(statusBadge(snap("unsupported"))).toBe("未接入");
  });

  it("error(采集失败) → 采集失败, 不是\"过期\"", () => {
    const p = snap("error");
    expect(statusBadge(p)).toBe("采集失败");
    expect(statusBadge(p)).not.toBe("过期");
  });

  it("全部徽章文案 ≤4 汉字(徽章位窄)", () => {
    const cases: ProviderSnapshot[] = [
      snap("ok", [windowMetric(100, 1200)]),
      snap("ok", [windowMetric(960, 1200)]),
      snap("ok", [windowMetric(100, 100)]),
      snap("auth_expired"),
      snap("stale"),
      snap("unsupported"),
      snap("error"),
    ];
    for (const p of cases) expect(statusBadge(p).length).toBeLessThanOrEqual(4);
  });
});

describe("颜色语义不变(D-022) — 本卡只改文案, 不动判定", () => {
  const expectHealth: [ProviderSnapshot, HealthLevel][] = [
    [snap("ok", [windowMetric(100, 1200)]), "ok"],
    [snap("ok", [windowMetric(960, 1200)]), "warn"],
    [snap("ok", [windowMetric(100, 100)]), "bad"],
    [snap("auth_expired"), "warn"], // §2.1: 登录态失效亮黄灯, 非配额耗尽
    [snap("stale"), "unknown"],
    [snap("unsupported"), "unknown"],
    [snap("error"), "bad"],
  ];
  for (const [p, health] of expectHealth) {
    it(`${p.status}${p.metrics.length ? ` used=${p.metrics[0].used}/${p.metrics[0].limit}` : ""} → ${health}`, () => {
      expect(providerHealth(p)).toBe(health);
    });
  }
});

describe("HEALTH_LABEL 定位收窄为配额健康度", () => {
  it("bad = 已耗尽(配额语义), 不再出现\"过期\"", () => {
    expect(HEALTH_LABEL.bad).toBe("已耗尽");
    expect(Object.values(HEALTH_LABEL)).not.toContain("过期");
  });
});

describe("tooltipSummary — 托盘摘要按原因分组", () => {
  it("空列表保持原样", () => {
    expect(tooltipSummary([])).toBe("token-wallet — 暂无 Provider");
  });

  it("auth_expired 不再被统计成\"偏低\", 耗尽显示\"已耗尽\"而非\"过期\"", () => {
    const out = tooltipSummary([
      snap("ok", [windowMetric(100, 1200)]),
      snap("ok", [windowMetric(100, 1200)]),
      snap("ok", [windowMetric(100, 100)]),
      snap("auth_expired"),
    ]);
    expect(out).toBe("token-wallet — 1已耗尽 1待授权 2健康");
    expect(out).not.toContain("过期");
    expect(out).not.toContain("偏低");
    expect(out).not.toContain("未知");
  });

  it("stale/unsupported/error 各有精确文案", () => {
    const out = tooltipSummary([snap("stale"), snap("unsupported"), snap("error")]);
    expect(out).toBe("token-wallet — 1采集失败 1已陈旧 1未接入");
  });

  it("「即将耗尽」独立分组, 排在「已耗尽」之后(BADGE_ORDER)", () => {
    const out = tooltipSummary([
      snap("ok", [windowMetric(95, 100)]), // remaining=5% → 即将耗尽
      snap("ok", [windowMetric(100, 100)]), // remaining=0 → 已耗尽
      snap("ok", [windowMetric(100, 1200)]), // 健康
    ]);
    expect(out).toBe("token-wallet — 1已耗尽 1即将耗尽 1健康");
  });
});

describe("耗尽分级(t_05271be0) — 已耗尽 vs 即将耗尽, 只拆文案不动颜色", () => {
  it("remaining=0(used>=limit) → 「已耗尽」", () => {
    const p = snap("ok", [windowMetric(100, 100)]);
    expect(statusBadge(p)).toBe("已耗尽");
    expect(providerHealth(p)).toBe("bad"); // 颜色语义不变(D-022)
  });

  it("0<remaining≤10%(如 5%) → 「即将耗尽」, 不再误报已耗尽", () => {
    const p = snap("ok", [windowMetric(95, 100)]);
    expect(statusBadge(p)).toBe("即将耗尽");
    expect(providerHealth(p)).toBe("bad"); // 仍红, 色带不变
  });

  it("remaining=15%(10%~30%) → 「偏低」, 不进耗尽分级", () => {
    const p = snap("ok", [windowMetric(1020, 1200)]);
    expect(statusBadge(p)).toBe("偏低");
    expect(providerHealth(p)).toBe("warn");
  });

  it("整卡取最差级: 一窗打满+一窗 5% → 「已耗尽」", () => {
    const p = snap("ok", [windowMetric(95, 100), windowMetric(100, 100)]);
    expect(statusBadge(p)).toBe("已耗尽");
  });

  it("整卡取最差级(反向): 仅 5% 无打满窗 → 「即将耗尽」", () => {
    const p = snap("ok", [windowMetric(100, 1200), windowMetric(95, 100)]);
    expect(statusBadge(p)).toBe("即将耗尽");
  });

  it("两级文案均 ≤4 汉字(徽章位窄)", () => {
    expect("即将耗尽".length).toBeLessThanOrEqual(4);
    expect(statusBadge(snap("ok", [windowMetric(95, 100)])).length).toBeLessThanOrEqual(4);
  });
});
