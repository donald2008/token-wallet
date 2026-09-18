/**
 * AgentDashboardC 组件入参类型(t_9255cb63, D-055 后续; t_12c28686 多维数据面)
 * 调用方(App.tsx)并行拉 3 次多/单维 mcpUsageSummary 后传入 — 组件本身不直接调
 * daemon, 便于 (a) 单元测试传固定数据 (b) 大屏/主窗复用同一份数据。
 */
import type { McpQueryResult } from "../mcpQuery";
import type { UsageSummaryOutput } from "../mcpQueryTypes";

export interface TrendBucket {
  /** day 维 = YYYY-MM-DD(daemon 本地时区) */
  label: string;
  tokens: number;
}

export interface ModelSlice {
  model: string;
  tokens: number;
  /** t_e83ad982: 迷你数据表列 — 调用次数 / cache 命中 / cache 未命中 / output(全部现有 summary 字段) */
  calls: number;
  hit: number;
  miss: number;
  out: number;
}

export interface DetailRow {
  agent_id: string;
  tokens: number;
  cost: number | null;
  currency: string | null;
  calls: number;
  /** completed > 0 → active, calls > 0 && completed = 0 → idle, calls = 0 → no_report_today */
  completed: number;
  idle: boolean;
  /** t_e83ad982: 明细扩列 — 三分项(hit/miss/output) + 该 agent 模型数(全部现有 summary 字段) */
  hit: number;
  miss: number;
  out: number;
  models: number;
}

export interface AgentDashboardCProps {
  /** group_by=["agent"] 单维汇总 — hero 总量/三分项/明细按当前选中 agent 过滤 */
  summary: UsageSummaryOutput;
  /** group_by=["agent","model"] 多维查询 — ok=false 时 Model 面板显式「数据拉取失败+重试」 */
  modelSummary: McpQueryResult<UsageSummaryOutput>;
  /** group_by=["day"] 多维查询 — ok=false 时趋势面板显式空态; <2 天显「数据积累中」 */
  trendSummary: McpQueryResult<UsageSummaryOutput>;
  /** 由调用方(mcpUsageSummary 返回 generatedAt)传入 — 避免组件内部再发请求 */
  generatedAt: string;
  /** SL-08 B③: onBack 已随顶栏返回钮删除(大屏是独立窗/全屏态, 无「返回主页」语义) */
  /** 模块空态「重试」回调 — 调用方重新并行拉取三维数据 */
  onRetry: () => void;
  /** SC-02(SL-03): 最近一次刷新三维查询全部失败 → 整屏降级形态
   *  (横幅: 状态明确+快照时效+重试动作) + 数据区降饱和快照语义。
   *  调用方仅在「三维全失败」时置 true —— 单维失败走下面的 *Stale 面板级形态。 */
  offline?: boolean;
  /** SC-03/H7(SL-03): 该维最近一次拉取失败, 但旧 ok 快照仍在(只读缓存语义) →
   *  对应面板标为降级(快照语义)而不清空数据; 整屏降级(offline)时由横幅统一承载, 面板级标记让位。 */
  summaryStale?: boolean;
  modelStale?: boolean;
  trendStale?: boolean;
}
