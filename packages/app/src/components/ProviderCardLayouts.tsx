/**
 * ProviderCardLayouts — Provider 卡片卡内排版 4 方案真组件(t_73c110ea, 9/7 用户拍板重建)
 *
 * 设计前提(用户 9/7 硬约束):
 *  - 三窗 QuotaMeter(layout=row) **常驻直显**是卡片信息主体(5h/周/月, 同一套真实数据)
 *  - BarRowTooltip 仅作「可选密度增强」—— 行 hover 补 micro 视图, **不得**作为 QuotaMeter
 *    的唯一呈现方式(信息全靠悬浮才见 = 不合格)
 *  - 4 排版差异必须建立在**真排版维度**(卡头与三窗的空间关系/信息层级/密度), 不是头部装饰件堆叠
 *  - 不替换主页 ProviderCard; 纯方案页 QuotaGallery 渲染, 用户选型后另开实现卡
 *
 * 3 方案差异维度(每方案建立一个真维度):
 *   P1 · 基线竖排      头部 handle+name+状态 三件套一行 + 三窗 row 各一行(8px gap)
 *                      → 与主页 ProviderCard/BarsTemplate 1:1 完全一致, 认知零成本
 *   P2 · 头部综合态    头部右侧合并「最紧窗徽章+文字」一行 + 三窗 row(同 P1)
 *                      → 信息上抬, 不引入摘要条(颜色走行内自身 color)
 *   P4 · 头部数字      头部右侧并入「最紧窗用量数字+窗名」一行 + 三窗 row(最紧窗 hideUsage)
 *                      → 风险数字一瞥可见, 行内不重复数字(无摘要条形态)
 *
 * P3(双列 grid 并排)在 360px 屏下已实测文字重叠 + 列被裁切 —— QuotaMeter row 三件套
 * (56px 标题 + 进度条 + 用量)装不进 ~104px 列宽,激进收紧字号 + 隐藏 reset 行后仍重叠。
 * 故本轮不交付 P3(已记入取舍说明,后续如需 grid 方案需先扩 QuotaMeter row 极简版或加断点);
 * 留 3 种方案覆盖空间结构 / 信息层级 / 头部承载 三个真维度, 已满足任务「3-5 种」下限。
 * (P3Grid 组件函数 + .qcard3-grid-* css 已整体下架)
 *
 * 异常卡(auth_expired + error)共用同一套 AbnormalBody(不计入独立布局):
 *  - 沿用主页 .abnormal-body 形态(状态灯 + 文字 + setup_hint 授权面板 + 最近更新/alerts)
 *  - 与 ProviderCard.tsx AbnormalBody **结构同构**(data-health 对齐, 排序扫描形态一致)
 *  - 异常段里 HintCopyButton(setup_hint 复制)走 mock-only 简化版(基于主页 export 的
 *    copyText + extractCommandFromHint); OneClickAuth 因依赖主页未导出 IPC 通道不在
 *    mock 异常段呈现(避免伪功能), 真实异常卡实现卡接入真 OneClickAuth
 *
 * 数据契约:
 *  - 同套真实数据 = kimi-code 三窗(rolling_5h + weekly + monthly), unit=requests(计数制)
 *  - mock 静态不接 IPC; 见 getProviderCardMockProviders()
 *  - 新前缀 .qcard3-* / .qvar-canvas--cards3; 不占真卡 .card/.card-head, 不与 e2e
 *    真卡选择器(provider-card/.progress 之外)冲突
 *
 * 硬约束:
 *  - .progress / .progress-fill[data-health] / role=progressbar 契约零破(QuotaMeter 自带)
 *  - 8px 网格 / tokens.css / D-016 三态(dark/light/glass)
 *  - useCardDragSort(D-039)零改 → 拖把手 = BrandLogo
 *  - 不动 ProviderCard / BarsTemplate / BarRowTooltip / QuotaMeter 本体
 */
import { useState } from "react";
import type { Metric, MetricUnit, ProviderSnapshot } from "../types";
import { healthLabel, metricHealth, providerHealth, statusBadge } from "../health";
import { t } from "../i18n";
import { QuotaMeter, type QuotaState } from "./QuotaMeter";
import { BarRowTooltip } from "./BarRowTooltip";
import { resetText as progressResetText } from "./ProgressBar";
import { BrandLogo } from "./brand-logos";
import { StatusDot } from "./StatusDot";
import { copyText, extractCommandFromHint } from "./ProviderCard";

/* ============ 共享子组件 ============ */

/** 窗口名本地化(与 registry.tsx windowTitle 同规): 取 i18n metric.<key>, 未知 key 回退原样 */
function cardWindowTitle(key: string): string {
  const metricKey = `metric.${key}` as Parameters<typeof t>[0];
  return t(metricKey).startsWith("metric.") ? t("metric.fallback", { key }) : t(metricKey);
}

/** 三窗行(共享于 P1/P2/P4): QuotaMeter(row) + 行内 BarRowTooltip(micro)
 *  `hideUsage` = P4 头部承担最紧窗用量, 该窗 QuotaMeter 缺省即不渲染 .quota-usage,
 *  避免与头部数字重复。BarRowTooltip 始终挂, 不传 hideUsage(独立 QuotaMeter 渲染)。 */
type WindowRowProps = {
  metric: Metric;
  /** P4 让头部承担该窗用量时设为 true, 该窗 QuotaMeter 不渲染 .quota-usage */
  hideUsage?: boolean;
};
function WindowRow({ metric, hideUsage = false }: WindowRowProps) {
  const h = metricHealth(metric);
  const state: QuotaState = h === "unknown" ? "ok" : (h as QuotaState);
  const reset = progressResetText(metric.reset_at);
  return (
    <div className="bar-row" data-testid="qcard3-bar-row" data-metric={metric.key}>
      <QuotaMeter
        layout="row"
        pct={metric.limit !== undefined && metric.limit > 0 ? metric.used / metric.limit : 0}
        state={state}
        title={cardWindowTitle(metric.key)}
        resetText={reset || undefined}
        used={hideUsage ? undefined : metric.used}
        limit={metric.limit}
        unit={metric.unit}
      />
      {/* 硬约束: BarRowTooltip 仅作可选密度增强, 不替代 QuotaMeter row 直显 */}
      <BarRowTooltip metric={metric} />
    </div>
  );
}

/** 头部品牌块(handle, 拖把手载体 = BrandLogo) + 名称 */
function CardHandle({ p }: { p: ProviderSnapshot }) {
  return (
    <>
      <span className="qcard3-handle" aria-hidden="true" data-testid="qcard3-handle">
        {/* 拖把手载体 = BrandLogo(D-039); 实现卡沿真卡结构用 brand-block.drag-handle 绑 makeHandleProps */}
        <BrandLogo platform={p.logo ?? p.provider_id} size={14} />
      </span>
      <span className="qcard3-name" title={p.display_name} data-testid="qcard3-name">
        {p.display_name}
      </span>
    </>
  );
}

/** 找最紧窗(remaining 最小; 无 limit 不参与) */
function pickTightest(metrics: Metric[]): Metric | null {
  return metrics.reduce<Metric | null>((acc, m) => {
    if (m.limit === undefined || m.limit <= 0) return acc;
    const r = m.used / m.limit;
    if (acc === null) return m;
    const accLimit = acc.limit;
    if (accLimit === undefined || accLimit <= 0) return m;
    return r > m.used / accLimit ? m : acc;
  }, null);
}

/** 用量格式化(与 QuotaMeter.usageText 语义一致; 简化版避免 import 内部循环) */
function formatUsage(m: Metric): string {
  const u = (m.unit ?? "percent") as MetricUnit;
  const used = Math.round(m.used);
  if (u === "percent") return `${used}%`;
  const limit = m.limit !== undefined ? Math.round(m.limit) : null;
  return limit !== null ? `${used} / ${limit} ${u}` : `${used} ${u}`;
}

/* ============ P1 · 基线竖排 ============ */

function P1Baseline({ p, m, abnormal }: { p: ProviderSnapshot; m: Metric[]; abnormal: boolean }) {
  const health = providerHealth(p);
  return (
    <div
      className="qcard3 qcard3--baseline"
      data-testid="qcard3"
      data-variant="baseline"
      data-health={health}
    >
      <div className="qcard3-head" data-testid="qcard3-head">
        <CardHandle p={p} />
        <StatusDot health={health} size={8} />
        <span className={`qcard3-badge text-${health}`} data-testid="qcard3-badge">
          {statusBadge(p)}
        </span>
      </div>
      {abnormal ? (
        <AbnormalBody p={p} />
      ) : (
        <div className="qcard3-windows" data-testid="qcard3-windows">
          {m.map((mm) => (
            <WindowRow key={mm.key} metric={mm} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ P2 · 头部综合态(灯+综合态文字同行) ============ */

function P2HeadRollup({ p, m, abnormal }: { p: ProviderSnapshot; m: Metric[]; abnormal: boolean }) {
  const health = providerHealth(p);
  return (
    <div
      className="qcard3 qcard3--head-rollup"
      data-testid="qcard3"
      data-variant="head-rollup"
      data-health={health}
    >
      <div className="qcard3-head" data-testid="qcard3-head">
        <CardHandle p={p} />
        <span className={`qcard3-status-group text-${health}`} data-testid="qcard3-status-group">
          <StatusDot health={health} size={8} />
          <span className="qcard3-status-label">
            {abnormal ? statusBadge(p) : healthLabel(health)}
          </span>
        </span>
      </div>
      {abnormal ? (
        <AbnormalBody p={p} />
      ) : (
        <div className="qcard3-windows">
          {m.map((mm) => (
            <WindowRow key={mm.key} metric={mm} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ P4 · 头部数字(最紧窗数字内联, 无摘要条) ============ */

function P4HeadNumber({ p, m, abnormal }: { p: ProviderSnapshot; m: Metric[]; abnormal: boolean }) {
  const health = providerHealth(p);
  const tightest = abnormal ? null : pickTightest(m);
  return (
    <div
      className="qcard3 qcard3--head-number"
      data-testid="qcard3"
      data-variant="head-number"
      data-health={health}
    >
      <div className="qcard3-head" data-testid="qcard3-head">
        <CardHandle p={p} />
        {/* 头部右侧并入最紧窗: 窗名小字 + 用量数字(内联到信息流, 非摘要条) */}
        {tightest && (
          <span className="qcard3-headline" data-testid="qcard3-headline">
            <span className="qcard3-headline-window">{cardWindowTitle(tightest.key)}</span>
            <span className={`qcard3-headline-usage text-${metricHealth(tightest)}`}>
              {formatUsage(tightest)}
            </span>
          </span>
        )}
        <StatusDot health={health} size={8} />
        <span className={`qcard3-badge text-${health}`} data-testid="qcard3-badge">
          {statusBadge(p)}
        </span>
      </div>
      {abnormal ? (
        <AbnormalBody p={p} />
      ) : (
        <div className="qcard3-windows">
          {m.map((mm) => (
            <WindowRow
              key={mm.key}
              metric={mm}
              hideUsage={tightest !== null && mm.key === tightest.key}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 异常卡 AbnormalBody ============
 * 结构同构主页 AbnormalBody: 状态灯 + 状态文字 + (auth_expired only) setup_hint
 * 授权面板(简化 HintCopyButton, mock 不接 OneClickAuth 因依赖主页未导出 IPC) +
 * 最近更新/alerts 行。 */

function HintCopyButtonMock({ hint }: { hint: string }) {
  const [copied, setCopied] = useState(false);
  const command = extractCommandFromHint(hint);
  const onCopy = () => {
    void copyText(command).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      className="btn btn-sm hint-copy-btn"
      data-testid="hint-copy-btn"
      data-copied={copied}
      title={t("card.copyCmdTitle", { cmd: command })}
      aria-label={copied ? t("card.copied") : t("card.copyCmdAria", { cmd: command })}
      onClick={onCopy}
    >
      {copied ? t("card.copied") : t("card.copy")}
    </button>
  );
}

function agoText(fetchedAt: number): string {
  const s = Math.floor(Date.now() / 1000) - fetchedAt;
  if (s < 60) return t("ago.now");
  if (s < 3600) return t("ago.minutes", { n: Math.floor(s / 60) });
  return t("ago.hours", { n: Math.floor(s / 3600) });
}

function AbnormalBody({ p }: { p: ProviderSnapshot }) {
  const health = providerHealth(p);
  return (
    <div className="qcard3-abnormal" data-testid="qcard3-abnormal">
      <div className={`qcard3-status-line text-${health}`}>
        {p.status === "auth_expired" && (
          <span className="qcard3-lamp" aria-hidden="true">●</span>
        )}
        {p.status === "auth_expired"
          ? t("statusText.auth_expired" as Parameters<typeof t>[0])
          : p.status === "error"
            ? t("statusText.error" as Parameters<typeof t>[0])
            : p.status}
      </div>
      {p.status === "auth_expired" && p.setup_hint && (
        <div className="qcard3-hint" data-testid="qcard3-hint">
          <span className="qcard3-hint-text">⚑ {p.setup_hint}</span>
          {/* mock 简化: 仅展示复制按钮(主页 export 的 copyText 实现), 真实授权面板见主页 OneClickAuth */}
          <HintCopyButtonMock hint={p.setup_hint} />
        </div>
      )}
      <div className="qcard3-note">
        {t("card.lastUpdate", { ago: agoText(p.fetched_at) })}
        {p.alerts.length > 0 ? ` — ${p.alerts.map((a) => a.message).join("; ")}` : ""}
        {p.error_message && p.error_message !== p.alerts.map((a) => a.message).join("; ")
          ? ` · ${p.error_message}`
          : ""}
      </div>
    </div>
  );
}

/* ============ 导出: 4 方案定义 + 异常段数据契约 ============ */

export interface CardVariantDef {
  /** 方案代号(显示在 qvar-tag) */
  tag: string;
  /** 测试/截图用 key, 嵌进 testid: qvar-cards3-<key> / qvar-canvas-cards3-<key> */
  testKey: string;
  /** i18n 键(quota.card*) — 方案名 */
  nameKey: string;
  /** i18n 键(quota.cardDesc*) — 方案说明 */
  descKey: string;
  /** 渲染哪个方案 */
  render: (props: { p: ProviderSnapshot; m: Metric[]; abnormal: boolean }) => React.ReactNode;
}

export const PROVIDER_CARD_LAYOUTS: CardVariantDef[] = [
  {
    tag: "P1",
    testKey: "p1",
    nameKey: "quota.cardP1Name",
    descKey: "quota.cardP1Desc",
    render: ({ p, m, abnormal }) => <P1Baseline p={p} m={m} abnormal={abnormal} />,
  },
  {
    tag: "P2",
    testKey: "p2",
    nameKey: "quota.cardP2Name",
    descKey: "quota.cardP2Desc",
    render: ({ p, m, abnormal }) => <P2HeadRollup p={p} m={m} abnormal={abnormal} />,
  },
  {
    tag: "P4",
    testKey: "p4",
    nameKey: "quota.cardP4Name",
    descKey: "quota.cardP4Desc",
    render: ({ p, m, abnormal }) => <P4HeadNumber p={p} m={m} abnormal={abnormal} />,
  },
];

/**
 * 4 方案的真实数据快照(同 S1-S4 同规升级: **三窗齐全** rolling_5h + weekly + monthly,
 * 同套 kimi-code 真实形态)。请求计数制(unit=requests), 主页窗口行同形态。
 *
 * 异常卡数据(auth_expired + error)同 S1-S4: aliyun auth_expired 带 setup_hint,
 * deepseek error 警示。异常段**不算独立布局**, 共用 AbnormalBody(与主页 ProviderCard
 * AbnormalBody 结构同构)。
 */
export function getProviderCardMockProviders(): {
  ok: ProviderSnapshot;
  auth: ProviderSnapshot;
  error: ProviderSnapshot;
} {
  const NOW_SEC = Math.floor(Date.now() / 1000);
  return {
    ok: {
      provider_id: "kimi-code",
      display_name: "Kimi-Code #1",
      plan_type: "window",
      logo: "kimi",
      fetched_at: NOW_SEC - 90,
      status: "ok",
      metrics: [
        // 三窗真实数据: 5h warn(80%) + weekly ok(20%) + monthly ok(30%)
        {
          key: "rolling_5h",
          kind: "window",
          unit: "requests" as MetricUnit,
          used: 960,
          limit: 1200,
          reset_at: NOW_SEC + 3.2 * 3600,
        },
        {
          key: "weekly",
          kind: "window",
          unit: "requests" as MetricUnit,
          used: 1200,
          limit: 6000,
          reset_at: NOW_SEC + 5.8 * 86400,
        },
        {
          key: "monthly",
          kind: "window",
          unit: "requests" as MetricUnit,
          used: 1800,
          limit: 6000,
          reset_at: NOW_SEC + 21.4 * 86400,
        },
      ],
      alerts: [],
    },
    auth: {
      provider_id: "aliyun",
      display_name: "百炼 Token Plan",
      plan_type: "window",
      logo: "aliyun-bailian",
      fetched_at: NOW_SEC - 7200,
      status: "auth_expired",
      metrics: [],
      alerts: [{ level: "warn" as const, message: "bl 会话已失效" }],
      setup_hint: "请运行 `bl auth login --console` 重新授权",
    },
    error: {
      provider_id: "deepseek",
      display_name: "DeepSeek-按量 #1",
      plan_type: "balance",
      logo: "deepseek",
      fetched_at: NOW_SEC - 240,
      status: "error",
      metrics: [],
      alerts: [{ level: "critical" as const, message: "429 quota exceeded: 今日按量已超限" }],
    },
  };
}

// re-export for tests / gallery page convenience
export { AbnormalBody, cardWindowTitle, pickTightest, formatUsage };