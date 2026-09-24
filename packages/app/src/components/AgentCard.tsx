/**
 * Agent 卡(t_9255cb63, D-055 后续):
 * 主页列表 item,与 ProviderCard 同构(共用 .card/.card-head/.card-name/.card-status-text 等),
 * 数据源 = MCP daemon usage_summary(group_by=["agent"]) — **非 mock**。
 *
 * 视觉同构(任务卡定稿):
 *   header: logo + 名称 + 状态点[有活动/空闲/今天无上报] + 悬浮删除钮(t_6eb3e728 ③)
 *   主体: token 总量(大数字,必有) + 金额副标(可空留白, 拍板契约)
 *   尾部: [大屏 →] 打开用量大屏(t_6eb3e728 ②语义归位: 大屏=整体大屏, 非单 agent 详情)
 *
 * 降级: daemon 不可达 → 整卡显式「daemon 未连接」空态(不静默吞成 0)
 */
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import type { SummaryRow } from "../mcpQueryTypes";

export type AgentActivityState = "active" | "idle" | "no_report_today";

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
   */
  activity: AgentActivityState;
  /** daemon 数据生成时间戳(来自 usage_summary.generated_at),note 区展示 */
  generatedAt: string;
  /** 大屏入口回调(t_6eb3e728 ②语义归位: 打开整体用量大屏; 原 onOpenDetail 纯内部接口改名) */
  onOpenDashboard: (agentId: string) => void;
  /** 删除该 agent 全部上报数据回调(t_6eb3e728 ③; 缺省=不渲染删除钮, e2e mock 场景可控) */
  onDeleteUsage?: (agentId: string) => Promise<boolean>;
}

const ACTIVITY_LABEL: Record<AgentActivityState, string> = {
  active: "有活动",
  idle: "空闲",
  no_report_today: "今天无上报",
};

/** token 总量(三分项之和 — 任务卡「大数字, 必有」契约).
 *  ⚠️ 与 daemon §4.2 "usage_records.tokens = input_cache_miss + output" 不一致:
 *  主页 Agent 卡面向用户展示「总共花了多少 token」, 三分项之和更直观,
 *  usage_records 的语义是计费 token, 二者用途不同。注释明示, 不静默改契约。 */
export function totalTokens(row: SummaryRow): number {
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
};

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
  onOpenDashboard,
  onDeleteUsage,
}: AgentCardProps): ReactNode {
  const tokens = totalTokens(row);
  const costStr = formatCost(row.cost_total, row.currency);
  const health = ACTIVITY_HEALTH[activity];
  // t_6eb3e728 ③: 删除确认二态(false=普通卡 / true=确认气泡浮出); ProviderCard.confirming 同模式
  const [confirming, setConfirming] = useState(false);
  // 删除失败错误态(daemon 未就绪等): 显式报错不静默(卡面 ③ 错误态要求)
  const [delError, setDelError] = useState(false);

  const onDashboard = useCallback(() => onOpenDashboard(agentId), [agentId, onOpenDashboard]);
  const onConfirmDelete = useCallback(() => {
    setConfirming(false);
    if (!onDeleteUsage) return;
    void onDeleteUsage(agentId).then((ok) => {
      setDelError(!ok);
      if (!ok) {
        // 错误态瞬态常驻到下次操作/重拉 — 不自动消失(用户必须看到失败), 重新 hover 再删可清
        window.setTimeout(() => setDelError(false), 8000);
      }
    });
  }, [agentId, onDeleteUsage]);

  return (
    <section
      className="card agent-card"
      data-testid="agent-card"
      data-agent={agentId}
      data-health={health}
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
          {ACTIVITY_LABEL[activity]}
        </span>
      </div>
      <div className="agent-card-body">
        <div className="agent-tokens" data-testid="agent-tokens" title={`${tokens.toLocaleString("en-US")} tokens`}>
          <span className="agent-tokens-number">{formatTokens(tokens)}</span>
          <span className="agent-tokens-unit">tokens</span>
        </div>
        <div
          className={`agent-cost${costStr === "" ? " is-empty" : ""}`}
          data-testid="agent-cost"
          aria-hidden={costStr === "" ? "true" : undefined}
        >
          {costStr}
        </div>
        <button
          type="button"
          className="agent-detail-btn"
          data-testid={`agent-detail-${agentId}`}
          onClick={onDashboard}
          aria-label={`打开 ${agentId} 用量大屏`}
          title="打开用量大屏"
        >
          大屏 →
        </button>
        {delError && (
          <p className="agent-del-error text-error" data-testid={`agent-delete-error-${agentId}`} role="alert">
            删除失败：agent {agentId} 的数据未删除 — daemon 未连接或删除未生效，请确认 daemon 运行后重试。
          </p>
        )}
        <div className="agent-meta" data-testid="agent-meta">
          calls <strong>{row.calls}</strong>
          {generatedAt && (
            <>
              {" · 数据 "}
              <time dateTime={generatedAt}>{generatedAt}</time>
            </>
          )}
        </div>
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
