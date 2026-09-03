/**
 * QuotaMeter — 进度条「最小组件」+ 四元素实例(t_37416b22 增容 + t_af01e265 复用)。
 *
 * 两级用法(同一组件, 按数据驱动选择):
 *   A) 纯条本体(默认): 只传 pct/state/variant → 仅渲染进度条 (+可选 aria-label)。
 *   B) 完整四元素实例(可选 slots): 另传 title/resetText/used/limit 中的任意组合 →
 *      渲染「标题 + 重置时间 + 进度条 + 用量」组成的完整四元素排版卡片。
 *      未传的 slot 不渲染 → B 用法是 A 的**纯增量**, 不破坏既有 .progress 契约。
 *
 * 数据契约(无状态, 纯受控):
 *   pct    : 已用比例 0-1(0%..100%), 非窗口专属。
 *   state  : 可选 ok|warn|bad —— 仅供着色; 阈值沿用 metricHealth(health.ts)。
 *   variant: 可选 slim|thick|segmented|flow —— 4 种「条」的形态, 全走 CSS modifier。
 *   title   : 可选, 额度名(数据来自 metric key 的展示名, 组件不自造文案)。
 *   resetText: 可选, 重置倒计时文案(reset_at 派生, 复用 bar-reset 同规格式化)。
 *   used/limit: 可选, 用量数值 —— 两者齐传才渲染「用量」行。
 *
 * 过渡动画(纯 CSS, 零 JS 定时): 挂载 grow(scaleX) + 数据变化 width 渐变。
 *
 * 硬约束:
 *   - tokens.css 唯一数值来源; margin/padding/gap/border-radius 走 4/8 网格
 *   - D-016 状态色语义; dark/light/glass 三态零硬编码色
 *   - e2e DOM 契约(.progress/.progress-fill[data-health]/role=progressbar)一例不破
 */
export type QuotaState = "ok" | "warn" | "bad";
export type QuotaVariant = "slim" | "thick" | "segmented" | "flow";

export interface QuotaMeterProps {
  /** 已用比例 0-1 */
  pct: number;
  /** 健康状态(着色), 缺省 ok */
  state?: QuotaState;
  /** 形态(粗细/圆角/质感/动效), 缺省 slim */
  variant?: QuotaVariant;
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
}

/** 归一: 数值钳到 [0,1], 任意非法值(Infinity/NaN/负/超界)都收敛为合法比例 */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(1, Math.max(0, pct));
}

/** 用量行文案: `91 / 100 (91%)`, 纯展示(render 层派生, 非组件自造) */
export function usageText(used: number, limit: number): string {
  const pct = Math.round(clampPct(limit > 0 ? used / limit : 0) * 100);
  return `${used} / ${limit} (${pct}%)`;
}

export function QuotaMeter({
  pct,
  state = "ok",
  variant = "slim",
  label,
  title,
  resetText,
  used,
  limit,
}: QuotaMeterProps) {
  const target = Math.round(clampPct(pct) * 100);
  // 四元素实例: 任意扩展 slot 出现即进入完整排版模式(纯增量, 不影响条契约)
  const hasMeta = title !== undefined || resetText !== undefined || (used !== undefined && limit !== undefined);
  return (
    <div
      className={`quota-meter quota-meter--${variant}${hasMeta ? " quota-meter--instance" : ""}`}
      data-testid="quota-meter"
      data-variant={variant}
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
        <div className="quota-usage">{usageText(used, limit)}</div>
      )}
    </div>
  );
}