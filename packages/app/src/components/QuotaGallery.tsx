import { t } from "../i18n";
import {
  PROVIDER_CARD_LAYOUTS,
  getProviderCardMockProviders,
} from "./ProviderCardLayouts";
import type { Metric } from "../types";

/**
 * QuotaGallery — Provider 卡片排版方案对比页(t_73c110ea 9/7 重建, t_5b092750 9/7 加 P5)
 *
 * 用户拍板(9/7) + 修订 #1116(覆盖卡体原文):
 *  - 上一轮 4 方案(S1-S4→d304801/279858d→4×`ProviderCardVariants`)作废——
 *    4 方案本质是「1 种排版 + 4 头部装饰」非真排版差异。
 *  - 卡体「QuotaMeter(layout=row) 常驻直显」作废 → 卡内窗口展示 = 悬浮窗内那个 QuotaMeter
 *    组件 = layout="micro" 紧凑竖排形态(title+bar+(usage|reset) 三层 grid, 4px 条, font-10)
 *  - 本轮清空重建:
 *    * 4 方案差异建立在**真排版维度**(卡头 vs 三窗的空间关系/信息层级/密度/短窗并排)
 *    * **三窗 QuotaMeter(layout=micro) 常驻直显** = 卡片信息主体(无 hover 依赖)
 *    * 不再单独挂 <BarRowTooltip>: micro 常驻直接展开, 信息全靠悬浮才见 = 不合格
 *  - t_5b092750 9/7 加 P5(短窗并排): 5h+周同窗两列 grid, 月独占一行全宽 — token-monitor 布局
 *  - 不接 IPC; 用同一套真实数据三窗(rolling_5h + weekly + monthly, kimi-code, unit=requests)
 *
 * 本页结构(自上而下):
 *   1. settings-head: 标题 + 返回钮
 *   2. settings-body:
 *      - subtitle 提示(数据契约 + 三窗 micro 常驻硬约束)
 *      - 4 个排版段(qvar-cards3-p1/p2/p4/p5), 每段一张 ok 卡, **同一套数据**
 *      - 异常段(qvar-cards3-abn): auth_expired + error 共用 AbnormalBody 骨架
 *      - 图例段: 健康三色
 *
 * 旧 5 排版对比段(A/B/C/D/E)整段删除(从 t_35ff3c1f 至 t_23800bd4 起家, t_73c110ea 9/7 作废)——
 * 5 排版本质是 QuotaMeter 单元素 layout 变体, 与 Provider 卡片卡内排版不同维度, 不在方案页展示。
 */
export function QuotaGallery({ onBack }: { onBack: () => void }) {
  const { ok, auth, error } = getProviderCardMockProviders();
  // 4 方案段都用同一份 ok 数据(同 ProviderSnapshot, 三窗齐全); abnormal 标记 = false
  const cards = ok.metrics as Metric[];

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

        {/* 4 方案段: 同一套三窗真实数据, 卡头×三窗空间关系各异 */}
        {PROVIDER_CARD_LAYOUTS.map((v) => (
          <section
            className="qvar"
            data-testid={`qvar-cards3-${v.testKey}`}
            key={v.testKey}
          >
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
              className="qvar-canvas qvar-canvas--cards3"
              data-testid={`qvar-canvas-cards3-${v.testKey}`}
            >
              {v.render({ p: ok, m: cards, abnormal: false })}
            </div>
          </section>
        ))}

        {/* 异常段: auth_expired + error 共用 AbnormalBody 骨架(不计入独立布局) */}
        <section className="qvar" data-testid="qvar-cards3-abn" key="abn">
          <header className="qvar-head">
            <div className="qvar-title-row">
              <span className="qvar-tag" aria-hidden="true">
                ⚠
              </span>
              <h4 className="qvar-name">{t("quota.cardAbnName")}</h4>
            </div>
            <p className="qvar-desc">{t("quota.cardAbnDesc")}</p>
          </header>
          <div
            className="qvar-canvas qvar-canvas--cards3"
            data-testid="qvar-canvas-cards3-abn"
          >
            {/* 异常卡复用 P1 基线卡头(同 .qcard3--baseline 骨架), body 走 AbnormalBody
             * 用卡头是因为 abnormal 卡片仍要展示 provider 名 + health 文字,
             * 不引出新的"异常卡"骨架契约(任务硬约束: 异常不算独立布局) */}
            {PROVIDER_CARD_LAYOUTS[0]!.render({ p: auth, m: auth.metrics, abnormal: true })}
            {PROVIDER_CARD_LAYOUTS[0]!.render({ p: error, m: error.metrics, abnormal: true })}
          </div>
        </section>

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