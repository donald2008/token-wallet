import { t } from "../i18n";
import { QuotaMeter, type QuotaState, type QuotaVariant } from "./QuotaMeter";

/**
 * QuotaGallery — 进度条形态方案页(t_37416b22, feat/theme-glass 实验视图)。
 *
 * 数据契约(纯 mock 驱动, 无引擎无 store):
 *   METRICS = 3 条典型窗口(5h 40% ok / 周 72% warn / 月 91% bad) → 一眼看到三种状态色。
 *   VARIANTS = 4 种「条」的形态(slim/thick/segmented/flow), 并排矩阵对比。
 * 布局 = 行(窗口 × 状态) × 列(形态), 每格一个 QuotaMeter(条本体)。
 * 窗名/数值标签是**方案页说明层**(非 QuotaMeter 本体承载), 便于评审对照数据组合。
 *
 * 契约同源: tokens.css / 8px 网格 / D-016 三态(dark/light/glass 随主题自适应, 零硬编码色)。
 * e2e 契约: 复用 .progress / .progress-fill[data-health], 一例不破正文卡。
 */
const METRICS: { key: string; labelKey: string; pct: number; state: QuotaState }[] = [
  { key: "rolling_5h", labelKey: "quota.window5h", pct: 0.4, state: "ok" },
  { key: "weekly", labelKey: "quota.windowWeek", pct: 0.72, state: "warn" },
  { key: "monthly", labelKey: "quota.windowMonth", pct: 0.91, state: "bad" },
];

const VARIANTS: { id: QuotaVariant; labelKey: string; noteKey: string; motion?: boolean }[] = [
  { id: "slim", labelKey: "quota.vSlim", noteKey: "quota.vSlimNote" },
  { id: "thick", labelKey: "quota.vThick", noteKey: "quota.vThickNote" },
  { id: "segmented", labelKey: "quota.vSegmented", noteKey: "quota.vSegmentedNote", motion: true },
  { id: "flow", labelKey: "quota.vFlow", noteKey: "quota.vFlowNote", motion: true },
];

export function QuotaGallery({ onBack }: { onBack: () => void }) {
  return (
    <div className="settings-view quota-gallery" data-testid="quota-gallery">
      <div className="settings-head">
        <h3>{t("quota.title")}</h3>
        <button type="button" className="btn" data-testid="quota-back" onClick={onBack}>
          {t("common.back")}
        </button>
      </div>

      <div className="settings-body">
        <p className="hint">{t("quota.subtitle")}</p>

        <div className="quota-table" role="table" aria-label={t("quota.title")}>
          {/* 表头 = 形态列(variant) */}
          <div className="quota-row quota-row--head" role="row">
            <div className="quota-cell quota-cell--corner" role="columnheader">
              {t("quota.colWindow")}
            </div>
            {VARIANTS.map((v) => (
              <div
                className="quota-cell quota-vhead"
                data-variant={v.id}
                key={v.id}
                role="columnheader"
              >
                <span className="quota-vname">{t(v.labelKey as Parameters<typeof t>[0])}</span>
                <span className="quota-vnote">{t(v.noteKey as Parameters<typeof t>[0])}</span>
                {v.motion && <span className="quota-vmotion">{t("quota.motion")}</span>}
              </div>
            ))}
          </div>

          {/* 每行 = 一个典型窗口(含状态色), 每列 = 条本体候选 */}
          {METRICS.map((m) => (
            <div className="quota-row" data-metric={m.key} key={m.key} role="row">
              <div
                className={`quota-cell quota-cell--label${m.pct >= 0.9 ? " is-exhaust" : ""}`}
                role="rowheader"
              >
                <span className="quota-mname">{t(m.labelKey as Parameters<typeof t>[0])}</span>
                <span className="quota-mpct">{Math.round(m.pct * 100)}%</span>
              </div>
              {VARIANTS.map((v) => (
                <div className="quota-cell" role="cell" key={v.id}>
                  <QuotaMeter pct={m.pct} state={m.state} variant={v.id} />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* 状态色图例(阈值沿用 metricHealth, 不重造) */}
        <div className="quota-legend" data-testid="quota-legend">
          <span className="quota-legend-item">
            <i className="quota-swatch quota-swatch--ok" />
            {t("quota.legendOk")}
          </span>
          <span className="quota-legend-item">
            <i className="quota-swatch quota-swatch--warn" />
            {t("quota.legendWarn")}
          </span>
          <span className="quota-legend-item">
            <i className="quota-swatch quota-swatch--bad" />
            {t("quota.legendBad")}
          </span>
        </div>
      </div>
    </div>
  );
}