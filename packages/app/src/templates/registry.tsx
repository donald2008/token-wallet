import type { ComponentType } from "react";
import type { Metric, PlanType, ProviderSnapshot } from "../types";
import { metricHealth } from "../health";
import { ProgressBar } from "../components/ProgressBar";

/**
 * 模板注册表(D-004): Template(信息结构与视觉形态)与 Theme(配色)分离。
 * 模板注册进 registry, 按 plan_type 默认指派; MVP 先做 bars + ticker, 后续 gauge / battery / ring-stack / ledger。
 * ProviderCard 通过 `getTemplateFor(p)` 取模板渲染 — 数据怎么画, 由模板决定, 不硬编码在卡片里。
 */

export interface Template {
  /** 模板唯一 id, 如 "bars" | "ticker" */
  id: string;
  /** 默认适配的原型(与 DESIGN.md §6.3 模板表一致) */
  planType: PlanType;
  /** 渲染组件: 仅接收快照, 内部决定如何画 */
  component: ComponentType<{ p: ProviderSnapshot }>;
}

const templates = new Map<string, Template>();

/** 注册模板(重复 id 覆盖并告警, 便于 HMR 刷新) */
export function registerTemplate(t: Template): void {
  if (templates.has(t.id)) {
    // eslint-disable-next-line no-console
    console.warn(`[templates] 重复注册 "${t.id}", 已覆盖`);
  }
  templates.set(t.id, t);
}

export function getTemplate(id: string): Template | undefined {
  return templates.get(id);
}

/** 未注册模板的兜底: 落回 bars(最通用), 避免白屏 */
const FALLBACK: Template = {
  id: "fallback",
  planType: "window",
  component: BarsTemplate,
};

/** 取某 provider 的渲染模板(按 plan_type 默认指派; 全局/按 provider 覆盖为 P1+) */
export function getTemplateFor(p: ProviderSnapshot): Template {
  for (const t of templates.values()) {
    if (t.planType === p.plan_type) return t;
  }
  return FALLBACK;
}

/* ---------------- 窗口制: bars 模板(§6.3) ---------------- */

/** 窗口紧度排序: used/limit 比例降序(最紧在前) */
function sortByTightness(metrics: Metric[]): Metric[] {
  return [...metrics].sort((a, b) => {
    const ra = a.limit !== undefined && a.limit > 0 ? a.used / a.limit : 0;
    const rb = b.limit !== undefined && b.limit > 0 ? b.used / b.limit : 0;
    return rb - ra;
  });
}

/**
 * bars 模板: 多窗口嵌套, 每窗口一条进度条 + 压字 + 重置倒计时;
 * 最紧窗口(剩余比例最小)置顶并标红, 一眼定位最先耗尽的风险窗。
 * 状态微部件全手绘(D-002), 不引 Chart.js。
 */
export function BarsTemplate({ p }: { p: ProviderSnapshot }) {
  const metrics = sortByTightness(p.metrics);
  const tightest = metrics[0];
  return (
    <div className="bars-template" data-testid="bars-template">
      {metrics.map((m) => {
        // 最紧窗口(剩余比例最小)置顶后标红 —— 风险带(warn/bad)才标, 健康窗口不误标红(颜色即状态)
        const tight = m === tightest && metricHealth(m) !== "ok";
        return <ProgressBar key={m.key} metric={m} tightest={tight} />;
      })}
    </div>
  );
}

/* ---------------- 余额制: ticker 模板(§6.3) ---------------- */

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

/** 币种符号: CNY/人民币 → ¥; 其他用 ISO 码兜底 */
function currencySymbol(currency?: string): string {
  if (!currency) return "¥";
  const upper = currency.toUpperCase();
  if (upper === "CNY" || upper === "RMB") return "¥";
  if (upper === "USD") return "$";
  if (upper === "EUR") return "€";
  return `${currency} `;
}

/** 余额制: 当前剩余 = remaining 优先, 否则 limit-used 推导(旧 mock 兼容) */
function currentRemaining(m: Metric): number | null {
  if (m.remaining !== undefined) return m.remaining;
  if (m.limit !== undefined) return m.limit - m.used;
  return null;
}

/** 近 7 天速率 → 预计可用天数(§2 数字回答"还能撑多久") */
function estimatedDays(m: Metric): number | null {
  const remaining = currentRemaining(m);
  if (remaining === null) return null;
  if (remaining <= 0) return 0;
  if (!m.daily_rate || m.daily_rate <= 0) return null;
  return remaining / m.daily_rate;
}

function fmtDays(days: number): string {
  return days >= 100 ? String(Math.round(days)) : days.toFixed(1);
}

/**
 * ticker 模板: 剩余大数字 + 币种 + granted/topped_up 拆分 + 按近 7 天速率的预计可用天数。
 * daily_rate(近 7 天平均日消耗)由 P0-5 RuntimeEngine 从历史快照计算附着。
 */
export function TickerTemplate({ p }: { p: ProviderSnapshot }) {
  const m = p.metrics.find((x) => x.kind === "balance") ?? p.metrics[0];
  const remaining = m ? currentRemaining(m) : null;
  const symbol = currencySymbol(m?.currency);
  const days = m ? estimatedDays(m) : null;
  const showSplit = m && (m.granted !== undefined || m.topped_up !== undefined);
  return (
    <div className="ticker-template" data-testid="ticker-template">
      <div className="ticker-number">
        {remaining !== null ? `${symbol}${fmtMoney(remaining)}` : "—"}
      </div>
      {showSplit && (
        <div className="ticker-split" data-testid="ticker-split">
          {m!.granted !== undefined && <span>赠送 {symbol}{fmtMoney(m!.granted!)}</span>}
          {m!.topped_up !== undefined && <span>充值 {symbol}{fmtMoney(m!.topped_up!)}</span>}
        </div>
      )}
      <div className="ticker-sub">
        {days !== null ? (
          <>
            近 7 天 ~{m!.daily_rate}/天 · <span data-testid="ticker-days">预计可用约 {fmtDays(days)} 天</span>
          </>
        ) : (
          "余额 · 预计可用天数待消耗速率数据(历史积累后显示)"
        )}
      </div>
    </div>
  );
}

/* ---------------- 本地 Agent: local 模板(§6.5, P3 才做真实数据) ---------------- */

export function LocalTemplate({ p }: { p: ProviderSnapshot }) {
  return (
    <div className="local-template" data-testid="local-template">
      <div className="ticker-sub">{p.display_name} · 本地用量(P3)</div>
    </div>
  );
}

/* ---------------- 注册(MVP: bars + ticker, local 占位) ---------------- */

registerTemplate({ id: "bars", planType: "window", component: BarsTemplate });
registerTemplate({ id: "ticker", planType: "balance", component: TickerTemplate });
registerTemplate({ id: "local", planType: "local", component: LocalTemplate });