/**
 * AgentCard 组件单测(t_9255cb63, 与项目惯例一致 — 用裸 createRoot + act, 不引 testing-library):
 * - 渲染三种活动态(active / idle / no_report_today)
 * - 金额可空留白契约(cost_total=null OR currency=null → is-empty 类, 内容空白)
 * - 详情按钮触发 onOpenDetail 回调
 * - AgentCardEmpty 渲染 reason 文案
 */
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCard, AgentCardEmpty } from "./AgentCard";
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
        onOpenDetail={() => {}}
      />,
    );
    expect(c.querySelector('[data-testid="agent-card"][data-agent="njbx02"]')).toBeTruthy();
    const tokens = c.querySelector('[data-testid="agent-tokens"]');
    expect(tokens?.textContent).toMatch(/64\.0K/); // 50000+10000+4000 = 64000 → 64.0K
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
        onOpenDetail={() => {}}
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
        onOpenDetail={() => {}}
      />,
    );
    const cost = c.querySelector('[data-testid="agent-cost"]');
    expect(cost?.classList.contains("is-empty")).toBe(true);
  });

  it("active 状态 → status-dot ok + 文案「有活动」", () => {
    const { container: c } = mount(
      <AgentCard agentId="a" row={baseRow()} activity="active" generatedAt="" onOpenDetail={() => {}} />,
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
        onOpenDetail={() => {}}
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
        onOpenDetail={() => {}}
      />,
    );
    const dot = c.querySelector('[data-testid="agent-status-dot"]');
    expect(dot?.getAttribute("data-health")).toBe("unknown");
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("今天无上报");
  });

  it("点击详情按钮触发 onOpenDetail(传 agentId)", () => {
    const onOpen = vi.fn();
    const { container: c } = mount(
      <AgentCard agentId="njbx02" row={baseRow()} activity="active" generatedAt="" onOpenDetail={onOpen} />,
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
        onOpenDetail={() => {}}
      />,
    );
    const meta = c.querySelector('[data-testid="agent-meta"]');
    expect(meta?.textContent).toMatch(/calls\s*100/);
    expect(meta?.textContent).toMatch(/2026-09-09T12:00:00\+08:00/);
  });
});

describe("AgentCardEmpty", () => {
  it("渲染 reason 文案 + 显式「daemon 未连接」徽章", () => {
    const { container: c } = mount(<AgentCardEmpty reason="daemon 未连接,请先启动 daemon" />);
    expect(c.querySelector('[data-testid="agent-card-empty"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="agent-empty-reason"]')?.textContent).toBe(
      "daemon 未连接,请先启动 daemon",
    );
    expect(c.querySelector('[data-testid="agent-activity-badge"]')?.textContent).toBe("daemon 未连接");
  });
});
