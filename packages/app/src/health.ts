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

/** provider 级健康度: status 一等公民优先, ok 才看 metrics.
 * 注意: SPEC 冲突已在任务卡 P0-3 验收优先级下裁决 —— DESIGN.md §9 谓 auth_expired 恒红,
 * 但 §2.1 与 P0-3 验收明确"auth_expired 亮黄灯"(登录态失效不是配额耗尽, 属待处理告警)。
 * → auth_expired 定黄(warn), error/耗尽 恒红。 */
export function providerHealth(p: ProviderSnapshot): HealthLevel {
  switch (p.status) {
    // error / 额度耗尽(metrics 全满)恒红, 不走阈值(D-022)
    case "error":
      return "bad";
    // auth_expired: 登录态失效 → 黄灯(§2.1 + P0-3 验收; 非配额耗尽)
    case "auth_expired":
      return "warn";
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

/** 非 ok 状态严重度(仅在同一健康度带内作二级比较): error > auth_expired > stale/unsupported > ok */
function statusSeverity(p: ProviderSnapshot): number {
  switch (p.status) {
    case "error":
      return 4;
    case "auth_expired":
      return 3;
    case "unsupported":
      return 2;
    case "stale":
      return 2;
    case "ok":
      return 1;
  }
}

/** ok 态最坏 metric 的剩余比例(0~1), 越接近 0 越紧 */
function minRemainingRatio(p: ProviderSnapshot): number {
  let worst = 1;
  for (const m of p.metrics) {
    if (m.limit !== undefined && m.limit > 0) {
      const remaining = Math.max(0, 1 - m.used / m.limit);
      if (remaining < worst) worst = remaining;
    }
  }
  return worst;
}

/** 面板排序(§6.1 glanceability): 最坏情况优先。
 * 主键 = 健康度带(红>黄>灰>绿); 同带内二级 = status 严重度(error/auth_expired 前置);
 * 三级 = ok 态按最紧 metric 剩余比例升序(消耗多的在前)。 */
export function sortByHealth(providers: ProviderSnapshot[]): ProviderSnapshot[] {
  return [...providers].sort((a, b) => {
    const rankDiff = HEALTH_RANK[providerHealth(b)] - HEALTH_RANK[providerHealth(a)];
    if (rankDiff !== 0) return rankDiff;
    const sevDiff = statusSeverity(b) - statusSeverity(a);
    if (sevDiff !== 0) return sevDiff;
    return minRemainingRatio(a) - minRemainingRatio(b);
  });
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
