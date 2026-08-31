import type { Metric } from "../types";
import { metricHealth } from "../health";

/**
 * 重置倒计时文案(#829 R2): 纯倒计时, 去掉旧的动作后缀, 单单位 + 保留一位小数:
 *   ≥1天 → "X.X天"(625h41m → 26.1天)
 *   <1天 ≥1小时 → "X.X小时"(5h42m → 5.7小时; 86399s 四舍五入 → 24.0小时)
 *   <1小时 → "X分"(整数分, 四舍五入; 599s → 10分)
 * 即将重置/空文案语义不变。nowSec 可注入便于单测。
 */
export function resetText(resetAt?: number, nowSec: number = Math.floor(Date.now() / 1000)): string {
  if (!resetAt) return "";
  const s = resetAt - nowSec;
  if (s <= 0) return "即将重置";
  if (s >= 86400) return `${(s / 86400).toFixed(1)}天`;
  if (s >= 3600) return `${(s / 3600).toFixed(1)}小时`;
  return `${Math.round(s / 60)}分`;
}

/** 数字格式化: ≤1 位小数 + 去尾 .0(37.9415→"37.9", 40→"40"); 整数原样不进小数 */
function fmt1(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * 进度条压字文案(t_66b67453 契约6): percent 单位 used 走 fmt1 ——
 * alyun 适配器 0-1 小数×100 引入浮点尾差(37.941548…%原样上屏), 显示层修,
 * 数据层不动(原始 used 保留供 7 天速率计算); 非 percent 单位(48/100 计数制)不动。
 */
export function progressText(metric: Metric): string {
  if (metric.unit === "percent") {
    return `${fmt1(metric.used)}/${metric.limit ?? "—"}`;
  }
  return `${metric.used}/${metric.limit ?? "—"}`;
}

/** bars 模板微部件: 手写进度条 + 压字(D-002, 不引组件库/Chart.js)。
 * tightest: 该窗口是"最紧窗口"(bars 模板标红不置顶, §6.3)。 */
export function ProgressBar({ metric, tightest = false }: { metric: Metric; tightest?: boolean }) {
  const pct =
    metric.limit !== undefined && metric.limit > 0
      ? Math.min(100, Math.max(0, (metric.used / metric.limit) * 100))
      : 0;
  const health = metricHealth(metric);
  return (
    <div className="bar-row" data-tightest={tightest || undefined}>
      <span className="bar-label" title={metric.key}>
        {metric.key}
      </span>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-fill" data-health={health} style={{ width: `${pct}%` }} />
        <div className="progress-text">{progressText(metric)}</div>
      </div>
      <span className="bar-reset">{resetText(metric.reset_at)}</span>
    </div>
  );
}
