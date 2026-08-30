// @vitest-environment jsdom
// L1 组件级断言(t_553dcb5a): 徽章文字 = statusBadge(原因), 颜色 = providerHealth(不变)。
// 同一快照渲染后 data-health 与 text-* class 必须与健康度一致 —— 只改文字, 不改颜色。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerHealth, statusBadge } from "../health";
import type { HealthLevel, Metric, ProviderSnapshot, ProviderStatus } from "../types";
import { ProviderCard } from "./ProviderCard";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Math.floor(Date.now() / 1000);

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

function renderCard(p: ProviderSnapshot, onDelete?: (id: string) => void): HTMLElement {
  act(() => {
    root.render(<ProviderCard p={p} onDelete={onDelete} />);
  });
  return container.querySelector<HTMLElement>('[data-testid="provider-card"]')!;
}

function click(el: Element | null): void {
  expect(el, "待点击元素必须存在").toBeTruthy();
  act(() => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ProviderCard 徽章: 文案表达原因, 颜色不动", () => {
  const cases: [string, ProviderSnapshot, string, HealthLevel][] = [
    ["ok+充足", snap("ok", [windowMetric(100, 1200)]), "健康", "ok"],
    ["ok+偏低", snap("ok", [windowMetric(960, 1200)]), "偏低", "warn"],
    ["ok+耗尽", snap("ok", [windowMetric(100, 100)]), "已耗尽", "bad"],
    ["auth_expired", snap("auth_expired"), "待授权", "warn"],
    ["stale", snap("stale"), "已陈旧", "unknown"],
    ["unsupported", snap("unsupported"), "未接入", "unknown"],
    ["error", snap("error"), "采集失败", "bad"],
  ];

  for (const [name, p, badge, health] of cases) {
    it(`${name} → 徽章「${badge}」, data-health=${health}, class text-${health}`, () => {
      const card = renderCard(p);
      // 颜色不变: data-health 与 text-* class 仍由 providerHealth 决定
      expect(card.getAttribute("data-health")).toBe(health);
      expect(health).toBe(providerHealth(p));
      const badgeEl = card.querySelector<HTMLElement>(".card-status-text")!;
      expect(badgeEl.className).toContain(`text-${health}`);
      // 文案表达原因(单一真相源 statusBadge)
      expect(badgeEl.textContent).toBe(badge);
      expect(badgeEl.textContent).toBe(statusBadge(p));
      // 误导文案不得再出现
      expect(badgeEl.textContent).not.toBe("过期");
      if (p.status !== "ok") expect(badgeEl.textContent).not.toBe("未知");
    });
  }
});

// ---- D-038: 卡内删除(实例动作分区) ----
describe("卡内删除钮(D-038)", () => {
  it("未传 onDelete(dev mock 预览卡) → 不渲染删除钮", () => {
    const card = renderCard(snap("ok", [windowMetric(10, 100)]));
    expect(card.querySelector('[data-testid="card-del-kimi-code"]')).toBeNull();
  });

  it("传 onDelete → head 出删除钮(手绘 SVG + 红调 btn-danger)", () => {
    const card = renderCard(snap("ok", [windowMetric(10, 100)]), () => {});
    const btn = card.querySelector<HTMLButtonElement>('[data-testid="card-del-kimi-code"]')!;
    expect(btn).toBeTruthy();
    // 就近在卡头(不是卡体), 红调复用既有 btn-danger, 图标手绘 SVG(D-002)
    expect(card.querySelector(".card-head")!.contains(btn)).toBe(true);
    expect(btn.className).toContain("btn-danger");
    expect(btn.querySelectorAll("svg").length).toBe(1);
    expect(btn.getAttribute("title")).toBe("删除 Kimi-Code #1");
  });

  it("点删除 → 弹确认气泡(含取消), 未确认前不触发 onDelete", () => {
    const removed: string[] = [];
    const card = renderCard(snap("ok", [windowMetric(10, 100)]), (id) => removed.push(id));
    click(card.querySelector('[data-testid="card-del-kimi-code"]'));
    const bubble = card.querySelector<HTMLElement>('[data-testid="card-confirm-row-kimi-code"]')!;
    expect(bubble).toBeTruthy();
    expect(bubble.textContent).toContain("删除并清钥匙串?");
    expect(bubble.querySelector('[data-testid="card-cancel-del-kimi-code"]')).toBeTruthy();
    expect(removed).toEqual([]);
  });

  it("取消 → 气泡消失, 删除钮回来, onDelete 从未被调用", () => {
    const removed: string[] = [];
    const card = renderCard(snap("ok", [windowMetric(10, 100)]), (id) => removed.push(id));
    click(card.querySelector('[data-testid="card-del-kimi-code"]'));
    click(card.querySelector('[data-testid="card-cancel-del-kimi-code"]'));
    expect(card.querySelector('[data-testid="card-confirm-row-kimi-code"]')).toBeNull();
    expect(card.querySelector('[data-testid="card-del-kimi-code"]')).toBeTruthy();
    expect(removed).toEqual([]);
  });

  it("确认 → onDelete(provider_id) 恰一次, 气泡收起", () => {
    const removed: string[] = [];
    const card = renderCard(snap("ok", [windowMetric(10, 100)]), (id) => removed.push(id));
    click(card.querySelector('[data-testid="card-del-kimi-code"]'));
    click(card.querySelector('[data-testid="card-confirm-del-kimi-code"]'));
    expect(removed).toEqual(["kimi-code"]);
    expect(card.querySelector('[data-testid="card-confirm-row-kimi-code"]')).toBeNull();
  });

  it("异常卡(unsupported/error)同样可删(删除是实例动作, 与采集状态无关)", () => {
    const removed: string[] = [];
    const card = renderCard(snap("error"), (id) => removed.push(id));
    click(card.querySelector('[data-testid="card-del-kimi-code"]'));
    click(card.querySelector('[data-testid="card-confirm-del-kimi-code"]'));
    expect(removed).toEqual(["kimi-code"]);
  });
});

// ---- CSS 契约: hover 淡入 + 气泡浮层(不挤压 360px 卡头) ----
describe("卡内删除 CSS 契约(D-038)", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app.css"), "utf8");

  function ruleBlock(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    expect(m, `CSS 规则 ${selector} 必须存在`).toBeTruthy();
    return m![1];
  }

  it(".card-del-btn 默认 opacity 0 + 过渡; hover 卡片/focus 时淡入", () => {
    const block = ruleBlock(".card-del-btn");
    expect(block).toContain("opacity: 0");
    expect(block).toContain("transition: opacity");
    // 只用 opacity, 不加 pointer-events:none(否则点击命中被拦)
    expect(block).not.toContain("pointer-events");
    expect(css).toContain(".card:hover .card-del-btn");
    expect(css).toContain(".card:focus-within .card-del-btn");
  });

  it(".card-confirm 绝对定位浮在卡右上 + 红调边框(卡头布局不被挤压)", () => {
    const block = ruleBlock(".card-confirm");
    expect(block).toContain("position: absolute");
    expect(block).toContain("border: 1px solid var(--bad)");
    // 定位容器: .card 必须 position: relative
    expect(ruleBlock(".card")).toContain("position: relative");
  });
});
