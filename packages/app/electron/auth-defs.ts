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

/** arkcli phase2 成败判定: 解析 JSON 的 ok 字段(任一对象 ok===true 即成功; 不信 exit code) */
function arkParseOk(out: string): boolean {
  return extractJsonObjects(out).some((s) => {
    try {
      return (JSON.parse(s) as { ok?: unknown }).ok === true;
    } catch {
      return false;
    }
  });
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
