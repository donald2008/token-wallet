import type { Metric } from "../types";
import { metricHealth } from "../health";

function resetText(resetAt?: number): string {
  if (!resetAt) return "";
  const s = resetAt - Math.floor(Date.now() / 1000);
  if (s <= 0) return "即将重置";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h${m}m 后重置` : `${m}m 后重置`;
}

/** bars 模板微部件: 手写进度条 + 压字(D-002, 不引组件库/Chart.js)。
 * tightest: 该窗口是"最紧窗口"(bars 模板置顶标红, §6.3)。 */
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
