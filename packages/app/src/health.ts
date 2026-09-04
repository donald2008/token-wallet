import type { HealthLevel, Metric, ProviderSnapshot, ProviderStatus } from "./types";
import { t, tKey } from "./i18n";
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

/** 配额健康度文案键(D-022): 仅表达配额维度, 不表达 status 原因(原因文案见 statusBadge);
 * 值为 i18n 键, 渲染时经 t() 按当前语言取文案(D-047 前 zh 文案原样) */
export const HEALTH_LABEL: Record<HealthLevel, string> = {
  ok: "badge.ok",
  warn: "badge.warn",
  // 额度打满/耗尽(剩余 ≤10%), 不是"过期" — 耗尽只需等窗口重置, 无需重新授权
  bad: "badge.exhausted",
  unknown: "badge.unknown",
};

/** 健康度文案(渲染用): t(HEALTH_LABEL[h]) 的便捷封装 */
export function healthLabel(h: HealthLevel): string {
  return t(HEALTH_LABEL[h] as Parameters<typeof t>[0]);
}

/**
 * 徽章短文案(≤4 汉字, D-005 status 一等公民) — 徽章位表达"原因", 非颜色带。
 * 唯一真相源: ProviderCard 徽章与托盘 tooltipSummary 共用, 禁止组件内散落三元。
 * - status !== "ok" → status 短文案(卡体长文案 STATUS_TEXT 不变, 两者不是一回事)
 * - status === "ok" → 才看配额健康度(HEALTH_LABEL)
 */
const STATUS_BADGE: Record<Exclude<ProviderStatus, "ok">, string> = {
  auth_expired: "badge.auth_expired",
  stale: "badge.stale",
  unsupported: "badge.unsupported",
  error: "badge.error",
};

export function statusBadge(p: ProviderSnapshot): string {
  if (p.status !== "ok") return t(STATUS_BADGE[p.status] as Parameters<typeof t>[0]);
  const h = providerHealth(p);
  // 耗尽分级(t_05271be0): bad 带内按 metric 级判定取最差级拆文案 ——
  // 任一窗口 remaining==0(used>=limit) → 「已耗尽」; 否则(0<remaining≤10%) → 「即将耗尽」。
  // 颜色语义不动: 两级同属 bad 红(D-022), metricHealth 阈值判定不改。
  if (h === "bad") return hasExhaustedMetric(p) ? healthLabel("bad") : t("badge.exhausting");
  return healthLabel(h);
}

/** metric 级耗尽判定: 任一窗口额度打满(used>=limit, remaining==0) */
function hasExhaustedMetric(p: ProviderSnapshot): boolean {
  return p.metrics.some((m) => m.limit !== undefined && m.limit > 0 && m.used >= m.limit);
}

/** tooltip 摘要分组的展示顺序: 严重度降序(采集失败 > 已耗尽 > 即将耗尽 > 待授权 > 偏低 > 已陈旧 > 未接入 > 健康)
 * 值为 i18n 键(tooltipSummary 渲染时按当前语言取文案) */
const BADGE_ORDER = [
  "badge.error",
  "badge.exhausted",
  "badge.exhausting",
  "badge.auth_expired",
  "badge.warn",
  "badge.stale",
  "badge.unsupported",
  "badge.ok",
];

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

// ---------------- 卡间排序 = 只留手动(t_d086543b 用户拍板 2026-09-04) ----------------
// 历史: #829 R1 key(名称|紧要度|手动)×dir 两正交 → 本卡收敛为仅 manual(拖拽排序)。
// 名称/紧要度自动排序与其 UI 控件已移除; 旧持久化配置读取时归一化为 manual(order 保留)。

export type SortKey = "manual";
export type SortDir = "asc";
export interface SortConfig {
  key: SortKey;
  dir: SortDir;
  /**
   * 手动排序顺序(providerId 数组, D-039): 仅 key=manual 时生效。
   * order 永远是**附加信息**, 当前实例集合才是真相源 ——
   * 排序时按实例集合做交集, 不因 order 过期/幽灵 id 丢卡(见 sortProviders)。
   * 非 manual 模式下 order 仍保留在内存与盘上(切换回 manual 可恢复自定义顺序)。
   */
  order?: string[];
}
/** 缺省 = 手动(t_d086543b: 排序只留手动; 无 order 时尾部按名称正排, 与旧缺省视觉一致) */
export const DEFAULT_SORT_CONFIG: SortConfig = { key: "manual", dir: "asc" };

/** 从未知值提取合法的 order 数组(非数组/含非字符串 → 过滤; 空/非法 → undefined) */
function normalizeOrder(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const order = raw.filter((x): x is string => typeof x === "string");
  return order.length > 0 ? order : undefined;
}

/**
 * 排序配置归一化(t_d086543b: 排序只留手动): 任何输入一律归一为 manual, 不抛错。
 * - 旧持久化的 name/urgency 配置 → manual, order 保留(拖拽自定义顺序不丢)
 * - order 数组按字符串过滤保留; 非法/缺失 → undefined(退化为尾部全追加 = 名称正排)
 * 真壳 settings.json 与浏览器 localStorage 两侧共用同一宽容语义(损坏配置不崩 UI)。
 */
export function normalizeSortConfig(raw: unknown): SortConfig {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const order = normalizeOrder(o.order);
    if (o.key === "manual" || o.key === "name" || o.key === "urgency") {
      return { key: "manual", dir: "asc", ...(order ? { order } : {}) };
    }
  }
  return DEFAULT_SORT_CONFIG;
}

/**
 * 卡间排序(t_d086543b: 只留手动, D-039 order 交集语义保留)。
 * - 按 config.order(providerId 数组)排 —— 以当前实例集合为准做交集:
 *   order 里没有的 id(新添加/历史漂移)按缺省规则(名称正排)追加尾部; order 里的幽灵 id(已删除)忽略;
 *   order 永远是附加信息, 实例集合是真相源, 不因 order 过期丢卡。
 * - 尾部缺省规则 locale 显式钉 "zh"(t_6c6dd54f: 不钉则随运行时默认 locale 跨机漂移, e2e 必红)
 * - 新 provider 置顶由 App 在保存成功时把新 id prepend 进 order 实现(不在此函数内)
 * 托盘(globalHealth/tooltipSummary)不经此函数 —— 排序配置不影响托盘全局最差状态。
 */
const NAME_COLLATOR = new Intl.Collator("zh", { numeric: true });

export function sortProviders(
  providers: ProviderSnapshot[],
  config: SortConfig = DEFAULT_SORT_CONFIG,
): ProviderSnapshot[] {
  // manual(D-039): order 交集 + 尾部按缺省规则(名称正排)追加 + 幽灵 id 忽略
  const order = config.order ?? [];
  const byId = new Map(providers.map((p) => [p.provider_id, p]));
  const picked: ProviderSnapshot[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const p = byId.get(id);
    if (p && !seen.has(id)) {
      picked.push(p);
      seen.add(id);
    }
  }
  const rest = providers
    .filter((p) => !seen.has(p.provider_id))
    .sort((a, b) => NAME_COLLATOR.compare(a.display_name, b.display_name));
  return [...picked, ...rest];
}

/**
 * 拖动落点(D-039): 把 dragId 从 ids 移到 overIndex 位置(其余保持原相对顺序)。
 * overIndex = 拖动后 dragId 在**新列表中的下标**(0..ids.length)。
 * 纯函数, App 的 drop 处理器与 L1 单测共用。
 */
export function reorderByIds(ids: string[], dragId: string, overIndex: number): string[] {
  const others = ids.filter((id) => id !== dragId);
  const idx = Math.max(0, Math.min(overIndex, others.length));
  return [...others.slice(0, idx), dragId, ...others.slice(idx)];
}

/** 托盘 tooltip 摘要, 如 "1待授权 1已耗尽 2健康"(§6.2)。
 * P1 起按 statusBadge(原因)分组, 不再按颜色带分组 —— auth_expired 不再被统计成"偏低",
 * 配额耗尽显示"已耗尽"而非"过期"。 */
export function tooltipSummary(providers: ProviderSnapshot[]): string {
  if (providers.length === 0) return t("tray.noProviders");
  const counts = new Map<string, number>();
  for (const p of providers) {
    const label = statusBadge(p);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // counts 以"渲染后文案"为键(statusBadge 产出); BADGE_ORDER 键序即严重度降序, 按 key 序取即得稳定排序
  const ordered = BADGE_ORDER.map((k) => tKey(k))
    .map((label) => ({ label, n: counts.get(label) ?? 0 }))
    .filter(({ n }) => n > 0)
    .map(({ label, n }) => t("tray.countBadge", { count: n, label }));
  return `token-wallet — ${ordered.join(" ")}`;
}
