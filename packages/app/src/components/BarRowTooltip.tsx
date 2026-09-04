import type { Metric } from "../types";
import { metricHealth } from "../health";
import { t } from "../i18n";
import { QuotaMeter, type QuotaState } from "./QuotaMeter";
import { displayUsed, resetText } from "./ProgressBar";

/**
 * BarRowTooltip — 窗口行悬停额度详情 tooltip(t_a398348b, micro 排版落地)。
 *
 * 用户 9/4 拍板: micro 排版(无卡竖排超紧凑: 4px 条、重置并入用量行)先落地为
 * tooltip 场景。本组件 = 通用 micro tooltip 载体: 喂与窗口行同源的单个真实 Metric,
 * 渲染四元素(标题/重置/用量/进度条)微型展示。
 *
 * 挂载契约(两条结构共用 —— 旧 ProgressBar 行 / t_23800bd4 QuotaMeter 行):
 *   挂在 `.bar-row` 壳内作为行的最后一个子元素即可; 揭示/定位/防溢出全在 app.css
 *   `.bar-tooltip`(纯 CSS .bar-row:hover, 零 JS 事件; 行内 left/right:0 横向不溢面板;
 *   模板首行向下弹出防吸顶裁剪; pointer-events:none 纯提示)。
 *   → t_23800bd4 切换行渲染器时, 只需把 <BarRowTooltip metric={m} /> 挂进新 .bar-row 壳,
 *     本组件与 CSS/测试零改(e2e bar-tooltip.spec.ts 是回归护栏)。
 *
 * 数据映射(与行同源):
 *   标题 = 窗口名本地化(metric.<key>, 未知 key 回退原样)
 *   重置 = resetText(reset_at) 派生; 无 reset_at → slot 不渲染(无空壳)
 *   条   = used/limit 比例 + metricHealth 着色(与行一致)
 *   用量 = unit 语义格式化(t_23800bd4/老大裁决#4: 补传 unit={m.unit} 与行用量格式对齐,
 *          percent → "48% / 100%"); displayUsed 预修浮点尾差保留(displayUsed+fmt1 双保险同值)
 */
export function BarRowTooltip({ metric }: { metric: Metric }) {
  const pct =
    metric.limit !== undefined && metric.limit > 0
      ? Math.min(1, Math.max(0, metric.used / metric.limit))
      : 0;
  const health = metricHealth(metric);
  // metricHealth 实际不产 unknown(limit<=0 → ok), 类型层窄化给 QuotaMeter
  const state: QuotaState = health === "unknown" ? "ok" : health;
  const metricKey = `metric.${metric.key}` as Parameters<typeof t>[0];
  const title = t(metricKey).startsWith("metric.") ? t("metric.fallback", { key: metric.key }) : t(metricKey);
  const reset = resetText(metric.reset_at);
  return (
    <div className="bar-tooltip" role="tooltip" data-testid="bar-tooltip" data-metric={metric.key}>
      <QuotaMeter
        layout="micro"
        pct={pct}
        state={state}
        title={title}
        resetText={reset || undefined}
        used={displayUsed(metric)}
        limit={metric.limit}
        unit={metric.unit}
      />
    </div>
  );
}
