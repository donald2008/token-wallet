// @vitest-environment jsdom
/**
 * P1(t_6484ecc6): 主页过滤 chips。
 * 覆盖契约五组:
 *  1. 三态桶正确性(isAvailable/isAbnormal/deriveBuckets)
 *  2. 平台 chips 动态推导(derivePlatforms: 有实例的平台才出, 按 brand key 分组计数)
 *  3. 单选切换(选中 → onChange, 点已选 → 取消回「全部」)
 *  4. 空态(matchesFilter 命中空 + App 层 NoMatchState 语义在此兜底)
 *  5. 增删实例联动(deriveBuckets/derivePlatforms 随 providers 集合变化)
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../types";
import {
  deriveBuckets,
  derivePlatforms,
  DEFAULT_FILTER,
  FilterChips,
  isAbnormal,
  isAvailable,
  matchesFilter,
  platformKey,
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

/** 渲染 FilterChips, 返回 chips 的 testid 集合 + 变更回调记录 + 元素。 */
function renderChips(providers: ProviderSnapshot[], value: FilterSel = DEFAULT_FILTER) {
  const calls: FilterSel[] = [];
  act(() => {
    root.render(<FilterChips providers={providers} value={value} onChange={(s) => calls.push(s)} />);
  });
  return {
    calls,
    el: container.firstElementChild as HTMLElement,
    chip: (testid: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!,
  };
}

/* ----------------- 1. 三态桶 ----------------- */

describe("三态桶正确性", () => {
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

  it("deriveBuckets: 全部=集合数, 可用/异常各自计数", () => {
    const providers = [
      snap("a", "DeepSeek #1", "ok", { used: 10, limit: 100 }),
      snap("b", "Kimi #1", "auth_expired"),
      snap("c", "Ark #1", "error"),
      snap("d", "Opencode #1", "ok", { used: 95, limit: 100 }), // 已耗尽(abnormal)非可用
    ];
    const b = deriveBuckets(providers);
    // available=DeepSeek(ok); abnormal=Kimi(auth_expired)+Ark(error)+Opencode(已耗尽) = 3
    expect(b).toEqual({ all: 4, available: 1, abnormal: 3 });
  });
});

/* ----------------- 2. 平台推导 ----------------- */

describe("平台 chips 动态推导", () => {
  it("从当前实例集推导, 有实例的平台才出 chip(label 首个实例平台展示名)", () => {
    const providers = [
      snap("p1", "DeepSeek #1", "ok", { logo: "deepseek", used: 10, limit: 100 }),
      snap("p2", "Kimi #1", "ok", { logo: "kimi" }),
      snap("p3", "Kimi #2", "ok", { logo: "kimi" }),
    ];
    const ps = derivePlatforms(providers);
    // 按首次出现顺序(deepseek, kimi), 无第三方平台
    expect(ps.map((p) => p.key)).toEqual(["deepseek", "kimi"]);
    expect(ps[0]).toMatchObject({ key: "deepseek", label: "DeepSeek", count: 1 });
    expect(ps[1]).toMatchObject({ key: "kimi", label: "Kimi", count: 2 });
  });

  it("provider_id 兜底 + 别名解析: kimi-code → kimi(key 归一)", () => {
    // logo 缺失时用 provider_id, 经 brand-logos 别名映射(BRAND_ALIASES)
    const p = snap("kimi-code", "Kimi #1", "ok");
    expect(platformKey(p)).toBe("kimi");
    const ps = derivePlatforms([p]);
    expect(ps[0]?.key).toBe("kimi");
  });

  it("无实例 → 空平台数组(不出任何平台 chip)", () => {
    expect(derivePlatforms([])).toEqual([]);
  });
});

/* ----------------- 3. 单选切换 ----------------- */

describe("单选切换语义", () => {
  const providers = [
    snap("a", "DeepSeek #1", "ok", { used: 10, limit: 100 }),
    snap("b", "Kimi #1", "auth_expired"),
  ];

  it("初始 value=全部 → filter-all 选中, 其余未选", () => {
    const { chip } = renderChips(providers);
    expect(chip("filter-all").getAttribute("aria-checked")).toBe("true");
    expect(chip("filter-available").getAttribute("aria-checked")).toBe("false");
    expect(chip("filter-abnormal").getAttribute("aria-checked")).toBe("false");
  });

  it("点击可用 chip → onChange({kind:'available'}), 变选中", () => {
    const { calls, chip } = renderChips(providers);
    act(() => {
      chip("filter-available").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([{ kind: "available" }]);
  });

  it("点击已选 chip → 取消回「全部」(单选+取消语义)", () => {
    const { calls, chip } = renderChips(providers, { kind: "available" });
    expect(chip("filter-available").getAttribute("aria-checked")).toBe("true");
    act(() => {
      chip("filter-available").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // 点已选 → onChange 收到「全部」
    expect(calls).toEqual([DEFAULT_FILTER]);
  });

  it("平台 chip 带 BrandLogo(14px), 点击平台 → {kind:'platform', platform:key}", () => {
    const { calls, el } = renderChips([snap("a", "DeepSeek #1", "ok", { logo: "deepseek" })]);
    const pc = el.querySelector<HTMLButtonElement>('[data-testid="filter-platform-deepseek"]')!;
    expect(pc.querySelector("svg")).toBeTruthy(); // BrandLogo 收录 → SVG
    act(() => {
      pc.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([{ kind: "platform", platform: "deepseek" }]);
  });

  it("radiogroup 语义 + 可选 chip 均有 role/aria-checked", () => {
    const { el } = renderChips(providers);
    expect(el.getAttribute("role")).toBe("radiogroup");
    const radios = el.querySelectorAll('[role="radio"]');
    expect(radios.length).toBeGreaterThanOrEqual(3);
    for (const r of radios) {
      expect(r.getAttribute("aria-checked")).toBeTruthy();
    }
  });
});

/* ----------------- 4. 空态 ----------------- */

describe("过滤空态", () => {
  it("matchesFilter 对当前集合全不命中 → 返回空子集(供 App 渲染 NoMatchState)", () => {
    const providers = [snap("b", "Kimi #1", "auth_expired")];
    const avail = providers.filter((p) => matchesFilter(p, { kind: "available" }));
    expect(avail).toEqual([]);
    // 其他视角仍有命中
    expect(providers.filter((p) => matchesFilter(p, { kind: "abnormal" }))).toHaveLength(1);
    expect(providers.filter((p) => matchesFilter(p, { kind: "all" }))).toHaveLength(1);
  });

  it("平台视角对不存在的平台 → 空(有实例的平台 chip 里点不到的兜底语义)", () => {
    const providers = [snap("a", "DeepSeek #1", "ok", { logo: "deepseek" })];
    expect(providers.filter((p) => matchesFilter(p, { kind: "platform", platform: "kimi" }))).toEqual([]);
  });
});

/* ----------------- 5. 增删实例联动 ----------------- */

describe("增删实例联动", () => {
  it("provider 集合变化 → chips 数量角标实时更新(可联动增删/采集状态变化)", () => {
    const one = [
      snap("a", "DeepSeek #1", "ok", { logo: "deepseek", used: 10, limit: 100 }),
    ];
    const two = [
      snap("a", "DeepSeek #1", "ok", { logo: "deepseek", used: 10, limit: 100 }),
      snap("b", "Kimi #1", "auth_expired", { logo: "kimi" }),
    ];

    const { chip, el } = renderChips(one);
    const countOf = (testid: string) => chip(testid).querySelector(".filter-chip-count")!.textContent;

    expect(countOf("filter-all")).toBe("1");
    expect(countOf("filter-available")).toBe("1");
    expect(countOf("filter-abnormal")).toBe("0");
    expect(el.querySelector('[data-testid^="filter-platform-"]')).toBeTruthy();

    // 增: 重新渲染两实例 → 计数 +1, 平台 chip 多出 kimi
    act(() => {
      root.render(<FilterChips providers={two} value={DEFAULT_FILTER} onChange={() => {}} />);
    });
    expect(countOf("filter-all")).toBe("2");
    expect(countOf("filter-available")).toBe("1");
    expect(countOf("filter-abnormal")).toBe("1");
    expect(el.querySelector('[data-testid="filter-platform-kimi"]')!).toBeTruthy();

    // 减: 回到单实例 → 计数回落, kimi chip 消失
    act(() => {
      root.render(<FilterChips providers={one} value={DEFAULT_FILTER} onChange={() => {}} />);
    });
    expect(countOf("filter-all")).toBe("1");
    expect(el.querySelector('[data-testid="filter-platform-kimi"]')).toBeNull();
  });
});