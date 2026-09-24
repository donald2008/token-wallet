/**
 * AgentCard 组件单测(t_9255cb63, 与项目惯例一致 — 用裸 createRoot + act, 不引 testing-library):
 * - 渲染三种活动态(active / idle / no_report_today)
 * - 金额可空留白契约(cost_total=null OR currency=null → is-empty 类, 内容空白)
 * - 详情按钮触发 onOpenDashboard 回调
 * - AgentCardEmpty 渲染 reason 文案
 */
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCard, AgentCardEmpty, formatTokens } from "./AgentCard";
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

describe("AgentCard", () => {
  it("渲染 agent_id + tokens + amount(有金额时显示 USD 1.23)", () => {
    const { container: c } = mount(
      <AgentCard
        agentId="njbx02"
        row={baseRow()}
        activity="active"
        generatedAt="2026-09-09T12:00:00+08:00"
        onOpenDashboard={() => {}}
      />,
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
      <AgentCard
        agentId="home-computer"
        row={baseRow({ cost_total: null })}
        activity="active"
        generatedAt=""
        onOpenDashboard={() => {}}
      />,
    );
    const cost = c.querySelector('[data-testid="agent-cost"]');
    expect(cost?.classList.contains("is-empty")).toBe(true);
    expect(cost?.textContent).toBe(""); // 彻底空白
    expect(cost?.getAttribute("aria-hidden")).toBe("true");
  });

  it("currency=null + cost 存在 → 同样留空(契约:cost OR currency 缺一不可)", () => {
    const { container: c } = mount(
      <AgentCard
        agentId="desktop"
        row={baseRow({ currency: null })}
        activity="active"
        generatedAt=""
        onOpenDashboard={() => {}}
      />,
    );
    const cost = c.querySelector('[data-testid="agent-cost"]');
    expect(cost?.classList.contains("is-empty")).toBe(true);
  });

  it("active 状态 → status-dot ok + 文案「有活动」", () => {
    const { container: c } = mount(
      <AgentCard agentId="a" row={baseRow()} activity="active" generatedAt="" onOpenDashboard={() => {}} />,
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
        onOpenDashboard={() => {}}
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
        onOpenDashboard={() => {}}
      />,
    );
    const dot = c.querySelector('[data-testid="agent-status-dot"]');
    expect(dot?.getAttribute("data-health")).toBe("unknown");
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("今天无上报");
  });

  it("点击详情按钮触发 onOpenDashboard(传 agentId)", () => {
    const onOpen = vi.fn();
    const { container: c } = mount(
      <AgentCard agentId="njbx02" row={baseRow()} activity="active" generatedAt="" onOpenDashboard={onOpen} />,
    );
    const btn = c.querySelector('[data-testid="agent-detail-njbx02"]') as HTMLButtonElement;
    act(() => btn.click());
    expect(onOpen).toHaveBeenCalledWith("njbx02");
  });

  it("meta 区显示 calls + generated_at 时间戳", () => {
    const { container: c } = mount(
      <AgentCard
        agentId="njbx02"
        row={baseRow()}
        activity="active"
        generatedAt="2026-09-09T12:00:00+08:00"
        onOpenDashboard={() => {}}
      />,
    );
    const meta = c.querySelector('[data-testid="agent-meta"]');
    expect(meta?.textContent).toMatch(/calls\s*100/);
    expect(meta?.textContent).toMatch(/2026-09-09T12:00:00\+08:00/);
  });

  // t_6eb3e728 ②: 详情钮语义归位 — 大屏是整体大屏, 按钮文案「大屏 →」+ aria-label 同步。
  // testid agent-detail-<id> 保留(卡面二选一: 保留 testid 仅改文案, e2e 零波及)。
  it("②大屏按钮文案=「大屏 →」+ aria-label 打开用量大屏(不再是单卡详情语义)", () => {
    const { container: c } = mount(
      <AgentCard agentId="njbx02" row={baseRow()} activity="active" generatedAt="" onOpenDashboard={() => {}} />,
    );
    const btn = c.querySelector('[data-testid="agent-detail-njbx02"]') as HTMLButtonElement;
    expect(btn.textContent).toBe("大屏 →");
    expect(btn.getAttribute("aria-label")).toBe("打开 njbx02 用量大屏");
    expect(btn.getAttribute("title")).toBe("打开用量大屏");
    expect(btn.textContent).not.toContain("详情");
  });

  // t_6eb3e728 ③: 悬浮删除钮 + 二次确认。onDeleteUsage 缺省 = 不渲染删除钮(e2e mock 场景可控)。
  it("③未传 onDeleteUsage → 不渲染删除钮与确认气泡", () => {
    const { container: c } = mount(
      <AgentCard agentId="a" row={baseRow()} activity="active" generatedAt="" onOpenDashboard={() => {}} />,
    );
    expect(c.querySelector('[data-testid="agent-delete-a"]')).toBeNull();
    expect(c.querySelector('[data-testid="agent-confirm-row-a"]')).toBeNull();
  });

  it("③点删除钮 → 确认气泡浮出(含 agent_id + calls 数 + 不可逆), 删除钮互斥隐藏", () => {
    const { container: c } = mount(
      <AgentCard
        agentId="njbx02"
        row={baseRow()}
        activity="active"
        generatedAt=""
        onOpenDashboard={() => {}}
        onDeleteUsage={async () => true}
      />,
    );
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
        onOpenDashboard={() => {}}
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
      <AgentCard agentId="x" row={baseRow()} activity="active" generatedAt="" onOpenDashboard={() => {}} />,
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
