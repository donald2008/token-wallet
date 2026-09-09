/**
 * MCP daemon 读数据桥(t_9255cb63, D-048 后续):
 * - usage_summary: 读聚合(主页 Agent 卡 + 大屏方案 C 数据源)
 * - usage_report_echo: 读原文(明细对账)
 *
 * 协议: MCP streamable-http(D-048 §5, docs/mcp-protocol.md §2)
 *   - POST {endpoint}/mcp
 *   - Authorization: Bearer <TOKEN_WALLET_MCP_KEY>
 *   - Accept: application/json, text/event-stream
 *   - Content-Type: application/json
 *   - Body: JSON-RPC 2.0
 *
 * 返回格式: streamable-http 的 SSE/JSON 响应。本模块只解析 application/json 风格
 * (server 把整个 RPC 响应作单一 JSON 返回 — fastmcp streamable-http 的
 * `Accept: application/json, text/event-stream` 模式),够用且零 sse-parser 依赖。
 *
 * 纯逻辑零 electron 依赖 — http 行为经 HttpShim 注入,便于 node vitest 单测
 * (mock 200/401/网络失败)。所有副作用都走 shim。
 */
import { loadMcpEnv } from "./mcp-env";

export type {
  ByStatus,
  SummaryRow,
  SummaryTotal,
  UsageReportEchoEvent,
  UsageReportEchoInput,
  UsageReportEchoOutput,
  UsageSummaryInput,
  UsageSummaryOutput,
} from "./mcp-query-types";

export interface HttpShim {
  /**
   * POST request to MCP daemon with optional Bearer auth.
   * Returns parsed JSON body + status, throws on network failure / non-200.
   * 鉴权失败(401)→ throw { message: "mcp http status 401" }(由调用方归类为 "unauthorized" reason)。
   */
  postJson: <T>(opts: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
    timeoutMs: number;
  }) => Promise<{ status: number; body: T }>;
}

export function defaultHttpShim(): HttpShim {
  return {
    postJson: async <T>(opts: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
      timeoutMs: number;
    }): Promise<{ status: number; body: T }> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const resp = await fetch(opts.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...opts.headers },
          body: JSON.stringify(opts.body),
          signal: ctrl.signal,
        });
        // MCP streamable-http 容许 200 + JSON body, 也容许 SSE(以 Accept 头协商);
        // 200 时一律按 JSON 解析;非 200 → throw 让调用方归类
        if (resp.status !== 200) {
          throw new Error(`mcp http status ${resp.status}`);
        }
        const parsed = (await resp.json()) as T;
        return { status: resp.status, body: parsed };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface McpCallToolInput {
  /** MCP 工具名, 如 "usage_summary" */
  name: string;
  /** 工具参数(对应 docs/mcp-protocol.md §2.2 UsageSummaryInput 等) */
  arguments: Record<string, unknown>;
}

export interface McpCallToolResult<T> {
  /** 工具返的 JSON 文本 — MCP 协议规定 tool result 包成 { content: [{ type: "text", text: "<json>" }] } */
  parsed: T;
  /** daemon 端响应时间戳(由调用方按需填充) */
  generatedAt?: string;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * MCP JSON-RPC 2.0 响应(单值形态 — fastmcp streamable-http application/json 模式)
 */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: { content?: Array<{ type: string; text?: string }> };
  error?: JsonRpcError;
}

/**
 * 调 MCP 工具的统一入口:POST /mcp,JSON-RPC 2.0 tools/call,
 * 解析 result.content[0].text(JSON) 并返回 typed 结果。
 *
 * 错误归类(供 UI 降级使用):
 *   - network / timeout / non-200 → throw { reason: "unreachable" }
 *   - 401 / 403 → throw { reason: "unauthorized" }
 *   - JSON-RPC error(协议层)→ throw { reason: "protocol_error", message }
 *   - result.content[0].text 非 JSON → throw { reason: "protocol_error" }
 */
export async function callMcpTool<T>(
  cfg: { host: string; port: number; key: string },
  input: McpCallToolInput,
  http: HttpShim,
  opts: { timeoutMs?: number; rpcId?: number | string } = {},
): Promise<McpCallToolResult<T>> {
  const endpoint = `http://${cfg.host}:${cfg.port}/mcp`;
  const body = {
    jsonrpc: "2.0",
    id: opts.rpcId ?? 1,
    method: "tools/call",
    params: { name: input.name, arguments: input.arguments },
  };
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.key}`,
    Accept: "application/json, text/event-stream",
  };
  let resp: { status: number; body: JsonRpcResponse };
  try {
    resp = await http.postJson<JsonRpcResponse>({
      url: endpoint,
      headers,
      body,
      timeoutMs: opts.timeoutMs ?? 5000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/status (401|403)/.test(msg)) throw new McpCallError("unauthorized", msg);
    throw new McpCallError("unreachable", msg);
  }
  if (resp.body.error) {
    throw new McpCallError("protocol_error", `${resp.body.error.code}: ${resp.body.error.message}`);
  }
  const text = resp.body.result?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new McpCallError("protocol_error", "missing result.content[0].text");
  }
  try {
    const parsed = JSON.parse(text) as T;
    return { parsed };
  } catch {
    throw new McpCallError("protocol_error", "tool result is not valid JSON");
  }
}

/** 错误归类(daemon 不可达 / 401 / 协议错) — UI 据此决定降级 */
export type McpCallErrorKind = "unreachable" | "unauthorized" | "protocol_error";

export class McpCallError extends Error {
  readonly kind: McpCallErrorKind;
  constructor(kind: McpCallErrorKind, message: string) {
    super(message);
    this.name = "McpCallError";
    this.kind = kind;
  }
}

/**
 * 高阶:加载 mcp.env + 调一次工具。一次封装,供 ipc.ts 主进程 handler 直接复用。
 * 失败抛 McpCallError(让 IPC handler 透传给 renderer, 由 UI 归类)。
 */
export async function callMcpToolFromEnv<T>(
  configDir: string,
  input: McpCallToolInput,
  http: HttpShim,
  opts: { timeoutMs?: number } = {},
): Promise<McpCallToolResult<T>> {
  const cfg = loadMcpEnv(configDir);
  return callMcpTool<T>(
    { host: cfg.TOKEN_WALLET_HOST, port: cfg.TOKEN_WALLET_PORT, key: cfg.TOKEN_WALLET_MCP_KEY },
    input,
    http,
    opts,
  );
}

// ============== 类型契约(对齐 docs/mcp-protocol.md §2.2 / §2.3) ==============
// 见 ./mcp-query-types(re-export 在本文件顶部)。
