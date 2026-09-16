/**
 * command 通道授权命令定义表(D-041/D-044 同构, 2026-09-01 njbx02 定)
 *
 * 两种完成模式(评审 round1 修正, 推翻先前 stdin 回喂模型):
 *   - finishMode="code"(arkcli, 设备码协议): step1 spawn `<command> <loginArgs>` → stdout 打
 *     授权 JSON(authorize_url 字段 + 人类文本), 进程随即 **exit 0 立即退出, 不读 stdin**;
 *     浏览器打开授权页显示 base64 code(不可自动捕获)→ 用户复制 → app 收集 →
 *     step2 spawn **新进程** `<command> <buildCodeArgs(code)>`(官方 next_command:
 *     `arkcli auth login --no-browser --code <code>`) → 解析 stdout+stderr JSON `ok` 字段
 *     判成败(exit code 不可信, 实测失败也 exit 0/1 不定)。
 *   - finishMode="callback"(bl, localhost 自闭环): step1 spawn `bl auth login --console` → stdout 打
 *     `https://bailian.console.aliyun.com/console-login?notice=127.0.0.1:PORT?state=...`,
 *     进程**保持存活**; 浏览器授权后 302 回跳本机端口, bl 自收 code 落盘 → exit 0。
 *     免回喂: app 监听进程 close(0) 即完成(无效 code 返回 400 且保持存活, 可取消)。
 *
 * 实测基线(2026-09-01 njbx02 隔离 HOME /tmp/arkcli-research + /tmp/bl181 复现):
 *   - arkcli 1.0.23(stdin=pipe 非交互)输出尾 JSON
 *     {"authorize_url":"…","expires_in_sec":600,"method":"sso_no_browser",
 *      "next_command":"arkcli auth login --no-browser --code <code>","stage":"authorize_pending"}
 * 后 exit 0; 官方 Phase2 = next_command(新进程 --code), 非 stdin 回喂
 *   - `arkcli … --code <code>` → JSON {"ok":true|false,"error":{…}}, 成败必须解析 ok 字段
 */
import type { AuthCommandDef } from "./auth-session";

/**
 * 从 CLI 输出提取全部 JSON 对象(处理嵌套花括号 + 字符串内花括号, 与人类文本混排兼容)。
 * 现仅 mode="code" 的 phase2 成败判定使用(arkcli JSON ok 字段)。
 */
export function extractJsonObjects(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start < 0) break;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = start;
    for (; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    if (j > start && text[j - 1] === "}") out.push(text.slice(start, j));
    i = j;
  }
  return out;
}

/** 通用 URL 提取: 首个 http(s) 链接(bl console 输出与 arkcli @url:/JSON authorize_url 均兼容) */
function extractFirstUrl(stdout: string): string | null {
  const m = /https?:\/\/[^\s`"'<>）)\]]+/i.exec(stdout);
  return m?.[0] ?? null;
}

/**
 * ANSI 转义码剥离(2026-09-11 真机实证, t_x 用户 9/11 三连 P0):
 * arkcli 1.0.27 输出含 Rust 风格 RGB 颜色码 `\x1b[38;2;R;G;Bm` 与 SGR 重置 `\x1b[0m`,
 * 不 strip 落 UI 会出现 `□[38;2;22;100;255m▶ 正在交换访问令牌…` 乱码。
 * 实现仅匹配 SGR 序列(CSI `[` + 数字/分号参数 + 末尾字母), 不动 OSC 等其他 ANSI;
 * 满足 arkcli/bl 实际输出形态, 不会误伤正常文本。
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/**
 * arkcli phase2 / refresh 同账号分支 — 三层判据(按优先级, 2026-09-11 真机实证):
 *   ① JSON `ok===true`(1.0.23 契约, 老 fixture 不动)
 *   ② JSON 含 `auth_method` 且无 `error` 字段(1.0.27 同账号 refresh 新分支:
 *      输出仅文本「√ 火山 SSO 认证成功!」+ [arkcli] ✓ 同账号 SSO refresh, profile 保留
 *      + {"auth_method": "sso_no_browser", "path": "same"}, 无 ok 字段)
 *   ③ strip ANSI 后文本匹配「SSO 认证成功」/「同账号 SSO refresh」(文本兜底,
 *      防后续 CLI 版本漂移再次漏判)
 * 任一命中即认为成功(用户已实测三形态都=真授权成功, 旧版判失败是误判)。
 */
export function arkParseOk(rawOut: string): boolean {
  const out = stripAnsi(rawOut);
  // ① + ②: 解析所有 JSON 对象(混排文本中可能有多个, 任一满足即成功)
  const jsonObjects = extractJsonObjects(out);
  for (const s of jsonObjects) {
    let parsed: { ok?: unknown; auth_method?: unknown; error?: unknown };
    try {
      parsed = JSON.parse(s) as { ok?: unknown; auth_method?: unknown; error?: unknown };
    } catch {
      continue;
    }
    if (parsed.ok === true) return true;
    // ② 1.0.27 同账号 refresh 分支: 有 auth_method(成功凭证) + 无 error(未失败)
    if (typeof parsed.auth_method === "string" && parsed.auth_method.length > 0 && parsed.error === undefined) {
      return true;
    }
  }
  // ③ 文本兜底: 真实 1.0.27 输出含「√ 火山 SSO 认证成功!」+「✓ 同账号 SSO refresh」原文
  // strip ANSI 后原文匹配(防未来 JSON 形态再漂移, 兜底用文本关键词)
  return /SSO\s*认证成功|同账号\s*SSO\s*refresh/i.test(out);
}

/** 按 CLI 命令名注册(renderer 从 setup_hint 提取命令首词 → 主进程查表) */
export const AUTH_DEFS: Record<string, AuthCommandDef> = {
  arkcli: {
    command: "arkcli",
    loginArgs: ["auth", "login", "volc-sso", "--no-browser"],
    extractUrl: (stdout) => {
      // arkcli step1 输出@url/JSON authorize_url; 通用 http(s) 兜底
      const m = /@url:\s*`?([^`\s]+)/i.exec(stdout);
      if (m?.[1]?.startsWith("http")) return m[1];
      return extractFirstUrl(stdout);
    },
    finishMode: "code",
    // step2 = 官方 next_command: `arkcli auth login --no-browser --code <code>`(新进程)
    buildCodeArgs: (code) => ["auth", "login", "--no-browser", "--code", code],
    parseOk: arkParseOk,
  },
  bl: {
    command: "bl",
    loginArgs: ["auth", "login", "--console"],
    extractUrl: extractFirstUrl,
    // localhost 自闭环免回喂: 浏览器授权后 302 回跳, bl 自收 code 退出(等 close(0))
    finishMode: "callback",
    // bl --console 自带开系统浏览器(xdg-open/start), app 不重复 openExternal(2026-09-02 真机: 两次授权页)
    opensBrowserItself: true,
  },
};

/** 主进程查表: 未知 CLI 返回 undefined(main.ts 转错误) */
export function authDefFor(commandName: string): AuthCommandDef | undefined {
  return AUTH_DEFS[commandName];
}
