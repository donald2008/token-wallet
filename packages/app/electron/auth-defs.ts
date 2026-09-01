/**
 * command 通道授权命令定义表(D-041/D-044 同构, 2026-09-01)
 *
 * 每 command 通道的 auth login 两段式:
 *   1. `<command> <loginArgs>` → stdout 打出授权 URL(浏览器打开)
 *   2. 用户浏览器完成 → 页面显示 code → `<command> <codeArgs(code)>` 或 stdin 回喂
 *
 * 实测基线(用户真机 2026-09-01):
 *   - arkcli auth login volc-sso --no-browser → `@url:` 前缀 + 提示复制授权码
 *     **stdin 交互**: 粘贴 code 回车(auth-session.ts 已按 stdin 回喂实现, 非 --code 参数)
 *   - bl auth login --console → 同构(声称 console access token, 输出窗口未逐字节实测,
 *     按通用 http(s) URL 提取 + stdin 回喂; 真机验证后如需微调只改本表)
 *
 * 协议天花板(诚实标注): 浏览器页面显示 code 是设备码协议, 无法自动捕获 ——
 * 用户仍需「浏览器复制 code → app 粘贴」一次。本表/本流程消灭的是「开终端跑命令」。
 */
import type { AuthCommandDef } from "./auth-session";

/** 通用 URL 提取: 首个 http(s) 链接(bl console 输出与 arkcli @url: 均兼容) */
function extractFirstUrl(stdout: string): string | null {
  const m = /https?:\/\/[^\s`"'<>）)\]]+/i.exec(stdout);
  return m?.[0] ?? null;
}

/** 按 CLI 命令名注册(renderer 从 setup_hint 提取命令首词 → 主进程查表) */
export const AUTH_DEFS: Record<string, AuthCommandDef> = {
  arkcli: {
    command: "arkcli",
    loginArgs: ["auth", "login", "volc-sso", "--no-browser"],
    extractUrl: (stdout) => {
      // arkcli 明确 @url: 前缀优先, 兜底通用 http(s)
      const m = /@url:\s*`?([^`\s]+)/i.exec(stdout);
      if (m?.[1]?.startsWith("http")) return m[1];
      return extractFirstUrl(stdout);
    },
  },
  bl: {
    command: "bl",
    loginArgs: ["auth", "login", "--console"],
    extractUrl: extractFirstUrl,
  },
};

/** 主进程查表: 未知 CLI 返回 undefined(main.ts 转错误) */
export function authDefFor(commandName: string): AuthCommandDef | undefined {
  return AUTH_DEFS[commandName];
}