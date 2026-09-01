/**
 * auth-session 授权会话单测(t_fb8c44d8, node vitest)
 *
 * 用真实 node 子进程模拟 CLI 的两段式:
 *   - spawn 后 stdout 打印授权 URL(arkcli `@url:` 形态), 然后阻塞读 stdin
 *   - 收到 code 后打印 ok 并 exit 0
 * 验证: URL 提取(含重复数据段 accumulate)、stdin 回喂、exit=0 判定成功、
 * 提前退出/超时错误、会话清理。
 */
import { describe, expect, it, afterEach } from "vitest";

// 授权会话驱动器与类型
import { startAuthSession, finishAuthSession, authSessionCount, abortAllAuthSessions } from "./auth-session";
import type { AuthCommandDef } from "./auth-session";

// 每个测试后清理残留授权进程, 防泄漏串扰
afterEach(() => {
  abortAllAuthSessions();
});

/** 模拟 arkcli 的授权 CLI(node 脚本, 走真实 stdin/stdout; String.raw 保 \n 转义) */
const FAKE_ARK_SCRIPT = String.raw`
process.stdout.write("请在任意设备的浏览器中打开以下 URL:\n");
process.stdout.write("@url:\`https://signin.volcengine.com/authorize/oauth/authorize?client_id=test&state=fake\`\n");
process.stdout.write("把授权码粘贴到此处后回车:\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  if (buf.includes("\n")) {
    const code = buf.trim();
    if (code.startsWith("CODE-")) {
      process.stdout.write("login ok\n");
      process.exit(0);
    } else {
      process.stderr.write("bad code\n");
      process.exit(1);
    }
  }
});
`;

function fakeArkDef(): AuthCommandDef {
  return {
    command: process.execPath,
    loginArgs: ["-e", FAKE_ARK_SCRIPT],
    extractUrl: (stdout) => {
      const m = /@url:\s*`?([^`\s]+)/i.exec(stdout);
      return m?.[1]?.startsWith("http") ? m[1] : null;
    },
  };
}

describe("auth-session(授权会话驱动器, t_fb8c44d8)", () => {
  it("startAuthSession: 解析 @url 前缀 URL 并回调 openBrowser", async () => {
    const opened: string[] = [];
    const { sessionId, url } = await startAuthSession(fakeArkDef(), (u) => opened.push(u));
    expect(url).toMatch(/^https:\/\/signin\.volcengine\.com\//);
    expect(opened).toEqual([url]);
    expect(sessionId).toBeTruthy();
    // 默认 openBrowser 是 no-op, 不炸
    await startAuthSession(fakeArkDef());
  });

  it("finishAuthSession: stdin 回喂正确 code → exit 0 → ok", async () => {
    const { sessionId } = await startAuthSession(fakeArkDef());
    const res = await finishAuthSession(sessionId, "CODE-ABC123");
    expect(res.ok).toBe(true);
    expect(res.message).toBe("授权成功");
  });

  it("finishAuthSession: 错误 code → exit 1 → 失败带 stderr 尾巴", async () => {
    const { sessionId } = await startAuthSession(fakeArkDef());
    const res = await finishAuthSession(sessionId, "BAD");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("exit=1");
    expect(res.message).toContain("bad code");
  });

  it("finishAuthSession: 未知 sessionId → 直接失败不炸", async () => {
    const res = await finishAuthSession("no-such-session", "CODE-X");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("不存在");
  });

  it("startAuthSession: CLI 提前退出无 URL → 报错(不挂起)", async () => {
    const def: AuthCommandDef = {
      command: process.execPath,
      loginArgs: ["-e", "process.exit(1)"],
      extractUrl: () => null,
    };
    await expect(startAuthSession(def)).rejects.toThrow(/提前退出\(exit=1\)/);
  });

  it("授权完成后会话清理: finish 后 sessions 为空", async () => {
    const { sessionId } = await startAuthSession(fakeArkDef());
    expect(authSessionCount()).toBeGreaterThan(0);
    await finishAuthSession(sessionId, "CODE-X");
    expect(authSessionCount()).toBe(0);
  });

  it("超时: URL 迟迟不来 → 注入短 timeout 验证拒绝路径", async () => {
    const def: AuthCommandDef = {
      command: process.execPath,
      loginArgs: ["-e", "setTimeout(()=>{}, 60000)"], // 永不输出 URL
      extractUrl: () => null,
    };
    const t0 = Date.now();
    await expect(startAuthSession(def, () => {}, 200)).rejects.toThrow(/获取授权 URL 超时/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
  });
});