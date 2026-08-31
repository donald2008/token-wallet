/**
 * L1 golden sample — volcengine-ark/coding-plan command 类第二实例 (D-043, 2026-08-31)
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

describe("volcengine-ark/coding-plan golden sample(D-043 三态)", () => {
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