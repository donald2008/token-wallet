/**
 * Agent 卡(t_9255cb63, D-055 后续; t_56c66972 方案 A-rev3 重构):
 * 主页列表 item,与 ProviderCard 同构(共用 .card/.card-head/.card-name/.card-status-text 等),
 * 数据源 = MCP daemon usage_summary(group_by=["agent"]) — **非 mock**。
 *
 * 视觉同构(plan-a-v3.html 正常态 + 边界①):
 *   header: logo + 名称 + 状态点[有活动/空闲/今天无上报/数据滞后] + 悬浮删除钮(t_6eb3e728 ③)
 *   主体: token 总量(大数字,必有) + 金额副标(可空留白, 拍板契约)
 *   尾部: meta 行**去词化**——左 = calls 数字, 右 = 时间(居中无标签, 位置约定自明)
 *   t_56c66972: 大屏入口整卡移除(全局唯一入口上收到置顶组件 AgentUsageHero)
 *
 * 降级: daemon 不可达 → 整卡显式「daemon 未连接」空态(不静默吞成 0)
 */
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import type { SummaryRow } from "../mcpQueryTypes";

/** 活动状态 + 边界① 数据陈旧(>30min 无上报) */
export type AgentActivityState = "active" | "idle" | "no_report_today" | "stale";

/** 边界① 陈旧阈值: agent 超 30 分钟无上报(design-gate.json + 卡体明文 30min) */
export const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export interface AgentCardProps {
  /** agent_id(契约: usage_summary rows[].group, 单维 group_by=["agent"]) */
  agentId: string;
  /** 聚合行 — tokens/cost/currency/by_status 全从这取 */
  row: SummaryRow;
  /** 活动状态 — 任务卡契约: 有活动 / 空闲 / 今天无上报。
   *  启发(由调用方算好传进来):
   *    calls > 0 且 by_status.completed > 0 → "active"
   *    calls > 0 但 completed = 0 (只剩 partial/unknown) → "idle" (流式中断 / 占位)
   *    calls = 0 → "no_report_today"
   *  ⚠️ "stale"(数据滞后) 由本组件依 row.latest_ts 自行判定(见 staleOf), 调用方不必传。
   */
  activity: AgentActivityState;
  /** daemon 数据快照时间戳(usage_summary.generated_at) — meta 右列兜底时间 + 陈旧判定的「now」 */
  generatedAt: string;
  /** 删除该 agent 全部上报数据回调(t_6eb3e728 ③; 缺省=不渲染删除钮, e2e mock 场景可控) */
  onDeleteUsage?: (agentId: string) => Promise<boolean>;
}

const ACTIVITY_LABEL: Record<AgentActivityState, string> = {
  active: "有活动",
  idle: "空闲",
  no_report_today: "今天无上报",
  stale: "数据滞后",
};

/** token 总量(三分项之和 — 任务卡「大数字, 必有」契约).
 *  ⚠️ 与 daemon §4.2 "usage_records.tokens = input_cache_miss + output" 不一致:
 *  主页 Agent 卡面向用户展示「总共花了多少 token」, 三分项之和更直观,
 *  usage_records 的语义是计费 token, 二者用途不同。注释明示, 不静默改契约。 */
export function totalTokens(
  row: Pick<SummaryRow, "input_cache_hit_tokens" | "input_cache_miss_tokens" | "output_tokens">,
): number {
  return row.input_cache_hit_tokens + row.input_cache_miss_tokens + row.output_tokens;
}

/** token 大数字格式化(t_4b7984d9 B): 用户拍板全数字展示(「4,474,000 比 4.5M 震撼」)。
 *  删原 K/M 简写分支, 一律 Intl.NumberFormat("en-US") 千分位完整展示;
 *  365px 卡片宽度下 9 位数字 + 「tokens」unit 走 .agent-tokens-number 的
 *  font-variant-numeric: tabular-nums + clamp 字号自适应, **禁止截断/换行**。
 *  AgentDashboardC 同步: hero 区与 detail-list 的 tokens 列与其自有 fmt 函数保持同口径。 */
const fmtWhole = new Intl.NumberFormat("en-US");
export function formatTokens(n: number): string {
  return fmtWhole.format(n);
}

/** 金额格式化 — cost_total=null 或 currency=null → 空串(拍板契约: 留空不显示) */
export function formatCost(costTotal: number | null, currency: string | null): string {
  if (costTotal == null || currency == null) return "";
  // 截到 2 位小数(USD/CNY 等常用 2 位, daemon 不返 ¥/$ 前缀, 由前端拼)
  const num = costTotal.toFixed(2);
  return `${num} ${currency}`;
}

const ACTIVITY_HEALTH: Record<AgentActivityState, "ok" | "warn" | "unknown"> = {
  active: "ok",
  idle: "warn",
  no_report_today: "unknown",
  // 边界①: 黄点(mock .astatus .adot style=background:var(--warn))
  stale: "warn",
};

/** 边界① 陈旧判定(纯函数, 可单测):
 *  row.latest_ts 与快照时间(generated_at)差 > 30min → 数据滞后。
 *  ⚠️ latest_ts 缺失(daemon 未提供该字段)或时间不可解析 → **不判陈旧**(宁可不标, 不误报)。 */
export function staleOf(
  latestTs: string | null | undefined,
  generatedAt: string,
  thresholdMs: number = STALE_THRESHOLD_MS,
): boolean {
  if (!latestTs || !generatedAt) return false;
  const latest = Date.parse(latestTs);
  const snap = Date.parse(generatedAt);
  if (!Number.isFinite(latest) || !Number.isFinite(snap)) return false;
  return snap - latest > thresholdMs;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** meta 右列时间文案(对稿 plan-a-v3 边界①):
 *  与快照同日 → "HH:MM"; 前一日 → "昨天 HH:MM"; 更早 → "YYYY-MM-DD HH:MM"。 */
export function formatMetaTime(iso: string | null | undefined, refIso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const ref = new Date(refIso);
  if (!Number.isNaN(ref.getTime())) {
    const dayOf = (x: Date) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
    if (dayOf(d) === dayOf(ref)) return hhmm;
    const y = new Date(ref);
    y.setDate(y.getDate() - 1);
    if (dayOf(d) === dayOf(y)) return `昨天 ${hhmm}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hhmm}`;
}

/** 陈旧快照带文案(mock 边界① 逐字): 「◇ 数据为 <YYYY-MM-DD HH:MM> 前的快照 — agent 可能已下线」 */
export function staleBandText(latestTs: string): string {
  return `◇ 数据为 ${formatMetaTime(latestTs, "")} 前的快照 — agent 可能已下线`;
}

/**
 * Agent 标识 → logo glyph 缩写(任务卡定稿无品牌 sprite; 大写首字母 1 字符占位)。
 * 真接入 daemon 时 hook 上报的 agent_id 会含 harness, 此处仅展示 ID 头字符。
 */
function logoGlyph(agentId: string): string {
  const trimmed = agentId.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

export function AgentCard({
  agentId,
  row,
  activity,
  generatedAt,
  onDeleteUsage,
}: AgentCardProps): ReactNode {
  const tokens = totalTokens(row);
  const costStr = formatCost(row.cost_total, row.currency);
  // 边界① 数据滞后(>30min 无上报)覆盖常规活动态; 优先级: stale > active/idle/no_report_today
  const stale = staleOf(row.latest_ts, generatedAt);
  const effActivity: AgentActivityState = stale ? "stale" : activity;
  const health = ACTIVITY_HEALTH[effActivity];
  // 右侧时间列: agent 级 latest_ts 优先, 缺失回落快照 generated_at(daemon 未提供 latest_ts 时格式不变)
  const metaTime = formatMetaTime(row.latest_ts ?? generatedAt, generatedAt);
  // t_6eb3e728 ③: 删除确认二态(false=普通卡 / true=确认气泡浮出); ProviderCard.confirming 同模式
  const [confirming, setConfirming] = useState(false);
  // 删除失败错误态(daemon 未就绪等): 显式报错不静默(卡面 ③ 错误态要求)
  const [delError, setDelError] = useState(false);

  const onConfirmDelete = useCallback(() => {
    setConfirming(false);
    if (!onDeleteUsage) return;
    void onDeleteUsage(agentId).then((ok) => {
      setDelError(!ok);
      if (!ok) {
        // 错误态瞬态 8s 自动清除(用户可见窗口足够; IPC 超时 5s + UI 停留 8s), 重新 hover 再删可清
        window.setTimeout(() => setDelError(false), 8000);
      }
    });
  }, [agentId, onDeleteUsage]);

  return (
    <section
      className={`card agent-card${onDeleteUsage ? " is-deletable" : ""}`}
      data-testid="agent-card"
      data-agent={agentId}
      data-health={health}
      data-stale={stale ? "true" : undefined}
      data-del-error={delError ? "true" : undefined}
    >
      {/* t_6eb3e728 ③: 悬浮删除钮 — ProviderCard.card-del-btn 同款纪律(按钮自为热区:
          opacity:0 + pointer-events:auto, .agent-card:hover 单条触发, focus 键盘可达;
          不叠多层热区)。绝对定位锚卡右上, 确认气泡浮出时互斥隐藏(与 ProviderCard 同)。 */}
      {onDeleteUsage && !confirming && (
        <button
          type="button"
          className="btn btn-icon btn-danger agent-del-btn"
          data-testid={`agent-delete-${agentId}`}
          title={`删除 ${agentId} 的全部上报数据`}
          aria-label={`删除 ${agentId} 的全部上报数据`}
          onClick={() => setConfirming(true)}
        >
          {/* 手绘垃圾桶(D-002 不引图标库, 与 ProviderCard.card-del-btn 同 stroke 风格) */}
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M3.4 4.6h9.2M6.4 4.6V3.1h3.2v1.5M4.6 4.6l.5 8.3h5.8l.5-8.3M6.8 6.9v4.1M9.2 6.9v4.1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {onDeleteUsage && confirming && (
        // 二次确认气泡(t_6eb3e728 ③): ProviderCard.card-confirm 同款形态(绝对定位浮卡右上,
        // 不挤压 360px 卡头), 文案含 agent_id + 将删除行数(calls) + 不可逆
        <span className="confirm-row card-confirm agent-confirm" data-testid={`agent-confirm-row-${agentId}`}>
          <span className="confirm-text">
            将删除 agent <b>{agentId}</b> 的全部 {row.calls} 条上报数据，不可逆
          </span>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            data-testid={`agent-confirm-del-${agentId}`}
            onClick={onConfirmDelete}
          >
            确认删除
          </button>
          <button
            type="button"
            className="btn btn-sm"
            data-testid={`agent-confirm-cancel-${agentId}`}
            onClick={() => setConfirming(false)}
          >
            取消
          </button>
        </span>
      )}
      <div className="card-head">
        <span className="agent-logo" data-testid="agent-logo" aria-hidden="true">
          {logoGlyph(agentId)}
        </span>
        <span className="card-name" title={agentId}>
          {agentId}
        </span>
        <span className="status-dot" data-testid="agent-status-dot" data-health={health} aria-hidden="true" />
        <span className={`card-status-text text-${health}`} data-testid="agent-activity-badge">
          {ACTIVITY_LABEL[effActivity]}
        </span>
      </div>
      <div className="agent-card-body">
        <div className="agent-tokens" data-testid="agent-tokens" title={`${tokens.toLocaleString("en-US")} tokens`}>
          <span className={`agent-tokens-number${stale ? " is-stale" : ""}`}>{formatTokens(tokens)}</span>
          <span className="agent-tokens-unit">tokens</span>
        </div>
        <div
          className={`agent-cost${costStr === "" ? " is-empty" : ""}`}
          data-testid="agent-cost"
          aria-hidden={costStr === "" ? "true" : undefined}
        >
          {costStr}
        </div>
        {delError && (
          <p className="agent-del-error text-error" data-testid={`agent-delete-error-${agentId}`} role="alert">
            删除失败：agent {agentId} 的数据未删除 — daemon 未连接或删除未生效，请确认 daemon 运行后重试。
          </p>
        )}
        {/* meta 行去词化(plan-a-v3): 左 = calls 数字, 右 = 时间(位置约定自明, 无「calls」「更新」词) */}
        <div className="agent-meta" data-testid="agent-meta">
          <span data-testid="agent-meta-calls">{row.calls}</span>
          {metaTime && (
            <time data-testid="agent-meta-time" dateTime={row.latest_ts ?? generatedAt}>
              {metaTime}
            </time>
          )}
        </div>
        {/* 边界① 陈旧快照提示带(mock 逐字) */}
        {stale && row.latest_ts && (
          <p className="agent-stale-band" data-testid={`agent-stale-band-${agentId}`}>
            {staleBandText(row.latest_ts)}
          </p>
        )}
      </div>
    </section>
  );
}

/** Agent 卡空态(daemon 未连接 / 401 / 协议错) — 任务卡边界:
 *  显式失败空态, 不静默吞成 0(不渲染 0 tokens 卡)。
 *  round-7(9/14 用户截图反馈): 徽章与正文重复渲染同一状态两次 —
 *  徽章改为按 reason 分类的短语(状态行), 正文保留完整 reason, 语义分层不重复。
 *  reason 支持裸 kind(unreachable/unauthorized/protocol_error)与已格式化文案。 */
const EMPTY_BADGE: Record<string, string> = {
  unreachable: "连接失败",
  unauthorized: "鉴权失败",
  protocol_error: "协议错误",
};

/** round-7: reason → 用户可读文案(唯一映射点, App.tsx 三处调用统一走这里)。
 *  裸 kind 与旧硬编码文案都兜住 — 大屏空态历史传文案串, 主页传裸 kind。 */
export function agentEmptyReasonText(reason: string): string {
  switch (reason) {
    case "unreachable":
      return "daemon 未连接,请先启动 daemon";
    case "unauthorized":
      return "鉴权失败,请检查 daemon API Key";
    case "protocol_error":
      return "daemon 协议错误";
    default:
      return reason || "daemon 未连接,请先启动 daemon";
  }
}

export function AgentCardEmpty({ reason }: { reason: string }): ReactNode {
  const badge = EMPTY_BADGE[reason] ?? "不可用";
  return (
    <section className="card agent-card agent-card-empty" data-testid="agent-card-empty">
      <div className="card-head">
        <span className="agent-logo" aria-hidden="true">·</span>
        <span className="card-name">Agent 用量</span>
        <span className="status-dot" data-testid="agent-status-dot" data-health="unknown" aria-hidden="true" />
        <span className="card-status-text text-unknown" data-testid="agent-activity-badge">{badge}</span>
      </div>
      <div className="agent-card-body">
        <p className="agent-empty-reason" data-testid="agent-empty-reason">{agentEmptyReasonText(reason)}</p>
      </div>
    </section>
  );
}
