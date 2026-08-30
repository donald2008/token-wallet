// @vitest-environment jsdom
// L1(P1 契约 t_c31e6099): 窗口排序 = 时间窗升序(不按紧度), 未识别 key 兜底不丢;
// tightest 标红逻辑不回归 —— 排序变更后 data-tightest 仍在最紧行(只标不置顶)。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Metric, ProviderSnapshot } from "../types";
import { BarsTemplate, sortByWindowSpan, tightestMetric, windowSpanRank } from "./registry";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Math.floor(Date.now() / 1000);

function wm(key: string, used: number, limit: number): Metric {
  return { key, kind: "window", unit: "requests", used, limit, reset_at: NOW + 3600 };
}

function snap(metrics: Metric[]): ProviderSnapshot {
  return {
    provider_id: "kimi-code",
    display_name: "Kimi-Code #1",
    plan_type: "window",
    fetched_at: NOW - 60,
    status: "ok",
    metrics,
    alerts: [],
  };
}

describe("windowSpanRank: key 语义分级", () => {
  it("5h/小时级=0, 周=1, 月=2, 未识别=3", () => {
    expect(windowSpanRank("rolling_5h")).toBe(0);
    expect(windowSpanRank("quota_24h")).toBe(0);
    expect(windowSpanRank("weekly")).toBe(1);
    expect(windowSpanRank("周用量")).toBe(1);
    expect(windowSpanRank("monthly")).toBe(2);
    expect(windowSpanRank("月额度")).toBe(2);
    expect(windowSpanRank("credits")).toBe(3);
  });
});

describe("sortByWindowSpan: 时间窗升序", () => {
  it("[rolling_5h, weekly, monthly] 任意输入顺序 → 输出恒为 5h→周→月", () => {
    const input = [wm("monthly", 10, 100), wm("rolling_5h", 50, 100), wm("weekly", 20, 100)];
    const out = sortByWindowSpan(input);
    expect(out.map((m) => m.key)).toEqual(["rolling_5h", "weekly", "monthly"]);
    // 顺序不变量: 已升序输入重排后不变
    const sorted = [wm("rolling_5h", 1, 100), wm("weekly", 2, 100), wm("monthly", 3, 100)];
    expect(sortByWindowSpan(sorted).map((m) => m.key)).toEqual(["rolling_5h", "weekly", "monthly"]);
  });

  it("不按紧度排序: 最紧的月窗不因此提前", () => {
    const input = [wm("rolling_5h", 10, 100), wm("monthly", 99, 100)]; // monthly 最紧
    expect(sortByWindowSpan(input).map((m) => m.key)).toEqual(["rolling_5h", "monthly"]);
  });

  it("未识别 key 保持原相对顺序追加在已知窗口之后(不丢不崩)", () => {
    const input = [wm("custom_b", 1, 10), wm("weekly", 1, 10), wm("custom_a", 1, 10), wm("rolling_5h", 1, 10)];
    const out = sortByWindowSpan(input);
    expect(out.map((m) => m.key)).toEqual(["rolling_5h", "weekly", "custom_b", "custom_a"]);
    expect(out).toHaveLength(input.length);
  });

  it("不改输入数组(纯函数)", () => {
    const input = [wm("monthly", 1, 10), wm("rolling_5h", 1, 10)];
    const before = input.map((m) => m.key);
    sortByWindowSpan(input);
    expect(input.map((m) => m.key)).toEqual(before);
  });
});

describe("tightestMetric: 最紧窗口 = used/limit 最高", () => {
  it("命中最高比例窗口; 空数组返回 undefined", () => {
    const metrics = [wm("rolling_5h", 10, 100), wm("weekly", 900, 1000)];
    expect(tightestMetric(metrics)?.key).toBe("weekly");
    expect(tightestMetric([])).toBeUndefined();
  });
});

describe("BarsTemplate: 排序变更后 tightest 标红不回归", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("DOM 顺序按时间窗升序; data-tightest 仍在最紧行(月窗), 不在首行", () => {
    // monthly 最紧(used/limit=0.99, metricHealth=bad)但时间窗最长 → 排最后仍标红
    const metrics = [wm("monthly", 99, 100), wm("rolling_5h", 10, 100), wm("weekly", 20, 100)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    const rows = Array.from(container.querySelectorAll(".bar-row"));
    const labels = rows.map((r) => r.querySelector(".bar-label")?.textContent);
    expect(labels).toEqual(["rolling_5h", "weekly", "monthly"]);
    const tightestRow = container.querySelector(".bar-row[data-tightest]");
    expect(tightestRow?.querySelector(".bar-label")?.textContent).toBe("monthly");
  });

  it("全部健康(remaining>30%)时不误标红", () => {
    const metrics = [wm("rolling_5h", 10, 100), wm("weekly", 20, 100)];
    act(() => root.render(<BarsTemplate p={snap(metrics)} />));
    expect(container.querySelector(".bar-row[data-tightest]")).toBeNull();
  });
});
