/**
 * auth-session 授权会话单测(t_fb8c44d8 修正轮, node vitest)
 *
 * 按真实 CLI 协议(2026-09-01 njbx02 隔离 HOME 实测):
 *   - arkcli phase1(stdin=pipe): stdout 打 JSON authorize_url 后**立即 exit 0 不读 stdin**
 *     → finishMode="code" 时 phase2 必须 spawn **新进程** `--code <code>`(无 stdin 可喂)
 *   - arkcli phase2: 输出 JSON {"ok":true|false}; 成败解析 ok 字段, **不信 exit code**
 *     (真实失败也 exit 0/1 不定)
 *   - bl --console: localhost 自闭环, process 打印 URL 后**保持存活**, 浏览器授权后
 *     302 回跳自收 code → exit 0 → finishMode="callback" 免回喂, 等 close(0)
 *
 * 假 CLI 用 node -e 真实子进程模拟以上形态(不走 stdin 交互 —— 那正是被推翻的旧模型)。
 */
import { describe, expect, it, afterEach } from "vitest";

// 授权会话驱动器与类型
import { startAuthSession, finishAuthSession, cancelAuthSession, authSessionCount, abortAllAuthSessions } from "./auth-session";
import type { AuthCommandDef } from "./auth-session";
import { authDefFor, extractJsonObjects } from "./auth-defs";

// 每个测试后清理残留授权进程/会话, 防泄漏串扰
afterEach(() => {
  abortAllAuthSessions();
});

/** 假 arkcli phase1: 打 JSON authorize_url 后自然退出(exit 0, 非交互不读 stdin) */
const FAKE_ARK_PHASE1 = String.raw`
process.stdout.write(JSON.stringify({
  authorize_url: "https://signin.volcengine.com/authorize/oauth/authorize?client_id=test&state=unit",
  expires_in_sec: 600,
  method: "sso_no_browser",
  next_command: "arkcli auth login --no-browser --code <code>",
  stage: "authorize_pending"
}) + "\n");
`;

/** 假 arkcli phase2: 收 argv 的 code, 打印 {"ok":…}; 一律 exit 0(真实失败也 exit 0 → 不能信 exit code) */
const FAKE_ARK_PHASE2 = String.raw`
const code = process.argv[1] || "";
const ok = code.startsWith("CODE-");
process.stdout.write(JSON.stringify(ok ? { ok: true } : { ok: false, error: { message: "invalid code" } }) + "\n");
process.exit(0);
`;

/** 假 bl --console: localhost 自闭环 — 打印 URL 后保持存活, 模拟浏览器授权后 302 回跳自收 code 退出 */
const FAKE_BL_EXIT_0 = String.raw`
process.stdout.write("https://bailian.console.aliyun.com/console-login?notice=127.0.0.1:4321?state=unit\n");
setTimeout(() => process.exit(0), 300);
`;

const FAKE_BL_EXIT_1 = String.raw`
process.stdout.write("https://bailian.console.aliyun.com/console-login?notice=127.0.0.1:4322?state=unit\n");
setTimeout(() => process.exit(1), 300);
`;

/** 假 bl 挂起(浏览器授权迟迟不来, 由 waitTimeout 兜底) */
const FAKE_BL_HANG = String.raw`
process.stdout.write("https://bailian.console.aliyun.com/console-login?notice=127.0.0.1:4323?state=unit\n");
setTimeout(() => {}, 60000);
`;

/** arkcli 类型 def(node -e 假 CLI; finishMode="code" 两段新进程) */
function arkDef(): AuthCommandDef {
  return {
    command: process.execPath,
    loginArgs: ["-e", FAKE_ARK_PHASE1],
    extractUrl: (stdout) => {
      // 同 AUTH_DEFS: 该输出形态下取 JSON authorize_url(通用 http(s) 兜底)
      const m = /https:\/\/signin\.volcengine\.com\/[^\s"}\\]*/i.exec(stdout);
      return m?.[0] ?? null;
    },
    finishMode: "code",
    buildCodeArgs: (code) => ["-e", FAKE_ARK_PHASE2, code],
    parseOk: (out) => extractJsonObjects(out).some((s) => (JSON.parse(s) as { ok?: unknown }).ok === true),
  };
}

/** bl 类型 def(node -e 假 CLI; finishMode="callback" 自闭环) */
function blDef(script: string): AuthCommandDef {
  return {
    command: process.execPath,
    loginArgs: ["-e", script],
    extractUrl: (stdout) => {
      const m = /https:\/\/bailian\.console\.aliyun\.com\/[^\s"}\\]*/i.exec(stdout);
      return m?.[0] ?? null;
    },
    finishMode: "callback",
    // bl --console 自带开浏览器 → app 不重复 openExternal(2026-09-02: 两次授权页 bug)
    opensBrowserItself: true,
  };
}

describe("auth-session(授权会话驱动器, t_fb8c44d8 修正轮)", () => {
  it("arkcli phase1: 打印 JSON authorize_url 后立即 exit 0 仍成功(start 不因提前退出挂起)", async () => {
    const opened: string[] = [];
    const { sessionId, url, finishMode } = await startAuthSession(arkDef(), (u) => opened.push(u));
    expect(url).toMatch(/^https:\/\/signin\.volcengine\.com\//);
    expect(opened).toEqual([url]);
    expect(finishMode).toBe("code");
    expect(sessionId).toBeTruthy();
    // phase1 虽已退出, 会话仍登记(供 finish 拿 def 起新进程)
    expect(authSessionCount()).toBe(1);
    // 默认 openBrowser 是 no-op, 不炸
    await startAuthSession(arkDef());
  });

  it("arkcli phase2: 正确 code → spawn 新进程 --code → 解析 ok:true → 授权成功", async () => {
    const { sessionId } = await startAuthSession(arkDef());
    const res = await finishAuthSession(sessionId, "CODE-ABC123");
    expect(res.ok).toBe(true);
    expect(res.message).toBe("授权成功");
    // 一次性会话: finish 即清
    expect(authSessionCount()).toBe(0);
  });

  it("arkcli phase2: 错误 code → 即使 exit 0 也判失败(解析 ok:false, 不信 exit code)", async () => {
    const { sessionId } = await startAuthSession(arkDef());
    const res = await finishAuthSession(sessionId, "BAD-CODE");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("invalid code");
  });

  it("finishAuthSession: 未知 sessionId → 直接失败不炸", async () => {
    const res = await finishAuthSession("no-such-session", "CODE-X");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("不存在");
  });

  it("startAuthSession: phase1 提前退出无 URL → 报错(不挂起)", async () => {
    const def: AuthCommandDef = {
      command: process.execPath,
      loginArgs: ["-e", "process.exit(1)"],
      extractUrl: () => null,
      finishMode: "code",
    };
    await expect(startAuthSession(def)).rejects.toThrow(/提前退出\(exit=1\)/);
  });

  it("bl callback: 浏览器授权后 CLI 自收 code exit 0 → 免回喂自动完成; app 不开浏览器(bl 自带开)", async () => {
    const opened: string[] = [];
    const { sessionId, url, finishMode } = await startAuthSession(blDef(FAKE_BL_EXIT_0), (u) => opened.push(u));
    expect(url).toContain("bailian.console.aliyun.com");
    expect(finishMode).toBe("callback");
    // 2026-09-02 真机 bug 修复: bl --console 自带开浏览器, app 不重复 openExternal(否则两次授权页)
    expect(opened).toEqual([]);
    // 免回喂: code 传空串, 等 bl 自闭环 close(0)(300ms 后)
    const res = await finishAuthSession(sessionId, "");
    expect(res.ok).toBe(true);
    expect(res.message).toBe("授权成功");
  });

  it("bl callback: exit 1 → 授权失败带 exit", async () => {
    const { sessionId } = await startAuthSession(blDef(FAKE_BL_EXIT_1));
    const res = await finishAuthSession(sessionId, "");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("exit=1");
  });

  it("bl callback: 浏览器授权迟迟不来 → 等待超时兜底(kill 不挂起)", async () => {
    const { sessionId } = await startAuthSession(blDef(FAKE_BL_HANG), () => {}, 5_000, 300);
    const res = await finishAuthSession(sessionId, "");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("授权等待超时");
  });

  it("cancelAuthSession: 取消清理会话(kill 存活进程, callback 模式必须有出口)", async () => {
    const { sessionId } = await startAuthSession(blDef(FAKE_BL_HANG), () => {}, 5_000, 60_000);
    expect(authSessionCount()).toBe(1);
    cancelAuthSession(sessionId);
    expect(authSessionCount()).toBe(0);
  });

  it("abortAllAuthSessions: 清理全部残留会话", async () => {
    await startAuthSession(arkDef());
    await startAuthSession(blDef(FAKE_BL_HANG), () => {}, 5_000, 60_000);
    expect(authSessionCount()).toBe(2);
    abortAllAuthSessions();
    expect(authSessionCount()).toBe(0);
  });

  it("超时: URL 迟迟不来 → 注入短 timeout 验证拒绝路径", async () => {
    const def: AuthCommandDef = {
      command: process.execPath,
      loginArgs: ["-e", "setTimeout(()=>{}, 60000)"], // 永不输出 URL
      extractUrl: () => null,
      finishMode: "code",
    };
    const t0 = Date.now();
    await expect(startAuthSession(def, () => {}, 200)).rejects.toThrow(/获取授权 URL 超时/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
  });
});

describe("auth-defs 注册表(t_fb8c44d8 契约)", () => {
  it("arkcli → finishMode=code, phase2 组装 --code; bl → finishMode=callback", () => {
    const ark = authDefFor("arkcli");
    expect(ark?.finishMode).toBe("code");
    expect(ark?.buildCodeArgs?.("CODE-X")).toEqual(["auth", "login", "--no-browser", "--code", "CODE-X"]);

    const bl = authDefFor("bl");
    expect(bl?.finishMode).toBe("callback");
  });

  it("未知 CLI → undefined", () => {
    expect(authDefFor("kimi")).toBeUndefined();
  });

  it("arkcli extractUrl 兼容 JSON authorize_url 输出(实战形态)", () => {
    const ark = authDefFor("arkcli")!;
    const out = `请在浏览器打开:\n${JSON.stringify({
      authorize_url: "https://signin.volcengine.com/authorize?client_id=x&state=y",
      stage: "authorize_pending",
    })}\n`;
    expect(ark.extractUrl(out)).toContain("signin.volcengine.com");
  });
});
