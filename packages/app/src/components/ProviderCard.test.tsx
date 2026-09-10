// @vitest-environment jsdom
// L1 组件级断言(t_553dcb5a): 徽章文字 = statusBadge(原因), 颜色 = providerHealth(不变)。
// 同一快照渲染后 data-health 与 text-* class 必须与健康度一致 —— 只改文字, 不改颜色。
//
// t_034a6e81 Bug1 修: OneClickAuth done 态点击 = onRefresh(不再走 onStart) 的真流程断言
// —— vi.mock 替换 ipc 的 commandAuthStart/Finish, 走完 callback 模式(浏览器授权自动收 code)
// 让用户端推进 idle→starting→waiting→done, 再 fireEvent click 已授权按钮断言 onRefresh 被调。
//
// t_5d8c3c81 只读缓存语义: 失败卡分两态(有旧数据=正常模板+时效标注 / 无旧数据=整卡文字)。
// 本文件既有 cases 仍走"无旧数据形态"(metrics=[]), 头卡片 statusBadge 已被 head 承担(abnormal-body 内不再重复)。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t_034a6e81 Bug1: 模块级 vi.mock 替换 ipc, 让 OneClickAuth 走完 callback 流程到 done 态。
// 本文件其它 describe 段(徽章/删除/setup_hint 复制)不依赖 ipc, 替换无害。
// 复用一组 vi.fn + beforeEach 重置, 跨用例统计 commandAuthStart 次数
// (反证 done 态点击不再调 onStart → 不再起 commandAuthStart)。
// 签名用宽松类型透传(ProviderCard 调用面是 string / sessionId+code),
// ts 端用 .mock.calls 读 call 列表, 不参与编译期类型推断。
// 关键: vi.mock 工厂里要写"真函数"形态, 内部委托到 vi.fn(否则 vitest 类型校验不过)。
const commandAuthStartImpl = vi.fn();
const commandAuthFinishImpl = vi.fn();
const commandAuthCancelImpl = vi.fn(async (_sessionId: string) => ({ ok: true }));
vi.mock("../ipc", () => ({
  commandAuthStart: (cli: string) => commandAuthStartImpl(cli),
  commandAuthFinish: (sessionId: string, code: string) => commandAuthFinishImpl(sessionId, code),
  commandAuthCancel: (sessionId: string) => commandAuthCancelImpl(sessionId),
}));

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

function renderCard(
  p: ProviderSnapshot,
  onDelete?: (id: string) => void,
  onRefresh?: (id: string) => void,
): HTMLElement {
  act(() => {
    root.render(<ProviderCard p={p} onDelete={onDelete} onRefresh={onRefresh} />);
  });
  return container.querySelector<HTMLElement>('[data-testid="provider-card"]')!;
}

function click(el: Element | null): void {
  expect(el, "待点击元素必须存在").toBeTruthy();
  act(() => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// t_5d8d8c81 round-2: 「单行徽章」守卫改为**文本级**, 不再依赖 class 名 —
// round-1 教训: 只数 .card-status-text class 时, 无旧数据 error 卡的 abnormal-status-detail
// 行(渲染「采集失败」长文案)未在守卫内 = 字面重复但断言假绿。文本级守卫
// (全卡叶节点 textContent 恰含目标 badge 文案 1 次)与 class 无关, 改名/换结构仍生效。
function countBadgeText(card: HTMLElement, badge: string): number {
  return Array.from(card.querySelectorAll<HTMLElement>("*"))
    .filter((el) => el.children.length === 0)
    .filter((el) => (el.textContent ?? "").trim() === badge).length;
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
      // t_5d8c3c81: 徽章在 card-head(data-testid="card-status-badge")
      const badgeEl = card.querySelector<HTMLElement>('[data-testid="card-status-badge"]')!;
      expect(badgeEl.className).toContain(`text-${health}`);
      // 文案表达原因(单一真相源 statusBadge)
      expect(badgeEl.textContent).toBe(badge);
      expect(badgeEl.textContent).toBe(statusBadge(p));
      // 误导文案不得再出现
      expect(badgeEl.textContent).not.toBe("过期");
      if (p.status !== "ok") expect(badgeEl.textContent).not.toBe("未知");
      // round-2: 文本级守卫 — 全卡叶节点中目标 badge 文案恰出现 1 次。
      // 防止 AbnormalBody 内任何位置(无论 class 名)再渲染字面相同的徽章文字。
      expect(countBadgeText(card, badge)).toBe(1);
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

// ---- t_034a6e81 Bug1 修: OneClickAuth done 态点击 = onRefresh(不再走 onStart) ----
// 真流程断言: vi.mock ipc 走完 callback 模式(stage 推进 idle→starting→waiting→done),
// 然后 fireEvent click 已授权按钮, 断言 onRefresh 被调(commandAuthStart 调用次数未增)。
describe("OneClickAuth done 态 = 刷线 + 预览卡禁用(t_034a6e81 Bug1 修)", () => {
  const hint = "请运行 `bl auth login --console` 重新授权";

  beforeEach(() => {
    commandAuthStartImpl.mockReset();
    commandAuthFinishImpl.mockReset();
  });

  /** 走完 callback 模式让 stage=done: 返 ok+callback, 后台 finish 也返 ok */
  function mockCallbackSuccess(): void {
    commandAuthStartImpl.mockResolvedValue({
      ok: true,
      sessionId: "s1",
      url: "https://oauth.local/device",
      finishMode: "callback",
    });
    commandAuthFinishImpl.mockResolvedValue({ ok: true, message: "" });
  }

  /** 一次性 flush 多次 microtask 直到 setStage("done") 真正落到 DOM */
  async function flushUntilDone(): Promise<void> {
    // callback 模式链路: click idle → setStage("starting") → commandAuthStart.then
    //   → setStage("waiting") + 同步发起 commandAuthFinish → 后者.then → setStage("done")
    // 至少 4 轮 microtask 推进
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }
  }

  it("idle → 一键授权 → 走完 callback 链路 → done 态按钮 = 「已授权」", async () => {
    mockCallbackSuccess();
    const card = renderCard({ ...snap("auth_expired"), setup_hint: hint }, () => {}, () => {});
    const btn = card.querySelector<HTMLButtonElement>('[data-testid="oneclick-auth-btn"]')!;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe("一键授权");

    // 点 idle 按钮触发 onStart
    click(btn);
    await flushUntilDone();

    // 链路走完 → stage=done → 按钮文案 = 「已授权」
    const doneBtn = card.querySelector<HTMLButtonElement>('[data-testid="oneclick-auth-btn"]')!;
    expect(doneBtn).toBeTruthy();
    expect(doneBtn.textContent).toBe("已授权 ✓");
    // commandAuthStart 被调 1 次(idle 那次), commandAuthFinish 也被调 1 次(callback 自动收)
    expect(commandAuthStartImpl).toHaveBeenCalledTimes(1);
    expect(commandAuthFinishImpl).toHaveBeenCalledTimes(1);
  });

  it("done 态点击已授权按钮 → onRefresh(provider_id) 被调 1 次, commandAuthStart 不增", async () => {
    mockCallbackSuccess();
    const refreshed: string[] = [];
    const card = renderCard(
      { ...snap("auth_expired"), setup_hint: hint },
      () => {},
      (id) => refreshed.push(id),
    );

    // 走完 callback 链路进入 done
    click(card.querySelector('[data-testid="oneclick-auth-btn"]'));
    await flushUntilDone();

    // 此时按钮已是 done 态, 点击应触发 onRefresh(不再走 onStart)
    const doneBtn = card.querySelector<HTMLButtonElement>('[data-testid="oneclick-auth-btn"]')!;
    expect(doneBtn.textContent).toBe("已授权 ✓");
    const beforeStartCalls = commandAuthStartImpl.mock.calls.length;
    expect(beforeStartCalls).toBe(1); // 链路已调一次

    click(doneBtn);

    // 核心断言: onRefresh 被调一次且参数 = provider_id(由 snap("auth_expired") 给 "kimi-code")
    expect(refreshed).toEqual(["kimi-code"]);
    // 反证: done 态点击**不**再调 commandAuthStart(原 Bug 现象: 已授权态点击又开授权页)
    expect(commandAuthStartImpl).toHaveBeenCalledTimes(beforeStartCalls);
  });

  it("预览卡未传 onRefresh → 走完 callback 链路后 done 态按钮 disabled + 提示文案", async () => {
    mockCallbackSuccess();
    const card = renderCard({ ...snap("auth_expired"), setup_hint: hint }, () => {});

    // 走完 callback 链路进入 done(不传 onRefresh)
    click(card.querySelector('[data-testid="oneclick-auth-btn"]'));
    await flushUntilDone();

    const doneBtn = card.querySelector<HTMLButtonElement>('[data-testid="oneclick-auth-btn"]')!;
    expect(doneBtn.textContent).toBe("已授权 ✓");
    // 预览卡 done 态按钮禁用(不给用户可点但无效的按钮)
    expect(doneBtn.disabled).toBe(true);
    // 提示文案: title + aria-label
    expect(doneBtn.getAttribute("title")).toBe("预览卡不可刷新(仅真实实例可点)");
    expect(doneBtn.getAttribute("aria-label")).toBe("已授权 - 预览卡不可刷新");
  });
});
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

// ---- t_ee76442e: 火山 SETUP_HINT 一键授权链路契约(零命令行) ----
// 任务背景: 用户 9/7 拍板「火山生命周期全进 app, 零命令行」。判别修正后火山卡 auth_expired
// 必出现「请重新授权」+ 一键授权按钮; 点按钮 = extractCliFromHint(SETUP_HINT) → "arkcli" →
// commandAuthStart("arkcli") → 主进程 spawn arkcli auth login volc-sso --no-browser 拉起
// 设备码流程。本段钉死两条契约: (1) SETUP_HINT 含 --no-browser 参数不影响 extractCliFromHint
// 取首词 "arkcli"; (2) 点 idle 按钮 commandAuthStart 实参 = "arkcli"(参数不被命令行 flag 干扰)。
describe("t_ee76442e: 火山 SETUP_HINT 一键授权链路(--no-browser 不干扰首词解析)", () => {
  // 与 packages/core/src/channels/volcengine-ark.ts:62 SETUP_HINT 同字面量,
  // 钉死契约: core 侧改 SETUP_HINT 时必须同步在本测试反映。
  const ARK_SETUP_HINT =
    "运行 `arkcli auth login volc-sso --no-browser` 重新授权(SSO 会话由 CLI 管理)";

  beforeEach(() => {
    commandAuthStartImpl.mockReset();
    commandAuthFinishImpl.mockReset();
  });

  it("extractCliFromHint(SETUP_HINT) = 'arkcli'(反引号内首词, --no-browser 不干扰)", async () => {
    const { extractCliFromHint } = await import("./ProviderCard");
    expect(extractCliFromHint(ARK_SETUP_HINT)).toBe("arkcli");
  });

  it("extractCommandFromHint(SETUP_HINT) = 'arkcli auth login volc-sso --no-browser'(反引号全文)", async () => {
    const { extractCommandFromHint } = await import("./ProviderCard");
    expect(extractCommandFromHint(ARK_SETUP_HINT)).toBe(
      "arkcli auth login volc-sso --no-browser",
    );
  });

  it("idle 一键授权 → commandAuthStart 实参 = 'arkcli'(走 arkcli 设备码流程, 不被 --no-browser 干扰)", async () => {
    // 模拟火山 auth login 设备码模式: 返 finishMode=code(用户复制粘贴 code 回喂)
    commandAuthStartImpl.mockResolvedValue({
      ok: true,
      sessionId: "s-ark",
      url: "https://oauth.volcengine.com/device?code=ABCD",
      finishMode: "code",
    });
    commandAuthFinishImpl.mockResolvedValue({ ok: true, message: "" });
    const card = renderCard({ ...snap("auth_expired"), setup_hint: ARK_SETUP_HINT }, () => {}, () => {});
    const btn = card.querySelector<HTMLButtonElement>('[data-testid="oneclick-auth-btn"]')!;
    expect(btn).toBeTruthy();

    click(btn);
    // 等 idle → starting → waiting 微任务推进(设备码模式无 finish 自动收, 只验 start 实参)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // commandAuthStart 实参 = "arkcli", 不含 --no-browser(主进程 spawn 时再拼 args)
    expect(commandAuthStartImpl).toHaveBeenCalledTimes(1);
    expect(commandAuthStartImpl).toHaveBeenCalledWith("arkcli");
    // 设备码模式: finishMode=code 已传入, 等待用户粘贴 code 回喂 → stage=waiting
    expect(card.querySelector('[data-testid="oneclick-auth-panel"]')).toBeTruthy();
  });
});

// ---- t_5d8c3c81: 采集失败只读缓存语义(用户 9/9 拍板) ----
// 失败卡分两态:
//   - 有旧数据(metrics 非空): 正常模板(BarsTemplate 等)+ 数据时效标注 + 错误原因(text-error)
//   - 无旧数据(metrics 空): 整卡文字形态 + setup_hint + lastUpdate; 状态徽章仅由 head 承担
// 状态徽章文字严禁在卡内出现两次(原 bug: head + AbnormalBody 各一次 → 截图右上两行)
describe("t_5d8c3c81: 采集失败只读缓存语义", () => {
  // 通用 factory: error 快照带 metrics = 「有旧数据」; 不带 metrics = 「无旧数据」
  function okSnap(status: ProviderStatus, fetchedAtSec: number, metrics: Metric[] = []): ProviderSnapshot {
    return {
      provider_id: "kimi-code",
      display_name: "Kimi-Code #1",
      plan_type: "window",
      fetched_at: fetchedAtSec,
      status,
      metrics,
      alerts: [],
      logo: "kimi",
    };
  }

  it("error + 无旧数据(metrics=[]) → 整卡文字形态(无 template 渲染)", () => {
    const card = renderCard(okSnap("error", NOW - 60, []));
    // head 徽章红「采集失败」
    const headBadge = card.querySelector<HTMLElement>('[data-testid="card-status-badge"]')!;
    expect(headBadge.textContent).toBe("采集失败");
    // 整卡文字形态: abnormal-body 容器带 --no-data modifier(模板未渲染)
    const abnormalBody = card.querySelector<HTMLElement>('[data-testid="abnormal-body"]')!;
    expect(abnormalBody.classList.contains("abnormal-body--no-data")).toBe(true);
    // 模板(进度条 .bar-row / 余额数字)未渲染 —— 无假数据原则
    expect(card.querySelectorAll(".bar-row").length).toBe(0);
    // logo 仍显示(BrandLogo platform=p.logo="kimi" 有品牌 key)
    expect(card.querySelector(".brand-block")).toBeTruthy();
    // data-health 由 status=error → providerHealth 决定 = bad
    expect(card.getAttribute("data-health")).toBe("bad");
  });

  it("error + 有旧数据(metrics 非空) → 正常模板 + 数据时效标注 + 错误原因", () => {
    const errSnap: ProviderSnapshot = {
      ...okSnap("error", NOW - 600, [windowMetric(960, 1200)]),
      error_message: "网络超时",
      alerts: [{ level: "critical", message: "网络超时", code: "adapter_threw" }],
    };
    const card = renderCard(errSnap);
    // head 徽章红「采集失败」
    const headBadge = card.querySelector<HTMLElement>('[data-testid="card-status-badge"]')!;
    expect(headBadge.textContent).toBe("采集失败");
    // abnormal-body 走 --stale-data 形态(模板渲染)
    const abnormalBody = card.querySelector<HTMLElement>('[data-testid="abnormal-body"]')!;
    expect(abnormalBody.classList.contains("abnormal-body--stale-data")).toBe(true);
    // 模板渲染了: 至少 1 个 .bar-row(QuotaMeter micro 形态)
    expect(card.querySelectorAll(".bar-row").length).toBeGreaterThanOrEqual(1);
    // 数据时效标注存在 + 文案正确(i18n card.staleFetchedAgo = "当前数据为 {ago} 采集(非最新)")
    const note = card.querySelector<HTMLElement>('[data-testid="stale-fetched-note"]')!;
    expect(note).toBeTruthy();
    // agoText(600 秒前) = "10 分钟前"
    expect(note.textContent).toBe("当前数据为 10 分钟前 采集(非最新)");
    // 错误原因行: data-testid + text-error class
    const reason = card.querySelector<HTMLElement>('[data-testid="abnormal-error-reason"]')!;
    expect(reason).toBeTruthy();
    expect(reason.textContent).toBe("网络超时");
    expect(reason.classList.contains("text-error")).toBe(true);
  });

  it("error + 有旧数据但 error_message 缺 → 错误原因行不渲染", () => {
    const errSnap = okSnap("error", NOW - 600, [windowMetric(960, 1200)]);
    const card = renderCard(errSnap);
    expect(card.querySelector('[data-testid="abnormal-error-reason"]')).toBeNull();
    // 数据时效标注仍存在
    expect(card.querySelector('[data-testid="stale-fetched-note"]')).toBeTruthy();
  });

  it("status=ok 卡 → abnormal-body 不渲染(走 Template 分支, 形态不变)", () => {
    const card = renderCard(okSnap("ok", NOW, [windowMetric(100, 1200)]));
    expect(card.querySelector('[data-testid="abnormal-body"]')).toBeNull();
    // head 徽章绿「健康」
    const headBadge = card.querySelector<HTMLElement>('[data-testid="card-status-badge"]')!;
    expect(headBadge.textContent).toBe("健康");
  });

  it("auth_expired + 有旧数据 + setup_hint 存在 → 模板渲染 + 时效标注 + setup_hint 一键授权区", () => {
    const authSnap: ProviderSnapshot = {
      ...okSnap("auth_expired", NOW - 300, [windowMetric(960, 1200)]),
      setup_hint: "请运行 `bl auth login --console` 重新授权",
    };
    const card = renderCard(authSnap);
    // head 徽章黄「待授权」
    expect(card.querySelector<HTMLElement>('[data-testid="card-status-badge"]')!.textContent).toBe("待授权");
    // 有旧数据 → 模板渲染
    expect(card.querySelectorAll(".bar-row").length).toBeGreaterThanOrEqual(1);
    // 时效标注存在
    expect(card.querySelector('[data-testid="stale-fetched-note"]')).toBeTruthy();
    // round-2: stale-data auth_expired 现在也补 setup_hint 引导(command 通道 bl/arkcli 重授权入口)
    expect(card.querySelector('[data-testid="setup-hint"]')).toBeTruthy();
    expect(card.querySelector(".lamp[data-lamp=\"auth_expired\"]")).toBeTruthy();
    // 文本级守卫: 全卡「待授权」叶节点恰 1 次(head 徽章唯一)
    expect(countBadgeText(card, "待授权")).toBe(1);
  });

  it("auth_expired + 无旧数据 + setup_hint 存在 → 整卡文字形态, lamp + setup_hint 引导保留", () => {
    const authSnap: ProviderSnapshot = {
      ...okSnap("auth_expired", NOW - 60),
      setup_hint: "请运行 `bl auth login --console` 重新授权",
    };
    const card = renderCard(authSnap);
    // head 徽章黄「待授权」
    expect(card.querySelector<HTMLElement>('[data-testid="card-status-badge"]')!.textContent).toBe("待授权");
    // abnormal-body 整卡文字形态
    const abnormalBody = card.querySelector<HTMLElement>('[data-testid="abnormal-body"]')!;
    expect(abnormalBody.classList.contains("abnormal-body--no-data")).toBe(true);
    // setup_hint 引导区存在
    expect(card.querySelector('[data-testid="setup-hint"]')).toBeTruthy();
    // lamp 灯存在
    expect(card.querySelector(".lamp[data-lamp=\"auth_expired\"]")).toBeTruthy();
    // 模板未渲染
    expect(card.querySelectorAll(".bar-row").length).toBe(0);
    // round-2: 文本级守卫 — 全卡叶节点中「待授权」恰 1 次(head 徽章唯一)
    expect(countBadgeText(card, "待授权")).toBe(1);
  });

  it("unsupported / stale 异常卡 + 无旧数据 → 整卡文字形态(head 徽章 + lastUpdate + error 提示)", () => {
    const unsupportedCard = renderCard(okSnap("unsupported", NOW - 60));
    expect(unsupportedCard.querySelector<HTMLElement>('[data-testid="card-status-badge"]')!.textContent).toBe("未接入");
    expect(unsupportedCard.querySelectorAll(".bar-row").length).toBe(0);
    // round-2: 文本级守卫
    expect(countBadgeText(unsupportedCard, "未接入")).toBe(1);

    const staleCard = renderCard(okSnap("stale", NOW - 86400 * 3)); // 3 天前
    expect(staleCard.querySelector<HTMLElement>('[data-testid="card-status-badge"]')!.textContent).toBe("已陈旧");
    expect(countBadgeText(staleCard, "已陈旧")).toBe(1);
  });

  it("错误状态字徽章(head.card-status-badge)在所有异常态里恰好 1 次(原 bug 修复)", () => {
    // 四种异常态 × 全卡叶节点中目标 badge 文案恰 1 次(textContent 守卫, 与 class 名无关)
    const cases: Array<{ status: ProviderStatus; badge: string }> = [
      { status: "error", badge: "采集失败" },
      { status: "auth_expired", badge: "待授权" },
      { status: "stale", badge: "已陈旧" },
      { status: "unsupported", badge: "未接入" },
    ];
    for (const { status, badge } of cases) {
      const card = renderCard(okSnap(status, NOW - 60));
      const headBadge = card.querySelector<HTMLElement>('[data-testid="card-status-badge"]')!;
      expect(headBadge.textContent).toBe(badge);
      // 全卡只 1 个相同文字的徽章(textContent 守卫, 与 class 无关)
      expect(countBadgeText(card, badge)).toBe(1);
    }
  });

  it("Logo 在 error 卡上仍显示(BrandLogo platform=p.logo, 不退 provider_id)", () => {
    // 无 logo 字段的旧快照: 品牌块仍渲染(provider_id 退而求其次, 不空)
    const snapNoLogo: ProviderSnapshot = {
      provider_id: "kimi-code",
      display_name: "Kimi-Code #1",
      plan_type: "window",
      fetched_at: NOW - 60,
      status: "error",
      metrics: [],
      alerts: [],
      // logo 字段缺(模拟 errorSnapshot 旧行为: 不带 logo)
    };
    const cardNoLogo = renderCard(snapNoLogo);
    expect(cardNoLogo.querySelector(".brand-block")).toBeTruthy();

    // 有 logo 字段的快照: 品牌块按 logo 渲染(BrandLogo platform="kimi")
    const snapWithLogo: ProviderSnapshot = { ...snapNoLogo, logo: "kimi" };
    const cardWithLogo = renderCard(snapWithLogo);
    expect(cardWithLogo.querySelector(".brand-block")).toBeTruthy();
  });

  // round-2 反向对照: 验证文本级守卫(countBadgeText)真咬住缺陷 —
  // 手工构造一个会让无旧数据 error 卡字面出现 2 次「采集失败」的快照,
  // 守卫必须确定性变红; 修复后(本卡 round-2)错误不再渲染 abnormal-status-detail 行,
  // 守卫恢复通过。证实断言不是空转。
  it("round-2 反向对照: 无旧数据 error 卡全卡叶节点中「采集失败」恰 1 次", () => {
    const card = renderCard(okSnap("error", NOW - 60, []));
    // 修复后路径: abnormal-status-detail 行被守卫 showStatusDetail=false 跳过,
    // 仅 head card-status-badge 渲染「采集失败」, countBadgeText === 1。
    expect(countBadgeText(card, "采集失败")).toBe(1);
    // 同时验证反例触发: 手动制造一个重复文案元素后, 守卫确定性变红。
    // (用 DOM API 注入一个相同文案的兄弟节点, countBadgeText 应跳到 2)
    const dup = document.createElement("div");
    dup.textContent = "采集失败";
    card.appendChild(dup);
    expect(countBadgeText(card, "采集失败")).toBe(2);
    dup.remove();
    expect(countBadgeText(card, "采集失败")).toBe(1);
  });
});
