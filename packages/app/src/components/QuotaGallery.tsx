import { t } from "../i18n";
import { QuotaMeter, type QuotaLayout, type QuotaState } from "./QuotaMeter";
import { metricHealth, providerHealth, statusBadge } from "../health";
import { BrandLogo } from "./brand-logos";
import { StatusDot } from "./StatusDot";
import type { HealthLevel, Metric, MetricUnit, ProviderSnapshot } from "../types";

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

/* ============ Provider 卡片卡内排版方案段(t_698a43c9 round2, 以评论 #1043 终稿为准) ============
 * 对象: 卡片**内部排版** —— 多窗口 QuotaMeter 实例(一律当前默认排版 row, t_23800bd4 主页同规;
 * duo 等排版切换等用户拍板, 本设计不定案)在卡内的组织方式。QuotaMeter 本体已定稿不改。
 * 4 方案差异只在卡内窗口区的组织/分组/间距/对齐/层级(敢差异, 非 QuotaMeter 本体改造):
 *   S1 基准竖排列表式: 窗间 1px 分隔线(--border) + 8px 节奏(现状最接近, 基准对照)
 *   S2 头部融合式: 最紧窗以警示色带摘要直呈头部下方, 窗口区按时间窗升序完整列表(风险上抬)
 *   S3 分区卡片式: 窗口按周期分区(短周期/长周期)分区标签 + 组内紧凑 + 区间分隔线
 *   S4 紧凑密度式: 去窗间分隔线 + 行距压 4px + ok 窗不渲染重置行(状态色已表达健康)
 * 异常卡共用骨架(auth_expired+error)保留(H 段)。mock 渲染供选型, 不落地正式替换。
 * 复用已定稿组件 BrandLogo/StatusDot/QuotaMeter + health 纯函数, 不重造; .qcard-* 前缀。 */

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

/** 单个窗口行: 一律 QuotaMeter 当前默认排版(row, t_23800bd4 主页同规; duo 等切换等用户拍板)。
 * hideReset = ok 窗隐藏重置行(S4 紧凑密度式用; resetText 缺省即不渲染, QuotaMeter 契约不破) */
function WindowMeter({ m, hideReset = false }: { m: Metric; hideReset?: boolean }) {
  const h = metricHealth(m);
  return (
    <QuotaMeter
      layout="row"
      pct={m.limit !== undefined && m.limit > 0 ? m.used / m.limit : 0}
      state={h === "unknown" ? "ok" : (h as QuotaState)}
      title={cardWindowTitle(m.key)}
      resetText={
        hideReset
          ? undefined
          : m.key === "rolling_5h"
            ? t("quota.cResetH" as Parameters<typeof t>[0])
            : t("quota.cResetD" as Parameters<typeof t>[0])
      }
      used={m.used}
      limit={m.limit}
      unit={m.unit}
    />
  );
}

/** 窗口周期分区(S3): rolling_5h/session → 短周期; 其余(weekly/monthly…) → 长周期 */
function zoneOf(key: string): "short" | "long" {
  return key === "rolling_5h" || key === "session" ? "short" : "long";
}

/** 最紧窗(S2): 用量比例最大者(remaining 最小); 无 limit 的窗不参与比较 */
function tightestOf(metrics: Metric[]): Metric | null {
  const ratio = (m: Metric) => (m.limit !== undefined && m.limit > 0 ? m.used / m.limit : -1);
  return metrics.reduce<Metric | null>((acc, m) => (acc === null || ratio(m) > ratio(acc) ? m : acc), null);
}

/** 未来 ProviderCard 的目标结构 mock: head + body slot(正常=窗口区卡内排版方案 / 异常=AbnormalBodyMock)。
 * variant 只改窗口区组织方式(卡内排版), QuotaMeter 实例一律默认排版 row(每窗一个)。 */
function ProviderCardMock({
  p,
  variant = "stacked",
}: {
  p: ProviderSnapshot;
  variant?: "stacked" | "fusion" | "zoned" | "compact";
}) {
  const health = providerHealth(p);
  const abnormal = p.status !== "ok";
  const tightest = tightestOf(p.metrics);
  return (
    <div
      className={`qcard qcard--${variant}`}
      data-testid="qcard"
      data-health={health}
      data-variant={abnormal ? "abnormal" : variant}
    >
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
        <>
          {/* S2 头部融合: 最紧窗摘要带(警示底色)直呈头部下方; 窗口区完整列表不变(§6.3 只标不排序) */}
          {variant === "fusion" && tightest && (
            <div className="qcard-tightest-strip" data-testid="qcard-tightest-strip">
              <span className="qcard-strip-label">
                {t("quota.stripTightest" as Parameters<typeof t>[0])}
              </span>
              <WindowMeter m={tightest} />
            </div>
          )}
          {variant === "zoned" ? (
            /* S3 分区卡片式: 窗口按周期分区(短/长), 分区标签 + 区间分隔线 */
            <div className="qcard-windows qcard-windows--zoned">
              {(["short", "long"] as const)
                .map((zone) => ({ zone, items: p.metrics.filter((m) => zoneOf(m.key) === zone) }))
                .filter((z) => z.items.length > 0)
                .map((z) => (
                  <div className="qcard-zone" data-zone={z.zone} key={z.zone}>
                    <span className="qcard-zone-label">
                      {t(
                        (z.zone === "short"
                          ? "quota.zoneShort"
                          : "quota.zoneLong") as Parameters<typeof t>[0],
                      )}
                    </span>
                    {z.items.map((m) => (
                      <WindowMeter key={m.key} m={m} />
                    ))}
                  </div>
                ))}
            </div>
          ) : (
            /* S1 基准竖排(分隔线+8px) / S4 紧凑(无分隔线+ok窗藏重置, 由 hideReset 与 CSS modifier 实现) */
            <div className="qcard-windows">
              {p.metrics.map((m) => (
                <WindowMeter
                  key={m.key}
                  m={m}
                  hideReset={variant === "compact" && metricHealth(m) === "ok"}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Provider 卡片卡内排版方案段定义: tag(方案代号) + variant(窗口区组织) + 画布内容 + i18n 名/说明 */
interface CardOptionDef {
  tag: string;
  testKey: string;
  nameKey: string;
  descKey: string;
  providers: ProviderSnapshot[];
  variant?: "stacked" | "fusion" | "zoned" | "compact";
}

/** S1-S4 = 4 个卡内排版方案(同数据同组件, 只差卡内组织); 末段 = 异常卡共用骨架(auth+error 两例) */
const CARD_OPTIONS: CardOptionDef[] = [
  { tag: "1", testKey: "s1", variant: "stacked", nameKey: "quota.cardS1Name", descKey: "quota.cardS1Desc", providers: [CARD_OK_PROVIDER] },
  { tag: "2", testKey: "s2", variant: "fusion", nameKey: "quota.cardS2Name", descKey: "quota.cardS2Desc", providers: [CARD_OK_PROVIDER] },
  { tag: "3", testKey: "s3", variant: "zoned", nameKey: "quota.cardS3Name", descKey: "quota.cardS3Desc", providers: [CARD_OK_PROVIDER] },
  { tag: "4", testKey: "s4", variant: "compact", nameKey: "quota.cardS4Name", descKey: "quota.cardS4Desc", providers: [CARD_OK_PROVIDER] },
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

        {/* Provider 卡片卡内排版方案(t_698a43c9 round2, #1043): S1-S4 同数据横比 + 异常卡共用骨架 */}
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
                <ProviderCardMock key={`${opt.testKey}-${p.provider_id}`} p={p} variant={opt.variant} />
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
