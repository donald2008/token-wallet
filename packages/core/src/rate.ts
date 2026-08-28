/**
 * 余额制速率计算 — DESIGN.md §2 原型表: "余额大数字 + 按近 7 天速率的预计可用天数"
 *
 * 输入: 某 provider 的历史快照(升/降序均可, 内部排序)。
 * 输出: 近 7 天平均日消耗(daily_rate) + 预计可用天数。
 * 数据不足(无历史/无余额指标)返回 null, 面板显示"待积累数据"而非假数字。
 */
import type { ProviderSnapshot } from "./schema.js";

const DAY = 86_400;

/** 从快照取余额指标(首个 kind=balance 的 metric) */
export function balanceMetricOf(snap: ProviderSnapshot) {
  return snap.metrics.find((m) => m.kind === "balance");
}

/** 余额制快照的"当前剩余": remaining 优先, 否则 limit-used(旧语义兼容) */
export function remainingOf(snap: ProviderSnapshot): number | null {
  const m = balanceMetricOf(snap);
  if (!m) return null;
  if (m.remaining !== undefined) return m.remaining;
  if (m.limit !== undefined) return m.limit - m.used;
  return null;
}

/** 近 7 天平均日消耗; 不足 2 条余额快照或窗口 < 1 天返回 null */
export function dailyRateFromHistory(
  history: ProviderSnapshot[],
  now: number = Math.floor(Date.now() / 1000),
): number | null {
  const weekAgo = now - 7 * DAY;
  const points = history
    .filter((s) => s.status === "ok")
    .filter((s) => s.fetched_at >= weekAgo && s.fetched_at <= now)
    .map((s) => ({ at: s.fetched_at, remaining: remainingOf(s) }))
    .filter((p): p is { at: number; remaining: number } => p.remaining !== null)
    .sort((a, b) => a.at - b.at);

  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const days = (last.at - first.at) / DAY;
  if (days < 1) return null;
  // 余额下降 = 消耗; 上升(充值)按 0 计(避免负速率)
  const consumed = Math.max(0, first.remaining - last.remaining);
  return consumed / days;
}

/** 预计可用天数 = 当前剩余 / 日速率; 速率缺失返回 null */
export function estimatedDays(
  remaining: number | null | undefined,
  dailyRate: number | null | undefined,
): number | null {
  if (remaining === null || remaining === undefined || remaining <= 0) return 0;
  if (dailyRate === null || dailyRate === undefined || dailyRate <= 0) return null;
  return remaining / dailyRate;
}
