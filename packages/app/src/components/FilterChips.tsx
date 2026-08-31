import type { ProviderSnapshot } from "../types";
import { providerHealth } from "../health";
import { BrandLogo, resolveBrandKey } from "./brand-logos";

/**
 * 主页过滤 chips — P1 t_6484ecc6。
 *
 * 契约(njbx02 定): 卡片列表顶部、主区第一行, 常驻低调(fg-dim, hover/选中才 accent+bg-hover)。
 * - 固定态 3 枚: 全部 / 可用(=health ok) / 异常(=auth_expired/stale/error/已耗尽)
 * - 平台 chips 数据驱动动态生成: 从当前实例集推导(有实例的平台才出 chip),
 *   chip 带 BrandLogo(14px, 复用 t_696ec820 brand-logos 注册表, 未收录回退色点)。
 * - 单选语义: 一次一个视角, 点击已选 chip = 取消回「全部」; 不做多选组合。
 * - 默认「全部」= 现状行为零变化。
 *
 * 过滤 = 一层 filter, 不碰 sortProviders 排序器与采集层(排序在过滤之后由 App 做)。
 */

/** 过滤选中态(单选): all=不过滤 / available=可用 / abnormal=异常 / platform=<品牌key>。 */
export type FilterSel =
  | { kind: "all" }
  | { kind: "available" }
  | { kind: "abnormal" }
  | { kind: "platform"; platform: string };

export const DEFAULT_FILTER: FilterSel = { kind: "all" };

const ABNORMAL_STATUSES = new Set(["auth_expired", "stale", "error"]);

/** 可用桶: health ∈ {ok}(providerHealth 一等公民后的四色, 见 health.ts)。 */
export function isAvailable(p: ProviderSnapshot): boolean {
  return providerHealth(p) === "ok";
}

/**
 * 异常桶(契约口径): auth_expired / stale / error / 已耗尽。
 * - auth_expired/stale/error 按 status 判;
 * - 已耗尽 = status ok 但配额 health=bad(remaining==0 与 0<r≤10% 都算, 与 c3b8396 耗尽分级对齐)。
 * 未接入/即将耗尽(0.1<r≤0.3 warn)不在异常桶内(只出现在「全部」)。
 */
export function isAbnormal(p: ProviderSnapshot): boolean {
  return ABNORMAL_STATUSES.has(p.status) || providerHealth(p) === "bad";
}

/** platform 平台 key: logo 优先(descriptor.logo), 兜底 provider_id, 经 brand-logos 别名解析。 */
export function platformKey(p: ProviderSnapshot): string {
  return resolveBrandKey(p.logo ?? p.provider_id);
}

/** 过滤判定: provider 是否命中当前选中态。 */
export function matchesFilter(p: ProviderSnapshot, sel: FilterSel): boolean {
  switch (sel.kind) {
    case "all":
      return true;
    case "available":
      return isAvailable(p);
    case "abnormal":
      return isAbnormal(p);
    case "platform":
      return platformKey(p) === sel.platform;
  }
}

/** 三态桶计数(数据驱动, 供 chips 角标联动含增删实例/采集状态变化)。 */
export function deriveBuckets(providers: ProviderSnapshot[]): {
  all: number;
  available: number;
  abnormal: number;
} {
  let available = 0;
  let abnormal = 0;
  for (const p of providers) {
    if (isAvailable(p)) available += 1;
    if (isAbnormal(p)) abnormal += 1;
  }
  return { all: providers.length, available, abnormal };
}

/** 平台 chips 数据驱动推导: 在有实例的平台里按 brand key 分组计数(label 展示名取首个实例平台)。 */
export function derivePlatforms(
  providers: ProviderSnapshot[],
): { key: string; label: string; count: number }[] {
  const groups = new Map<string, { key: string; label: string; count: number }>();
  for (const p of providers) {
    const key = platformKey(p);
    const g = groups.get(key) ?? {
      key,
      label: platformLabel(p),
      count: 0,
    };
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** 平台展示名: 已知品牌 → 映射文案; 未收录 → 品牌 key 本身(不崩)。 */
const PLATFORM_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  opencode: "opencode",
  kimi: "Kimi",
  "aliyun-bailian": "阿里云百炼",
  "volcengine-ark": "火山方舟",
  zai: "智谱bigmodel",
  minimax: "MiniMax",
  "token-wallet": "token-wallet",
  generic: "其他",
};

function platformLabel(p: ProviderSnapshot): string {
  const k = platformKey(p);
  return PLATFORM_LABELS[k] ?? k;
}

/* ---------------- 组件 ---------------- */

interface Props {
  providers: ProviderSnapshot[];
  value: FilterSel;
  onChange: (sel: FilterSel) => void;
}

/**
 * 过滤 chips 行。role=radiogroup 单选语义(aria 完整, 键盘 Tab + Enter 可达)。
 * 结构: [全部(n)] [✓ 可用(n)] [⚠ 异常(n)] │ [<平台logo> 平台(n)] ...
 * 点击已选 chip → 取消回「全部」。
 */
export function FilterChips({ providers, value, onChange }: Props) {
  const { all, available, abnormal } = deriveBuckets(providers);
  const platforms = derivePlatforms(providers);

  const select = (sel: FilterSel) => onChange(isSameSel(sel, value) ? DEFAULT_FILTER : sel);

  return (
    <div className="filter-chips" role="radiogroup" aria-label="过滤 Provider" data-testid="filter-chips">
      <FilterChip
        testid="filter-all"
        sel={{ kind: "all" }}
        label="全部"
        count={all}
        value={value}
        onSelect={select}
      />
      <FilterChip
        testid="filter-available"
        sel={{ kind: "available" }}
        label="✓ 可用"
        count={available}
        value={value}
        onSelect={select}
      />
      <FilterChip
        testid="filter-abnormal"
        sel={{ kind: "abnormal" }}
        label="⚠ 异常"
        count={abnormal}
        value={value}
        onSelect={select}
      />
      {platforms.length > 0 && <span className="filter-chips-sep" aria-hidden="true" />}
      {platforms.map((pf) => (
        <FilterChip
          key={pf.key}
          testid={`filter-platform-${pf.key}`}
          sel={{ kind: "platform", platform: pf.key }}
          label={pf.label}
          count={pf.count}
          value={value}
          onSelect={select}
          platform={pf.key}
        />
      ))}
    </div>
  );
}

function isSameSel(a: FilterSel, b: FilterSel): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "platform" && b.kind === "platform" ? a.platform === b.platform : true;
}

function FilterChip({
  testid,
  sel,
  label,
  count,
  value,
  onSelect,
  platform,
}: {
  testid: string;
  sel: FilterSel;
  label: string;
  count: number;
  value: FilterSel;
  onSelect: (sel: FilterSel) => void;
  platform?: string;
}) {
  const checked = isSameSel(sel, value);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={`filter-chip${checked ? " active" : ""}`}
      data-testid={testid}
      onClick={() => onSelect(sel)}
    >
      {platform !== undefined && <BrandLogo platform={platform} size={14} />}
      <span className="filter-chip-label">{label}</span>
      <span className="filter-chip-count">{count}</span>
    </button>
  );
}