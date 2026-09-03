import { t } from "../i18n";
import { QuotaMeter, type QuotaState, type QuotaVariant } from "./QuotaMeter";

/**
 * QuotaGallery — 四元素组件实例方案页(t_af01e265, feat/theme-glass 实验视图)。
 *
 * 用户两次纠正(9/4): 不要「矩阵表格」(列=形态 × 行=窗口)。正确 = 一个完整四元素
 * 「最小组件实例(标题 + 重置时间 + 进度条 + 用量)」, 按数据需要渲染**多个完整实例**。
 *
 * 数据契约(纯 mock 驱动, 无引擎无 store):
 *   INSTANCES = N 条完整四元素数据组合, 每条 = 一个 QuotaMeter(四元素实例)。
 *   不同实例喂不同数据: pct 状态色(40% ok / 58% warn / 72% warn / 91% bad …)、
 *   不同形态的条(slim/thick/segmented/flow)、不同标题/重置时间/用量。
 * 布局 = 竖排逐个展示完整实例(非表格; 形态对比保留在组件内部同一排版里)。
 *
 * 契约同源: tokens.css / 8px 网格 / D-016 三态(dark/light/glass 随主题自适应)。
 * e2e 契约: 复用 .progress / .progress-fill[data-health] / role=progressbar —— 正文卡一例不破。
 */
interface GalleryInstance {
  key: string;
  titleKey: string;
  pct: number;
  state: QuotaState;
  variant: QuotaVariant;
  resetTextKey: string;
  used: number;
  limit: number;
}

const INSTANCES: GalleryInstance[] = [
  // 40% ok / flash-回落滚动窗 / 细条
  {
    key: "flash_40",
    titleKey: "quota.iFlash",
    pct: 0.4,
    state: "ok",
    variant: "slim",
    resetTextKey: "quota.iResetSoon",
    used: 40,
    limit: 100,
  },
  // 58% warn / 长窗已过半 / 瓶形粗条
  {
    key: "deep_58",
    titleKey: "quota.iDeep",
    pct: 0.58,
    state: "warn",
    variant: "thick",
    resetTextKey: "quota.iResetWeek",
    used: 58,
    limit: 100,
  },
  // 72% warn / 周窗 / 分段刻度
  {
    key: "week_72",
    titleKey: "quota.iWeek",
    pct: 0.72,
    state: "warn",
    variant: "segmented",
    resetTextKey: "quota.iResetDayFrac",
    used: 72,
    limit: 100,
  },
  // 91% bad / 月窗近耗尽 / 流水动效
  {
    key: "month_91",
    titleKey: "quota.iMonth",
    pct: 0.91,
    state: "bad",
    variant: "flow",
    resetTextKey: "quota.iResetHours",
    used: 91,
    limit: 100,
  },
  // 全量尚可 / 更细颗粒(1000 记数制) / 细条
  {
    key: "perf_23",
    titleKey: "quota.iPerf",
    pct: 0.23,
    state: "ok",
    variant: "slim",
    resetTextKey: "quota.iResetDayInt",
    used: 2300,
    limit: 10000,
  },
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

        {/* 竖排逐个展示完整四元素实例(非表格, 无窗口×形态矩阵) */}
        <div className="quota-instances" data-testid="quota-instances">
          {INSTANCES.map((inst) => (
            <div className="quota-instance" data-instance={inst.key} key={inst.key}>
              <QuotaMeter
                pct={inst.pct}
                state={inst.state}
                variant={inst.variant}
                title={t(inst.titleKey as Parameters<typeof t>[0])}
                resetText={t(inst.resetTextKey as Parameters<typeof t>[0])}
                used={inst.used}
                limit={inst.limit}
              />
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