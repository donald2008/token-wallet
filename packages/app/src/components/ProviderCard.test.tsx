// @vitest-environment jsdom
// L1 组件级断言(t_553dcb5a): 徽章文字 = statusBadge(原因), 颜色 = providerHealth(不变)。
// 同一快照渲染后 data-health 与 text-* class 必须与健康度一致 —— 只改文字, 不改颜色。
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

function renderCard(p: ProviderSnapshot): HTMLElement {
  act(() => {
    root.render(<ProviderCard p={p} />);
  });
  return container.querySelector<HTMLElement>('[data-testid="provider-card"]')!;
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
