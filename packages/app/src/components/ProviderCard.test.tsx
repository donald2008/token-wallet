// @vitest-environment jsdom
// L1 组件级断言(t_553dcb5a): 徽章文字 = statusBadge(原因), 颜色 = providerHealth(不变)。
// 同一快照渲染后 data-health 与 text-* class 必须与健康度一致 —— 只改文字, 不改颜色。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// ---- t_66b67453 契约4: setup_hint 一键复制(反引号提取 + clipboard 降级 + 1.5s 反馈) ----
describe("setup_hint 复制钮(契约4)", () => {
  const hint = "请运行 `bl auth login --console` 重新授权";

  function renderExpiredCard(p: ProviderSnapshot): HTMLElement {
    return renderCard(p);
  }

  function clickCopy(card: HTMLElement): void {
    click(card.querySelector('[data-testid="hint-copy-btn"]'));
  }

  it("auth_expired + setup_hint 卡渲染复制钮, 无 hint 不渲染", () => {
    const withHint = renderCard({ ...snap("auth_expired"), setup_hint: hint });
    expect(withHint.querySelector('[data-testid="hint-copy-btn"]')).toBeTruthy();
    const noHint = renderCard(snap("auth_expired"));
    expect(noHint.querySelector('[data-testid="hint-copy-btn"]')).toBeNull();
  });

  it("点击复制 = 反引号内完整命令原文(navigator.clipboard mock)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const card = renderExpiredCard({ ...snap("auth_expired"), setup_hint: hint });
    clickCopy(card);
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("bl auth login --console"); // 完整命令原文, 不带反引号/前后缀
  });

  it("成功反馈「已复制」1.5s 后还原(注入定时器)", async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn(async () => undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      const card = renderExpiredCard({ ...snap("auth_expired"), setup_hint: hint });
      const btn = card.querySelector<HTMLButtonElement>('[data-testid="hint-copy-btn"]')!;
      clickCopy(card);
      await act(async () => {
        await Promise.resolve();
      });
      expect(btn.textContent).toBe("已复制");
      expect(btn.dataset.copied).toBe("true");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(btn.textContent).toBe("复制");
      expect(btn.dataset.copied).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clipboard API 不可用 → 降级 execCommand('copy') 也能复制原文", async () => {
    // 剪贴板写入直接拒绝(打包壳 file:// 常见) → 走 execCommand 降级
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    const exec = vi.fn(() => true);
    document.execCommand = exec as unknown as typeof document.execCommand;
    const card = renderExpiredCard({ ...snap("auth_expired"), setup_hint: hint });
    clickCopy(card);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(exec).toHaveBeenCalledWith("copy");
    expect(card.querySelector('[data-testid="hint-copy-btn"]')!.textContent).toBe("已复制");
  });

  it("hint 无反引号 → 复制整个 hint(有得复制好过没得复制)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const card = renderExpiredCard({ ...snap("auth_expired"), setup_hint: "去控制台重新登录" });
    clickCopy(card);
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("去控制台重新登录");
  });
});

// ---- t_27eeadad: 主页 P1 形态接入(9/7 用户拍板) ----
describe("主页 P1 形态头部(9/7 用户拍板)", () => {
  it("head 行 = handle + name + StatusDot + 状态徽章 四件套", () => {
    const card = renderCard(snap("ok", [windowMetric(100, 1200)]));
    const head = card.querySelector(".card-head")!;
    expect(head).toBeTruthy();
    // 拖把手(沿用 .brand-block,选择器族零改)
    expect(head.querySelectorAll(".brand-block").length).toBe(1);
    // 卡名
    expect(head.querySelector(".card-name")!.textContent).toBe("Kimi-Code #1");
    // StatusDot: P1 形态新增(原主页只有状态徽章文字,现在加圆点)
    expect(head.querySelectorAll(".status-dot").length).toBe(1);
    const dot = head.querySelector(".status-dot")!;
    expect(dot.getAttribute("data-health")).toBe("ok");
    // 状态徽章文字(t_553dcb5a: statusBadge = 文案表达原因)
    expect(head.querySelector(".card-status-text")!.textContent).toBe("健康");
  });

  it("异常卡(auth_expired)head 仍有 StatusDot + 黄灯状态徽章", () => {
    const card = renderCard({ ...snap("auth_expired"), setup_hint: "去重授权" });
    const head = card.querySelector(".card-head")!;
    const dot = head.querySelector(".status-dot")!;
    expect(dot.getAttribute("data-health")).toBe("warn"); // auth_expired 裁决为 warn(§2.1)
    expect(head.querySelector(".card-status-text")!.textContent).toBe("待授权");
  });

  it("BarsTemplate 渲染 QuotaMeter(layout=micro) 三窗常驻直显, 不再挂 BarRowTooltip", () => {
    const card = renderCard(snap("ok", [
      windowMetric(100, 1200),
      { ...windowMetric(1200, 6000), key: "weekly", reset_at: NOW + 5 * 86400 },
      { ...windowMetric(1800, 6000), key: "monthly", reset_at: NOW + 21 * 86400 },
    ]));
    // 沿用 .bar-row 壳(主页 e2e 契约 + drag-sort 复用)
    const rows = card.querySelectorAll(".bar-row");
    expect(rows.length).toBe(3);
    // DOM 契约: .progress / .progress-fill[data-health] / role=progressbar 仍由 QuotaMeter 保证
    // (QuotaMeter 内部: .quota-meter > .progress > .progress-fill,progress 4 层选)
    expect(card.querySelectorAll(".bar-row > .quota-meter > .progress").length).toBe(3);
    expect(card.querySelectorAll('.bar-row > .quota-meter > .progress[role="progressbar"]').length).toBe(3);
    expect(card.querySelectorAll(".bar-row > .quota-meter > .progress > .progress-fill[data-health]").length).toBe(3);
    // micro 排版: QuotaMeter 挂 quota-meter--layout-micro modifier
    const meters = card.querySelectorAll(".bar-row > .quota-meter");
    expect(meters.length).toBe(3);
    meters.forEach((m) => {
      expect((m as HTMLElement).getAttribute("data-layout")).toBe("micro");
      expect(m.classList.contains("quota-meter--layout-micro")).toBe(true);
    });
    // 硬契约: 主页窗口行不再挂 BarRowTooltip
    expect(card.querySelectorAll(".bar-tooltip").length).toBe(0);
    expect(card.querySelectorAll('[data-testid="bar-tooltip"]').length).toBe(0);
    // data-tightest 仍由最紧窗标志(主页 e2e 契约; 此处 3 窗全 ok 不标红, 标红另在 titlebar-bars.spec.ts golden 验)
    expect(card.querySelectorAll(".bar-row[data-tightest]").length).toBe(0);
  });

  it("三窗含风险窗时, data-tightest 标志位 = 1(主页 opencode golden 同规, t_05271be0)", () => {
    const card = renderCard(snap("ok", [
      windowMetric(100, 1200), // rolling_5h 8% ok
      { ...windowMetric(6000, 6000), key: "weekly", reset_at: NOW + 5 * 86400 }, // weekly 100% bad(耗尽)
      { ...windowMetric(1800, 6000), key: "monthly", reset_at: NOW + 21 * 86400 }, // monthly 30% ok
    ]));
    expect(card.querySelectorAll(".bar-row[data-tightest]").length).toBe(1);
    // tightest = weekly(最高 used/limit)
    const tight = card.querySelector(".bar-row[data-tightest]")!;
    expect(tight.getAttribute("data-metric")).toBe("weekly");
    expect(tight.querySelector(".progress-fill")!.getAttribute("data-health")).toBe("bad");
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

  // t_433892c6 9/7 修订 H(老大 #1175 回归): 删钮 = 按钮自为热区, 一行 CSS 闭环。
  // 默认 opacity:0 + pointer-events:auto(opacity 不影响 hit-test, 按钮始终在 hit-test tree),
  // :hover/.card:focus-within/:focus-visible 触发 opacity:1。无 zone、无 :has()、无 z-index。
  it(".card-del-btn 默认 opacity:0 + pointer-events:auto; hover / focus 时显出", () => {
    const block = ruleBlock(".card-del-btn");
    expect(block).toContain("opacity: 0");
    // 关键: 默认 pointer-events:auto(opacity:0 不影响 hit-test, 按钮始终接收 pointer events)
    expect(block).toContain("pointer-events: auto");
    // 按钮 position:absolute 锚卡右上角, top 下移到 badge 行之下(B-2 零重叠)
    expect(block).toContain("top: var(--space-28)");
    expect(block).toContain("right: var(--space-4)");
    // 触发选择器: 按钮自身 hover/focus-within/focus-visible 显出
    expect(css).toContain(".card:focus-within .card-del-btn");
    expect(css).toContain(".card-del-btn:focus-visible");
    // 按钮自身 hover 触发显示(契约 self-hover) + 红色背景
    expect(css).toMatch(/\.card-del-btn:hover[\s\S]*?opacity:\s*1/);
    expect(css).toMatch(/\.card-del-btn:hover[\s\S]*?var\(--bad\)/);
    // .card-del-zone 透明 div 已删除(c1d380f 三层机制结构死锁, 老大 #1175 裁决回归)
    expect(css).not.toMatch(/\.card-del-zone[\s\{]/);
    // :has() 让位规则已删除
    expect(css).not.toContain(":has(.card-del-btn");
    // z-index:1 显式 stacking context(防 animation 窗口行压住 hover, B-2 修复加)
    expect(block).toContain("z-index: 1");
  });

  it(".card-confirm 绝对定位浮在卡右上 + 红调边框(卡头布局不被挤压)", () => {
    const block = ruleBlock(".card-confirm");
    expect(block).toContain("position: absolute");
    expect(block).toContain("border: 1px solid var(--bad)");
    // 定位容器: .card 必须 position: relative
    expect(ruleBlock(".card")).toContain("position: relative");
  });
});
