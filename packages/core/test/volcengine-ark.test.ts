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
// STS 续期撞锁(2026-09-01 真机实锤): 并发刷新 sts.json 单飞锁, 后到者 exit=1
const STS_LOCK = readFileSync(join(FIXTURES, "ark-usage-sts-lock.json"), "utf8");
// 未登录形态: 真实 arkcli(干净 HOME)error body 写 **stderr**、stdout 空(exit=1)
const AUTH_EXPIRED_STDERR = readFileSync(join(FIXTURES, "ark-usage-auth-expired.json"), "utf8");
// 真机中毒现场(t_ee76442e, 2026-09-07 njbx02 实测): body 同时含「STS 续期失败」「另一个 arkcli
// 进程正在刷新」+「token 交换失败: invalid_request - refresh_token is invalid」, 真相是 SSO
// refresh_token 被吊销(火山账号凭据过期), 不是锁竞争。判别修正后必须走 auth_expired。
const TOKEN_REVOKED_REAL = readFileSync(join(FIXTURES, "ark-usage-token-revoked-real.json"), "utf8");
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

  it("STS 撞锁(2026-09-01 真机): 首呼撞锁 exit=1 → 退避重试 → 第二次成功出数(不算采集失败)", async () => {
    const seq = runnerSequence([
      { code: 1, stderr: STS_LOCK }, // 锁竞争(与手动 arkcli 并发)
      { code: 0, stdout: HEALTHY_REAL },
    ]);
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0); // delay=0 跳过等待
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(seq.callCount()).toBe(2); // 首呼 + 1 次重试
    expect(snap.status).toBe("ok");
    expect(snap.metrics).toHaveLength(3);
  });

  it("STS 撞锁连续 3 次(长期锁占用): 重试 2 次后仍失败 → stale 灰卡 + sts_refresh_locked 告警(不报采集失败), 不走 auth_expired", async () => {
    const seq = runnerSequence([{ code: 1, stderr: STS_LOCK }]);
    // B层自愈(t_91ae22ff): 注入空锁目录, 钉死「无残留锁可删 → 不重跑」语义(长期锁占用→
    // stale), 测试必须 hermetic——不注入会落真实 ~/.arkcli/cache/auth, 本机既有残留锁
    // 会被自愈删掉(真实副作用)
    const adapter = new VolcengineArkCodingPlanAdapter(
      seq.runner,
      0,
      { listLocks: async () => [], statMtimeMs: async () => undefined, unlink: async () => true },
      async () => "/nonexistent/ark/auth",
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(seq.callCount()).toBe(3); // 首呼 + 2 次重试上限
    // 卡片主案(round1 审查修正): 重试耗尽仍撞锁 = 长期锁占用 → stale 灰卡「数据过期」,
    // 不渲染「采集失败」红卡; 可读文案经 alerts 在卡上可见
    expect(snap.status).toBe("stale");
    const lockAlert = snap.alerts.find((a) => a.code === "sts_refresh_locked");
    expect(lockAlert).toBeDefined();
    expect(lockAlert?.level).toBe("warn");
    expect(lockAlert?.message).toContain("刷新");
    expect(lockAlert?.message).toContain("稍候自动重试");
    // 撞锁判别与 auth_expired 互斥: 锁竞争 body 不因含 "SSO" 被误判为会话失效
    expect(snap.alerts.some((a) => a.code === "auth_expired")).toBeFalsy();
    expect(snap.error_message).toBeUndefined(); // stale 分支不携带 error_message(可读文案走 alerts)
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

  /** 撞锁三连(首呼+2 重试全撞)的 runner 序列 */
  function lockStuckSeq() {
    return runnerSequence([
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK },
    ]);
  }

  it("①陈旧锁(mtime 超阈值) → 删锁 + 单次重跑成功 → ok 出数(告别永久 stale)", async () => {
    const seq = runnerSequence([
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK }, // 重试耗尽仍撞锁
      { code: 0, stdout: HEALTHY_REAL }, // 删锁后重跑成功
    ]);
    const fake = fakeLockFs({ locks: [{ path: `${LOCK_DIR}/refresh-deadbeef.lock`, mtimeMs: STALE }] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.unlink).toEqual([`${LOCK_DIR}/refresh-deadbeef.lock`]); // 残留锁被删
    expect(seq.callCount()).toBe(4); // 首呼+2重试+删锁后单次重跑
    expect(snap.status).toBe("ok");
    expect(snap.metrics).toHaveLength(3);
  });

  it("②活跃锁(mtime 新 < 阈值) → 绝不删, 走原 stale + sts_refresh_locked", async () => {
    const seq = lockStuckSeq();
    const fake = fakeLockFs({ locks: [{ path: `${LOCK_DIR}/refresh-abc.lock`, mtimeMs: FRESH }] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.unlink).toEqual([]); // 活跃刷新锁绝不删(避免与真实并发刷新打架)
    expect(seq.callCount()).toBe(3); // 未删锁 → 不额外重跑
    expect(snap.status).toBe("stale");
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeDefined();
  });

  it("③删锁后重跑仍撞锁 → 走原 stale, 不无限抢(单次重跑为上限)", async () => {
    const seq = runnerSequence([
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK },
      { code: 1, stderr: STS_LOCK }, // 删锁后重跑仍撞锁
    ]);
    const fake = fakeLockFs({ locks: [{ path: `${LOCK_DIR}/refresh-deadbeef.lock`, mtimeMs: STALE }] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.unlink).toHaveLength(1);
    expect(seq.callCount()).toBe(4); // 只多一次重跑, 不进入第二次删锁循环
    expect(snap.status).toBe("stale");
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeDefined();
    expect(snap.alerts.some((a) => a.code === "auth_expired")).toBeFalsy(); // 判别序不变
  });

  it("④a 正常路径(无撞锁) → 完全不触碰锁文件", async () => {
    const seq = runnerSequence([{ code: 0, stdout: HEALTHY_REAL }]);
    const fake = fakeLockFs({ locks: [] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("ok");
    expect(fake.calls.listLocks).toBe(0); // 健康路径不进自愈逻辑, 零 fs 触碰
  });

  it("④b 撞锁但无锁文件 → 无锁可删, 走原 stale(不误判不崩)", async () => {
    const seq = lockStuckSeq();
    const fake = fakeLockFs({ locks: [] });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.listLocks).toBe(1);
    expect(fake.calls.unlink).toEqual([]);
    expect(seq.callCount()).toBe(3);
    expect(snap.status).toBe("stale");
  });

  it("⑤删锁失败(Windows 句柄占用等) → 静默跳过不重跑, 走原 stale, 不报错", async () => {
    const seq = lockStuckSeq();
    const fake = fakeLockFs({ locks: [{ path: `${LOCK_DIR}/refresh-deadbeef.lock`, mtimeMs: STALE }], unlinkResult: false });
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0, fake.fs, async () => LOCK_DIR, 5 * 60_000);
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(fake.calls.unlink).toEqual([`${LOCK_DIR}/refresh-deadbeef.lock`]); // 尝试过删除
    expect(seq.callCount()).toBe(3); // 删除失败 → 不重跑, 等下轮轮询
    expect(snap.status).toBe("stale");
  });

  it("STS_LOCK_STALE_MS 导出常量缺省 5min(可测注入)", () => {
    expect(STS_LOCK_STALE_MS).toBe(5 * 60_000);
  });
});

// t_ee76442e 判别修正(用户 9/7 拍板, 零命令行): 真 token 失效被「STS 续期失败」字样误导命中
// 锁竞争 → 永远 stale 灰卡 + 「请稍候自动重试」, 授权引导按钮永远出不来。正解 = 锁竞争分支
// 加排除(若 body 同时含 auth_expired 真 token 失效串 → 走 auth_expired), 纯并发锁竞争仍走
// stale。落地: AUTH_EXPIRED_PATTERNS 扩 refresh_token is invalid / token 交换失败 /
// invalid_request; sts 锁判别收紧为 `isStsLockBody && !isAuthExpiredBody`。
describe("t_ee76442e: 真 token 失效判别修正(SSO refresh_token 被吊销 ≠ 锁竞争)", () => {
  // 🔴 RED 测试 1: 真机中毒 fixture → 期望 auth_expired(当前 stale, 红灯)
  it("真机中毒(STS 续期失败 + refresh_token is invalid 同体) → auth_expired + setup_hint, 不再 stale", async () => {
    // 真机 body 同时含: STS 续期失败 / 另一个 arkcli 进程正在刷新 / token 交换失败:
    // invalid_request - refresh_token is invalid → 真相是 SSO refresh_token 失效, 不
    // 是锁竞争。判别修正后必须走 auth_expired, 卡片出现「请重新授权」+ 一键授权按钮
    const seq = runnerSequence([{ code: 1, stderr: TOKEN_REVOKED_REAL }]);
    // 自愈禁用(空锁目录), 钉死不走残留锁重跑
    const adapter = new VolcengineArkCodingPlanAdapter(
      seq.runner,
      0,
      { listLocks: async () => [], statMtimeMs: async () => undefined, unlink: async () => true },
      async () => "/nonexistent/ark/auth",
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    // 1) 不重试: 真 token 失效非瞬时竞争, 串行退避无意义
    expect(seq.callCount()).toBe(1);
    // 2) 状态: auth_expired(用户能看到「请重新授权」+ 一键授权按钮), 不是 stale
    expect(snap.status).toBe("auth_expired");
    // 3) alerts: 走 auth_expired 卡片文案, 不走「请稍候自动重试」(sts_refresh_locked)
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeUndefined();
    expect(snap.alerts.find((a) => a.code === "auth_expired")).toBeDefined();
    // 4) setup_hint: 引导用户重新授权(SSO refresh_token 被吊销只能重走 auth login)
    expect(snap.setup_hint).toContain("arkcli auth login volc-sso");
    expect(snap.error_message).toBeUndefined(); // auth_expired 走 alerts 文案而非 error_message
  });

  // 🔴 RED 测试 2: AUTH_EXPIRED_PATTERNS 新串命中(纯 token 失效 body, 不含 STS 锁竞争字样)
  it("纯 SSO refresh_token is invalid body(无锁竞争字样) → auth_expired 命中 + setup_hint", async () => {
    // 极简 token 失效形态: 只含 invalid_request + refresh_token is invalid + token 交换失败,
    // 不含 STS_LOCK_PATTERNS 任何串 → 验证新加的 3 个判别串被真识别
    const tokenInvalidOnly = JSON.stringify({
      ok: false,
      error: {
        type: "error",
        message: "token 交换失败: invalid_request - refresh_token is invalid, please run `arkcli auth login`",
      },
    });
    const adapter = new VolcengineArkCodingPlanAdapter(
      runnerReturning({ stdout: tokenInvalidOnly, code: 1 }),
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("arkcli auth login volc-sso");
  });

  // ✅ 回归测试: 纯并发锁竞争(无 token 失效串) → 仍 stale + sts_refresh_locked(不误伤)
  it("纯并发锁竞争(无 token 失效串) → 仍 stale + sts_refresh_locked(回归不破)", async () => {
    const seq = runnerSequence([{ code: 1, stderr: STS_LOCK }]);
    const adapter = new VolcengineArkCodingPlanAdapter(
      seq.runner,
      0,
      { listLocks: async () => [], statMtimeMs: async () => undefined, unlink: async () => true },
      async () => "/nonexistent/ark/auth",
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("stale");
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeDefined();
    expect(snap.alerts.find((a) => a.code === "auth_expired")).toBeUndefined();
  });

  // ✅ 回归测试: 原 STS 撞锁连续 3 次(老测试已被新语义包含, 但保留显式回归以钉死语义)
  it("STS 撞锁连续 3 次 + body 不含 token 失效串 → stale + sts_refresh_locked(钉死纯锁竞争回归)", async () => {
    // STS_LOCK fixture 当前是「ListSubscribeTrade requires ... 请稍后重试」, 不含 refresh_token
    // is invalid 等 token 失效串 → 必须走原 stale 逻辑
    const seq = runnerSequence([{ code: 1, stderr: STS_LOCK }]);
    const adapter = new VolcengineArkCodingPlanAdapter(
      seq.runner,
      0,
      { listLocks: async () => [], statMtimeMs: async () => undefined, unlink: async () => true },
      async () => "/nonexistent/ark/auth",
    );
    const snap = await adapter.fetchSnapshot(VOLCENGINE_ARK_CODING_PLAN, INSTANCE, makeCtx());

    expect(seq.callCount()).toBe(3); // 重试 2 次上限
    expect(snap.status).toBe("stale");
    expect(snap.alerts.find((a) => a.code === "sts_refresh_locked")).toBeDefined();
    expect(snap.alerts.find((a) => a.code === "auth_expired")).toBeFalsy();
    expect(snap.error_message).toBeUndefined();
  });
});