/**
 * Agent 卡(t_9255cb63, D-055 后续):
 * 主页列表 item,与 ProviderCard 同构(共用 .card/.card-head/.card-name/.card-status-text 等),
 * 数据源 = MCP daemon usage_summary(group_by=["agent"]) — **非 mock**。
 *
 * 视觉同构(任务卡定稿):
 *   header: logo + 名称 + 状态点[有活动/空闲/今天无上报]
 *   主体: token 总量(大数字,必有) + 金额副标(可空留白, 拍板契约)
 *   尾部: [详情→] 进入大屏方案 C
 *
 * 降级: daemon 不可达 → 整卡显式「daemon 未连接」空态(不静默吞成 0)
 */
import { useCallback } from "react";
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
  /** 详情按钮回调(打开大屏方案 C) */
  onOpenDetail: (agentId: string) => void;
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
  onOpenDetail,
}: AgentCardProps): ReactNode {
  const tokens = totalTokens(row);
  const costStr = formatCost(row.cost_total, row.currency);
  const health = ACTIVITY_HEALTH[activity];

  const onClick = useCallback(() => onOpenDetail(agentId), [agentId, onOpenDetail]);

  return (
    <section className="card agent-card" data-testid="agent-card" data-agent={agentId} data-health={health}>
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
          onClick={onClick}
          aria-label={`查看 ${agentId} 大屏`}
        >
          详情 →
        </button>
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
 *  显式「daemon 未连接」空态, 不静默吞成 0(不渲染 0 tokens 卡)。 */
export function AgentCardEmpty({ reason }: { reason: string }): ReactNode {
  return (
    <section className="card agent-card agent-card-empty" data-testid="agent-card-empty">
      <div className="card-head">
        <span className="agent-logo" aria-hidden="true">·</span>
        <span className="card-name">Agent 用量</span>
        <span className="status-dot" data-testid="agent-status-dot" data-health="unknown" aria-hidden="true" />
        <span className="card-status-text text-unknown" data-testid="agent-activity-badge">daemon 未连接</span>
      </div>
      <div className="agent-card-body">
        <p className="agent-empty-reason" data-testid="agent-empty-reason">{reason}</p>
      </div>
    </section>
  );
}
