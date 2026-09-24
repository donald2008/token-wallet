/**
 * AgentCard 组件单测(t_9255cb63; t_56c66972 方案 A-rev3 重构后):
 * - 渲染三种活动态(active / idle / no_report_today) + 边界① 数据滞后(stale)
 * - 金额可空留白契约(cost_total=null OR currency=null → is-empty 类, 内容空白)
 * - **卡内大屏钮整体移除**(agent-detail-* 零残留, 大屏入口上收置顶组件)
 * - meta 行去词化(左=calls 数字, 右=时间; 无「calls」「更新」词)
 * - AgentCardEmpty 渲染 reason 文案
 */
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentCard,
  AgentCardEmpty,
  STALE_THRESHOLD_MS,
  formatMetaTime,
  formatTokens,
  staleOf,
} from "./AgentCard";
import type { SummaryRow } from "../mcpQueryTypes";

const baseRow = (over: Partial<SummaryRow> = {}): SummaryRow => ({
  group: "njbx02",
  calls: 100,
  input_cache_hit_tokens: 50000,
  input_cache_miss_tokens: 10000,
  output_tokens: 4000,
  cost_total: 1.23,
  currency: "USD",
  by_status: { completed: 95, partial: 5, unknown: 0 },
  ...over,
});

/** 快照时间(判陈旧的「now」基准)与陈旧数据点(隔日 22:14, 对稿 plan-a-v3 边界①) */
const SNAP_AT = "2026-09-24T10:20:00+08:00";
const STALE_TS = "2026-09-23T22:14:00+08:00";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: React.ReactNode): { container: HTMLDivElement; root: Root } {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r = createRoot(c);
  act(() => {
    r.render(node);
  });
  container = c;
  root = r;
  return { container: c, root: r };
}

afterEach(() => {
  const r = root;
  const c = container;
  if (r !== null && c !== null) {
    act(() => r.unmount());
    c.remove();
  }
  container = null;
  root = null;
});

/** 本机时区下的 HH:MM(latest_ts 无偏移时按本地解析, 断言随环境 TZ 自洽) */
function localHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

describe("AgentCard", () => {
  it("渲染 agent_id + tokens + amount(有金额时显示 USD 1.23)", () => {
    const { container: c } = mount(
      <AgentCard agentId="njbx02" row={baseRow()} activity="active" generatedAt={SNAP_AT} />,
    );
    expect(c.querySelector('[data-testid="agent-card"][data-agent="njbx02"]')).toBeTruthy();
    const tokens = c.querySelector('[data-testid="agent-tokens"]');
    expect(tokens?.textContent).toMatch(/64,000/); // 50000+10000+4000 = 64000 → 64,000 (t_4b7984d9 B: 全数字, 千分位)
    const cost = c.querySelector('[data-testid="agent-cost"]');
    expect(cost?.textContent).toBe("1.23 USD");
    expect(cost?.classList.contains("is-empty")).toBe(false);
  });

  it("cost_total=null → is-empty 类(彻底留空,不显示破折号)", () => {
    const { container: c } = mount(
      <AgentCard agentId="home-computer" row={baseRow({ cost_total: null })} activity="active" generatedAt="" />,
    );
    const cost = c.querySelector('[data-testid="agent-cost"]');
    expect(cost?.classList.contains("is-empty")).toBe(true);
    expect(cost?.textContent).toBe(""); // 彻底空白
    expect(cost?.getAttribute("aria-hidden")).toBe("true");
  });

  it("currency=null + cost 存在 → 同样留空(契约:cost OR currency 缺一不可)", () => {
    const { container: c } = mount(
      <AgentCard agentId="desktop" row={baseRow({ currency: null })} activity="active" generatedAt="" />,
    );
    const cost = c.querySelector('[data-testid="agent-cost"]');
    expect(cost?.classList.contains("is-empty")).toBe(true);
  });

  it("active 状态 → status-dot ok + 文案「有活动」", () => {
    const { container: c } = mount(
      <AgentCard agentId="a" row={baseRow()} activity="active" generatedAt="" />,
    );
    const dot = c.querySelector('[data-testid="agent-status-dot"]');
    expect(dot?.getAttribute("data-health")).toBe("ok");
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("有活动");
  });

  it("idle 状态 → status-dot warn + 文案「空闲」", () => {
    const { container: c } = mount(
      <AgentCard
        agentId="a"
        row={baseRow({ by_status: { completed: 0, partial: 5, unknown: 0 }, calls: 5 })}
        activity="idle"
        generatedAt=""
      />,
    );
    const dot = c.querySelector('[data-testid="agent-status-dot"]');
    expect(dot?.getAttribute("data-health")).toBe("warn");
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("空闲");
  });

  it("no_report_today 状态 → status-dot unknown + 文案「今天无上报」", () => {
    const { container: c } = mount(
      <AgentCard
        agentId="a"
        row={baseRow({ calls: 0, by_status: { completed: 0, partial: 0, unknown: 0 } })}
        activity="no_report_today"
        generatedAt=""
      />,
    );
    const dot = c.querySelector('[data-testid="agent-status-dot"]');
    expect(dot?.getAttribute("data-health")).toBe("unknown");
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("今天无上报");
  });

  // t_56c66972 ①: 卡内大屏钮整体移除 —— 大屏入口全局唯一(置顶组件 AgentUsageHero)
  it("卡内大屏钮已移除: agent-detail-* testid 与「大屏 →」文案零残留", () => {
    const { container: c } = mount(
      <AgentCard agentId="njbx02" row={baseRow()} activity="active" generatedAt={SNAP_AT} />,
    );
    expect(c.querySelector('[data-testid="agent-detail-njbx02"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid^="agent-detail-"]').length).toBe(0);
    expect(c.querySelector(".agent-detail-btn")).toBeNull();
    expect(c.textContent).not.toContain("大屏");
  });

  // t_56c66972 ②: meta 行去词化(位置约定自明: 左 = 调用数, 右 = 时间)
  it("meta 行去词化: 左=calls 数字 / 右=HH:MM, 无「calls」「更新」「数据」词", () => {
    const { container: c } = mount(
      <AgentCard agentId="njbx02" row={baseRow()} activity="active" generatedAt={SNAP_AT} />,
    );
    const meta = c.querySelector('[data-testid="agent-meta"]');
    expect(c.querySelector('[data-testid="agent-meta-calls"]')?.textContent).toBe("100");
    expect(c.querySelector('[data-testid="agent-meta-time"]')?.textContent).toBe(localHHMM(SNAP_AT));
    // 去词化硬断言: 词面不得出现
    expect(meta?.textContent).not.toMatch(/calls|更新|数据 /);
    // 时间不再是全量 ISO 串
    expect(meta?.textContent).not.toContain("2026-");
  });

  it("row.latest_ts 存在时 meta 右列取 agent 级时间(非快照时间)", () => {
    const latest = "2026-09-24T10:05:00+08:00";
    const { container: c } = mount(
      <AgentCard
        agentId="njbx02"
        row={baseRow({ latest_ts: latest })}
        activity="active"
        generatedAt={SNAP_AT}
      />,
    );
    expect(c.querySelector('[data-testid="agent-meta-time"]')?.textContent).toBe(localHHMM(latest));
  });

  // ---- t_56c66972 边界①: 数据滞后(>30min 无上报) ----
  it("边界① latest_ts 超前快照 30min+: 黄点 + 「数据滞后」 + 快照提示带 + 大数字降饱和", () => {
    const { container: c } = mount(
      <AgentCard
        agentId="k3-worker"
        row={baseRow({ calls: 2, latest_ts: STALE_TS })}
        activity="idle"
        generatedAt={SNAP_AT}
      />,
    );
    const card = c.querySelector('[data-testid="agent-card"]');
    expect(card?.getAttribute("data-stale")).toBe("true");
    // 状态覆盖: stale 优先于常规 activity
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("数据滞后");
    expect(c.querySelector('[data-testid="agent-status-dot"]')?.getAttribute("data-health")).toBe("warn");
    // 快照提示带(mock 逐字)
    const band = c.querySelector('[data-testid="agent-stale-band-k3-worker"]');
    expect(band?.textContent).toContain("前的快照 — agent 可能已下线");
    expect(band?.textContent).toContain("2026-09-23 22:14");
    // 大数字降饱和
    expect(c.querySelector(".agent-tokens-number")?.classList.contains("is-stale")).toBe(true);
    // meta 右列 = 隔日时间文案
    expect(c.querySelector('[data-testid="agent-meta-time"]')?.textContent).toContain("22:14");
  });

  it("边界① 未超阈值(29min)→ 不判陈旧(不误报)", () => {
    // 快照 10:20, latest 09:51 → 29min
    const { container: c } = mount(
      <AgentCard
        agentId="a"
        row={baseRow({ latest_ts: "2026-09-24T09:51:00+08:00" })}
        activity="active"
        generatedAt={SNAP_AT}
      />,
    );
    expect(c.querySelector('[data-testid="agent-card"]')?.getAttribute("data-stale")).toBeNull();
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("有活动");
    expect(c.querySelectorAll('[data-testid^="agent-stale-band-"]').length).toBe(0);
  });

  it("边界① daemon 未提供 latest_ts → 不判陈旧(宁可不标, 不误报)", () => {
    const { container: c } = mount(
      <AgentCard agentId="a" row={baseRow()} activity="active" generatedAt={SNAP_AT} />,
    );
    expect(c.querySelector('[data-testid="agent-card"]')?.getAttribute("data-stale")).toBeNull();
    expect(c.querySelectorAll('[data-testid^="agent-stale-band-"]').length).toBe(0);
  });

  // t_6eb3e728 ③: 悬浮删除钮 + 二次确认。onDeleteUsage 缺省 = 不渲染删除钮(e2e mock 场景可控)。
  it("③未传 onDeleteUsage → 不渲染删除钮与确认气泡, 且卡不带 is-deletable(不藏状态徽章)", () => {
    const { container: c } = mount(
      <AgentCard agentId="a" row={baseRow()} activity="active" generatedAt="" />,
    );
    expect(c.querySelector('[data-testid="agent-delete-a"]')).toBeNull();
    expect(c.querySelector('[data-testid="agent-confirm-row-a"]')).toBeNull();
    expect(c.querySelector(".agent-card")?.classList.contains("is-deletable")).toBe(false);
  });

  it("③点删除钮 → 确认气泡浮出(含 agent_id + calls 数 + 不可逆), 删除钮互斥隐藏", () => {
    const { container: c } = mount(
      <AgentCard
        agentId="njbx02"
        row={baseRow()}
        activity="active"
        generatedAt=""
        onDeleteUsage={async () => true}
      />,
    );
    expect(c.querySelector(".agent-card")?.classList.contains("is-deletable")).toBe(true);
    expect(c.querySelector('[data-testid="agent-delete-njbx02"]')).toBeTruthy();
    act(() => (c.querySelector('[data-testid="agent-delete-njbx02"]') as HTMLButtonElement).click());
    const confirmRow = c.querySelector('[data-testid="agent-confirm-row-njbx02"]');
    expect(confirmRow).toBeTruthy();
    const text = confirmRow?.textContent ?? "";
    expect(text).toContain("njbx02");
    expect(text).toContain("100"); // row.calls = 100
    expect(text).toContain("不可逆");
    // 互斥: 确认气泡浮出期间删除钮卸载(单条 hover 纪律, 不叠热区)
    expect(c.querySelector('[data-testid="agent-delete-njbx02"]')).toBeNull();
  });

  it("③确认删除 → onDeleteUsage(agentId) 调用; 取消 → 不调用且气泡收起", () => {
    const onDelete = vi.fn(async () => true);
    const { container: c } = mount(
      <AgentCard
        agentId="njbx02"
        row={baseRow()}
        activity="active"
        generatedAt=""
        onDeleteUsage={onDelete}
      />,
    );
    act(() => (c.querySelector('[data-testid="agent-delete-njbx02"]') as HTMLButtonElement).click());
    // 取消路径
    act(() => (c.querySelector('[data-testid="agent-confirm-cancel-njbx02"]') as HTMLButtonElement).click());
    expect(onDelete).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="agent-confirm-row-njbx02"]')).toBeNull();
    // 再次进入确认 → 确认路径
    act(() => (c.querySelector('[data-testid="agent-delete-njbx02"]') as HTMLButtonElement).click());
    act(() => (c.querySelector('[data-testid="agent-confirm-del-njbx02"]') as HTMLButtonElement).click());
    expect(onDelete).toHaveBeenCalledWith("njbx02");
    expect(c.querySelector('[data-testid="agent-confirm-row-njbx02"]')).toBeNull();
  });
});

describe("staleOf / formatMetaTime 纯函数(t_56c66972 边界①)", () => {
  it("阈值用 STALE_THRESHOLD_MS = 30min", () => {
    expect(STALE_THRESHOLD_MS).toBe(30 * 60 * 1000);
  });

  it("staleOf: >30min 陈旧 / =30min 不陈旧(严格大于) / 字段缺失不判", () => {
    const snap = "2026-09-24T10:20:00+08:00";
    expect(staleOf("2026-09-24T09:49:00+08:00", snap)).toBe(true); // 31min
    expect(staleOf("2026-09-24T09:50:00+08:00", snap)).toBe(false); // 30min 整
    expect(staleOf(null, snap)).toBe(false);
    expect(staleOf(undefined, snap)).toBe(false);
    expect(staleOf("", snap)).toBe(false);
    expect(staleOf("not-a-time", snap)).toBe(false);
    expect(staleOf(snap, "")).toBe(false);
  });

  it("formatMetaTime: 同日 → HH:MM; 隔日 → 昨天 HH:MM; 更早 → YYYY-MM-DD HH:MM", () => {
    const snap = "2026-09-24T10:20:00+08:00";
    expect(formatMetaTime("2026-09-24T08:00:00+08:00", snap)).toBe("08:00");
    expect(formatMetaTime("2026-09-23T22:14:00+08:00", snap)).toBe("昨天 22:14");
    expect(formatMetaTime("2026-09-20T22:14:00+08:00", snap)).toBe("2026-09-20 22:14");
    // 无参照(陈旧快照带用)→ 全量日期文案
    expect(formatMetaTime("2026-09-23T22:14:00+08:00", "")).toBe("2026-09-23 22:14");
    expect(formatMetaTime("", snap)).toBe("");
  });
});

describe("formatTokens 边界(t_f26c5fb8: K/M 简写分支已删, 一律 Intl.NumberFormat 千分位全数字)", () => {
  it.each([
    [0, "0"], // 下界: 零不显示 0.0K
    [999, "999"], // 千位以下: 无分隔符
    [1000, "1,000"], // 千位边界: 首个分隔符, 不是 1K
    [4474000, "4,474,000"], // 任务卡样例: 9 位完整数字, 不是 4.5M
    [1455000000, "1,455,000,000"], // 十亿级: 极大值仍完整展开
    [-42, "-42"], // 负数(异常数据)不炸, 忠实展示
  ])("formatTokens(%i) → %s", (input, expected) => {
    expect(formatTokens(input)).toBe(expected);
  });

  it("任意 ≥1000 值不含 K/M 简写后缀(负向断言)", () => {
    for (const n of [1000, 1500, 999999, 1000000, 4474000, 1000000000]) {
      expect(formatTokens(n)).not.toMatch(/\d+(\.\d+)?[KM]\b/);
    }
  });

  it("agent-tokens 行 title 保留完整数字(悬停兜底,勿删)", () => {
    const { container: c } = mount(
      <AgentCard agentId="x" row={baseRow()} activity="active" generatedAt="" />,
    );
    const tokens = c.querySelector('[data-testid="agent-tokens"]');
    expect(tokens?.getAttribute("title")).toBe("64,000 tokens");
  });
});

describe("AgentCardEmpty", () => {
  it("渲染 reason 文案 + 按 reason 分类的徽章(round-7: 徽章与正文不再重复同一状态)", () => {
    // 主页/大屏传裸 kind → 徽章「连接失败」, 正文完整引导文案
    const { container: c } = mount(<AgentCardEmpty reason="unreachable" />);
    expect(c.querySelector('[data-testid="agent-card-empty"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="agent-empty-reason"]')?.textContent).toBe(
      "daemon 未连接,请先启动 daemon",
    );
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("连接失败");
  });

  it("徽章按 reason 分类: unauthorized → 鉴权失败", () => {
    const { container: c } = mount(<AgentCardEmpty reason="unauthorized" />);
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("鉴权失败");
    expect(c.querySelector('[data-testid="agent-empty-reason"]')?.textContent).toBe(
      "鉴权失败,请检查 daemon API Key",
    );
  });
});
