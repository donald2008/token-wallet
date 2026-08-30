import type { Metric } from "../types";
import { metricHealth } from "../health";

/**
 * 重置倒计时文案(P1 真机验收契约): 纯倒计时, 去掉旧的动作后缀。
 * 阶梯(整除取余, 不截断精度, 禁出现"26天1小时60分"):
 *   ≥1天 → "X天X小时"(625h41m → 26天1小时)
 *   ≥1小时 → "X小时X分"(5小时42分)
 *   <1小时 → "X分"
 * 即将重置/空文案语义不变。nowSec 可注入便于单测。
 */
export function resetText(resetAt?: number, nowSec: number = Math.floor(Date.now() / 1000)): string {
  if (!resetAt) return "";
  const s = resetAt - nowSec;
  if (s <= 0) return "即将重置";
  const day = Math.floor(s / 86400);
  const hour = Math.floor((s % 86400) / 3600);
  const min = Math.floor((s % 3600) / 60);
  if (day > 0) return `${day}天${hour}小时`;
  if (hour > 0) return `${hour}小时${min}分`;
  return `${min}分`;
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
        <div className="progress-text">
          {metric.used}/{metric.limit ?? "—"}
        </div>
      </div>
      <span className="bar-reset">{resetText(metric.reset_at)}</span>
    </div>
  );
}
