/**
 * 置顶用量组件 AgentUsageHero(t_56c66972 local-agent-redesign ②, 方案 A-rev3):
 *
 * 形态唯一依据 = docs/requests/2026-09-24-local-agent-redesign/plan-a-v3.html
 * 「正常态 + 四边界态」逐字对稿:
 *   行0: 「近 5 小时」标签(左) + 「用量大屏 →」钮(右) —— 大屏入口全局唯一(卡内已移除)
 *   行1: 全局总 tokens 大数字 (28px) + 单位
 *   52px 折线(手绘 SVG, 离线无 CDN 依赖, 色走 --chart-1) + 时间轴 -5h…now
 *
 * 数据面(两个独立失败域, 卡体明示):
 *  - 大数字 = 主 summary(单维 agent)的**全局行** total —— 「全部 agent 聚合」, 与卡片列表同源。
 *  - 折线   = usage_summary({group_by:["hour"], since: now-5h}) 的桶序列(row.group = 本地时区
 *             "YYYY-MM-DDTHH:00", 协议 §2.2 hour 维语义, v1.1 增补)。
 *    hour 查询失败 → **只**降级折线区(「数据积累中」), 大数字不受牵动(卡体明示的降级边界)。
 *
 * 四边界态(mock 边界区):
 *  ② 全局零数据   → 大数字 0(暗色) + 虚线基线 + 引导句
 *  ④ 不足窗口(<1h)→ 断线绘制自首数据点(**禁零值平线**) + 首点标记 + 轴首点星标
 *                    + 「首次上报 N 分钟前 — 曲线自首条数据起绘制」
 *  折线降级       → 「数据积累中」
 */
import type { ReactNode } from "react";
import { formatTokens } from "./AgentCard";

const HOUR_MS = 3_600_000;
const VIEW_W = 320;
const VIEW_H = 52;
const PAD_TOP = 6;
const PAD_BOTTOM = 6;
/** 「不足窗口」判据(mock 边界④ 标题「数据不足窗口(<1h)」): 首数据点距窗口终点 < 60min */
const MIN_WINDOW_MS = HOUR_MS;

/** 时间轴标签: 由窗口 since/until 生成真实时钟刻度(本地时区) —
 *  9/24 老大裁定: 「-5h」式相对标注不专业, 改真实时钟。
 *  对齐与密度规则(360px 窄轴实测: 全 HH:mm 11 枚 297px 装得下但间隙仅 4px 偏密):
 *    - 刻度锚定整点/半点, 30min 步进
 *    - 整点 = 「HH:00」major(高亮); 半点 = 「:30」短标(省小时段, 钟面习惯)
 *    - 末刻度恒为窗口终点 until(=「now」, 可能是 :34 这类非整点, 如实显示)
 *  e2e 确定性来自 window 由 daemon 回显(非客户端时钟)。 */
export function buildHeroAxisLabels(windowSince: string, windowUntil: string): HeroAxisLabel[] {
  const sinceMs = Date.parse(windowSince);
  const untilMs = Date.parse(windowUntil);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
    return [];
  }
  const HALF_HOUR = 30 * 60 * 1000;
  const fmtHM = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtH = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false });
  const first = Math.ceil(sinceMs / HALF_HOUR) * HALF_HOUR;
  const labels: HeroAxisLabel[] = [];
  for (let t = first; t < untilMs; t += HALF_HOUR) {
    const d = new Date(t);
    const onHour = d.getMinutes() === 0;
    labels.push({
      text: onHour ? `${fmtH.format(d)}:00` : ":30",
      major: onHour,
      fullText: fmtHM.format(d),
    });
  }
  const untilDate = new Date(untilMs);
  const untilOnHour = untilDate.getMinutes() === 0;
  labels.push({
    text: untilOnHour ? `${fmtH.format(untilDate)}:00` : fmtHM.format(untilDate),
    major: untilOnHour,
    fullText: fmtHM.format(untilDate),
  }); // 末刻度 = now(撞整点则保留 major 语义)
  return labels;
}

export interface HeroAxisLabel {
  /** 轴上显示文本(半点为 「:30」 短标) */
  text: string;
  /** 整点刻度(高亮); 半点短标与 now 为 false */
  major: boolean;
  /** 完整时刻 HH:mm(星标语境用 — 半点短标 :30 的 fullText = 10:30) */
  fullText: string;
}

/** hour 维桶(hour = row.group, 本地时区 "YYYY-MM-DDTHH:00") */
export interface HourBucket {
  hour: string;
  tokens: number;
}

export interface HeroPoint {
  x: number;
  y: number;
  tokens: number;
}

export interface HeroSeries {
  points: HeroPoint[];
  /** 首数据点落在哪根刻度(仅不足窗口时有意义), null = 不标星 */
  firstTickIndex: number | null;
  /** 首数据点距窗口终点(≈now)的分钟数 */
  minutesSinceFirstReport: number;
  /** 不足窗口(首小时 <1h 数据) */
  insufficientWindow: boolean;
}

function parseMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
}

/**
 * 桶序列 → 折线点(纯函数, 可单测)。
 * 规则: 桶按 hour 升序; tokens <= 0 的桶不落点(禁零值平线); 横坐标按 daemon 回显的
 * window.since/until 换算刻度(不依赖客户端时钟 → e2e 确定性); 纵坐标按桶内峰值归一。
 */
export function buildHeroSeries(
  buckets: HourBucket[],
  windowSince: string,
  windowUntil: string,
): HeroSeries {
  const sinceMs = parseMs(windowSince);
  const untilMs = parseMs(windowUntil);
  const rows = buckets
    .map((b) => ({ ms: parseMs(b.hour), tokens: b.tokens }))
    .filter((r) => Number.isFinite(r.ms) && r.tokens > 0)
    .sort((a, b) => a.ms - b.ms);

  if (rows.length === 0) {
    return { points: [], firstTickIndex: null, minutesSinceFirstReport: 0, insufficientWindow: false };
  }

  const span = Number.isFinite(sinceMs) && Number.isFinite(untilMs) && untilMs > sinceMs
    ? untilMs - sinceMs
    : 5 * HOUR_MS;
  const max = rows.reduce((m, r) => Math.max(m, r.tokens), 0);
  const usable = VIEW_H - PAD_TOP - PAD_BOTTOM;

  const points: HeroPoint[] = rows.map((r) => {
    const ratio = Number.isFinite(sinceMs) ? (r.ms - sinceMs) / span : 1;
    const clamped = Math.min(1, Math.max(0, ratio));
    return {
      x: clamped * VIEW_W,
      y: VIEW_H - PAD_BOTTOM - (max > 0 ? (r.tokens / max) * usable : 0),
      tokens: r.tokens,
    };
  });

  const firstMs = rows[0]!.ms;
  // 「首次上报 N 分钟前」用 floor(宁可少报不满 1 分钟的部分, 不夸大)
  const minutesSinceFirstReport = Number.isFinite(untilMs)
    ? Math.max(1, Math.floor((untilMs - firstMs) / 60_000))
    : 0;
  const insufficientWindow =
    Number.isFinite(untilMs) && untilMs - firstMs < MIN_WINDOW_MS;

  return {
    points,
    firstTickIndex: null,
    minutesSinceFirstReport,
    insufficientWindow,
  };
}

export interface AgentUsageHeroProps {
  /** 全局行(全部 agent 聚合) tokens —— 主 summary total 的三分项之和 */
  globalTotalTokens: number;
  /** hour 维桶序列(折线数据面) */
  hourBuckets: HourBucket[];
  /** hour 查询是否可用(false → 折线区「数据积累中」降级, 大数字不受影响) */
  hourAvailable: boolean;
  /** 5h 窗起点(daemon 回显 window.since) */
  windowSince: string;
  /** 5h 窗终点(daemon 回显 window.until, 视作「now」) */
  windowUntil: string;
  /** 全局零数据(边界②: 列表零行且全局行 tokens = 0) */
  emptyPage: boolean;
  /** 大屏入口(全局唯一) */
  onOpenDashboard: () => void;
}

export function AgentUsageHero({
  globalTotalTokens,
  hourBuckets,
  hourAvailable,
  windowSince,
  windowUntil,
  emptyPage,
  onOpenDashboard,
}: AgentUsageHeroProps): ReactNode {
  const series = buildHeroSeries(hourBuckets, windowSince, windowUntil);
  const axisLabels = buildHeroAxisLabels(windowSince, windowUntil);
  const zeroState = emptyPage || series.points.length === 0;
  const degrade = !emptyPage && !hourAvailable;
  const drawChart = !zeroState && !degrade;
  // 边界④: 首数据点刻度定位 — 首点时刻之后最近的一根刻度(半点系时间坐标)
  const firstPointMs = hourBuckets.length
    ? Date.parse(hourBuckets[0]!.hour)
    : Number.NaN;
  const HALF_HOUR = 30 * 60 * 1000;
  let fromTick: number | null = null;
  if (series.insufficientWindow && Number.isFinite(firstPointMs)) {
    // 刻度时刻数组: 末刻度=until, 其余=firstAligned + i*30min(buildHeroAxisLabels 同源)
    const firstAligned = Math.ceil(Date.parse(windowSince) / HALF_HOUR) * HALF_HOUR;
    const tickTimes = axisLabels.map((_, i) =>
      i === axisLabels.length - 1 ? Date.parse(windowUntil) : firstAligned + i * HALF_HOUR,
    );
    fromTick = tickTimes.findIndex((t) => t >= firstPointMs);
    if (fromTick === -1) fromTick = null;
  }

  const linePath = series.points.length >= 2
    ? series.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")
    : "";
  const areaPath = series.points.length >= 2
    ? `${linePath} L${series.points[series.points.length - 1]!.x},${VIEW_H} L${series.points[0]!.x},${VIEW_H} Z`
    : "";
  const first = series.points[0];
  const last = series.points[series.points.length - 1];

  // 引导句(mock 边界②③④ 逐字)
  let hint: string | null = null;
  if (emptyPage) {
    hint = "暂无上报数据 — agent 完成首次调用并接入上报后，这里会出现用量曲线。";
  } else if (drawChart && series.insufficientWindow) {
    hint = `首次上报 ${series.minutesSinceFirstReport} 分钟前 — 曲线自首条数据起绘制`;
  }

  return (
    <section className="agent-usage-hero" data-testid="agent-usage-hero">
      {/* 行0: 窗口标签(左) + 大屏入口(右, 全局唯一) */}
      <div className="hero-row0">
        <span className="hero-label" data-testid="hero-window-label">
          近 5 小时
        </span>
        <button
          type="button"
          className="hero-dash-btn"
          data-testid="hero-dashboard-btn"
          onClick={onOpenDashboard}
          aria-label="打开用量大屏"
          title="打开用量大屏"
        >
          用量大屏 →
        </button>
      </div>

      {/* 行1: 全局总 tokens 大数字 + 单位(边界② → 0 且暗色) */}
      <div className="hero-num-row">
        <span
          className={`hero-num${emptyPage ? " is-empty" : ""}`}
          data-testid="hero-total-tokens"
          title={`${globalTotalTokens.toLocaleString("en-US")} tokens`}
        >
          {formatTokens(globalTotalTokens)}
        </span>
        <span className="hero-unit">tokens</span>
      </div>

      {/* 折线区: 正常态 / 边界② 虚线基线 / 边界④ 断线 + 首点标记 / hour 降级 */}
      {degrade ? (
        <div className="hero-chart-degrade" data-testid="hero-chart-degrade">
          数据积累中
        </div>
      ) : (
        <svg
          className="hero-chart"
          data-testid="hero-chart"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="近 5 小时用量趋势"
        >
          <defs>
            <linearGradient id="hero-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.35 }} />
              <stop offset="1" style={{ stopColor: "var(--chart-1)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {!drawChart ? (
            /* 边界②: 零数据 → 虚线基线(不画零值平线) */
            <line
              data-testid="hero-baseline"
              x1="0"
              y1={VIEW_H - 2}
              x2={VIEW_W}
              y2={VIEW_H - 2}
              strokeDasharray="3 3"
              style={{ stroke: "var(--border)" }}
              strokeWidth="1"
            />
          ) : (
            <>
              {areaPath && (
                <path data-testid="hero-area" d={areaPath} fill="url(#hero-area-grad)" stroke="none" />
              )}
              {linePath && (
                <path
                  data-testid="hero-line"
                  d={linePath}
                  fill="none"
                  style={{ stroke: "var(--chart-1)" }}
                  strokeWidth="1.5"
                />
              )}
              {/* 边界④ 首点标记(断线自首数据点起画的锚点) */}
              {series.insufficientWindow && first && (
                <circle
                  data-testid="hero-point-first"
                  cx={first.x}
                  cy={first.y}
                  r="2.5"
                  style={{ fill: "var(--chart-1)" }}
                />
              )}
              {last && (
                <circle
                  data-testid="hero-point-last"
                  cx={last.x}
                  cy={last.y}
                  r="2.5"
                  style={{ fill: "var(--chart-1)" }}
                />
              )}
            </>
          )}
        </svg>
      )}

      {/* 时间轴(真实时钟刻度: 整点 HH:00 major / 半点 :30 短标 / 末刻度=now; 首数据点星标) */}
      <div className="hero-axis" data-testid="hero-axis">
        {axisLabels.map((label, i) => (
          <span
            key={`${label.text}-${i}`}
            className={`${label.major ? "is-major" : "is-minor"}${fromTick === i ? " is-first" : ""}`}
            data-testid={fromTick === i ? "hero-axis-first" : "hero-axis-tick"}
          >
            {fromTick === i ? `${label.fullText}*` : label.text}
          </span>
        ))}
      </div>

      {hint && (
        <p className="hero-hint" data-testid="hero-hint">
          {hint}
        </p>
      )}
    </section>
  );
}
