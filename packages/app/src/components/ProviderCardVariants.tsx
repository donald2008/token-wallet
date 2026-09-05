import type { Metric, MetricUnit, ProviderSnapshot } from "../types";
import { healthLabel, metricHealth, providerHealth, statusBadge } from "../health";
import { t } from "../i18n";
import { QuotaMeter, type QuotaState } from "./QuotaMeter";
import { BarRowTooltip } from "./BarRowTooltip";
import { BrandLogo } from "./brand-logos";
import { StatusDot } from "./StatusDot";

/**
 * ProviderCardVariants — 4 个 Provider 卡片卡内排版方案 mock(t_85237167, 9/5 清空重建)
 *
 * 设计前提(卡体硬约束):
 *  - 唯一窗口行原语 = BarRowTooltip + QuotaMeter(layout=micro)(t_a398348b, 6dde355+ea570a0)
 *    → 契约不动; 每窗一行实例(同源 Metric), hover 弹 micro 四元素
 *  - 现实 provider 1-2 窗(5h + 周); 拒绝 4-6 窗密度压缩 / 周期分区标签
 *  - 用户 8/31 品味: 拒摘要条(警示色带), 低频信息低调
 *  - 异常形态(auth_expired/error)共用骨架 body 变体, 不算独立布局
 *  - setup_hint 授权状态必须承载(保留 t_52e3a7fb 列式修复)
 *  - 8px 网格 / tokens.css / D-016 三态 / e2e DOM 契约零破
 *  - useCardDragSort(D-039)零改 → 拖把手 = BrandLogo
 *
 * 4 方案差异维度(每方案建立在一个真实维度上):
 *   A 基线对照:   头部最小 + 双窗 8px gap + 无新结构 → 与现状 1:1, 认知零成本
 *   B 头部综合态: 头部右侧合并「灯 + 综合态文字」单行 → 信息上抬但无摘要条
 *   C 状态色条:   整卡左竖 2px 色条 + 整卡点击锁住 → 锁住态行 tooltip 常驻
 *   D 头部承担:   头部右侧并入最紧窗用量 + 头部本身成 tooltip 触发器 → 风险数字内联
 *
 * 数据契约(同 S1-S4): kimi 双窗(rolling_5h 80% warn + weekly 20% ok, requests 计数制)
 *   主页窗口行同规; mock 静态不接 IPC; 异常卡(setup_hint)共用 AbnormalBody
 *   新前缀 .qcard2-* / .qvar-canvas--cards2 不占真卡 .card/.card-head,
 *   不与 e2e 真卡选择器(provider-card/.progress 之外)冲突。
 *
 * 不替换主页 ProviderCard; 纯设计文档 + QuotaGallery mock 渲染,
 * 用户选型后另开实现卡。
 */

interface VariantDef {
  /** 方案代号(显示在 qvar-tag) */
  tag: string;
  /** 测试/截图用 key, 嵌进 testid: qvar-cards2-<key> / qvar-canvas-cards2-<key> */
  testKey: string;
  /** i18n 键(quota.card2*) — 方案名 */
  nameKey: string;
  /** i18n 键(quota.card2Desc*) — 方案说明 */
  descKey: string;
  /** 渲染哪个方案 */
  render: (props: { p: ProviderSnapshot; m: Metric[]; abnormal: boolean }) => React.ReactNode;
}

/* ============ 共享子组件 ============ */

/** 共享: 卡头(handle + 名称 + StatusDot + 综合徽章)
 * `compact`=基线/色条方案 A/C, `expanded`=头部综合态 B(加综合态文字)
 * `highlight`=头部承担方案 D(头部并入最紧窗用量, 让该窗行隐藏用量) */
function CardHead({
  p,
  mode,
  highlight,
}: {
  p: ProviderSnapshot;
  mode: "compact" | "expanded";
  /** 头部 tooltip 触发器: 承载最紧窗(D 用), undefined = 头部无 tooltip */
  highlight?: Metric;
}) {
  const health = providerHealth(p);
  const abnormal = p.status !== "ok";
  return (
    <div className={`qcard2-head qcard2-head--${mode}`} data-testid="qcard2-head">
      <span className="qcard2-handle" aria-hidden="true" data-testid="qcard2-handle">
        {/* 拖把手载体 = BrandLogo(D-039); 实现卡沿真卡结构用 brand-block.drag-handle 绑 makeHandleProps */}
        <BrandLogo platform={p.logo ?? p.provider_id} size={14} />
      </span>
      <span className="qcard2-name" title={p.display_name} data-testid="qcard2-name">
        {p.display_name}
      </span>
      {/* D 方案: 头部右侧并入最紧窗用量数字(无摘要条形态, 数字内联到头部信息流) */}
      {highlight && (
        <span className="qcard2-headline" data-testid="qcard2-headline">
          <span className="qcard2-headline-window">{cardWindowTitle(highlight.key)}</span>
          <span className={`qcard2-headline-usage text-${metricHealth(highlight)}`}>
            {formatUsage(highlight)}
          </span>
        </span>
      )}
      {/* B 方案: 综合态徽章(灯+文字同行), A/C 灯+徽章各列右。
       * t_03bdaf1f 终审修正: 文字 = healthLabel(health) 同源, 不再用固定
       * "综合健康" 键; mock kimi warn 卡正确显示「偏低」(与灯色一致)。 */}
      {mode === "expanded" ? (
        <span
          className={`qcard2-status-group text-${health}`}
          data-testid="qcard2-status-group"
        >
          <StatusDot health={health} size={8} />
          <span className="qcard2-status-label">
            {abnormal ? statusBadge(p) : healthLabel(health)}
          </span>
        </span>
      ) : (
        <>
          <StatusDot health={health} size={8} />
          <span className={`qcard2-badge text-${health}`} data-testid="qcard2-badge">
            {statusBadge(p)}
          </span>
        </>
      )}
    </div>
  );
}

/** 共享: 单个窗口行(QuotaMeter 默认排版 row) + 行内 BarRowTooltip(micro)。
 * `hideUsage` = D 方案让头部承担该窗用量, 行隐藏用量避免重复(QuotaMeter 缺省即不渲染, 契约不破) */
type WindowRowProps = {
  metric: Metric;
  /** D 方案让头部承担该窗用量时设为 true, 该窗 QuotaMeter 不渲染 .quota-usage */
  hideUsage?: boolean;
};
function WindowRow({ metric, hideUsage = false }: WindowRowProps) {
  const h = metricHealth(metric);
  return (
    <div className="bar-row" data-testid="qcard2-bar-row" data-metric={metric.key}>
      <QuotaMeter
        layout="row"
        pct={metric.limit !== undefined && metric.limit > 0 ? metric.used / metric.limit : 0}
        state={h === "unknown" ? "ok" : (h as QuotaState)}
        title={cardWindowTitle(metric.key)}
        resetText={cardResetText(metric)}
        used={hideUsage ? undefined : metric.used}
        limit={metric.limit}
        unit={metric.unit}
      />
      {/* 行内 BarRowTooltip: 沿用 6dde355 契约, 不动本体 */}
      <BarRowTooltip metric={metric} />
    </div>
  );
}

/** 窗口行标题(与 registry windowTitle 同规): 取 i18n metric.<key> 展示名, 未知 key 回退原样 */
function cardWindowTitle(key: string): string {
  const metricKey = `metric.${key}` as Parameters<typeof t>[0];
  return t(metricKey).startsWith("metric.") ? key : t(metricKey);
}

/** 窗口行重置行文案: 复用主页 resetText(5h → "X 小时后重置", 其余 → "X 天后重置") */
function cardResetText(m: Metric): string | undefined {
  if (m.reset_at === undefined) return undefined;
  // 走 ProgressBar.resetText 保证与主页同规(t_23800bd4 一致性)
  // 此处直接调, 避免 import 循环(BarRowTooltip 已 import, 复用其内 resetText)
  // 但 BarRowTooltip 的 resetText 未 export, 这里用 QuotaMeter 自身可读版简化:
  // 5h 窗用小时, 其余用天; 实际项目里所有 metric 都来自统一 resetText 管道
  const isShort = m.key === "rolling_5h" || m.key === "session";
  const diff = m.reset_at - Math.floor(Date.now() / 1000);
  if (diff <= 0) return undefined;
  if (isShort) {
    const h = diff / 3600;
    return `${h.toFixed(1)} ${t("quota.card2Hours" as Parameters<typeof t>[0])}`;
  }
  const d = diff / 86400;
  return `${d.toFixed(1)} ${t("quota.card2Days" as Parameters<typeof t>[0])}`;
}

/** 用量格式化(与主页 usageText 语义一致; 简化版避免 import 循环) */
function formatUsage(m: Metric): string {
  const u = (m.unit ?? "percent") as MetricUnit;
  const used = Math.round(m.used);
  if (u === "percent") {
    return `${used}%`;
  }
  // credits/requests: 显示绝对值 + 单位(去硬编码「次」)
  const limit = m.limit !== undefined ? Math.round(m.limit) : null;
  return limit !== null ? `${used} / ${limit} ${u}` : `${used} ${u}`;
}

/** 共享: 异常卡 body(auth_expired+error 共用骨架, 保留 t_52e3a7fb 列式修复) */
function AbnormalBody({ p }: { p: ProviderSnapshot }) {
  const health = providerHealth(p);
  return (
    <div className="qcard2-abnormal" data-testid="qcard2-abnormal">
      <div className={`qcard2-status-line text-${health}`}>
        {p.status === "auth_expired" && (
          <span className="qcard2-lamp" aria-hidden="true">
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
        <div className="qcard2-hint" data-testid="qcard2-hint">
          <span className="qcard2-hint-text">⚑ {p.setup_hint}</span>
          <div className="qcard2-hint-actions">
            {/* 示意(非功能): 实现卡接入 HintCopyButton / OneClickAuth */}
            <span className="qcard2-chip" aria-hidden="true">
              {t("card.copy" as Parameters<typeof t>[0])}
            </span>
            <span className="qcard2-chip" aria-hidden="true">
              {t("card.authStart" as Parameters<typeof t>[0])}
            </span>
          </div>
        </div>
      )}
      {p.alerts.length > 0 && (
        <div className="qcard2-note">{p.alerts.map((a) => a.message).join("; ")}</div>
      )}
    </div>
  );
}

/* ============ 4 个方案渲染函数 ============ */

/** 方案 A · 简洁双行基线
 * 差异点: 头部最小 + 双窗各一行 QuotaMeter(row) + 窗间 8px gap; 无新结构
 * 与 tooltip 关系: 每行内嵌 `<BarRowTooltip metric={m}/>`, 行 hover 弹 micro 四元素
 * 取舍: 与主页窗口行 1:1 完全一致, 认知零成本; 2 窗总高 ~88px, 最中性 */
function VariantA({ p, m, abnormal }: { p: ProviderSnapshot; m: Metric[]; abnormal: boolean }) {
  return (
    <div
      className="qcard2 qcard2--baseline"
      data-testid="qcard2"
      data-variant={abnormal ? "abnormal" : "baseline"}
      data-health={providerHealth(p)}
    >
      <CardHead p={p} mode="compact" />
      {abnormal ? (
        <AbnormalBody p={p} />
      ) : (
        <div className="qcard2-windows" data-testid="qcard2-windows">
          {m.map((mm) => (
            <WindowRow key={mm.key} metric={mm} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 方案 B · 头部综合态 + 整卡 tooltip
 * 差异点: 头部右侧合并「灯+综合态文字」单行; 整卡右上角 ⓘ hover 触发合并 tooltip
 * 与 tooltip 关系: 每行 BarRowTooltip 不变 + 整卡 ⓘ 触发器 hover 弹合并 BarRowTooltip(双窗堆叠)
 * 取舍: 信息上抬(综合态一行), 但**不引入摘要条**(不抽最紧窗, 风险颜色走行内自身 color); ⓘ 是新交互 */
function VariantB({ p, m, abnormal }: { p: ProviderSnapshot; m: Metric[]; abnormal: boolean }) {
  return (
    <div
      className="qcard2 qcard2--expanded-head"
      data-testid="qcard2"
      data-variant={abnormal ? "abnormal" : "expanded-head"}
      data-health={providerHealth(p)}
    >
      <div className="qcard2-head-wrap">
        <CardHead p={p} mode="expanded" />
        {!abnormal && (
          /* 整卡 tooltip 触发器: ⓘ, hover 弹合并双窗 BarRowTooltip
           * 纯 CSS .qcard2-trigger:hover ~ .qcard2-merged-tip 显示, 不动 BarRowTooltip 契约 */
          <span
            className="qcard2-trigger"
            data-testid="qcard2-trigger"
            aria-label={t("quota.card2MergedTip" as Parameters<typeof t>[0])}
          >
            ⓘ
            <span className="qcard2-merged-tip" data-testid="qcard2-merged-tip">
              {m.map((mm) => (
                <BarRowTooltip key={mm.key} metric={mm} />
              ))}
            </span>
          </span>
        )}
      </div>
      {abnormal ? (
        <AbnormalBody p={p} />
      ) : (
        <div className="qcard2-windows">
          {m.map((mm) => (
            <WindowRow key={mm.key} metric={mm} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 方案 C · 状态色条 + 锁住态 tooltip
 * 差异点: 整卡左竖 2px 色条(--ok/--warn/--bad, 对应最紧窗 health) + 整卡可点击锁住
 * 与 tooltip 关系: 每行 BarRowTooltip 默认 hover; 锁住态 CSS 让 .bar-tooltip 常驻揭示(不依赖 hover)
 * 取舍: 整卡色条=纯视觉锚点(2px, 不占宽度预算); 锁住态=新交互, 持续可见 micro 适合双窗对比; 锁住用 tabIndex+aria-pressed(无 JS 状态机) */
function VariantC({ p, m, abnormal }: { p: ProviderSnapshot; m: Metric[]; abnormal: boolean }) {
  return (
    <div
      className="qcard2 qcard2--status-bar"
      data-testid="qcard2"
      data-variant={abnormal ? "abnormal" : "status-bar"}
      data-health={providerHealth(p)}
      /* tabIndex + role=button 让整卡可键盘聚焦; 整卡聚焦 → CSS 让内部 .bar-tooltip 常驻 */
      tabIndex={abnormal ? -1 : 0}
      role={abnormal ? undefined : "button"}
      aria-pressed={undefined}
      data-pinnable={!abnormal}
    >
      <CardHead p={p} mode="compact" />
      {abnormal ? (
        <AbnormalBody p={p} />
      ) : (
        <div className="qcard2-windows">
          {m.map((mm) => (
            <WindowRow key={mm.key} metric={mm} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 方案 D · 头部承担最紧窗用量(无摘要条)
 * 差异点: 头部右侧并入「最紧窗用量数字+窗名小字」; 该窗行隐藏用量(避免重复)
 * 与 tooltip 关系: 每行 BarRowTooltip 不变; 头部 hover 也弹该最紧窗的 BarRowTooltip(头部成 tooltip 触发器)
 * 取舍: 风险数字一瞥可见, **不用摘要条形态**(数字内联到头部信息流, 不抽警示色带);
 *        隐含 S2「风险上抬」精神但换形态; 与 B 同属头部扩展, 区别在 D 显数字 / B 显综合态文字 */
function VariantD({ p, m, abnormal }: { p: ProviderSnapshot; m: Metric[]; abnormal: boolean }) {
  // 最紧窗: 比例最大(remaining 最小)的 metric; 无 limit 不参与
  const tightest = m.reduce<Metric | null>((acc, mm) => {
    if (mm.limit === undefined || mm.limit <= 0) return acc;
    const r = mm.used / mm.limit;
    if (acc === null) return mm;
    const accLimit = acc.limit;
    if (accLimit === undefined || accLimit <= 0) return mm;
    const accR = acc.used / accLimit;
    return r > accR ? mm : acc;
  }, null);
  return (
    <div
      className="qcard2 qcard2--head-takes"
      data-testid="qcard2"
      data-variant={abnormal ? "abnormal" : "head-takes"}
      data-health={providerHealth(p)}
    >
      <div className="qcard2-head-wrap">
        <CardHead p={p} mode="compact" highlight={abnormal ? undefined : (tightest ?? undefined)} />
        {!abnormal && tightest && (
          /* 头部 tooltip 触发器: 与 B ⓘ 形态对齐, 只作 hover 锚,
           * 不再渲染 formatUsage(避免与 qcard2-headline 数字重复, t_03bdaf1f 终审修正);
           * 纯 CSS .qcard2-trigger:hover ~ .qcard2-head-tip 显示 */
          <span
            className="qcard2-trigger qcard2-trigger--head"
            data-testid="qcard2-head-trigger"
            aria-label={t("quota.card2HeadTip" as Parameters<typeof t>[0])}
          >
            <span aria-hidden="true">ⓘ</span>
            <span className="qcard2-head-tip" data-testid="qcard2-head-tip">
              <BarRowTooltip metric={tightest} />
            </span>
          </span>
        )}
      </div>
      {abnormal ? (
        <AbnormalBody p={p} />
      ) : (
        <div className="qcard2-windows">
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

/* ============ 导出: 4 方案定义 ============ */

export const PROVIDER_CARD_VARIANTS: VariantDef[] = [
  {
    tag: "A",
    testKey: "a",
    nameKey: "quota.card2AName",
    descKey: "quota.card2ADesc",
    render: ({ p, m, abnormal }) => <VariantA p={p} m={m} abnormal={abnormal} />,
  },
  {
    tag: "B",
    testKey: "b",
    nameKey: "quota.card2BName",
    descKey: "quota.card2BDesc",
    render: ({ p, m, abnormal }) => <VariantB p={p} m={m} abnormal={abnormal} />,
  },
  {
    tag: "C",
    testKey: "c",
    nameKey: "quota.card2CName",
    descKey: "quota.card2CDesc",
    render: ({ p, m, abnormal }) => <VariantC p={p} m={m} abnormal={abnormal} />,
  },
  {
    tag: "D",
    testKey: "d",
    nameKey: "quota.card2DName",
    descKey: "quota.card2DDesc",
    render: ({ p, m, abnormal }) => <VariantD p={p} m={m} abnormal={abnormal} />,
  },
];

/** 4 方案的 mock 数据快照(同 S1-S4 同规: kimi 双窗, 主页同形态)
 *  异常段(abn)走 AbnormalBody, 不复用 4 方案变体(共用骨架而非独立布局) */
export function getVariantMockProviders(): {
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
