// @vitest-environment jsdom
/**
 * P1(t_9639078b): 主页过滤三枚 icon 钮(chips 收敛重设计)。
 * 覆盖契约:
 *  1. 过滤桶正确性(isAvailable/isAbnormal —— 可用=ok / 异常=auth_expired/stale/error/已耗尽)
 *  2. 空态(matchesFilter 命中空 → 供 App 渲染 NoMatchState)
 *  3. 三态切换(选中 → onChange, 点已选 → 取消回「全部」)
 *  4. 三枚钮语义: 仅 3 个 radio, 无计数角标/无平台 chips(颜色即信息, aria-label/title 兜底可读)
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../types";
import {
  DEFAULT_FILTER,
  FilterIcons,
  isAbnormal,
  isAvailable,
  matchesFilter,
  type FilterSel,
} from "./FilterChips";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Math.floor(Date.now() / 1000);

/** 构造一个 ProviderSnapshot(mock 场景同形态)。 */
function snap(
  id: string,
  name: string,
  status: ProviderSnapshot["status"],
  opts: { logo?: string; used?: number; limit?: number } = {},
): ProviderSnapshot {
  const { logo, used, limit } = opts;
  const metrics =
    limit !== undefined
      ? [{ key: "window", kind: "window" as const, unit: "requests" as const, used: used ?? 0, limit }]
      : [];
  return {
    provider_id: id,
    display_name: name,
    plan_type: "window",
    fetched_at: NOW,
    status,
    metrics,
    alerts: [],
    ...(logo ? { logo } : {}),
  };
}

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

/** 渲染 FilterIcons, 返回变更回调记录 + 元素查询 helper。 */
function renderIcons(value: FilterSel = DEFAULT_FILTER) {
  const calls: FilterSel[] = [];
  act(() => {
    root.render(<FilterIcons value={value} onChange={(s) => calls.push(s)} />);
  });
  return {
    calls,
    el: container.firstElementChild as HTMLElement,
    btn: (testid: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!,
    radios: () => container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  };
}

/* ----------------- 1. 过滤桶 ----------------- */

describe("过滤桶正确性", () => {
  it("可用 = health ok; 异常 = auth_expired/stale/error + 已耗尽(health bad)", () => {
    const ok = snap("a", "DeepSeek #1", "ok", { used: 10, limit: 100 });
    const expired = snap("b", "Kimi #1", "auth_expired");
    const stale = snap("c", "Ark #1", "stale");
    const error = snap("d", "Zai #1", "error");
    // 已耗尽: status ok 但 remaining=0.05(≤10%)→ health bad
    const exhausted = snap("e", "Opencode #1", "ok", { used: 95, limit: 100 });

    expect(isAvailable(ok)).toBe(true);
    expect(isAvailable(exhausted)).toBe(false);
    expect(isAbnormal(ok)).toBe(false);
    expect(isAbnormal(expired)).toBe(true);
    expect(isAbnormal(stale)).toBe(true);
    expect(isAbnormal(error)).toBe(true);
    expect(isAbnormal(exhausted)).toBe(true);
  });

  it("即将耗尽(0.1<r≤0.3 warn)不计入异常桶——契约只列已耗尽(≤10%)", () => {
    const warn = snap("a", "DeepSeek #1", "ok", { used: 75, limit: 100 }); // remaining 0.25 → warn
    expect(isAvailable(warn)).toBe(false);
    expect(isAbnormal(warn)).toBe(false); // 只在「全部」出现
  });
});

/* ----------------- 2. 过滤判定 + 空态 ----------------- */

describe("过滤判定 / 空态", () => {
  const mixed = [
    snap("deepseek", "DeepSeek #1", "ok", { used: 10, limit: 100 }),
    snap("kimi-code", "Kimi #1", "ok", { used: 75, limit: 100 }), // 即将耗尽 warn, 非可用非异常
    snap("aliyun", "阿里云百炼 #1", "auth_expired"),
  ];

  it("可用视角: 仅 health ok 命中(即将耗尽不在内)", () => {
    expect(mixed.filter((p) => matchesFilter(p, { kind: "available" })).map((p) => p.provider_id)).toEqual([
      "deepseek",
    ]);
  });

  it("异常视角: auth_expired/stale/error/已耗尽命中", () => {
    expect(mixed.filter((p) => matchesFilter(p, { kind: "abnormal" })).map((p) => p.provider_id)).toEqual([
      "aliyun",
    ]);
  });

  it("全部视角 = 全集; 命中空 → 空子集(供 App 渲染 NoMatchState)", () => {
    expect(mixed.filter((p) => matchesFilter(p, { kind: "all" }))).toHaveLength(3);
    const onlyAbnormal = [snap("b", "Kimi #1", "auth_expired")];
    expect(onlyAbnormal.filter((p) => matchesFilter(p, { kind: "available" }))).toEqual([]);
    expect(onlyAbnormal.filter((p) => matchesFilter(p, { kind: "abnormal" }))).toHaveLength(1);
  });
});

/* ----------------- 3. 三态切换 ----------------- */

describe("三态切换(单选 + 取消回「全部」)", () => {
  it("初始 value=全部 → filter-all 选中, 其余未选; 恰好 3 枚钮, 无计数/平台", () => {
    const { el, btn, radios } = renderIcons();
    expect(btn("filter-all").getAttribute("aria-checked")).toBe("true");
    expect(btn("filter-available").getAttribute("aria-checked")).toBe("false");
    expect(btn("filter-abnormal").getAttribute("aria-checked")).toBe("false");

    // 收敛形态铁律: 只有 3 个 radio = 全部/可用/异常, 无平台 chips(去平台行/去独立行)
    expect(radios()).toHaveLength(3);
    // 无计数角标(不再渲染 filter-chip-count)
    expect(el.querySelector(".filter-chip-count")).toBeNull();
    // 无平台注入口(BrandLogo 仅添加页在用, 主页不再渲染平台 chips)
    expect(el.querySelector('[data-testid^="filter-platform-"]')).toBeNull();
  });

  it("radiogroup 语义: 每钮 role/aria-checked/aria-label/title 可读(无文字, 颜色即信息)", () => {
    const { el, radios } = renderIcons();
    expect(el.getAttribute("role")).toBe("radiogroup");
    expect(radios()).toHaveLength(3);
    for (const r of radios()) {
      expect(r.getAttribute("aria-checked")).toBeTruthy();
      expect(r.getAttribute("aria-label")).toBeTruthy(); // 可读 label
      expect(r.getAttribute("title")).toBeTruthy(); // 悬浮提示
    }
  });

  it("点击「可用」→ onChange({kind:'available'})", () => {
    const { calls, btn } = renderIcons();
    act(() => {
      btn("filter-available").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([{ kind: "available" }]);
  });

  it("点击「异常」→ onChange({kind:'abnormal'})", () => {
    const { calls, btn } = renderIcons();
    act(() => {
      btn("filter-abnormal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([{ kind: "abnormal" }]);
  });

  it("点击已选「可用」→ 取消回「全部」(单选+取消语义, 契约不改)", () => {
    const { calls, btn } = renderIcons({ kind: "available" });
    expect(btn("filter-available").getAttribute("aria-checked")).toBe("true");
    act(() => {
      btn("filter-available").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([DEFAULT_FILTER]);
  });

  it("每枚钮渲染对应 glyph(SVG currentColor 图标, 无文字)", () => {
    const { btn } = renderIcons();
    for (const testid of ["filter-all", "filter-available", "filter-abnormal"]) {
      expect(btn(testid).querySelector("svg")).toBeTruthy();
    }
  });
});