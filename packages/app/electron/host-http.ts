/**
 * E2 主进程 HTTP 通道(本卡: http_get_json 接真) — 对齐换壳前 Rust 实现(5c50f47 lib.rs):
 *
 * - GET + headers + timeout(reqwest::Client::builder().timeout 的等价物: AbortController)
 * - 返回 { status, body }(body 经统一出口脱敏 D-029); 非 2xx **不抛**, 交引擎
 *   GenericHttpAdapter 按 auth_expired_status/!ok 分类(与 renderer 端语义逐字一致)
 * - 网络错误/超时 → 抛 Error(IPC reject → 引擎 fetch catch → error 快照), 消息经脱敏
 * - body 不在主进程做 JSON 解析(JSONPath/resp.json() 在引擎层), "json" 只是
 *   通道契约名 —— 保持换壳前后 renderer 可见语义零变化(P0-8 纪律)
 *
 * 零 electron 依赖(纯 node:undici + core redact), 供主进程与 node vitest 单测共用。
 * fetch 用依赖注入默认全局 fetch(Node 18+ 内置 undici, Electron 主进程 = net 栈),
 * 测试注入 stub server / 立即 reject 的假 fetch。
 */
import { redactSecrets } from "@token-wallet/core/redact";

/** 通道契约(http_get_json IPC 返回值, 与 renderer ipc.ts HttpJsonResponse 同形) */
export interface HttpJsonResponse {
  status: number;
  body: string;
}

/** http_get_json 入参(IPC payload, 与 renderer ipc.ts httpGetJson 实参同形) */
export interface HttpGetJsonArgs {
  url?: unknown;
  headers?: unknown;
  timeoutMs?: unknown;
}

/** 参数校验错误(IPC 层防御: 壳间契约破坏时 fail-fast, 不静默) */
export class HttpArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpArgError";
  }
}

/**
 * 主进程 http_get_json 实现 — GET 一次, 返回 { status, body(脱敏) }。
 * 超时: AbortController + setTimeout, 触发后 fetch reject(AbortError → 统一超时消息)。
 * 网络错误: fetch/读体 reject → 透传(消息脱敏后上抛)。
 * 非 2xx: 正常返回 { status, body }, 分类责任在引擎层(换壳前后语义不变)。
 */
export async function hostHttpGetJson(
  args: HttpGetJsonArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<HttpJsonResponse> {
  // IPC 载荷未经 renderer zod(主进程不信任入参), 逐项校验类型
  const { url, headers, timeoutMs } = args;
  if (typeof url !== "string" || url === "") {
    throw new HttpArgError("http_get_json: url 必须是非空字符串");
  }
  if (headers !== undefined && (typeof headers !== "object" || headers === null || Array.isArray(headers))) {
    throw new HttpArgError("http_get_json: headers 必须是对象");
  }
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new HttpArgError("http_get_json: timeoutMs 必须是正数");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let resp: Response;
    try {
      resp = await fetchImpl(url, {
        method: "GET",
        headers: headers as Record<string, string> | undefined,
        signal: controller.signal,
        // 凭据 key 只活请求构造瞬间(D-029): 不落 cache/disk, 禁 gzip 旁路敏感头
        cache: "no-store",
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(redactSecrets(`请求超时(${timeoutMs}ms): ${url}`));
      }
      throw new Error(
        redactSecrets(`网络错误: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    const status = resp.status;
    let body: string;
    try {
      body = await resp.text();
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(redactSecrets(`请求超时(${timeoutMs}ms): ${url}`));
      }
      throw new Error(
        redactSecrets(`读响应体失败: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    // 统一出口脱敏(D-029): 即使上游错误体回显 key 也打码
    return { status, body: redactSecrets(body) };
  } finally {
    clearTimeout(timer);
  }
}
