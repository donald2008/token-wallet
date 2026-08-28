/**
 * 日志统一出口脱敏 — DESIGN.md §7.2 (D-029)
 *
 * 内存纪律: key 读出只活请求构造瞬间; 任何进入日志/错误消息/UI 的文本
 * 都应经 redactSecrets 脱敏后再输出。模式:
 * - sk- 开头的 API key → sk-***
 * - Bearer <token> → Bearer ***
 */

const SK_PATTERN = /sk-[A-Za-z0-9_-]{4,}/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/g;

/** 把字符串中的密钥形态统一打码: sk-xxx → sk-***, Bearer xxx → Bearer *** */
export function redactSecrets(text: string): string {
  return text.replace(SK_PATTERN, "sk-***").replace(BEARER_PATTERN, "Bearer ***");
}

/** 任意值安全字符串化 + 脱敏(错误消息/日志通用入口) */
export function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") return redactSecrets(value);
    return redactSecrets(JSON.stringify(value));
  } catch {
    return "<unprintable>";
  }
}
