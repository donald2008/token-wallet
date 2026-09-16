/**
 * command_auth 会话桥 — command 通道两段式授权(D-041/D-044 同构, 2026-09-01)
 *
 * 目标: 用户在 app 内点「授权」完成登录, 不碰命令行。交互:
 *   1. command_auth_start(channel) → spawn `auth login …` → 解析 stdout 授权 URL
 *      → 返回 { url, sessionId, finishMode }; 主进程自动 shell.openExternal(浏览器)
 *   2. 用户在浏览器完成授权(显式点同意, 安全边界不变)
 * 完成回执按 finishMode 分流:
 *      - finishMode="code"(arkcli): 浏览器页面显示 base64 code → app 收集 →
 *        spawn **新进程** `--code <code>` 回喂, 解析 JSON ok 字段判成败(不信 exit code)
 *      - finishMode="callback"(bl): 浏览器授权后 302 回跳 CLI 自启的 localhost 端口,
 *        bl 自收 code 落盘退出 → app 监听 close(0) 即完成, 免回喂
 *
 * 与 runCommandFetch 区别: 后者一次性采集(spawn→collect→exit); 本会话是**有状态**
 * (两段式授权, 中间隔用户浏览器授权)。独立模块, 不混入采集路径。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { buildSpawnPlan } from "@token-wallet/core";

/** 授权命令定义: 每 command 通道的 auth login 命令/参数/URL 解析/完成模式 */
export interface AuthCommandDef {
  /** spawn 的命令名(win32 下走 buildSpawnPlan 探测绝对路径) */
  command: string;
  /** 首段参数(bl: [auth,login,--console]; ark: [auth,login,volc-sso,--no-browser]) */
  loginArgs: string[];
  /** 解析授权 URL: 从 stdout 提取浏览器链接; 返回 null=未找到 */
  extractUrl: (stdout: string) => string | null;
  /**
   * 完成模式(与 renderer ipc.finishMode 契约对齐):
   *   "code" — 设备码协议(arkcli): 需用户回喂 code, phase2 = 新进程 --code, 解析 ok 字段
   *   "callback" — localhost 自闭环(bl): 浏览器授权后 CLI 自收 code 退出, 免回喂, 等 close(0)
   */
  finishMode: "code" | "callback";
  /**
   * CLI 是否自带「打开系统浏览器」行为(2026-09-02 真机 bug: bl 两次授权页)。
   * true = CLI 自己会开(bl --console 实测 spawn xdg-open/start), app 不再重复 openExternal;
   * false/缺省 = app 负责开浏览器(arkcli 官方 --no-browser 抑制自开, 由 app 统一开一次)。
   */
  opensBrowserItself?: boolean;
  /** finishMode="code": 组装 phase2 `--code` 参数(ep: ["auth","login","--no-browser","--code", code]) */
  buildCodeArgs?: (code: string) => string[];
  /** finishMode="code": 从 phase2 stdout+stderr 判定成功(解析 ok 字段, 不信任 exit code) */
  parseOk?: (out: string) => boolean;
}

/** 会话状态 */
interface AuthSession {
  def: AuthCommandDef;
  proc: ChildProcessWithoutNullStreams;
  url: string;
  /** finishMode="callback" 专用: 预挂的完成 promise(进程 close(0)=成功; 消除 start→finish 竞态) */
  completion?: Promise<{ ok: boolean; message: string }>;
}

/** 进行中的授权会话(sessionId → 会话); 单通道单会话, 新授权替换旧 */
const sessions = new Map<string, AuthSession>();

/** 生成会话 id(递增 + 随机后缀) */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `auth-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

interface AuthResult {
  ok: boolean;
  message: string;
}

/** 读子进程 stdout 直到提取到 URL(或超时)。URL 命中先于 close(数据事件先于关闭事件)。 */
async function waitForUrl(
  def: AuthCommandDef,
  proc: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      reject(new Error("获取授权 URL 超时"));
    }, timeoutMs);
    proc.stdout!.on("data", (c: Buffer) => {
      chunks.push(c);
      const all = Buffer.concat(chunks).toString("utf8");
      const url = def.extractUrl(all);
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`授权命令启动失败: ${String(err)}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const all = Buffer.concat(chunks).toString("utf8");
      reject(new Error(`授权命令提前退出(exit=${code}): ${all.slice(0, 300)}`));
    });
  });
}

/** finishMode="callback": 预挂完成判定 — 进程 close(0)=浏览器授权成功(bl 自收 code 退出), 超时兜底 */
function waitForClose(proc: ReturnType<typeof spawn>, timeoutMs: number): Promise<AuthResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolve({ ok: false, message: "授权等待超时, 请重试" });
    }, timeoutMs);
    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, message: "授权进程异常退出" });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve(
        code === 0
          ? { ok: true, message: "授权成功" }
          : { ok: false, message: `授权失败(exit=${String(code)})` },
      );
    });
  });
}

/**
 * 启动授权会话: spawn auth login 取 URL, 回调 openBrowser(主进程 shell.openExternal)。
 * 返回 { sessionId, url, finishMode }; 完成回执由 finishAuthSession 按 finishMode 分流。
 */
export async function startAuthSession(
  def: AuthCommandDef,
  openBrowser: (url: string) => void = () => {
    /* 测试不真开浏览器; 生产由 main.ts 注入 shell.openExternal */
  },
  urlTimeoutMs = 15_000,
  waitTimeoutMs = 300_000,
): Promise<{ sessionId: string; url: string; finishMode: "code" | "callback" }> {
  const plan = buildSpawnPlan(def.command, def.loginArgs);
  const proc = spawn(plan.command, plan.args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: plan.windowsHide,
  });
  // 授权进程可能往 stderr 写步骤提示; 日志留档不阻塞
  proc.stderr.on("data", () => {});

  const url = await waitForUrl(def, proc, urlTimeoutMs);
  const sessionId = nextId();
  let completion: Promise<AuthResult> | undefined;
  if (def.finishMode === "callback") {
    // bl 自闭环: 进程在 URL 后保持存活等浏览器 302 回跳; 预挂 close(0)=成功的完成判定
    completion = waitForClose(proc, waitTimeoutMs);
  }
  sessions.set(sessionId, { def, proc, url, completion });
  // CLI 自带开浏览器(bl)时 app 不重复 openExternal —— 否则真机开两次授权页(2026-09-02)
  if (!def.opensBrowserItself) openBrowser(url);
  return { sessionId, url, finishMode: def.finishMode };
}

/**
 * 完成授权回执, 按 finishMode 分流:
 *   - "code": spawn **新进程** `--code <code>`(phase1 已退出, 无 stdin 可喂), 解析 ok 字段
 *   - "callback": 返回 start 时预挂的完成 promise(浏览器授权后 CLI 自收 code 退出 close(0))
 */
export async function finishAuthSession(
  sessionId: string,
  code: string,
  timeoutMs = 20_000,
): Promise<AuthResult> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, message: "授权会话不存在或已过期, 请重新发起" };
  sessions.delete(sessionId); // 一次性会话, 用完即清理

  if (session.def.finishMode === "callback") {
    return (
      session.completion ?? { ok: false, message: "授权会话状态异常, 请重新发起" }
    );
  }
  return completeWithCode(session.def, code, timeoutMs);
}

/** finishMode="code" phase2: spawn 新进程 --code, 收集 stdout+stderr, 按 parseOk 判定(不信 exit code) */
async function completeWithCode(
  def: AuthCommandDef,
  code: string,
  timeoutMs: number,
): Promise<AuthResult> {
  const args = def.buildCodeArgs ? def.buildCodeArgs(code) : [code];
  const plan = buildSpawnPlan(def.command, args);
  const proc = spawn(plan.command, plan.args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: plan.windowsHide,
  });
  return await new Promise<AuthResult>((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolve({ ok: false, message: "授权确认超时" });
    }, timeoutMs);
    let out = "";
    proc.stdout!.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    proc.stderr!.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, message: `授权命令启动失败: ${String(err)}` });
    });
    proc.on("close", () => {
      clearTimeout(timer);
      const ok = def.parseOk ? def.parseOk(out) : out.includes("ok");
      const tail = out.trim().slice(-200);
      resolve(ok ? { ok: true, message: "授权成功" } : { ok: false, message: `授权失败: ${tail || "未知错误"}` });
    });
  });
}

/** 用户取消授权: kill 进程并清会话(bl wait 模式进程保持存活, 必须有取消出口) */
export function cancelAuthSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    session.proc.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

/** 清理所有授权会话(应用退出/窗口关闭时防残留子进程) */
export function abortAllAuthSessions(): void {
  for (const [, s] of sessions) {
    try {
      s.proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  sessions.clear();
}

/** 测试辅助: 当前活跃会话数 */
export function authSessionCount(): number {
  return sessions.size;
}
