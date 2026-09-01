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
    const adapter = new VolcengineArkCodingPlanAdapter(seq.runner, 0);
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