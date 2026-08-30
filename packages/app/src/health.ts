import type { HealthLevel, Metric, ProviderSnapshot, ProviderStatus } from "./types";

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

/** 配额健康度文案(D-022): 仅表达配额维度, 不表达 status 原因(status 文案见 STATUS_BADGE) */
export const HEALTH_LABEL: Record<HealthLevel, string> = {
  ok: "健康",
  warn: "偏低",
  // 额度打满/耗尽(剩余 ≤10%), 不是"过期" — 耗尽只需等窗口重置, 无需重新授权
  bad: "已耗尽",
  unknown: "未知",
};

/**
 * 徽章短文案(≤4 汉字, D-005 status 一等公民) — 徽章位表达"原因", 非颜色带。
 * 唯一真相源: ProviderCard 徽章与托盘 tooltipSummary 共用, 禁止组件内散落三元。
 * - status !== "ok" → status 短文案(卡体长文案 STATUS_TEXT 不变, 两者不是一回事)
 * - status === "ok" → 才看配额健康度(HEALTH_LABEL)
 */
const STATUS_BADGE: Record<Exclude<ProviderStatus, "ok">, string> = {
  auth_expired: "待授权",
  stale: "已陈旧",
  unsupported: "未接入",
  error: "采集失败",
};

export function statusBadge(p: ProviderSnapshot): string {
  if (p.status !== "ok") return STATUS_BADGE[p.status];
  return HEALTH_LABEL[providerHealth(p)];
}

/** tooltip 摘要分组的展示顺序: 严重度降序(采集失败 > 耗尽 > 待授权 > 偏低 > 已陈旧 > 未接入 > 健康) */
const BADGE_ORDER = ["采集失败", "已耗尽", "待授权", "偏低", "已陈旧", "未接入", "健康"];

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

/** 面板排序比较器: 最坏情况优先(§6.1 glanceability 的历史默认, 现为 urgency 次级稳定键)。
 * 主键 = 健康度带(红>黄>灰>绿); 同带内二级 = status 严重度(error/auth_expired 前置);
 * 三级 = ok 态按最紧 metric 剩余比例升序(消耗多的在前)。 */
function compareByHealth(a: ProviderSnapshot, b: ProviderSnapshot): number {
  const rankDiff = HEALTH_RANK[providerHealth(b)] - HEALTH_RANK[providerHealth(a)];
  if (rankDiff !== 0) return rankDiff;
  const sevDiff = statusSeverity(b) - statusSeverity(a);
  if (sevDiff !== 0) return sevDiff;
  return minRemainingRatio(a) - minRemainingRatio(b);
}

/** 健康度排序(保留: urgency 模式的次级稳定键; 不再是面板唯一排序, 见 sortProviders) */
export function sortByHealth(providers: ProviderSnapshot[]): ProviderSnapshot[] {
  return [...providers].sort(compareByHealth);
}

// ---------------- P1(#829 R1): 卡间排序 = key(名称|紧要度) × dir(正排|倒排) 两正交参数 ----------------

export type SortKey = "name" | "urgency";
export type SortDir = "asc" | "desc";
export interface SortConfig {
  key: SortKey;
  dir: SortDir;
}
/** 缺省 = 名称正排(#829 R1 缺省不是紧要度; 无历史设置时的出厂行为) */
export const DEFAULT_SORT_CONFIG: SortConfig = { key: "name", dir: "asc" };

/**
 * 排序配置归一化: 非对象/非法 key/非法 dir → 缺省(名称正排), 不抛错。
 * 真壳 settings.json 与浏览器 localStorage 两侧共用同一宽容语义(损坏配置不崩 UI)。
 */
export function normalizeSortConfig(raw: unknown): SortConfig {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const key: SortKey | null = o.key === "name" ? "name" : o.key === "urgency" ? "urgency" : null;
    const dir: SortDir | null = o.dir === "asc" ? "asc" : o.dir === "desc" ? "desc" : null;
    if (key && dir) return { key, dir };
  }
  return DEFAULT_SORT_CONFIG;
}

/**
 * 卡间排序(#829 R1): key × dir 两正交参数。
 * - key=name: display_name localeCompare 自然序(asc 正排), 同名保持原相对顺序(排序稳定)
 * - key=urgency: 卡内 min(remaining/limit) 升序(asc = 越快耗尽越靠前);
 *   limit 缺失/为 0 的卡剩余比例视为 1(asc 时排最后, 不崩); 同比例按 sortByHealth 次序稳定(健康差在前)
 * - dir=desc 对两种 key 都是整体直接反转
 * 托盘(globalHealth/tooltipSummary)不经此函数 —— 排序配置不影响托盘全局最差状态。
 */
export function sortProviders(
  providers: ProviderSnapshot[],
  config: SortConfig = DEFAULT_SORT_CONFIG,
): ProviderSnapshot[] {
  const asc = [...providers].sort((a, b) => {
    if (config.key === "name") {
      return a.display_name.localeCompare(b.display_name, undefined, { numeric: true });
    }
    const diff = minRemainingRatio(a) - minRemainingRatio(b);
    if (diff !== 0) return diff;
    return compareByHealth(a, b);
  });
  return config.dir === "desc" ? asc.reverse() : asc;
}

/** 托盘 tooltip 摘要, 如 "1待授权 1已耗尽 2健康"(§6.2)。
 * P1 起按 statusBadge(原因)分组, 不再按颜色带分组 —— auth_expired 不再被统计成"偏低",
 * 配额耗尽显示"已耗尽"而非"过期"。 */
export function tooltipSummary(providers: ProviderSnapshot[]): string {
  if (providers.length === 0) return "token-wallet — 暂无 Provider";
  const counts = new Map<string, number>();
  for (const p of providers) {
    const label = statusBadge(p);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = BADGE_ORDER.filter((l) => counts.has(l)).map((l) => `${counts.get(l)}${l}`);
  return `token-wallet — ${parts.join(" ")}`;
}
