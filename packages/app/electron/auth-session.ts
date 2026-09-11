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
 *
 * 错误分类(2026-09-11 用户 9/11 真机三连 P0):
 *   - "cli_missing": spawn ENOENT(linux/macos 直 spawn 时)或 win32 包壳下
 *     `isShellCommandNotFound(res)`(stdout 空 + stderr 含 `not recognized` 等判别串)。
 *     用户体验: 错误信息明确「<CLI> 未安装或不在 PATH」+ 安装命令 + 重启提示。
 *   - "exec_error": 其它授权失败(CLI 退出非零、URL 超时、JSON 形态错误等)。
 *   - "ok": 成功。
 * 返回 AuthResult 含 `kind` 字段供 renderer 分流渲染(普通错误 vs cli_missing 引导)。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { buildSpawnPlan } from "@token-wallet/core";
import { stripAnsi } from "./auth-defs";

/** 授权错误分类 — renderer 据此选择引导文案(cli_missing 专属安装提示 vs 通用错误) */
export type AuthFailureKind = "cli_missing" | "exec_error";

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
  /**
   * 错误分类(2026-09-11 P0 引导):
   *   - "cli_missing": CLI 未安装 / 不在 PATH, 错误信息已含安装命令 + 重启提示
   *   - "exec_error": 其它授权失败(URL 超时 / JSON 解析失败 / CLI 主动报错等)
   *   - undefined: 成功时无 kind(等价于 "ok")
   */
  kind?: AuthFailureKind;
  /**
   * PATH 自检追加(2026-09-11 P0 L2, 仅 cli_missing 时填充):
   * 当用户 npm 全局 prefix 目录未加入 PATH 时, npm 装包提示已警告但未自修, app 探测到此情况
   * 把 npm prefix 与 PATH 比对结果附在此字段, renderer 额外渲染引导文案 + 一行 PowerShell 修复命令。
   * 字段形态: { npmPrefix, inPath: false } — inPath 恒 false(命中才填充, true 不发, 简化前端)
   */
  pathHint?: { npmPrefix: string };
  /** 触发授权的 CLI 名(2026-09-11 P0 L2 配套: cli_missing 时供 main.ts 调 detectPathHint 用) */
  cli?: string;
}

/** stderr 截断阈值(与既有 waitForUrl / auth-session 截断 300 字符口径一致, 防错误信息爆栈) */
const STDERR_TAIL_MAX = 300;

/**
 * spawn 层 ENOENT → "cli_missing"(linux/macos 直接 spawn 报 ENOENT 是 CLI 缺失的硬信号)。
 * win32 包壳下 cmd.exe 恒存在 → spawn 层永不触发 ENOENT, 该路径由 win32 早退分类承担。
 */
function classifySpawnError(err: unknown): AuthFailureKind | undefined {
  const code = (err as { code?: unknown })?.code;
  return code === "ENOENT" ? "cli_missing" : undefined;
}

/**
 * win32 包壳下 CLI 缺失分类(2026-09-11 P0 L1):
 * 复用 D-041 已落地的 `isShellCommandNotFound` 判别 —— stdout 空 + stderr 含判别串
 * (`not recognized` / `不是内部或外部命令`)。采集侧(volcengine-ark / aliyun-bailian)已用同一判别,
 * 授权侧与采集侧语义对齐: CLI 缺失 = 走安装引导。
 */
const SHELL_NOT_FOUND_STDERR = ["not recognized", "不是内部或外部命令"] as const;
function isWinShellCommandNotFound(stdout: string, stderr: string): boolean {
  if (stdout.trim() !== "") return false;
  return SHELL_NOT_FOUND_STDERR.some((p) => stderr.includes(p));
}

/**
 * L2 PATH 自检(2026-09-11 真机实证 P0, npm prefix 陷阱):
 * 用户 `npm config set prefix D:\npm-global` 后装的包**不在 PATH**(npm 只警告不修),
 * CLI 装了找不到。app 探测到 cli_missing 时进一步判断 npm prefix 是否在 PATH,
 * 命中则把 prefix 附在 pathHint 里回 renderer, 渲染额外引导文案 + 复制按钮。
 *
 * 实现策略(诊断而非修复, app 不代改注册表/不代调 setx):
 *   - spawn `npm config get prefix` 取当前全局 prefix; 失败 → 不发 pathHint(无 npm / npm 未装)
 *   - 拼 PATH(分号) → 看 prefix(归一化大小写与尾斜杠)是否在其中
 *   - 在 → 不发(用户 PATH 正常, 真未装); 不在 → 发 pathHint={ npmPrefix }
 * 失败一律不发 pathHint(诊断不可用就不打扰用户), 避免引导文案反而误导。
 */
export async function detectPathHint(_command: string): Promise<{ npmPrefix: string } | undefined> {
  try {
    const npmProc = spawn(
      "npm",
      ["config", "get", "prefix"],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    npmProc.stdout.on("data", (c: Buffer) => stdout.push(c));
    npmProc.stderr.on("data", (c: Buffer) => stderr.push(c));
    const exitCode: number = await new Promise((resolve) => {
      npmProc.on("close", resolve);
      npmProc.on("error", () => resolve(-1));
      setTimeout(() => {
        try { npmProc.kill("SIGTERM"); } catch { /* ignore */ }
        resolve(-1);
      }, 3_000);
    });
    if (exitCode !== 0) return undefined;
    const prefix = Buffer.concat(stdout).toString("utf8").trim();
    if (!prefix) return undefined;
    // 跨平台 PATH 分隔符 + 大小写归一(win32 默认不区分大小写, npm prefix 与 PATH 比较要 normalize)
    const sep = process.platform === "win32" ? ";" : ":";
    const pathEnv = process.env.PATH ?? process.env.Path ?? "";
    const normalize = (p: string) =>
      process.platform === "win32" ? p.toLowerCase().replace(/[\\/]+$/, "") : p.replace(/\/+$/, "");
    const normalizedPrefix = normalize(prefix);
    const inPath = pathEnv
      .split(sep)
      .some((entry) => normalize(entry) === normalizedPrefix);
    if (inPath) return undefined;
    return { npmPrefix: prefix };
  } catch {
    return undefined;
  }
}

/** 读子进程 stdout 直到提取到 URL(或超时)。URL 命中先于 close(数据事件先于关闭事件)。
 * 2026-09-11 真机实证补三件事:
 *   - stripAnsi: arkcli 1.0.27 输出含 Rust 颜色码, 不 strip 进 URL 提取会错配
 *   - 收集 stderr 进错误信息(旧版 on("data", () => {}) 直接丢弃, 真实报错不可见)
 *   - win32 包壳下 CLI 缺失(早退 + stdout 空 + stderr `not recognized`) → kind="cli_missing"
 */
async function waitForUrl(
  def: AuthCommandDef,
  proc: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
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
      // strip 后再匹配: 真机 arkcli 1.0.27 输出含 \x1b[38;2;... 颜色码, 直接正则会失配
      const all = stripAnsi(Buffer.concat(chunks).toString("utf8"));
      const url = def.extractUrl(all);
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    });
    // 2026-09-11 修复: 旧版丢弃 stderr, 用户只看到「授权命令提前退出(exit=1)」黑话。
    // 改为收集尾部(STDERR_TAIL_MAX 字符), cli_missing / 真实报错时一并进错误信息。
    proc.stderr!.on("data", (c: Buffer) => {
      stderrChunks.push(c);
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      const kind = classifySpawnError(err);
      if (kind === "cli_missing") {
        const msg = `${def.command} 未安装或不在 PATH`;
        reject(Object.assign(new Error(msg), { kind, cli: def.command }));
      } else {
        reject(new Error(`授权命令启动失败: ${String(err)}`));
      }
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const stdout = stripAnsi(Buffer.concat(chunks).toString("utf8"));
      const stderr = stripAnsi(Buffer.concat(stderrChunks).toString("utf8"));
      // win32 包壳下 CLI 缺失分类: 早退 + stdout 空 + stderr 判别串
      if (isWinShellCommandNotFound(stdout, stderr)) {
        const msg = `${def.command} 未安装或不在 PATH`;
        reject(Object.assign(new Error(msg), { kind: "cli_missing" as AuthFailureKind, cli: def.command }));
        return;
      }
      // 普通早退: stderr 尾部脱敏后并入错误信息(STDERR_TAIL_MAX 字符)
      const stderrTail = stderr.trim().slice(-STDERR_TAIL_MAX);
      const tail = stderrTail || stdout.slice(-STDERR_TAIL_MAX);
      reject(new Error(`授权命令提前退出(exit=${code}): ${tail || "未知错误"}`));
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
  // 2026-09-11 P0 修复: 旧版直接 on("data", () => {}) 丢弃 stderr, 用户只看到
  // 「授权命令提前退出(exit=1)」黑话(真机案例)。现在 stderr 收集改在 waitForUrl 内完成,
  // 配合 cli_missing 分类一并进错误信息, 此处不再二次挂 no-op 监听器。

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
  // cli_missing 时 completeWithCode 内部已把 cli 字段写到 result, main.ts 据此调 detectPathHint
  return completeWithCode(session.def, code, timeoutMs);
}

/** finishMode="code" phase2: spawn 新进程 --code, 收集 stdout+stderr, 按 parseOk 判定(不信 exit code)
 * 2026-09-11 P0 补: stripAnsi(arkcli 1.0.27 颜色码)+ stderr 收集 + cli_missing 分类
 */
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
    let stdoutRaw = "";
    let stderrRaw = "";
    proc.stdout!.on("data", (c: Buffer) => {
      stdoutRaw += c.toString("utf8");
    });
    proc.stderr!.on("data", (c: Buffer) => {
      stderrRaw += c.toString("utf8");
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      const kind = classifySpawnError(err);
      if (kind === "cli_missing") {
        const msg = `${def.command} 未安装或不在 PATH`;
        resolve({ ok: false, message: msg, kind, cli: def.command });
      } else {
        resolve({ ok: false, message: `授权命令启动失败: ${String(err)}` });
      }
    });
    proc.on("close", () => {
      clearTimeout(timer);
      // strip 后统一进判据 + 错误信息; 判据与错误信息基于同一干净文本, 不会自相矛盾
      const stdout = stripAnsi(stdoutRaw);
      const stderr = stripAnsi(stderrRaw);
      const combined = stdout + stderr;
      // 2026-09-11 P0 L1: win32 包壳下 CLI 缺失(早退 + stdout 空 + stderr 判别串)
      if (isWinShellCommandNotFound(stdout, stderr)) {
        const msg = `${def.command} 未安装或不在 PATH`;
        resolve({ ok: false, message: msg, kind: "cli_missing", cli: def.command });
        return;
      }
      const ok = def.parseOk ? def.parseOk(combined) : combined.includes("ok");
      const stderrTail = stderr.trim().slice(-STDERR_TAIL_MAX);
      const tail = stderrTail || stdout.trim().slice(-STDERR_TAIL_MAX) || "未知错误";
      if (ok) {
        resolve({ ok: true, message: "授权成功" });
      } else {
        resolve({ ok: false, message: `授权失败: ${tail}` });
      }
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
