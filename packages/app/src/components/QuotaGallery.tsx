import { t } from "../i18n";
import { QuotaMeter, type QuotaLayout, type QuotaState } from "./QuotaMeter";
import { metricHealth, providerHealth, statusBadge } from "../health";
import { BrandLogo } from "./brand-logos";
import { StatusDot } from "./StatusDot";
import type { HealthLevel, MetricUnit, ProviderSnapshot } from "../types";

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

/* ============ Provider 卡片组合层方案段(t_698a43c9, mock 供选型) ============
 * 目标结构(未来实现卡, 本卡不落地正式替换): ProviderCard 壳 = head(BrandLogo 拖把手
 * + 名称 + StatusDot + 徽章文字, D-005/D-039) + body slot。
 *   · 正常卡 body = 窗口行列表 —— 每窗口一个 QuotaMeter 实例:
 *       方案 A(layout=row): 标题列/条列/用量列多窗纵向对齐, 跨窗扫读比进度; 重置小字垫底(推荐)
 *       方案 B(layout=duo): 标题+用量一行 / 条+重置一行, 单窗自含组块(备选)
 *   · 异常卡 body = AbnormalBody 同构槽(auth_expired 黄灯+setup_hint 授权面板 /
 *       error 红字 / stale 灰), 不渲染假窗口行(§2.1)
 * 两方案共用同一份真实感 provider 快照(Kimi 窗口形态, requests 计数制), 只差排版。
 * 全部复用已定稿组件: BrandLogo / StatusDot / QuotaMeter + health 纯函数, 不重造。
 * mock 卡 class 用 .qcard-* 前缀(不占真卡 .card/.card-head 命名, 不与 e2e 真卡选择器冲突)。
 */

const NOW_SEC = Math.floor(Date.now() / 1000);

/** 窗口行标题(与 registry windowTitle 同规): 取 i18n metric.<key> 展示名, 未知 key 回退原样 */
function cardWindowTitle(key: string): string {
  const metricKey = `metric.${key}` as Parameters<typeof t>[0];
  return t(metricKey).startsWith("metric.") ? key : t(metricKey);
}

/** 方案 A/B 共用快照: kimi 双窗(5h 80% warn + 周窗 20% ok), 真实 requests 计数制(主页同形态) */
const CARD_OK_PROVIDER: ProviderSnapshot = {
  provider_id: "kimi-code",
  display_name: "Kimi-Code #1",
  plan_type: "window",
  logo: "kimi",
  fetched_at: NOW_SEC - 90,
  status: "ok",
  metrics: [
    { key: "rolling_5h", kind: "window", unit: "requests", used: 960, limit: 1200, reset_at: NOW_SEC + 3.2 * 3600 },
    { key: "weekly", kind: "window", unit: "requests", used: 1200, limit: 6000, reset_at: NOW_SEC + 5.8 * 86400 },
  ],
  alerts: [],
};

/** 异常卡快照: auth_expired(百炼, setup_hint 授权引导)—— 新卡片结构必须承载的状态之一 */
const CARD_AUTH_PROVIDER: ProviderSnapshot = {
  provider_id: "aliyun",
  display_name: "百炼 Token Plan",
  plan_type: "window",
  logo: "aliyun-bailian",
  fetched_at: NOW_SEC - 7200,
  status: "auth_expired",
  metrics: [],
  alerts: [{ level: "warn", message: "bl 会话已失效" }],
  setup_hint: "请运行 `bl auth login --console` 重新授权",
};

/** 异常卡快照: error(deepseek, 采集失败) */
const CARD_ERROR_PROVIDER: ProviderSnapshot = {
  provider_id: "deepseek",
  display_name: "DeepSeek-按量 #1",
  plan_type: "balance",
  logo: "deepseek",
  fetched_at: NOW_SEC - 240,
  status: "error",
  metrics: [],
  alerts: [{ level: "critical", message: "429 quota exceeded: 今日按量已超限" }],
};

/** 异常体 mock —— 未来实现卡由 ProviderCard AbnormalBody(OneClickAuth + HintCopyButton 等
 * IPC 件)承载, 此处仅静态示意结构(按钮为 chip 占位, 不接 IPC)。布局语义与
 * t_52e3a7fb 修复一致: 说明文字独占整行自然折行, 动作钮换行并排, 不单行挤压。 */
function AbnormalBodyMock({ p, health }: { p: ProviderSnapshot; health: HealthLevel }) {
  return (
    <div className="qcard-abnormal" data-testid="qcard-abnormal">
      <div className={`qcard-status-line text-${health}`}>
        {p.status === "auth_expired" && (
          <span className="qcard-lamp" aria-hidden="true">
            ●
          </span>
        )}
        {p.status === "auth_expired"
          ? t("statusText.auth_expired" as Parameters<typeof t>[0])
          : p.status === "error"
            ? t("statusText.error" as Parameters<typeof t>[0])
            : p.status}
      </div>
      {p.setup_hint && (
        <div className="qcard-hint" data-testid="qcard-hint">
          <span className="qcard-hint-text">⚑ {p.setup_hint}</span>
          <div className="qcard-hint-actions">
            {/* 示意(非功能): 实现卡接入 HintCopyButton / OneClickAuth */}
            <span className="qcard-chip" aria-hidden="true">
              {t("card.copy" as Parameters<typeof t>[0])}
            </span>
            <span className="qcard-chip" aria-hidden="true">
              {t("card.authStart" as Parameters<typeof t>[0])}
            </span>
          </div>
        </div>
      )}
      {p.alerts.length > 0 && <div className="qcard-note">{p.alerts.map((a) => a.message).join("; ")}</div>}
    </div>
  );
}

/** 未来 ProviderCard 的目标结构 mock: head + body slot(正常=窗口行 QuotaMeter / 异常=AbnormalBodyMock) */
function ProviderCardMock({ p, layout }: { p: ProviderSnapshot; layout?: QuotaLayout }) {
  const health = providerHealth(p);
  const abnormal = p.status !== "ok";
  return (
    <div className="qcard" data-testid="qcard" data-health={health} data-layout={layout ?? "abnormal"}>
      <div className="qcard-head">
        <span className="qcard-handle" aria-hidden="true">
          {/* 拖把手载体 = BrandLogo(D-039: 实现卡用 brand-block.drag-handle 绑 makeHandleProps) */}
          <BrandLogo platform={p.logo ?? p.provider_id} size={14} />
        </span>
        <span className="qcard-name" title={p.display_name}>
          {p.display_name}
        </span>
        <StatusDot health={health} size={8} />
        <span className={`qcard-badge text-${health}`}>{statusBadge(p)}</span>
      </div>
      {abnormal ? (
        <AbnormalBodyMock p={p} health={health} />
      ) : (
        <div className="qcard-windows">
          {p.metrics.map((m) => {
            const h = metricHealth(m);
            return (
              <QuotaMeter
                key={m.key}
                layout={layout}
                pct={m.limit !== undefined && m.limit > 0 ? m.used / m.limit : 0}
                state={h === "unknown" ? "ok" : (h as QuotaState)}
                title={cardWindowTitle(m.key)}
                resetText={
                  m.key === "rolling_5h"
                    ? t("quota.cResetH" as Parameters<typeof t>[0])
                    : t("quota.cResetD" as Parameters<typeof t>[0])
                }
                used={m.used}
                limit={m.limit}
                unit={m.unit}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Provider 卡片方案段定义: tag(方案代号) + 画布内容 + i18n 名/说明 */
interface CardOptionDef {
  tag: string;
  testKey: string;
  nameKey: string;
  descKey: string;
  providers: ProviderSnapshot[];
  layout?: QuotaLayout;
}

/** 方案 A(row, 推荐) / 方案 B(duo, 备选) 同数据; 第三段 = 异常卡共用骨架(auth+error 两例) */
const CARD_OPTIONS: CardOptionDef[] = [
  { tag: "A", testKey: "a", layout: "row", nameKey: "quota.cardAName", descKey: "quota.cardADesc", providers: [CARD_OK_PROVIDER] },
  { tag: "B", testKey: "b", layout: "duo", nameKey: "quota.cardBName", descKey: "quota.cardBDesc", providers: [CARD_OK_PROVIDER] },
  { tag: "⚠", testKey: "abn", nameKey: "quota.cardAbnName", descKey: "quota.cardAbnDesc", providers: [CARD_AUTH_PROVIDER, CARD_ERROR_PROVIDER] },
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

        {/* Provider 卡片组合层方案(t_698a43c9): A=row 卡(推荐) / B=duo 卡(备选) 同数据横比 + 异常卡共用骨架 */}
        {CARD_OPTIONS.map((opt) => (
          <section className="qvar" data-testid={`qvar-cards-${opt.testKey}`} key={opt.testKey}>
            <header className="qvar-head">
              <div className="qvar-title-row">
                <span className="qvar-tag" aria-hidden="true">
                  {opt.tag}
                </span>
                <h4 className="qvar-name">{t(opt.nameKey as Parameters<typeof t>[0])}</h4>
              </div>
              <p className="qvar-desc">{t(opt.descKey as Parameters<typeof t>[0])}</p>
            </header>
            <div className="qvar-canvas qvar-canvas--cards" data-testid={`qvar-canvas-cards-${opt.testKey}`}>
              {opt.providers.map((p) => (
                <ProviderCardMock key={`${opt.testKey}-${p.provider_id}`} p={p} layout={opt.layout} />
              ))}
            </div>
          </section>
        ))}

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
