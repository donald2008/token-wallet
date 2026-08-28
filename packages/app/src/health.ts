import type { HealthLevel, Metric, ProviderSnapshot } from "./types";

/** 阈值默认值(D-022): 黄线 30% / 红线 10%(剩余百分比), P0 后续卡片入全局设置 */
export const WARN_THRESHOLD = 0.3;
export const BAD_THRESHOLD = 0.1;

/** 健康度排序权重: 红 > 黄 > 灰 > 绿(托盘色点 = 全局最差状态) */
export const HEALTH_RANK: Record<HealthLevel, number> = {
  bad: 3,
  warn: 2,
  unknown: 1,
  ok: 0,
};

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  ok: "健康",
  warn: "偏低",
  bad: "过期",
  unknown: "未知",
};

/** 单条 metric 健康度(剩余百分比 vs 阈值) */
export function metricHealth(m: Metric): HealthLevel {
  if (m.limit === undefined || m.limit <= 0) return "ok";
  const remaining = 1 - m.used / m.limit;
  if (remaining <= BAD_THRESHOLD) return "bad";
  if (remaining <= WARN_THRESHOLD) return "warn";
  return "ok";
}

/** provider 级健康度: status 一等公民优先, ok 才看 metrics */
export function providerHealth(p: ProviderSnapshot): HealthLevel {
  switch (p.status) {
    // auth_expired / error 恒红, 不走阈值(D-022)
    case "auth_expired":
    case "error":
      return "bad";
    case "stale":
    case "unsupported":
      return "unknown";
    case "ok": {
      let worst: HealthLevel = "ok";
      for (const m of p.metrics) {
        const h = metricHealth(m);
        if (HEALTH_RANK[h] > HEALTH_RANK[worst]) worst = h;
      }
      return worst;
    }
  }
}

/** 全局最差状态(托盘色点) */
export function globalHealth(providers: ProviderSnapshot[]): HealthLevel {
  let worst: HealthLevel = "ok";
  for (const p of providers) {
    const h = providerHealth(p);
    if (HEALTH_RANK[h] > HEALTH_RANK[worst]) worst = h;
  }
  return worst;
}

/** 面板排序: 最坏情况优先(§6.1 glanceability) */
export function sortByHealth(providers: ProviderSnapshot[]): ProviderSnapshot[] {
  return [...providers].sort(
    (a, b) => HEALTH_RANK[providerHealth(b)] - HEALTH_RANK[providerHealth(a)],
  );
}

/** 托盘 tooltip 摘要, 如 "2健康 1偏低 1过期"(§6.2) */
export function tooltipSummary(providers: ProviderSnapshot[]): string {
  if (providers.length === 0) return "token-wallet — 暂无 Provider";
  const counts: Record<HealthLevel, number> = { ok: 0, warn: 0, bad: 0, unknown: 0 };
  for (const p of providers) counts[providerHealth(p)] += 1;
  const parts = (Object.keys(counts) as HealthLevel[])
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]}${HEALTH_LABEL[k]}`);
  return `token-wallet — ${parts.join(" ")}`;
}
