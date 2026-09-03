/**
 * QuotaMeter — 进度条「最小组件」(t_37416b22, feat/theme-glass)。
 *
 * 范围只到**进度条本体**: 条 + 填充 + 状态色 + 过渡动画。
 * 明确不含(外层组装责任, 本组件不设计不承载): 窗口名 / 用量数字 / 倒计时文案 / 操作按钮。
 *
 * 数据契约(无状态, 纯受控):
 *   pct   : 已用比例 0-1(0%..100%), 非窗口专属 —— 周窗/5 小时窗/月窗共用同一组件。
 *   state : 可选, ok | warn | bad —— 仅供着色; 阈值沿用 metricHealth(health.ts) 语义不重造。
 *   variant: 可选, slim | thick | segmented | flow —— 4 种「条」的形态差异化(粗细/圆角/质感/动效),
 *            全部走 CSS modifier 类, 不改变 DOM 契约(.progress/.progress-fill[data-health])。
 *
 * 过渡动画(纯 CSS, 零 JS 定时, L1 确定性):
 *   - 挂载生长: .quota-meter .progress-fill 的 `quota-grow`(scaleX 0→1, transform-origin left)
 *   - 数据变化: .progress-fill 既有 `transition: width`(token 时长) 平滑渐变
 *
 * 硬约束(契约, 方案文档同源):
 *   - tokens.css 唯一数值来源; margin/padding/gap/border-radius 走 4/8 网格
 *   - D-016 状态色语义: 着色走既有 .progress-fill[data-health] 规则的 --ok/--warn/--bad/--unknown
 *   - dark/light/glass 三态: 组件零硬编码色, 全部吃语义 token(glass 复用同套语义色), 天然三态自适应
 *   - a11y: role=progressbar + aria-valuenow(0-100)
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
}

/** 归一: 数值钳到 [0,1], 任意非法值(Infinity/NaN/负/超界)都收敛为合法比例 */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(1, Math.max(0, pct));
}

export function QuotaMeter({ pct, state = "ok", variant = "slim", label }: QuotaMeterProps) {
  const target = clampPct(pct) * 100;
  return (
    <div className={`quota-meter quota-meter--${variant}`} data-testid="quota-meter" data-variant={variant}>
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
    </div>
  );
}