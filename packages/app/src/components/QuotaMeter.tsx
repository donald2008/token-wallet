/**
 * QuotaMeter — 进度条「最小组件」+ 四元素实例(t_37416b22 增容 + t_af01e265 复用)。
 *
 * 两级用法(同一组件, 按数据驱动选择):
 *   A) 纯条本体(默认): 只传 pct/state/variant → 仅渲染进度条 (+可选 aria-label)。
 *   B) 完整四元素实例(可选 slots): 另传 title/resetText/used/limit 中的任意组合 →
 *      渲染「标题 + 重置时间 + 进度条 + 用量」组成的完整四元素排版卡片。
 *      未传的 slot 不渲染 → B 用法是 A 的**纯增量**, 不破坏既有 .progress 契约。
 *
 * 排版变体(t_35ff3c1f 征集, 布局是重点): 四元素「排版」不是组件新结构, 而是同一组
 *   DOM slots 在**容器层**被 CSS 重排(gird-area / flex order)。QuotaMeter 只认
 *   layout prop → 根元素追加 .quota-meter--layout-<layout> modifier, 各排版的具体
 *   摆法全在 app.css(新增排版容器一律新 class, 不触碰 .progress 契约)。
 *   不传 layout = 默认竖排卡片(stack, 即 t_af01e265 定案的实例排版)。
 *
 * 数据契约(无状态, 纯受控):
 *   pct    : 已用比例 0-1(0%..100%), 非窗口专属。
 *   state  : 可选 ok|warn|bad —— 仅供着色; 阈值沿用 metricHealth(health.ts)。
 *   variant: 可选 slim|thick|segmented|flow —— 4 种「条」的形态, 全走 CSS modifier。
 *   layout : 可选 row|duo|hero|micro|ticker —— 5 种排版(容器层重排 slots)。
 *   title   : 可选, 额度名(数据来自 metric key 的展示名, 组件不自造文案)。
 *   resetText: 可选, 重置倒计时文案(reset_at 派生, 复用 bar-reset 同规格式化)。
 *   used/limit: 可选, 用量数值 —— 两者齐传才渲染「用量」行。
 *   unit    : 可选, 真实 Metric.unit(t_23800bd4)——用量行按单位语义格式化:
 *             percent→百分比、requests/tokens/credits→计数(带单位标签)、cny→金额;
 *             缺省保持旧契约 "used / limit (pct%)" 不动(向后兼容)。
 *
 * 过渡动画(纯 CSS, 零 JS 定时): 挂载 grow(scaleX) + 数据变化 width 渐变。
 *
 * 硬约束:
 *   - tokens.css 唯一数值来源; margin/padding/gap/border-radius 走 4/8 网格
 *   - D-016 状态色语义; dark/light/glass 三态零硬编码色
 *   - e2e DOM 契约(.progress/.progress-fill[data-health]/role=progressbar)一例不破
 */
import type { MetricUnit } from "../types";
import { t, currentLocale } from "../i18n";

export type QuotaState = "ok" | "warn" | "bad";
export type QuotaVariant = "slim" | "thick" | "segmented" | "flow";
/** 排版变体(t_35ff3c1f): 容器层重排同一组四元素 slots; 不传 = 默认竖排卡片(stack) */
export type QuotaLayout = "row" | "duo" | "hero" | "micro" | "ticker";

export interface QuotaMeterProps {
  /** 已用比例 0-1 */
  pct: number;
  /** 健康状态(着色), 缺省 ok */
  state?: QuotaState;
  /** 形态(粗细/圆角/质感/动效), 缺省 slim */
  variant?: QuotaVariant;
  /** 排版(容器层 slots 摆法), 缺省默认竖排卡片 */
  layout?: QuotaLayout;
  /** 可选 aria-label(via prop 传入; 组件不自造文案) */
  label?: string;
  /** 可选: 标题(四元素实例 slot) */
  title?: string;
  /** 可选: 重置时间文案(四元素实例 slot, reset_at 派生) */
  resetText?: string;
  /** 可选: 用量分子; 与 limit 齐传才渲染用量行 */
  used?: number;
  /** 可选: 用量分母 */
  limit?: number;
  /** 可选: 真实 Metric.unit(t_23800bd4)——用量行按单位语义格式化, 缺省走旧契约 */
  unit?: MetricUnit;
}

/** 归一: 数值钳到 [0,1], 任意非法值(Infinity/NaN/负/超界)都收敛为合法比例 */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(1, Math.max(0, pct));
}

/* ---- 格式化助手(t_23800bd4) ----
 * 注: resetText(重置倒计时)仍在 ./ProgressBar(t_a398348b 兄弟卡正活跃改该文件,
 * 避免双卡互踩); 窗口行由 registry 从 ProgressBar 导入 resetText 喂本组件 prop。 */

/** 数字格式化: ≤1 位小数 + 去尾 .0(37.9415→"37.9", 40→"40"); 整数原样不进小数 */
function fmt1(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 金额格式化(与 ticker 模板同规): 固定 2 位小数, 浮点尾巴不上屏 */
function fmtMoney(n: number): string {
  const safe = Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  return safe.toLocaleString(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 用量行文案。单位语义(t_23800bd4, 跟真实 Metric.unit, 禁止硬编码单位词):
 *   percent                    → "37.9% / 100%"(fmt1 修浮点尾差, 数据层原始值不动)
 *   requests/tokens/credits    → "2300 / 10000 credits (23%)"(单位标签走 i18n unit.*)
 *   cny                        → "¥48.14 / ¥500.00"
 *   缺省(未传 unit)            → "used / limit (pct%)"(旧契约不变, 向后兼容)
 */
export function usageText(used: number, limit: number, unit?: MetricUnit): string {
  const pct = Math.round(clampPct(limit > 0 ? used / limit : 0) * 100);
  switch (unit) {
    case "percent":
      return `${fmt1(used)}% / ${fmt1(limit)}%`;
    case "requests":
    case "tokens":
    case "credits":
      return `${fmt1(used)} / ${fmt1(limit)} ${t(`unit.${unit}`)} (${pct}%)`;
    case "cny":
      return `¥${fmtMoney(used)} / ¥${fmtMoney(limit)}`;
    default:
      return `${used} / ${limit} (${pct}%)`;
  }
}

export function QuotaMeter({
  pct,
  state = "ok",
  variant = "slim",
  layout,
  label,
  title,
  resetText,
  used,
  limit,
  unit,
}: QuotaMeterProps) {
  const target = Math.round(clampPct(pct) * 100);
  // 四元素实例: 任意扩展 slot 出现即进入完整排版模式(纯增量, 不影响条契约)
  const hasMeta = title !== undefined || resetText !== undefined || (used !== undefined && limit !== undefined);
  // 排版变体 = 容器层 modifier(layout 只在完整实例下有意义; 裸条不挂排版类)
  const layoutMod = hasMeta && layout ? ` quota-meter--layout-${layout}` : "";
  return (
    <div
      className={`quota-meter quota-meter--${variant}${hasMeta ? " quota-meter--instance" : ""}${layoutMod}`}
      data-testid="quota-meter"
      data-variant={variant}
      data-layout={layout ?? "stack"}
    >
      {title !== undefined && <div className="quota-title">{title}</div>}
      {resetText !== undefined && <div className="quota-reset">{resetText}</div>}
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={Math.round(target)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="progress-fill" data-health={state} style={{ width: `${target}%` }} />
      </div>
      {used !== undefined && limit !== undefined && (
        // micro 排版全局只显百分比(用户 9/7 拍板, t_f7d1beeb):
        // 长文案(960/1200 次 (80%) / 80% / 100%)在 ~144px 双列(P5)与 ~360px 主页窗口行
        // 都触撞字; 短文本 "NN%" 单 token + nowrap 自然装下, Reset 行仍在右侧
        layout === "micro" ? (
          <div className="quota-usage">{target}%</div>
        ) : (
          <div className="quota-usage">{usageText(used, limit, unit)}</div>
        )
      )}
    </div>
  );
}