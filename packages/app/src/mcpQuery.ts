/**
 * Renderer 端 MCP daemon 读数据 wrapper(t_9255cb63, D-055 后续):
 * - mcpUsageSummary: 主页 Agent 卡 + 大屏方案 C 数据源
 * - mcpUsageReportEcho: 明细对账
 *
 * 浏览器降级(无桥):返回 { ok:false, reason:"unavailable" }(纯 dev 预览模式),
 * UI 据此显式「daemon 未连接」空态,不静默吞成 0(任务卡边界硬要求)。
 *
 * 协议形态: 主进程 IPC 通道名 = "mcp_usage_summary" / "mcp_usage_report_echo",
 * payload 与 docs/mcp-protocol.md §2.2 / §2.3 UsageSummaryInput / UsageReportEchoInput 对齐。
 *
 * 类型从 electron/mcp-query-types 引(types-only 文件,不拖 electron runtime)。
 */

import type {
  UsageReportEchoInput,
  UsageReportEchoOutput,
  UsageSummaryInput,
  UsageSummaryOutput,
} from "./mcpQueryTypes";

export type McpQueryResult<T> =
  | { ok: true; data: T; generatedAt: string }
  | { ok: false; reason: "unreachable" | "unauthorized" | "protocol_error" | "unavailable" };

function bridge(): { invoke?: <T>(channel: string, payload?: Record<string, unknown>) => Promise<T> } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    tokenWallet?: { invoke?: <T>(channel: string, payload?: Record<string, unknown>) => Promise<T> };
  };
  return w.tokenWallet?.invoke ? w.tokenWallet : null;
}

function hostInvoke<T>(channel: string, payload?: Record<string, unknown>): Promise<T> | null {
  const b = bridge();
  if (b?.invoke) return b.invoke<T>(channel, payload);
  return null;
}

/**
 * 读 usage_summary。daemon 不可达 / 401 / 协议错 → 返回 { ok:false, reason } 由 UI 降级。
 * 浏览器无桥 → ok:false reason:unavailable(同 daemon 不可达语义)。
 */
export async function mcpUsageSummary(input: UsageSummaryInput = {}): Promise<McpQueryResult<UsageSummaryOutput>> {
  const r = await hostInvoke<{ ok: true; data: UsageSummaryOutput } | { ok: false; reason: string }>(
    "mcp_usage_summary",
    input as unknown as Record<string, unknown>,
  );
  if (!r) return { ok: false, reason: "unavailable" };
  if (r.ok) {
    return { ok: true, data: r.data, generatedAt: r.data.generated_at };
  }
  return { ok: false, reason: r.reason as "unreachable" | "unauthorized" | "protocol_error" };
}

/**
 * 读 usage_report_echo(明细对账)。
 */
export async function mcpUsageReportEcho(
  input: UsageReportEchoInput = {},
): Promise<McpQueryResult<UsageReportEchoOutput>> {
  const r = await hostInvoke<{ ok: true; data: UsageReportEchoOutput } | { ok: false; reason: string }>(
    "mcp_usage_report_echo",
    input as unknown as Record<string, unknown>,
  );
  if (!r) return { ok: false, reason: "unavailable" };
  if (r.ok) return { ok: true, data: r.data, generatedAt: "" };
  return { ok: false, reason: r.reason as "unreachable" | "unauthorized" | "protocol_error" };
}
