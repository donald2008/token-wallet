/**
 * command_auth 会话桥 — command 通道两段式授权(D-041/D-044 同构, 2026-09-01)
 *
 * 目标: 用户在 app 内点「授权」完成登录, 不碰命令行。交互:
 *   1. command_auth_start(channel) → spawn `auth login … --no-browser` → 解析 stdout 授权 URL
 *      → 返回 { url, sessionId }; 主进程自动 shell.openExternal(浏览器)
 *   2. 用户在浏览器完成授权 → 页面显示一段 code(base64; arkcli 设备码协议, 非 localhost 重定向)
 *   3. command_auth_finish(sessionId, code) → 向缓存子进程 stdin 写 code+回车 → 等 exit 验证登录
 *
 * 协议天花板: arkcli/bl 的 code 是浏览器页面展示的 base64(非回调), 无法完全免粘贴——
 * 用户仍需「浏览器复制 code → app 粘贴」一次。本模块负责把其余全部自动化,
 * 消灭「开终端跑命令」。(设备码协议限制, 非实现缺口)
 *
 * 与 runCommandFetch 区别: 后者一次性采集(spawn→collect→exit); 本会话是**有状态**
 * (spawn 后保持 stdin 打开, 等用户 code 再喂)。独立模块, 不混入采集路径。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { buildSpawnPlan } from "@token-wallet/core";

/** 授权命令定义: 每 command 通道的 auth login 命令/参数/URL 解析 */
export interface AuthCommandDef {
  /** spawn 的命令名(win32 下走 buildSpawnPlan 探测绝对路径) */
  command: string;
  /** 首段参数(bl: [auth,login,--console]; ark: [auth,login,volc-sso,--no-browser]) */
  loginArgs: string[];
  /** 解析授权 URL: 从 stdout 提取浏览器链接; 返回 null=未找到 */
  extractUrl: (stdout: string) => string | null;
}

/** 会话状态 */
interface AuthSession {
  def: AuthCommandDef;
  proc: ChildProcessWithoutNullStreams;
  url: string;
}

/** 进行中的授权会话(sessionId → 会话); 单通道单会话, 新授权替换旧 */
const sessions = new Map<string, AuthSession>();

/** 生成会话 id(递增 + 随机后缀) */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `auth-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 读子进程 stdout 直到提取到 URL(或 15s 超时) */
async function waitForUrl(
  def: AuthCommandDef,
  proc: ReturnType<typeof spawn>,
  timeoutMs = 15_000,
): Promise<string> {
  const chunks: Buffer[] = [];
  const done = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("获取授权 URL 超时")), timeoutMs);
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
  return done;
}

/**
 * 启动授权会话: spawn auth login, 取 URL 自动开浏览器, 返回 {url, sessionId}。
 * 进程保持存活等 finish 喂 code。url 打开由调用方(main.ts)做 shell.openExternal。
 */
export async function startAuthSession(
  def: AuthCommandDef,
  openBrowser: (url: string) => void = () => {
    /* 测试不真开浏览器; 生产由 main.ts 注入 shell.openExternal */
  },
  urlTimeoutMs = 15_000,
): Promise<{ sessionId: string; url: string }> {
  const plan = buildSpawnPlan(def.command, def.loginArgs);
  const proc = spawn(plan.command, plan.args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: plan.windowsHide,
  });
  // 授权进程可能往 stderr 写步骤提示; 日志留档不阻塞
  proc.stderr.on("data", () => {});

  const url = await waitForUrl(def, proc, urlTimeoutMs);
  const sessionId = nextId();
  sessions.set(sessionId, { def, proc, url });
  openBrowser(url);
  return { sessionId, url };
}

/** 用户粘贴 code 后回喂, 等进程退出验证登录结果 */
export async function finishAuthSession(
  sessionId: string,
  code: string,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; message: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, message: "授权会话不存在或已过期, 请重新发起" };
  sessions.delete(sessionId); // 一次性会话, 用完即清理

  const { proc } = session;
  const result = new Promise<{ ok: boolean; message: string }>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ ok: false, message: "授权确认超时" });
    }, timeoutMs);
    let out = "";
    proc.stdout!.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    // stderr 并入输出(错误 code 时 CLI 往往把失败原因写 stderr)
    proc.stderr!.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      // exit 0 = 登录成功; bl/ark 两段式完成都会正常退出
      const tail = out.trim().slice(-200);
      if (code === 0) resolve({ ok: true, message: "授权成功" });
      else resolve({ ok: false, message: `授权失败(exit=${code}): ${tail}` });
    });
  });

  // 写 code + 回车(arkcli stdin 交互)
  proc.stdin!.write(`${code}\n`);
  return result;
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
