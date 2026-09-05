import { t } from "../i18n";
import { QuotaMeter, type QuotaLayout, type QuotaState } from "./QuotaMeter";
import {
  PROVIDER_CARD_VARIANTS,
  getVariantMockProviders,
} from "./ProviderCardVariants";
import type { MetricUnit } from "../types";

/**
 * QuotaGallery — 四元素排版变体对比页(t_35ff3c1f, feat/theme-glass 实验视图)。
 *
 * 用户拍板(9/4): 重点是「排版」。同一份四元素数据(标题 + 重置时间 + 进度条 + 用量)
 * 分别用 5 种**容器层排版**渲染, 供肉眼直接对比「同数据不同摆法、各用在哪」:
 *
 *   A 窗口行   -> row     水平三列单行带(标题定宽左/条中/用量右, 重置小字垫底)
 *   E 通用明细 -> duo     两行堆叠(标题+用量一行, 条+重置一行)
 *   B 汇总 hero -> hero   大数字主视觉卡(用量 22px, 标题/条/重置降为配)
 *   C tooltip  -> micro   无卡竖排超紧凑(4px 条, 重置并入用量行)
 *   D 余额 ticker -> ticker 数字优先(上行 caption, 下行 16px 数字 + 微条)
 *
 * 数据契约(t_23800bd4 修正): DATA = 4 行 —— 前 3 行百分制(ok 40% / warn 72% / bad 91%,
 *   unit=percent, 与主页窗口行真实形态一致), 标题用真实 provider 风格名(无「xx 次」误导);
 *   第 4 行为**计数制演示**(unit=credits, 2300/10000, 形态参照 zai-coding 周窗 6837/10000),
 *   专供对比「单位语义」在 5 种排版下的展示。条统一默认 slim, 排除「形态/颜色」干扰。
 * 硬约束: 四元素 slots DOM 顺序不变(容器层 grid-area 重排), .progress /
 *   .progress-fill[data-health] / role=progressbar 契约一例不破; 新增排版容器
 *   class = .quota-meter--layout-* / .qvar-* 新前缀。全 tokens.css / 8px 网格 /
 *   D-016 三态(dark/light/glass 随主题)。
 */
interface GalleryData {
  key: string;
  titleKey: string;
  resetTextKey: string;
  pct: number;
  state: QuotaState;
  used: number;
  limit: number;
  /** 真实单位语义(t_23800bd4): 用量行按此格式化, 禁止硬编码单位词 */
  unit: MetricUnit;
}

/** 同一组数据(全部排版共用): 前 3 行 = 三态百分制(ok/warn/bad), 第 4 行 = 计数制演示, 条统一 slim */
const DATA: GalleryData[] = [
  { key: "oc_5h", titleKey: "quota.iWin5h", pct: 0.4, state: "ok", resetTextKey: "quota.iResetSoon", used: 40, limit: 100, unit: "percent" },
  { key: "kimi_week", titleKey: "quota.iWeek", pct: 0.72, state: "warn", resetTextKey: "quota.iResetDayFrac", used: 72, limit: 100, unit: "percent" },
  { key: "aly_month", titleKey: "quota.iMonth", pct: 0.91, state: "bad", resetTextKey: "quota.iResetHours", used: 91, limit: 100, unit: "percent" },
  // 计数制演示行(非百分制): 参照 zai-coding 周窗 credits 绝对值形态, 展示单位语义差异
  { key: "zai_count", titleKey: "quota.iCount", pct: 0.23, state: "ok", resetTextKey: "quota.iResetHours", used: 2300, limit: 10000, unit: "credits" },
];

interface VariantDef {
  layout: QuotaLayout;
  /** 画布 modifier(个别布局的自适应容器), 缺省无 */
  canvasClass?: string;
}

/** 5 种排版: 场景 A-E 驱动(见上方头注释); nameKey/descKey 对应 i18n quota.v* 键 */
const VARIANTS: (VariantDef & { nameKey: string; descKey: string })[] = [
  { layout: "row", canvasClass: "row", nameKey: "quota.vNameRow", descKey: "quota.vDescRow" },
  { layout: "duo", nameKey: "quota.vNameDuo", descKey: "quota.vDescDuo" },
  { layout: "hero", canvasClass: "hero", nameKey: "quota.vNameHero", descKey: "quota.vDescHero" },
  { layout: "micro", nameKey: "quota.vNameMicro", descKey: "quota.vDescMicro" },
  { layout: "ticker", nameKey: "quota.vNameTicker", descKey: "quota.vDescTicker" },
];

/** 场景字母徽标(与卡面描述并列, 纯展示非 i18n) */
const SCENARIO_TAG: Record<QuotaLayout, string> = {
  row: "A",
  duo: "E",
  hero: "B",
  micro: "C",
  ticker: "D",
};

/* ============ Provider 卡片卡内排版方案段(t_85237167, 9/5 清空重建)
 * 上一轮 S1-S4（d304801/279858d）作废 —— 差异点没建立在 tooltip 原语上, 含 4-6 窗假想场景过度设计。
 * 本轮 4 方案全部基于 tooltip QuotaMeter(BarRowTooltip + QuotaMeter layout=micro) 组合,
 * 围绕「头部与窗口区组织 / 整卡交互 / tooltip 关系」三个真实维度展开。详见 docs。
 * 异常卡(auth_expired+error)共用 AbnormalBody(AbnormalBodyMock 同构), 不算独立布局(卡体硬约束)。 */

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

        {/* 同一组数据 × 5 种排版(容器层重排), 逐段标注适用场景 */}
        {VARIANTS.map((v) => (
          <section className="qvar" data-testid={`qvar-${v.layout}`} key={v.layout}>
            <header className="qvar-head">
              <div className="qvar-title-row">
                <span className="qvar-tag" aria-hidden="true">
                  {SCENARIO_TAG[v.layout]}
                </span>
                <h4 className="qvar-name">{t(v.nameKey as Parameters<typeof t>[0])}</h4>
              </div>
              <p className="qvar-desc">{t(v.descKey as Parameters<typeof t>[0])}</p>
            </header>
            <div
              className={`qvar-canvas${v.canvasClass ? ` qvar-canvas--${v.canvasClass}` : ""}`}
              data-testid={`qvar-canvas-${v.layout}`}
            >
              {DATA.map((d) => (
                <QuotaMeter
                  key={`${v.layout}-${d.key}`}
                  layout={v.layout}
                  pct={d.pct}
                  state={d.state}
                  title={t(d.titleKey as Parameters<typeof t>[0])}
                  resetText={t(d.resetTextKey as Parameters<typeof t>[0])}
                  used={d.used}
                  limit={d.limit}
                  unit={d.unit}
                />
              ))}
            </div>
          </section>
        ))}

        {/* Provider 卡片卡内排版方案段(t_85237167, 9/5 清空重建): 4 方案 mock + 异常卡共用骨架段 */}
        {PROVIDER_CARD_VARIANTS.map((v) => {
          const { ok } = getVariantMockProviders();
          const abnormal = ok.status !== "ok";
          return (
            <section className="qvar" data-testid={`qvar-cards2-${v.testKey}`} key={v.testKey}>
              <header className="qvar-head">
                <div className="qvar-title-row">
                  <span className="qvar-tag" aria-hidden="true">
                    {v.tag}
                  </span>
                  <h4 className="qvar-name">{t(v.nameKey as Parameters<typeof t>[0])}</h4>
                </div>
                <p className="qvar-desc">{t(v.descKey as Parameters<typeof t>[0])}</p>
              </header>
              <div
                className="qvar-canvas qvar-canvas--cards2"
                data-testid={`qvar-canvas-cards2-${v.testKey}`}
              >
                {v.render({ p: ok, m: ok.metrics, abnormal })}
              </div>
            </section>
          );
        })}
        {/* 异常段: auth_expired + error 共用骨架 */}
        {(() => {
          const { auth, error } = getVariantMockProviders();
          return (
            <section className="qvar" data-testid="qvar-cards2-abn" key="abn">
              <header className="qvar-head">
                <div className="qvar-title-row">
                  <span className="qvar-tag" aria-hidden="true">
                    ⚠
                  </span>
                  <h4 className="qvar-name">{t("quota.card2AbnName")}</h4>
                </div>
                <p className="qvar-desc">{t("quota.card2AbnDesc")}</p>
              </header>
              <div
                className="qvar-canvas qvar-canvas--cards2"
                data-testid="qvar-canvas-cards2-abn"
              >
                {/* 异常卡用基线 A 的 VariantA 渲染(共用骨架), 改 p 即可 */}
                {PROVIDER_CARD_VARIANTS[0]!.render({
                  p: auth,
                  m: auth.metrics,
                  abnormal: true,
                })}
                {PROVIDER_CARD_VARIANTS[0]!.render({
                  p: error,
                  m: error.metrics,
                  abnormal: true,
                })}
              </div>
            </section>
          );
        })()}

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
