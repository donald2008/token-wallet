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
  /** t_f6c85da6: 该行代表几个模型 — Top 6 正色行=1; 「其他」聚合行=N-6(表格副行显 N-6) */
  models: number;
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
  /** 返回主页回调(点 ← 返回) */
  onBack: () => void;
  /** 模块空态「重试」回调 — 调用方重新并行拉取三维数据 */
  onRetry: () => void;
}
