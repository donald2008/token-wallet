import type { ReactNode } from "react";
import type { ProviderSnapshot } from "../types";
import { providerHealth } from "../health";
import { t } from "../i18n";

/**
 * 主页过滤 — P1 t_9639078b: chips 收敛重设计(三枚 icon 钮)。
 *
 * 契约(njbx02 定, 2026-08-31): 弃计数角标/平台 chips/独立行 —— 收敛为三枚 24×24 圆钮浮在
 * 卡片列表右上角(与卡片列表同容器, 绝对定位, 随内容滚动不吸顶不重叠)。
 *
 * - 三枚: 全部(◇ 中性, 默认态) / 可用(✓ 绿) / 异常(⚠ 黄) —— 颜色即信息, 无文字无计数。
 * - 选中态 = 描边高亮(--accent) + 全不透明; 未选中 = 半透明(fg-dim 40%), 存在感≈0。
 * - 单选语义不变: 点选切换视角, 再点当前选中 = 回「全部」。
 * - 过滤桶语义不变: 可用 = health ok; 异常 = auth_expired/stale/error/已耗尽(health bad)。
 *
 * 过滤 = 一层 filter, 不碰 sortProviders 排序器与采集层(排序在过滤之后由 App 做)。
 */

/** 过滤选中态(单选): all=不过滤 / available=可用 / abnormal=异常。平台视角已随平台 chips 移除。 */
export type FilterSel =
  | { kind: "all" }
  | { kind: "available" }
  | { kind: "abnormal" };

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

/** 过滤判定: provider 是否命中当前选中态。 */
export function matchesFilter(p: ProviderSnapshot, sel: FilterSel): boolean {
  switch (sel.kind) {
    case "all":
      return true;
    case "available":
      return isAvailable(p);
    case "abnormal":
      return isAbnormal(p);
  }
}

function isSameSel(a: FilterSel, b: FilterSel): boolean {
  return a.kind === b.kind;
}

/* ---------------- 组件: 三枚 icon 钮 ---------------- */

interface Props {
  value: FilterSel;
  onChange: (sel: FilterSel) => void;
}

interface IconDef {
  sel: FilterSel;
  testid: string;
  /** 无障碍 + 悬浮提示(无文字, 颜色即信息, title/aria-label 兜底可读)。 */
  label: string;
  /** 颜色类: 决定图标语义色(绿=可用/黄=异常/中性=全部)。 */
  colorClass: "filter-icon-all" | "filter-icon-available" | "filter-icon-abnormal";
}

/** label 为 i18n 键(渲染时 FilterIcons 经 t() 取文案) */
const ICONS: IconDef[] = [
  { sel: { kind: "all" }, testid: "filter-all", label: "filter.all", colorClass: "filter-icon-all" },
  { sel: { kind: "available" }, testid: "filter-available", label: "filter.available", colorClass: "filter-icon-available" },
  { sel: { kind: "abnormal" }, testid: "filter-abnormal", label: "filter.abnormal", colorClass: "filter-icon-abnormal" },
];

/** 手绘 14px 单色 glyph(SVG path, currentColor 自适应主题, 不引图标库 D-002)。 */
const GLYPHS: Record<IconDef["colorClass"], ReactNode> = {
  // ◇ 全部(中性): 实心菱形
  "filter-icon-all": (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.8 13.6 8 8 14.2 2.4 8Z" fill="currentColor" />
    </svg>
  ),
  // ✓ 可用(绿): 对勾
  "filter-icon-available": (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 8.4 6.5 12 13 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  // ⚠ 异常(黄): 三角 + 叹号
  "filter-icon-abnormal": (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.3 14.4 12.6H1.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 5.6v3.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r="0.9" fill="currentColor" />
    </svg>
  ),
};

/**
 * 过滤三枚 icon 钮组。role=radiogroup 单选语义(aria 完整, 键盘 Tab + Enter 可达)。
 * 挂载点: 卡片列表容器内右上角(绝对定位)。点击已选项 → 取消回「全部」。
 * 无计数角标/无文字/无平台 chips —— 颜色即信息(绿=可用, 黄=异常, 中性=全部)。
 */
export function FilterIcons({ value, onChange }: Props) {
  return (
    <div className="filter-icons" role="radiogroup" aria-label={t("filter.aria")} data-testid="filter-icons">
      {ICONS.map(({ sel, testid, label, colorClass }) => {
        const checked = isSameSel(sel, value);
        return (
          <button
            key={testid}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t(label as Parameters<typeof t>[0])}
            title={t(label as Parameters<typeof t>[0])}
            className={`filter-icon ${colorClass}${checked ? " active" : ""}`}
            data-testid={testid}
            onClick={() => onChange(checked ? DEFAULT_FILTER : sel)}
          >
            {GLYPHS[colorClass]}
          </button>
        );
      })}
    </div>
  );
}