/**
 * L1 golden sample — volcengine-ark/coding-plan command 类第二实例 (D-044, 2026-08-31)
 *
 * fixture = 官方 arkcli(binary 内嵌 skill 文档 + pi-ark-quota 双源证实, 1.0.23):
 *   健康态: {"ok":true,"items":[{"product":"coding-plan","subscribed":true,
 *           "periods":[{"label":"session","used":…,"total":…,"percent":25,"reset_at":"RFC3339"},…]}]}
 * 断言: CodingPlan percent **已是 0-100**(勿 ×100)、reset_at RFC3339 字符串 → 秒、
 *   auth_expired(exit=1 + stderr body) 分类、未安装 ENOENT。
 * runner 注入(替代真实 spawn)覆盖三态 + healthCheck 未配置判定。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  VolcengineArkCodingPlanAdapter,
  ARK_USAGE_ARGS,
  ARK_USAGE_CMD,
  STS_LOCK_STALE_MS,
  type ArkLockFs,
} from "../src/channels/volcengine-ark.js";
import { buildSpawnPlan, isShellCommandNotFound, SpawnError, type CommandRunResult } from "../src/adapters.js";
import { VOLCENGINE_ARK_CODING_PLAN } from "../src/channels/presets.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "src", "channels", "__fixtures__");
const HEALTHY = readFileSync(join(FIXTURES, "ark-usage-healthy.json"), "utf8");
// 真机 golden(2026-09-01, 用户 Windows 1.0.23+SSO): percent 直接给值 + session 窗无 used/total/reset_at
const HEALTHY_REAL = readFileSync(join(FIXTURES, "ark-usage-healthy-real.json"), "utf8");
// 9/8 用户拍板: 含「STS 续期失败」+「另一个 arkcli 进程正在刷新」的 body = token 失效
// 真实信号, 不再当并发锁; 9/7 fixture 伪造段(invalid_request 串, 实际只来自 auth status
// 不来自 usage plan)删除, 回归用户 Windows 1.0.23 + njbx02 1.0.22 真机双版本原文。
// 见 t_f261dadb 任务 body「真实报错」段。
const STS_LOCK = readFileSync(join(FIXTURES, "ark-usage-token-revoked-real.json"), "utf8");
// 未登录形态: 真实 arkcli(干净 HOME)error body 写 **stderr**、stdout 空(exit=1)
const AUTH_EXPIRED_STDERR = readFileSync(join(FIXTURES, "ark-usage-auth-expired.json"), "utf8");
// 真机中毒现场(t_f261dadb 9/8 重写): body 含「STS 续期失败」「另一个 arkcli 进程正在刷新」
// +「requires Volcengine Ark SSO STS」+「please run arkcli auth login volc-sso」—— 9/7
// 的 invalid_request 伪造段已删(只来自 auth status, 不来自 usage plan), 回归用户真机原文。
// 真相是 SSO refresh_token 失效, 必走 auth_expired 走一键授权。
const TOKEN_REVOKED_REAL = STS_LOCK; // 9/8 落地: 锁竞争 body 与 token 失效 body 形态合并
// 历史 alias: 原 fixture 名 ark-usage-sts-lock.json 内容与 token-revoked-real 完全一致(都是
// 真机原文), 保留以防仓内外部脚本靠该路径引用, 但测试不直接读它。
void readFileSync(join(FIXTURES, "ark-usage-sts-lock.json"), "utf8");
const NEVER_CONFIGURED = readFileSync(join(FIXTURES, "ark-auth-status-never-configured.json"), "utf8");

const INSTANCE: InstanceConfig = {
  id: "ark",
  channel: "volcengine-ark/coding-plan",
  name: "火山方舟 Coding Plan #1",
  params: {},
};

function makeCtx(): AdapterContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 15_000,
    fetchedAt: 1_718_000_000,
    resolveCredential: () => Promise.resolve(""),
  };
}

/** 注入 runner: 返回预设 {stdout, code} (stderr 缺省空串) */
function runnerReturning(res: Omit<CommandRunResult, "stderr"> & { stderr?: string }) {
  const full: CommandRunResult = { stderr: "", ...res };
  return () => Promise.resolve(full);
}

/** 注入 runner: reject SpawnError(ENOENT=arkcli 不在 PATH) */
function runnerEnOent() {
  return () =>
    Promise.reject(
      new SpawnError("命令启动失败: arkcli: spawn arkcli ENOENT", Object.assign(new Error("spawn arkcli ENOENT"), { code: "ENOENT" })),
    );
}

/** 注入 runner: 按序返回预设结果序列(撞锁重试用: 每次调用弹出下一个; stdout 缺省空) */
function runnerSequence(seq: Array<Omit<CommandRunResult, "stderr" | "stdout"> & { stderr?: string; stdout?: string }>) {
  const full = seq.map((s) => ({ stderr: "", stdout: "", ...s }) as CommandRunResult);
  let calls = 0;
  return {
    runner: () => {
      const res = full[Math.min(calls, full.length - 1)];
      calls += 1;
      return Promise.resolve(res);
    },
    callCount: () => calls,
  };
}

describe("volcengine-ark/coding-plan golden sample(D-044 三态)", () => {
  it("健康态: CodingPlan percent 已是 0-100, session/weekly/monthly 三窗, reset_at RFC3339 字符串 → 秒", async () => {
    const adapter = new VolcengineArkCodingPlanAdapter(runnerReturning({ stdout: HEALTHY, code: 0 }));
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("ok");
    expect(snap.plan_type).toBe("window");
    // 个人版 Coding Plan: session(5h)/weekly/monthly 三窗
    const keys = snap.metrics.map((m) => m.key);
    expect(keys).toEqual(["rolling_5h", "weekly", "monthly"]);
    // 按 windowsSpanRank 语义: 5h→周→月
    expect(snap.metrics.map((m) => m.key)).toEqual(
      [...snap.metrics].sort((a, b) => windowSpanOf(a.key) - windowSpanOf(b.key)).map((m) => m.key),
    );
    // percent 已是 0-100(勿 ×100): session 25 → 25
    const session = snap.metrics.find((m) => m.key === "rolling_5h")!;
    expect(session.used).toBe(25);
    expect(session.limit).toBe(100);
    // reset_at RFC3339(UTC+08:00) 字符串 → unix 秒; Date.parse("2024-05-30T05:26:40+08:00")
    expect(session.reset_at).toBe(Math.floor(Date.parse("2024-05-30T05:26:40+08:00") / 1000));
    const weekly = snap.metrics.find((m) => m.key === "weekly")!;
    expect(weekly.used).toBe(16);
  });

  it("健康态 percent 缺席时 used/total 兜底推导(used/total*100)", async () => {
    const body = JSON.stringify({
      ok: true,
      items: [
        {
          product: "coding-plan",
          subscribed: true,
          periods: [{ label: "weekly", used: 800, total: 5000, reset_at: "2024-06-11T08:00:00+08:00" }],
        },
      ],
    });
    const adapter = new VolcengineArkCodingPlanAdapter(runnerReturning({ stdout: body, code: 0 }));
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("ok");
    expect(snap.metrics[0].used).toBeCloseTo(16, 5);
  });

  it("真机 golden(2026-09-01): percent 直接给值 + session 窗无 used/total/reset_at 不炸(主路径兼容)", async () => {
    const adapter = new VolcengineArkCodingPlanAdapter(runnerReturning({ stdout: HEALTHY_REAL, code: 0 }));
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("ok");
    // 真机: monthly 已耗尽(percent=100) 必须原样透出 0-100, 不得 ×100 成 10000
    const keys = snap.metrics.map((m) => m.key);
    expect(keys.length).toBe(3);
    expect(keys).toEqual(["rolling_5h", "weekly", "monthly"]);
    const session = snap.metrics.find((m) => m.key === "rolling_5h")!;
    expect(session.used).toBe(0);
    expect(session.limit).toBe(100);
    // session 窗无 reset_at → undefined 安全(不炸)
    expect(session.reset_at).toBeUndefined();
    const monthly = snap.metrics.find((m) => m.key === "monthly")!;
    expect(monthly.used).toBe(100); // 已耗尽态
    expect(monthly.reset_at).toBe(Math.floor(Date.parse("2026-09-04T23:59:59+08:00") / 1000));
  });

  it("STS 撞锁(2026-09-01 真机): 首呼撞锁(纯锁竞争 body, 不含 auth login 引导)→ 退避重试 → 第二次成功出数", async () => {
    // 9/8 t_f261dadb 反转后: 真实 STS 锁竞争 body 必含 arkcli 引导文案(please run
    // arkcli auth login), 走 auth_expired 走一键授权, 不再当并发锁。但**纯瞬时锁竞争**
    // 场景仍可构造(测试用): body 仅含 STS_LOCK_PATTERNS, 不含 auth login 引导, 此
    // 时串行退避可吸收「用户手动 arkcli auth login 跑完, 我方下一拍拿新 token 成功」场景。
    const pureLockOnly = JSON.stringify({
      ok: false,
      error: { type: "error", message: "另一个 arkcli 进程正在刷新 SSO 凭证，请稍后重试" },
    });
    const seq = runnerSequence([
      { code: 1, stderr: pureLockOnly }, // 纯瞬时锁竞争(无 auth 引导串)
      { code: 0, stdout: HEALTHY_REAL },
    ]);
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0); // delay=0 跳过等待
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(seq.callCount()).toBe(2); // 首呼 + 1 次重试(纯锁竞争走重试, 引导串会早退)
    expect(snap.status).toBe("ok");
    expect(snap.metrics).toHaveLength(3);
  });

  it("t_f261dadb: 真机 STS body(必含 please run arkcli auth login 引导串) → auth_expired 早退, 1 call 1 判定", async () => {
    // 9/8 真实 fixture 9/7 末段「token 交换失败: invalid_request - refresh_token is invalid」
    // 伪造段已删, 回归用户 Windows 1.0.23 + njbx02 1.0.22 真机原文。t_f261dadb 用户拍板:
    // 这段文案 = token 失效真实信号 → 必走 auth_expired 走一键授权。重试 loop 现在检测到
    // auth_expired 串就**早退**(节省 N×2s 浪费), 所以只 1 call 就定。
    const seq = runnerSequence([{ code: 1, stderr: STS_LOCK }]);
    // 自愈禁用(空锁目录), 钉死不走残留锁重跑
    const adapter = new VolcengineArkCodingPlanAdapter(
      seq.runner,
      0,
      { listLocks: async () => [], statMtimeMs: async () => undefined, unlink: async () => true },
      async () => "/nonexistent/ark/auth",
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(seq.callCount()).toBe(1); // 早退: 含 auth login 引导串, 1 call 1 判定
    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("arkcli auth login volc-sso");
    expect(snap.alerts.find((a) => a.code === "auth_expired")).toBeDefined();
    // 9/8 反转后: sts_refresh_locked 告警文案已删(走 auth_expired setup_hint), 不再生成
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeUndefined();
  });

  it("纯瞬时锁竞争(无 auth login 引导串)重试耗尽 + 残留锁空 → 落 error(不再 stale, 9/8 反转)", async () => {
    // 9/8 反转后: 「纯 STS_LOCK_PATTERNS body, 无 auth 引导」是构造场景(真实 arkcli body
    // 必带 please run), 走完重试+残留锁空后 → 落 error 分支(不再 stale)。回归不破:
    // 落 error 是预期(t_f261dadb 反转后无 stale 路径), 不影响 auth_expired 主路径。
    const pureLockOnly = JSON.stringify({
      ok: false,
      error: { type: "error", message: "另一个 arkcli 进程正在刷新 SSO 凭证，请稍后重试" },
    });
    const seq = runnerSequence([
      { code: 1, stderr: pureLockOnly },
      { code: 1, stderr: pureLockOnly },
      { code: 1, stderr: pureLockOnly },
    ]);
    const adapter = new VolcengineArkCodingPlanAdapter(
      seq.runner,
      0,
      { listLocks: async () => [], statMtimeMs: async () => undefined, unlink: async () => true },
      async () => "/nonexistent/ark/auth",
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(seq.callCount()).toBe(3); // 纯锁竞争无 auth 串 → 走满重试上限
    // 9/8 反转后无 stale 路径: 落 error 分支(stderr 已含非英文句子, 不被 isShellCommandNotFound 命中)
    expect(snap.status).toBe("error");
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeUndefined();
  });

  it("auth_expired 判别不因含 'SSO'/'refresh token' 串与撞锁混淆: 会话失效 body 不重试直接 auth_expired", async () => {
    const seq = runnerSequence([{ code: 1, stderr: AUTH_EXPIRED_STDERR }]);
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(seq.callCount()).toBe(1); // auth_expired 不重试
    expect(snap.status).toBe("auth_expired");
  });

  it("个人版单 SKU: 仅 coding-plan 在场即取, 忽略其他 product", async () => {
    const body = JSON.stringify({
      ok: true,
      items: [
        { product: "agent-plan", subscribed: true, periods: [{ label: "weekly", percent: 10, reset_at: "2024-06-11T08:00:00+08:00" }] },
        { product: "coding-plan", subscribed: true, periods: [{ label: "weekly", percent: 55, reset_at: "2024-06-11T08:00:00+08:00" }] },
      ],
    });
    const adapter = new VolcengineArkCodingPlanAdapter(runnerReturning({ stdout: body, code: 0 }));
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("ok");
    expect(snap.metrics).toHaveLength(1);
    expect(snap.metrics[0].used).toBe(55);
  });

  it("未登录(SSO 过期): exit=1 + error body 写 stderr(stdout 空) → auth_expired + setup_hint", async () => {
    // 真实 arkcli 干净 HOME 实测: error body 落 stderr、stdout 空、exit=1
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({ stdout: "", code: 1, stderr: AUTH_EXPIRED_STDERR }),
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("arkcli auth login volc-sso");
    expect(snap.metrics).toEqual([]);
  });

  it("未登录 error body 落 stdout 时同样判 auth_expired(双 stream)", async () => {
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({ stdout: AUTH_EXPIRED_STDERR, code: 1 }),
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("arkcli auth login volc-sso");
  });

  it("arkcli 不在 PATH(spawn ENOENT) → error 态, setup_hint 指向安装", async () => {
    const adapter = new VolcengineArkCodingPlanAdapter(runnerEnOent());
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("error");
    expect(snap.setup_hint).toContain("安装");
    expect(snap.setup_hint).toContain("重启");
  });

  it("win32 cmd /c 包装: arkcli 缺失(exit=9009 + stderr 中文) → error + 安装 hint", async () => {
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({
        stdout: "",
        code: 9009,
        stderr: "'arkcli' 不是内部或外部命令，也不是可运行的程序或批处理文件。",
      }),
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("error");
    expect(snap.setup_hint).toContain("安装");
    expect(snap.error_message).not.toContain("不是内部或外部命令");
  });

  it("usage 命令参数与 health_check 命令符合契约", () => {
    expect(VOLCENGINE_ARK_CODING_PLAN.params_schema).toEqual([]); // 零录入(D-041)
    expect(VOLCENGINE_ARK_CODING_PLAN.health_check?.command).toBe("arkcli auth status --format json");
    expect(VOLCENGINE_ARK_CODING_PLAN.adapter).toBe("command");
    expect(VOLCENGINE_ARK_CODING_PLAN.plan_type).toBe("window");
    expect(ARK_USAGE_CMD).toBe("arkcli");
    expect(ARK_USAGE_ARGS).toEqual(["usage", "plan", "--format", "json"]);
  });
});

describe("healthCheck: arkcli auth status 判从未配置", () => {
  it("未登录(auth status logged_in=false, 即使 exit=0) → ok=false + setup_hint", async () => {
    // 真实 arkcli auth status: exit=0, body {"auth_method":"none","logged_in":false}
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({ stdout: NEVER_CONFIGURED, code: 0 }),
    );
    const res = await adapter.healthCheck(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.setupHint).toContain("arkcli auth login volc-sso");
  });

  it("auth status body 无判别串但 logged_in=false → 走 logged_in 分支 ok=false + setup_hint", async () => {
    // 钉死 REAL 判别字段 logged_in: body 不含 \"auth login\"/\"not configured\" 等判别串,
    // 确保先命中的是解析 logged_in 分支而非 isAuthExpiredBody(对应 D-044 修后的真实字段判别)
    const body = JSON.stringify({ auth_method: "none", hint: "SSO not set up on this machine", logged_in: false });
    const adapter = new VolcengineArkCodingPlanAdapter(runnerReturning({ stdout: body, code: 0 }));
    const res = await adapter.healthCheck(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.setupHint).toContain("arkcli auth login volc-sso");
  });

  it("会话失效 body 写 stderr(与采集同口径) → ok=false + setup_hint", async () => {
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({ stdout: "", code: 1, stderr: AUTH_EXPIRED_STDERR }),
    );
    const res = await adapter.healthCheck(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.setupHint).toContain("arkcli auth login volc-sso");
  });

  it("已配置(auth status logged_in=true) → ok=true", async () => {
    const body = JSON.stringify({ auth_method: "volc_sso", logged_in: true });
    const adapter = new VolcengineArkCodingPlanAdapter(runnerReturning({ stdout: body, code: 0 }));
    const res = await adapter.healthCheck(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(true);
  });

  it("ENOENT(未装 arkcli) → ok=false + 安装提示", async () => {
    const adapter = new VolcengineArkCodingPlanAdapter(runnerEnOent());
    const res = await adapter.healthCheck(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.setupHint).toContain("安装");
  });

  it("win32 cmd /c 包装: arkcli 缺失(exit=9009 + stderr) → ok=false + 安装提示", async () => {
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({
        stdout: "",
        code: 9009,
        stderr: "'arkcli' 不是内部或外部命令，也不是可运行的程序或批处理文件。",
      }),
    );
    const res = await adapter.healthCheck(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.setupHint).toContain("安装");
  });
});

/** 与 app registry.windowSpanRank 同语义的测试内排序探针(不 import app 避免跨包) */
function windowSpanOf(key: string): number {
  const k = key.toLowerCase();
  if (/month|月|30d/.test(k)) return 2;
  if (/week|周|7d/.test(k)) return 1;
  if (/\d+\s*h\b|小时|hour/.test(k)) return 0;
  return 3;
}

describe("Windows spawn 适配(D-041: .cmd shim / CVE-2024-27980 / 黑框)", () => {
  it("win32 → cmd /c arkcli …, windowsHide=true", () => {
    const plan = buildSpawnPlan(ARK_USAGE_CMD, ARK_USAGE_ARGS, "win32");
    expect(plan.command).toBe("cmd");
    expect(plan.args).toEqual(["/c", "arkcli", ...ARK_USAGE_ARGS]);
    expect(plan.windowsHide).toBe(true);
  });

  it("非 win32 → 直接 spawn 原命令, 无 windowsHide", () => {
    const plan = buildSpawnPlan(ARK_USAGE_CMD, ARK_USAGE_ARGS, "linux");
    expect(plan.command).toBe("arkcli");
    expect(plan.args).toEqual(ARK_USAGE_ARGS);
    expect(plan.windowsHide).toBe(false);
  });

  it("win32 + %APPDATA%\\npm 命中 → cmd /c 绝对路径 .cmd(绕 explorer PATH 快照, 2026-09-01 真机)", () => {
    const env = { APPDATA: "C:\\Users\\Donald\\AppData\\Roaming", USERPROFILE: "C:\\Users\\Donald" };
    const exists = (p: string) => p === "C:\\Users\\Donald\\AppData\\Roaming\\npm\\arkcli.cmd";
    const plan = buildSpawnPlan(ARK_USAGE_CMD, ARK_USAGE_ARGS, "win32", env, exists);
    expect(plan.args[1]).toBe("C:\\Users\\Donald\\AppData\\Roaming\\npm\\arkcli.cmd");
    expect(plan.command).toBe("cmd");
  });

  it("win32 + 第一候选缺失但 npm-global 命中 → 用第二候选", () => {
    const env = { APPDATA: "C:\\Users\\X\\AppData\\Roaming", USERPROFILE: "C:\\Users\\X" };
    const exists = (p: string) => p === "C:\\Users\\X\\npm-global\\arkcli.cmd";
    const plan = buildSpawnPlan(ARK_USAGE_CMD, ARK_USAGE_ARGS, "win32", env, exists);
    expect(plan.args[1]).toBe("C:\\Users\\X\\npm-global\\arkcli.cmd");
  });

  it("win32 + 两候选都缺 → 回退原命令(PATH 解析, bl 等系统 PATH 场景不回归)", () => {
    const env = { APPDATA: "C:\\Users\\X\\AppData\\Roaming", USERPROFILE: "C:\\Users\\X" };
    const plan = buildSpawnPlan(ARK_USAGE_CMD, ARK_USAGE_ARGS, "win32", env, () => false);
    expect(plan.args[1]).toBe("arkcli");
  });

  it("非 win32 绝不探测(linux 直接原命令)", () => {
    const env = { APPDATA: "C:\\x\\AppData\\Roaming", USERPROFILE: "C:\\x" };
    const plan = buildSpawnPlan(ARK_USAGE_CMD, ARK_USAGE_ARGS, "linux", env, () => true);
    expect(plan.command).toBe("arkcli");
  });
});

describe("isShellCommandNotFound(win32 包壳下 CLI 缺失分类, D-041 round2)", () => {
  it("exit≠0 + stdout 空 + stderr 含判别串 → true(中/英)", () => {
    expect(
      isShellCommandNotFound({
        stdout: "",
        code: 9009,
        stderr: "'arkcli' 不是内部或外部命令，也不是可运行的程序或批处理文件。",
      }),
    ).toBe(true);
    expect(
      isShellCommandNotFound({
        stdout: "",
        code: 9009,
        stderr: "'arkcli' is not recognized as an internal or external command",
      }),
    ).toBe(true);
  });

  it("code=0(成功) → false, 无论 stderr 内容", () => {
    expect(
      isShellCommandNotFound({ stdout: "", code: 0, stderr: "not recognized" }),
    ).toBe(false);
  });
});

describe("残留锁自愈(B层, t_91ae22ff): 陈旧 refresh-*.lock mtime → 删锁重试", () => {
  /** 可注入的 fake lock fs(记录调用; mtime/删除结果可配置) */
  function fakeLockFs(state: {
    locks: Array<{ path: string; mtimeMs: number | undefined }>;
    unlinkResult?: boolean;
  }) {
    const calls = { listLocks: 0, unlink: [] as string[] };
    const fs: ArkLockFs = {
      async listLocks() {
        calls.listLocks += 1;
        return state.locks.map((l) => l.path);
      },
      async statMtimeMs(path) {
        const l = state.locks.find((x) => x.path === path);
        return l ? l.mtimeMs : undefined;
      },
      async unlink(path) {
        calls.unlink.push(path);
        return state.unlinkResult ?? true;
      },
    };
    return { fs, calls };
  }

  const LOCK_DIR = "/fake/ark/auth"; // 注入的锁目录(替代 ~/.arkcli/cache/auth)
  const STALE = Date.now() - 10 * 60_000; // 10 分钟前 = 超 5min 阈值 → 残留锁
  const FRESH = Date.now() - 1_000; // 1 秒前 = 活跃刷新

  /** 撞锁三连(首呼+2 重试全撞)的 runner 序列 — 9/8 反转后: 真实 STS body 必含 arkcli
   * 引导串(please run arkcli auth login)→ 重试 loop 早退, 此序列实际只消费 1 个;
   * 但保留原长 3 以兼容未注入引导串的纯瞬时锁竞争场景。 */
  function lockStuckSeq() {
    return runnerSequence([
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK },
    ]);
  }

  it("①陈旧锁(mtime 超阈值) → 删锁 + 单次重跑成功 → ok 出数(9/8 反转后 callCount=2)", async () => {
    // 9/8 t_f261dadb 反转后: STS_LOCK 真实 fixture 必含「please run arkcli auth login」,
    // 重试 loop 早退(0 retries); healStaleLock 删除残留锁后单次重跑 = call #2。callCount
    // 由旧版 4 收敛到 2(节省 2 次重试 × 2s)。B 层「残留锁自愈」依旧救「用户重授权后, 旧
    // 残留锁阻断下一拍」场景, 核心语义不变。
    const seq = runnerSequence([
      { code: 1, stderr: STS_LOCK }, // 1: 早退(bails on auth_expired 串)
      { code: 0, stdout: HEALTHY_REAL }, // 2: 删残留锁后单次重跑成功
    ]);
    const fake = fakeLockFs({ locks: [{ path: `${LOCK_DIR}/refresh-deadbeef.lock`, mtimeMs: STALE }] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.unlink).toEqual([`${LOCK_DIR}/refresh-deadbeef.lock`]); // 残留锁被删
    expect(seq.callCount()).toBe(2); // 1(早退) + 1(删锁后重跑) — 旧 4
    expect(snap.status).toBe("ok");
    expect(snap.metrics).toHaveLength(3);
  });

  it("②活跃锁(mtime 新 < 阈值) → 绝不删, 走 auth_expired(9/8 反转后无 stale)", async () => {
    // 9/8 反转后无 stale 路径: STS_LOCK 真实 body 必含「please run arkcli auth login」,
    // 早退 1 call, healStaleLock 不删活跃锁, 最终 res 仍含 auth 串 → auth_expired 走
    // setup_hint(用户可见「请重新授权 + 一键授权」)。B 层「活跃锁绝不删」防御不破。
    const seq = lockStuckSeq();
    const fake = fakeLockFs({ locks: [{ path: `${LOCK_DIR}/refresh-abc.lock`, mtimeMs: FRESH }] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.unlink).toEqual([]); // 活跃刷新锁绝不删(避免与真实并发刷新打架)
    expect(seq.callCount()).toBe(1); // 9/8 反转后: 含 auth 串早退, 不消耗第 2/3 个 runner 结果
    expect(snap.status).toBe("auth_expired"); // 9/8 反转后无 stale, 必走 auth_expired
    expect(snap.alerts.find((a) => a.code === "auth_expired")).toBeDefined();
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeUndefined();
  });

  it("③删锁后重跑仍撞锁 → 走 auth_expired, 不无限抢(9/8 反转后)", async () => {
    // 9/8 反转后: 残留锁删了, 但 SSO 仍失效(用户没点授权), 下一拍仍报 STS_LOCK body,
    // 命中 auth_expired 串 → 走 auth_expired(用户能看到「请重新授权」, 不再被
    // 「请稍候自动重试」误导)。B 层「单次重跑为上限」防御不破(callCount=2, 旧 4)。
    const seq = runnerSequence([
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK }, // 删锁后重跑仍撞锁
    ]);
    const fake = fakeLockFs({ locks: [{ path: `${LOCK_DIR}/refresh-deadbeef.lock`, mtimeMs: STALE }] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.unlink).toHaveLength(1);
    expect(seq.callCount()).toBe(2); // 1(早退) + 1(删锁后重跑) — 旧 4
    expect(snap.status).toBe("auth_expired");
    expect(snap.alerts.find((a) => a.code === "auth_expired")).toBeDefined();
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeUndefined();
  });

  it("④a 正常路径(无撞锁) → 完全不触碰锁文件", async () => {
    const seq = runnerSequence([{ code: 0, stdout: HEALTHY_REAL }]);
    const fake = fakeLockFs({ locks: [] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("ok");
    expect(fake.calls.listLocks).toBe(0); // 健康路径不进自愈逻辑, 零 fs 触碰
  });

  it("④b 撞锁但无锁文件 → 无锁可删, 走 auth_expired(9/8 反转后无 stale)", async () => {
    // 9/8 反转后: 重试 loop 早退(1 call), healStaleLock 空锁目录返回 null, res 仍
    // 含 auth 串 → auth_expired 走 setup_hint。
    const seq = lockStuckSeq();
    const fake = fakeLockFs({ locks: [] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.listLocks).toBe(1);
    expect(fake.calls.unlink).toEqual([]);
    expect(seq.callCount()).toBe(1); // 9/8 反转后早退
    expect(snap.status).toBe("auth_expired");
  });

  it("⑤删锁失败(Windows 句柄占用等) → 静默跳过不重跑, 走 auth_expired, 不报错", async () => {
    // 9/8 反转后: 早退 1 call, healStaleLock unlink 失败返回 null, res 仍含 auth 串
    // → auth_expired(用户能看到「请重新授权」+ 一键授权按钮, 等下轮轮询再试残留锁)。
    const seq = lockStuckSeq();
    const fake = fakeLockFs({ locks: [{ path: `${LOCK_DIR}/refresh-deadbeef.lock`, mtimeMs: STALE }], unlinkResult: false });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.unlink).toEqual([`${LOCK_DIR}/refresh-deadbeef.lock`]); // 尝试过删除
    expect(seq.callCount()).toBe(1); // 删除失败 → 不重跑, 等下轮轮询
    expect(snap.status).toBe("auth_expired");
  });

  it("STS_LOCK_STALE_MS 导出常量缺省 5min(可测注入)", () => {
    expect(STS_LOCK_STALE_MS).toBe(5 * 60_000);
  });
});

// t_f261dadb 9/8 判别反转(用户拍板实测推翻 t_ee76442e): 「STS 续期失败」+「另一个 arkcli
// 进程正在刷新」+「please run arkcli auth login」+「requires Volcengine Ark SSO STS」四类
// 文案任意命中 = token 失效的**真实信号**, 不是并发锁竞争; 必走 auth_expired 走一键授权。
// 反转前 t_ee76442e 的「加 3 个 invalid_request 串 + isStsLockBody 排除」路线已废: 真机
// 1.0.22/1.0.23 双版本实测, usage plan 报错的 SSO 失效形态**根本没有** invalid_request 串
// (该串只在 arkcli auth status 出现), 该方向修了等于没修。
describe("t_f261dadb: 锁竞争文案=token 失效信号(用户拍板, 9/8 反转)", () => {
  // 🔴 真机 fixture → auth_expired(必现, 用户 Windows 1.0.23 + njbx02 1.0.22 双版本一致)
  it("真机中毒 fixture(STS 续期失败 + please run arkcli auth login) → auth_expired, 1 call 早退", async () => {
    const seq = runnerSequence([{ code: 1, stderr: TOKEN_REVOKED_REAL }]);
    // 自愈禁用(空锁目录), 钉死不走残留锁重跑
    const adapter = new VolcengineArkCodingPlanAdapter(
      seq.runner,
      0,
      { listLocks: async () => [], statMtimeMs: async () => undefined, unlink: async () => true },
      async () => "/nonexistent/ark/auth",
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    // 1) 早退: 真机 fixture 命中 auth_expired 串 → 0 重试
    expect(seq.callCount()).toBe(1);
    // 2) 状态: auth_expired(用户可见「请重新授权」+ 一键授权按钮)
    expect(snap.status).toBe("auth_expired");
    // 3) alerts: 走 auth_expired 卡片文案, 不走「请稍候自动重试」(sts_refresh_locked 已废)
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeUndefined();
    expect(snap.alerts.find((a) => a.code === "auth_expired")).toBeDefined();
    // 4) setup_hint: 引导用户重新授权
    expect(snap.setup_hint).toContain("arkcli auth login volc-sso");
    expect(snap.error_message).toBeUndefined(); // auth_expired 走 alerts 文案而非 error_message
  });

  // 新增 9/8 判别串: 「requires Volcengine Ark SSO STS」命中(用户拍板)
  it("body 含 'requires Volcengine Ark SSO STS' → auth_expired 命中", async () => {
    const body = JSON.stringify({
      ok: false,
      error: {
        type: "error",
        message: "ListSubscribeTrade requires Volcengine Ark SSO STS, please run `arkcli auth login volc-sso`",
      },
    });
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({ stdout: body, code: 1 }),
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("arkcli auth login volc-sso");
  });

  // 新增 9/8 判别串: 「please run `arkcli auth login」命中(用户拍板: 引导串就是失效信号)
  it("body 含 'please run `arkcli auth login' 引导串 → auth_expired 命中", async () => {
    const body = JSON.stringify({
      ok: false,
      error: { type: "error", message: "请稍后重试: please run `arkcli auth login volc-sso`" },
    });
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({ stdout: body, code: 1 }),
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("arkcli auth login volc-sso");
  });

  // 回归: AUTH_EXPIRED_PATTERNS 老串(从 t_ee76442e 起)仍命中 — refresh_token is invalid
  it("AUTH_EXPIRED_PATTERNS 老串(从 t_ee76442e 起)仍命中: invalid_request 等", async () => {
    const tokenInvalidOnly = JSON.stringify({
      ok: false,
      error: {
        type: "error",
        message: "token 交换失败: invalid_request - refresh_token is invalid",
      },
    });
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({ stdout: tokenInvalidOnly, code: 1 }),
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("arkcli auth login volc-sso");
  });

  // 回归: 9/8 fixture 修正后不再含 invalid_request 串(只有 STS 续期失败 + 引导串)
  it("fixture 9/8 修正后: 真实 usage plan body 不再含 invalid_request 串(回归用户真机原文)", async () => {
    // 真机 fixture 现在只含「STS 续期失败」「另一个 arkcli 进程正在刷新」「please run
    // arkcli auth login volc-sso」「requires Volcengine Ark SSO STS」, 不含
    // invalid_request / refresh_token is invalid / token 交换失败 等
    const fixture = JSON.parse(TOKEN_REVOKED_REAL) as {
      error?: { message?: string };
    };
    expect(fixture.error?.message).not.toContain("invalid_request");
    expect(fixture.error?.message).not.toContain("refresh_token is invalid");
    expect(fixture.error?.message).not.toContain("token 交换失败");
    // 必含 arkcli 引导串(9/8 用户拍板: 这是 token 失效真实信号)
    expect(fixture.error?.message).toContain("please run `arkcli auth login volc-sso`");
    expect(fixture.error?.message).toContain("requires Volcengine Ark SSO STS");
    expect(fixture.error?.message).toContain("另一个 arkcli 进程正在刷新");
    expect(fixture.error?.message).toContain("STS 续期失败");
  });
});