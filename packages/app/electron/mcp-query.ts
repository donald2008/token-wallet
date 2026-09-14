/**
 * MCP daemon 读数据桥(t_9255cb63, D-055 后续; t_eece584f session 生命周期):
 * - usage_summary: 读聚合(主页 Agent 卡 + 大屏方案 C 数据源)
 * - usage_report_echo: 读原文(明细对账)
 *
 * 协议: MCP streamable-http(D-055 §5, docs/mcp-protocol.md §2)
 *   - POST {endpoint}/mcp
 *   - Authorization: Bearer <TOKEN...KEY>
 *   - Accept: application/json, text/event-stream
 *   - Content-Type: application/json
 *   - Body: JSON-RPC 2.0
 *
 * t_eece584f session 生命周期(本卡主线):
 *   - 模块级 session 缓存(key = endpoint URL)
 *   - 首次 tools/call 前先 POST initialize → 拿响应头 `mcp-session-id`(小写)→ 缓存
 *   - 后续 tools/call 带 `mcp-session-id` 请求头(fastmcp streamable-http 强制 session 绑定)
 *   - 自愈: 响应 -32600 Missing session ID 或 HTTP 404 Session not found
 *     → 清缓存, 重握手一次, 重试原请求(仅一次, 防循环)
 *   - 并发安全: single-flight — 多 IPC 调用同时首调时 initialize 只发一次
 *     (缓存的是 Promise<sid> 而非 sid 本身, 后续 await 共享同一 Promise)
 *
 * 返回格式: streamable-http 的 SSE/JSON 双形态。fastmcp 4.x 默认返 text/event-stream
 * (event: message\r\ndata: {...}\r\n\r\n), 但客户端 Accept=application/json 协商亦兼容。
 * 本模块做轻量 SSE 抽取(只解 data: 行, 不引 sse-parser)。
 *
 * 纯逻辑零 electron 依赖 — http 行为经 HttpShim 注入,便于 node vitest 单测。
 */
import { connectHost } from "./mcp-address";
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
   * Returns parsed JSON body + status + headers, throws on network failure / non-200.
   * 鉴权失败(401)→ throw { message: "mcp http status 401" }(由调用方归类为 "unauthorized" reason)。
   *
   * t_eece584f: 响应 headers 必须包含 `mcp-session-id` 等(initialize 时捕获);非 200 抛错由调用方归类 unreachable。
   */
  postJson: <T>(opts: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
    timeoutMs: number;
  }) => Promise<{ status: number; body: T; headers: Record<string, string> }>;
}

export function defaultHttpShim(): HttpShim {
  return {
    postJson: async <T>(opts: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
      timeoutMs: number;
    }): Promise<{ status: number; body: T; headers: Record<string, string> }> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const resp = await fetch(opts.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...opts.headers },
          body: JSON.stringify(opts.body),
          signal: ctrl.signal,
        });
        // 收 headers 给 session 捕获用 — 原生 fetch Headers → plain object (全小写键)
        const respHeaders: Record<string, string> = {};
        resp.headers.forEach((v, k) => {
          respHeaders[k.toLowerCase()] = v;
        });
        // t_eece584f round-2: MCP streamable-http 协议层错误用 HTTP 4xx + JSON-RPC body
        // (实测 fastmcp 4.x: 无 session → 400, 假 session → 404, 鉴权错 → 401/403)。
        // 不能在 status check 阶段直接 throw — 必须让上层解析 body 才能识别 self-heal 判定。
        //
        // 区分:
        //   - 401/403 鉴权错 → throw "mcp http status N"(归类 unauthorized)
        //   - 其他 status(含 400/404/5xx + 有 body)→ 尝试解析 body, 失败 throw unreachable
        //   - 解析成功 → return { status, body, headers }(让上层走 protocol_error / self-heal 判定)
        if (resp.status === 401 || resp.status === 403) {
          throw new Error(`mcp http status ${resp.status}`);
        }
        let parsed: T;
        try {
          parsed = (await parseStreamableBody(resp)) as T;
        } catch (parseErr) {
          // body 解析失败(非 JSON-RPC envelope)→ 视为 daemon 不可达。
          // round-7 可观测性: 原始失败原因必须落日志 — 此前这里吞成纯 status 码,
          // 间歇性 unreachable 无任何证据留存, 排障全靠猜(2026-09-14 用户批评成立)。
          const perr = parseErr instanceof Error ? parseErr.message : String(parseErr);
          const raw = await resp.text().catch(() => "<body unavailable>");
          console.error(
            `[mcp-query] body parse failed: status=${resp.status} ct=${resp.headers.get("content-type")} parseErr=${perr} body[:200]=${raw.slice(0, 200)}`,
          );
          throw new Error(`mcp http status ${resp.status} (parse: ${perr})`);
        }
        return { status: resp.status, body: parsed, headers: respHeaders };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * t_eece584f: 解析 streamable-http body。
 * - content-type: application/json → 直接 JSON.parse
 * - content-type: text/event-stream → 抽 `data:` 行, 最后一行的 data 作 JSON 解析
 *   (fastmcp 4.x 实测每次只 emit 一个 event: message + data: {...}\r\n)
 */
async function parseStreamableBody(resp: Response): Promise<unknown> {
  const ct = resp.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return await resp.json();
  }
  if (ct.includes("text/event-stream")) {
    // round-7(证据驱动修复): 用户真机日志实锤 — daemon(uvicorn/Windows)对 tools/call
    // 返回 200 + text/event-stream 后**流保持打开不关闭**, 旧实现 resp.text() 要等
    // 流结束才 resolve → 必然等到 timeoutMs 被 abort → "This operation was aborted"
    // → 全部归类 unreachable。间歇性"成功"(流恰好提前关)由此而来。
    // 修复: 流式逐块读 — 攒到完整 data: 行(JSON-RPC envelope)即解析返回, 不等流关闭。
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("SSE response has no body stream");
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += decoder.decode(value, { stream: true });
        // 完整事件判定: 已出现 data: 行且缓冲里有可解析的 JSON envelope
        if (buf.includes("data:")) {
          const dataLines = buf
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice("data:".length).trimStart());
          const joined = dataLines.join("\n").trim();
          if (joined) {
            try {
              const parsed = JSON.parse(joined) as unknown;
              // 成功解析即返回; 读到完整 envelope 后主动取消下游, 释放连接
              void reader.cancel().catch(() => {});
              return parsed;
            } catch {
              /* 半行/跨块 JSON — 继续读下一个 chunk */
            }
          }
        }
        if (done) break;
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    // 流结束仍无可解析 envelope
    const tail = buf.trim().slice(0, 200);
    throw new Error(`empty SSE data payload (stream ended, tail="${tail}")`);
  }
  // 未知 content-type: 退回 text → JSON(尽最大努力, 失败抛 plain error)
  try {
    return JSON.parse(await resp.text());
  } catch {
    throw new Error("unexpected response content-type");
  }
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

/** 错误归类(daemon 不可达 / 401 / 协议错) — UI 据此决定降级 */
export type McpCallErrorKind = "unreachable" | "unauthorized" | "protocol_error";

/** 协议层 / 网络层错误统一出口, UI 据此决定降级 */
export class McpCallError extends Error {
  readonly kind: McpCallErrorKind;
  constructor(kind: McpCallErrorKind, message: string) {
    super(message);
    this.name = "McpCallError";
    this.kind = kind;
  }
}

// ============== t_eece584f: MCP session 生命周期 ==============

/** session 缓存 key = endpoint URL(同 host:port:key 共享); value = initialize Promise(single-flight) */
const sessionCache = new Map<string, Promise<string>>();

/**
 * 测试钩子: 清空 session 缓存。
 * - 单测 beforeEach 重置, 避免跨 case 泄漏
 * - daemon 重启场景的"清缓存 + 重新握手"通过 invalidateSession 单独做
 */
export function _resetSessionCache(): void {
  sessionCache.clear();
}

/** 显式失效一个 endpoint 的缓存(自愈 / daemon 重启场景) */
export function invalidateSession(endpoint: string): void {
  sessionCache.delete(endpoint);
}

/**
 * Initialize MCP session: POST initialize → 解析响应头 `mcp-session-id`(小写) → 缓存。
 * - 同一 endpoint 并发首调共享同一 Promise(single-flight)。
 * - 失败抛 McpCallError 让上层归类。
 *
 * 与 mcp-ipc.ts 的 `defaultHttpShim().postInitialize`(probe 握手专用)同形态但用途不同:
 * - probe 只看 status 200/非, 不收 sid
 * - 这里要收 sid 且按 streamable-http 解析 body, 故独立函数更清晰
 */
async function ensureSession(
  endpoint: string,
  key: string,
  http: HttpShim,
  timeoutMs: number,
): Promise<string> {
  const cached = sessionCache.get(endpoint);
  if (cached) return cached;

  const initPromise = (async (): Promise<string> => {
    const body = {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "token-wallet-app", version: "0.2.8" },
      },
    };
    const headers: Record<string, string> = {
      Authorization: "Bearer " + key,
      Accept: "application/json, text/event-stream",
    };
    const resp = await http.postJson<JsonRpcResponse>({
      url: endpoint,
      headers,
      body,
      timeoutMs,
    });
    if (resp.body.error) {
      throw new McpCallError(
        "protocol_error",
        `initialize failed: ${resp.body.error.code}: ${resp.body.error.message}`,
      );
    }
    const sid = resp.headers["mcp-session-id"];
    if (!sid) {
      throw new McpCallError(
        "protocol_error",
        "initialize response missing mcp-session-id header",
      );
    }
    return sid;
  })();
  sessionCache.set(endpoint, initPromise);

  // initialize 失败的 Promise 不要留在缓存(后续应允许重试而非拿一个必抛的 cached promise)
  initPromise.catch(() => {
    if (sessionCache.get(endpoint) === initPromise) sessionCache.delete(endpoint);
  });

  return initPromise;
}

/**
 * 调 MCP 工具的统一入口:
 * 1. ensureSession(endpoint) — 首次自动 initialize, 后续直接拿缓存
 * 2. POST /mcp tools/call, 带 `mcp-session-id` 头
 * 3. 自愈: 响应 -32600 / 404 → 失效缓存, 重握手一次, 重试原请求(仅一次, 防循环)
 * 4. 解析 result.content[0].text(JSON) 并返回 typed 结果
 *
 * 错误归类(供 UI 降级使用):
 *   - network / timeout / non-200 → throw { reason: "unreachable" }
 *   - 401 / 403 → throw { reason: "unauthorized" }
 *   - JSON-RPC error(协议层)→ throw { reason: "protocol_error", message }
 *   - result.content[0].text 非 JSON → throw { reason: "protocol_error" }
 *   - initialize 失败 / 缺 sid → throw { reason: "protocol_error" }
 */
export async function callMcpTool<T>(
  cfg: { host: string; port: number; key: string },
  input: McpCallToolInput,
  http: HttpShim,
  opts: { timeoutMs?: number; rpcId?: number | string } = {},
): Promise<McpCallToolResult<T>> {
  const endpoint = `http://${cfg.host}:${cfg.port}/mcp`;
  const timeoutMs = opts.timeoutMs ?? 5000;

  // 1) ensure session(失败抛 protocol_error / unreachable 让 UI 归类)
  let sid: string;
  try {
    sid = await ensureSession(endpoint, cfg.key, http, timeoutMs);
  } catch (e) {
    if (e instanceof McpCallError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[mcp-query] initialize handshake failure: ${e instanceof Error ? e.name : "unknown"}: ${msg} endpoint=${endpoint}`,
    );
    if (/status (401|403)/.test(msg)) throw new McpCallError("unauthorized", msg);
    throw new McpCallError("unreachable", msg);
  }

  // 2) POST tools/call(带 sid)
  const body = {
    jsonrpc: "2.0",
    id: opts.rpcId ?? 1,
    method: "tools/call",
    params: { name: input.name, arguments: input.arguments },
  };

  /**
   * 单次工具调用尝试。
   * - allowSelfHeal=true 时, 响应 -32600 Missing session ID / Session not found 触发 _SessionExpired
   *   (外层 catch 会重握手 + 重试一次)
   * - allowSelfHeal=false 时, 同样的错误直接归类 protocol_error(防止自愈递归)
   *
   * callHeaders 允许重试时传入替换 sid 的 headers 副本。
   */
  const attempt = async (
    callHeaders: Record<string, string>,
    allowSelfHeal: boolean,
  ): Promise<McpCallToolResult<T>> => {
    let resp: { status: number; body: JsonRpcResponse; headers: Record<string, string> };
    try {
      resp = await http.postJson<JsonRpcResponse>({
        url: endpoint,
        headers: callHeaders,
        body,
        timeoutMs,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // round-7 可观测性: fetch 失败细节(超时/连接拒绝/DNS/中断)落日志 —
      // 是 TimeoutError 还是 ECONNREFUSED 决定排障方向, 此前全部被吞。
      console.error(
        `[mcp-query] tools/call transport failure: ${e instanceof Error ? e.name : "unknown"}: ${msg} endpoint=${endpoint}`,
      );
      if (/status (401|403)/.test(msg)) throw new McpCallError("unauthorized", msg);
      throw new McpCallError("unreachable", msg);
    }

    // 协议层错误: 自愈判定(-32600 Missing session ID / Session not found)
    if (resp.body.error) {
      const code = resp.body.error.code;
      const msg = resp.body.error.message ?? "";
      // t_eece584f round-2: daemon 协议层错误用 HTTP 4xx + JSON-RPC body
      // (实测 fastmcp 4.x: 无 session → 400, 假 session → 404)。defaultHttpShim 已修,
      // 这里能正常拿到 body.error, 不再被 status check 阻断。
      if (allowSelfHeal && code === -32600 && /Missing session ID/i.test(msg)) {
        throw new _SessionExpired("Missing session ID");
      }
      if (allowSelfHeal && code === -32600 && /Session not found/i.test(msg)) {
        throw new _SessionExpired("Session not found");
      }
      throw new McpCallError("protocol_error", `${code}: ${msg}`);
    }

    const text = resp.body.result?.content?.[0]?.text;
    if (typeof text !== "string") {
      throw new McpCallError("protocol_error", "missing result.content[0].text");
    }
    try {
      return { parsed: JSON.parse(text) as T };
    } catch {
      throw new McpCallError("protocol_error", "tool result is not valid JSON");
    }
  };

  const initialHeaders: Record<string, string> = {
    Authorization: "Bearer " + cfg.key,
    Accept: "application/json, text/event-stream",
    "mcp-session-id": sid,
  };
  try {
    return await attempt(initialHeaders, true);
  } catch (e) {
    if (!(e instanceof _SessionExpired)) throw e;
    // 自愈: 失效缓存, 重握手一次, 重试原请求(只一次, 防循环)
    invalidateSession(endpoint);
    let newSid: string;
    try {
      newSid = await ensureSession(endpoint, cfg.key, http, timeoutMs);
    } catch (initErr) {
      // 重握手失败: 沿用 McpCallError 归类(unauthorized / unreachable / protocol_error)
      throw initErr instanceof McpCallError
        ? initErr
        : new McpCallError(
            "unreachable",
            initErr instanceof Error ? initErr.message : String(initErr),
          );
    }
    // 用新 sid 重试 — allowSelfHeal=false 阻断自愈递归
    return await attempt({ ...initialHeaders, "mcp-session-id": newSid }, false);
  }
}

/** 内部 sentinel: session 失效信号(自愈触发), 不暴露 */
class _SessionExpired extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "_SessionExpired";
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
    // U6: HOST=bind 地址, 通配(0.0.0.0/::)不能作 connect 目标 → 归一 loopback
    { host: connectHost(cfg.TOKEN_WALLET_HOST), port: cfg.TOKEN_WALLET_PORT, key: cfg.TOKEN_WALLET_MCP_KEY },
    input,
    http,
    opts,
  );
}

// ============== 类型契约(对齐 docs/mcp-protocol.md §2.2 / §2.3) ==============
// 见 ./mcp-query-types(re-export 在本文件顶部)。
