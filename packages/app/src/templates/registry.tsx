import type { ComponentType } from "react";
import type { Metric, PlanType, ProviderSnapshot } from "../types";
import { metricHealth } from "../health";
import { t, currentLocale } from "../i18n";
import { QuotaMeter } from "../components/QuotaMeter";
// resetText 仍由 ProgressBar 导出(t_a398348b 兄弟卡活跃改动该文件, 不搬家避免互踩;
// t_27eeadad 主页 P1 化: BarRowTooltip 不再挂载, ProgressBar.tsx 文件保留作为 BarRowTooltip
// 组件依赖源 + 旧回归护栏产物, 主页不再 import 它的 BarRowTooltip)
import { resetText } from "../components/ProgressBar";
// import { BarRowTooltip } from "../components/BarRowTooltip";

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

/**
 * 窗口时间跨度分级(P1 真机验收反馈): 按 key 语义识别窗口时长 ——
 * 短(5h/小时级)=0, 中(周)=1, 长(月及更长)=2, 未识别=3(保持原相对顺序追加在已知窗口之后, 不丢不崩)。
 */
export function windowSpanRank(key: string): 0 | 1 | 2 | 3 {
  const k = key.toLowerCase();
  if (/month|月|30d/.test(k)) return 2;
  if (/week|周|7d/.test(k)) return 1;
  if (/\d+\s*h\b|小时|hour/.test(k)) return 0;
  return 3;
}

/**
 * 窗口排序: 按时间窗升序(5小时窗 → 周窗 → 月窗 → 更长窗), 不按紧度。
 * 未识别 key 稳定排在已知窗口之后(Array.sort 稳定, 同 rank 保持原相对顺序)。
 * 纯函数, 不改输入。
 */
export function sortByWindowSpan(metrics: Metric[]): Metric[] {
  return [...metrics].sort((a, b) => windowSpanRank(a.key) - windowSpanRank(b.key));
}

/** 最紧窗口 = used/limit 比例最高者(只用于标红定位风险, 不参与排序) */
export function tightestMetric(metrics: Metric[]): Metric | undefined {
  let best: Metric | undefined;
  let bestRatio = -1;
  for (const m of metrics) {
    const r = m.limit !== undefined && m.limit > 0 ? m.used / m.limit : 0;
    if (r > bestRatio) {
      bestRatio = r;
      best = m;
    }
  }
  return best;
}

/**
 * bars 模板: 多窗口按 P5 短窗并排排版(t_433892c6 9/7 用户拍板 — 上主页,非方案页实验)。
 * 排版契约:
 *   ┌─ <ProviderCard> ──────────┐
 *   │   ...head + status + del  │  ← 头部/status/删除钮沿用 ProviderCard 已修形态,不动
 *   │ ┌─5h─┐ ┌─周─┐             │  ← 短窗并排一行(非 monthly 全部并排,grid 2 列)
 *   │ │ 80%│ │ 20%│             │
 *   │ └────┘ └─────┘            │
 *   │ ┌─月──────────────────────┐│  ← monthly 独占下一行全宽(.qcard3-windows-row--wide)
 *   │ │ 30%                     ││
 *   │ └────────────────────────┘│
 *   └───────────────────────────┘
 *
 * 降级规则(用户 9/7 修订 — 1/2/3 窗都成立):
 *   - 3 窗 + monthly 存在 → short(5h+周)同行两列 + monthly 全宽
 *   - 2 窗(无 monthly)    → 全部 short 同行两列(规则统一:非 monthly 全并排)
 *   - 1 窗                → 整行全宽(短行 --wide 修饰符);短行内单格占 grid 第 1 列,第 2 列空
 *   - 0 窗                → 不走本模板(register 时 plan_type=window 不可能零窗)
 *
 * DOM 契约(零破):
 *   - .bar-row 仍是窗的语义壳,data-testid="bar-row" / data-metric / data-tightest 全保留
 *   - .progress / .progress-fill[data-health] / role=progressbar 由 QuotaMeter 自带
 *   - 新增 .qcard3-windows-row + .qcard3-windows-row--wide 容器(复用方案页 P5 同款 CSS)
 *   - 不挂 <BarRowTooltip>: micro 常驻 = 信息主体,hover 复读是冗余
 *
 * 不动: 头部 / 状态徽章 / 删除钮 / AbnormalBody / QuotaMeter 本体 / BarRowTooltip 本体。
 */

/** 窗口名本地化(2026-09-03 文案本地化⑤, 自旧 ProgressBar 收容): 未知 key 回退原样 */
function windowTitle(key: string): string {
  const metricKey = `metric.${key}` as Parameters<typeof t>[0];
  return t(metricKey).startsWith("metric.") ? t("metric.fallback", { key }) : t(metricKey);
}

/** 窗口行: QuotaMeter(layout=micro) 常驻直显, .bar-row 瘦壳承担语义锚点
 * (data-tightest / data-metric / data-testid 全在壳上, micro 内四元素由 QuotaMeter 渲染) */
function WindowRow({ metric, tightest }: { metric: Metric; tightest: Metric | undefined }) {
  const h = metricHealth(metric);
  const tight = metric === tightest && h !== "ok";
  const state = h === "unknown" ? "ok" : (h as "ok" | "warn" | "bad");
  const reset = resetText(metric.reset_at);
  return (
    <div
      className="bar-row"
      data-testid="bar-row"
      data-metric={metric.key}
      data-tightest={tight || undefined}
      key={metric.key}
    >
      <QuotaMeter
        layout="micro"
        pct={metric.limit !== undefined && metric.limit > 0 ? metric.used / metric.limit : 0}
        state={state}
        title={windowTitle(metric.key)}
        resetText={reset || undefined}
        used={metric.used}
        limit={metric.limit}
        unit={metric.unit}
      />
    </div>
  );
}

export function BarsTemplate({ p }: { p: ProviderSnapshot }) {
  const metrics = sortByWindowSpan(p.metrics);
  const tightest = tightestMetric(metrics);
  // 短窗 = 除 monthly 外的全部; 月窗 = 唯一 monthly(若存在)。非已知 key 一律归 short,
  // 符合规则「非 monthly 全并排, monthly 全宽」——未识别 key 不丢不崩,排在短行。
  const short = metrics.filter((m) => m.key !== "monthly");
  const wide = metrics.find((m) => m.key === "monthly");
  // 单窗 → 整行全宽(short 一格占 grid 第 1 列, --wide 让模板仅 1 列);
  // 多窗但无 monthly → 整行仍是 short 两列(自然就是规则形态,不需额外修饰)。
  const onlyOneOverall = short.length === 1 && !wide;
  // 0 窗保护(注册 plan_type=window 不可能零窗,但 type 收口)
  if (metrics.length === 0) return <div className="bars-template" data-testid="bars-template" />;
  return (
    <div className="bars-template" data-testid="bars-template">
      {/* 短窗行: 非 monthly 全并排(1 窗时 --wide 让整行单列, 多窗时 grid 2 列)。
       *   - 不挂 BarRowTooltip: 信息常驻 = micro 直接展开, hover 复读冗余
       *   - data-testid="windows-row" 与方案页 P5 一致, 主页 e2e 凭此锚定位 */}
      {short.length > 0 && (
        <div
          className={
            "qcard3-windows-row" + (onlyOneOverall ? " qcard3-windows-row--wide" : "")
          }
          data-testid="windows-row"
        >
          {short.map((m) => (
            <WindowRow key={m.key} metric={m} tightest={tightest} />
          ))}
        </div>
      )}
      {/* 月窗行: monthly 独占全宽(若存在);3 窗时第二行,2 窗时不出,1 窗时不出 */}
      {wide && (
        <div
          className="qcard3-windows-row qcard3-windows-row--wide"
          data-testid="windows-row-wide"
        >
          <WindowRow metric={wide} tightest={tightest} />
        </div>
      )}
    </div>
  );
}

/* ---------------- 余额制: ticker 模板(§6.3) ---------------- */

function fmtMoney(n: number): string {
  // 固定 2 位小数: 浮点尾巴(448.45000000000005)与长串都对不起来, 金额必须干净可读
  const safe = Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  return safe.toLocaleString(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 速率展示精度: 近 7 天日消耗, 两位内收敛(8.2 不显 8.2000000000001) */
function fmtRate(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString(currentLocale(), { maximumFractionDigits: 2 });
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
          {m!.granted !== undefined && <span>{t("tpl.granted", { amount: `${symbol}${fmtMoney(m!.granted!)}` })}</span>}
          {m!.topped_up !== undefined && <span>{t("tpl.toppedUp", { amount: `${symbol}${fmtMoney(m!.topped_up!)}` })}</span>}
        </div>
      )}
      <div className="ticker-sub">
        {days !== null ? (
          <>
            {t("tpl.rate7", { rate: String(fmtRate(m!.daily_rate!)) })} · <span data-testid="ticker-days">{t("tpl.eta", { days: fmtDays(days) })}</span>
          </>
        ) : (
          t("tpl.noRate")
        )}
      </div>
    </div>
  );
}

/* ---------------- 本地 Agent: local 模板(§6.5, P3 才做真实数据) ---------------- */

export function LocalTemplate({ p }: { p: ProviderSnapshot }) {
  return (
    <div className="local-template" data-testid="local-template">
      <div className="ticker-sub">{t("tpl.localUsage", { name: p.display_name })}</div>
    </div>
  );
}

/* ---------------- 注册(MVP: bars + ticker, local 占位) ---------------- */

registerTemplate({ id: "bars", planType: "window", component: BarsTemplate });
registerTemplate({ id: "ticker", planType: "balance", component: TickerTemplate });
registerTemplate({ id: "local", planType: "local", component: LocalTemplate });