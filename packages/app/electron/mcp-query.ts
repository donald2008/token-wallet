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
  // round-7(2026-09-14 证据链收口): shim 从全局 fetch 改为 **node:http 原生直连**。
  // 证据: 用户真机 win-local-test.mjs — node.exe 同机同 daemon 同请求 33ms 全通;
  //       electron 主进程同请求 = 200 headers 到、SSE body 5s 零字节。
  //       Electron 37 主进程全局 fetch 走 Chromium net 栈(非纯 undici), 其对
  //       keep-alive SSE 流的缓冲/代理行为导致 body 不交付 → 头到体不到。
  // 修法: localhost 数据面请求不过 Chromium 网络服务 — node:http + 手工 SSE 流式
  //       读(收到完整 data: 行即解析), 语义与旧 shim 完全一致, 且零系统代理干扰。
  return {
    postJson: <T>(opts: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
      timeoutMs: number;
    }): Promise<{ status: number; body: T; headers: Record<string, string> }> =>
      new Promise<{ status: number; body: T; headers: Record<string, string> }>((resolve, reject) => {
        const parsed = new URL(opts.url);
        const mod = parsed.protocol === "https:" ? require("node:https") : require("node:http");
        const payload = Buffer.from(JSON.stringify(opts.body), "utf8");
        const req = mod.request(
          {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": payload.length,
              ...opts.headers,
            },
          },
          (res: import("node:http").IncomingMessage) => {
            const status = res.statusCode ?? 0;
            const respHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              respHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : (v ?? "");
            }
            if (status === 401 || status === 403) {
              res.resume(); // drain
              reject(new Error(`mcp http status ${status}`));
              return;
            }
            // SSE/JSON 统一流式读: 攒 chunk, 出现可解析 envelope(JSON 或 SSE data:)即 resolve
            const chunks: Buffer[] = [];
            let buf = "";
            let settled = false;
            const finishJson = () => {
              if (settled) return;
              settled = true;
              const text = Buffer.concat(chunks).toString("utf8");
              try {
                resolve({ status, body: JSON.parse(text) as T, headers: respHeaders });
              } catch (pe) {
                console.error(
                  `[mcp-query] body parse failed: status=${status} ct=${respHeaders["content-type"]} parseErr=${pe instanceof Error ? pe.message : pe} body[:200]=${text.slice(0, 200)}`,
                );
                reject(new Error(`mcp http status ${status} (parse: ${pe instanceof Error ? pe.message : pe})`));
              }
            };
            const trySseEnvelope = (): boolean => {
              if (!buf.includes("data:")) return false;
              const joined = buf
                .split(/\r?\n/)
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice("data:".length).trimStart())
                .join("\n")
                .trim();
              if (!joined) return false;
              try {
                const body = JSON.parse(joined) as T;
                settled = true;
                res.destroy(); // 收到 envelope 即断开 — SSE 流不必读完
                resolve({ status, body, headers: respHeaders });
                return true;
              } catch {
                return false; // 跨块半行 — 继续攒
              }
            };
            const ct = respHeaders["content-type"] ?? "";
            res.on("data", (c: Buffer) => {
              chunks.push(c);
              buf += c.toString("utf8");
              if (ct.includes("text/event-stream")) {
                if (trySseEnvelope()) return;
              } else if (ct.includes("application/json")) {
                if (settled) return;
                // JSON 单发形态: 等流自然结束(end)后整体解析 — fastmcp JSON 模式发完即关
              }
            });
            res.on("end", () => {
              if (settled) return;
              finishJson();
            });
            res.on("error", (err: Error) => {
              if (settled) return;
              settled = true;
              console.error(`[mcp-query] response stream error: ${err.message}`);
              reject(new Error(`mcp http status ${status} (stream: ${err.message})`));
            });
          },
        );
        req.setTimeout(opts.timeoutMs, () => {
          req.destroy(new Error(`timeout after ${opts.timeoutMs}ms`));
        });
        req.on("error", (err: Error) => {
          console.error(
            `[mcp-query] transport failure(node:http): ${err.name || "Error"}: ${err.message} endpoint=${opts.url}`,
          );
          reject(err);
        });
        req.end(payload);
      }),
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
/**
 * JSON-RPC 请求 id 发号器(进程级单调递增)。
 *
 * round-8 根修(2026-09-14, 用户要求重读代码后定案): 此前所有请求默认 id=1,
 * 而 30s tick 的三路查询(主页/Model/趋势)经同一 session **并发**发出 →
 * daemon(mcp/server/streamable_http.py)按 request_id 存 per-request stream
 * (self._request_streams[request_id]) → 同 id 并发键冲突 → 后到覆盖先到,
 * 被覆盖请求的响应永不送达 → 客户端 5s 超时(每 tick 必挂 2 路, 偶发时序
 * 错开则全绿 — 与用户日志「1 路 ok=true + 2 路 timeout」逐字吻合)。
 * 9/12 前单查询/tick 无并发故从未触发; t_12c28686 加第三查询后必现。
 */
let rpcIdCounter = 0;
function nextRpcId(): number {
  rpcIdCounter += 1;
  return rpcIdCounter;
}

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

  // 2) POST tools/call(带 sid)。id 用进程级发号器 — 并发请求必须各持唯一 id,
  //    同 id 并发会让 daemon 按 request_id 索引的 per-request stream 互相覆盖。
  const body = {
    jsonrpc: "2.0",
    id: opts.rpcId ?? nextRpcId(),
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
