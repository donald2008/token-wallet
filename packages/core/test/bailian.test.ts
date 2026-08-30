/**
 * L1 golden sample — aliyun-bailian/token-plan command 类首实例 (D-041, 2026-08-30)
 *
 * fixture = 2026-08-30 Windows 真机 golden(已脱敏, 无 key):
 *   健康态: {"per1WeekPercentage": 0.37941547999999997, "per1WeekResetTime": 1788586320000}
 * 断言: percent 归一(0.379 → 37.9±0.1)、epoch 毫秒→秒、auth_expired 分类。
 * runner 注入(替代真实 spawn)覆盖三态 + healthCheck 未配置判定。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BailianTokenPlanAdapter,
  BL_USAGE_ARGS,
  BL_USAGE_CMD,
} from "../src/channels/aliyun-bailian.js";
import { buildSpawnPlan, isShellCommandNotFound, SpawnError, type CommandRunResult } from "../src/adapters.js";
import { ALIYUN_BAILIAN_TOKEN_PLAN } from "../src/channels/presets.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "src", "channels", "__fixtures__");
const HEALTHY = readFileSync(join(FIXTURES, "bailian-usage-healthy.json"), "utf8");
const AUTH_EXPIRED = readFileSync(join(FIXTURES, "bailian-usage-auth-expired.json"), "utf8");
// t_c561c8a8 终审 BLOCKING 补证: 真实 bl(1.18.x, 未登录)把错误 JSON 写 **stderr**、stdout 空
const AUTH_EXPIRED_STDERR = readFileSync(join(FIXTURES, "bailian-usage-auth-expired-stderr.json"), "utf8");
const NEVER_CONFIGURED = readFileSync(join(FIXTURES, "bailian-auth-status-never-configured.json"), "utf8");

const INSTANCE: InstanceConfig = {
  id: "bailian",
  channel: "aliyun-bailian/token-plan",
  name: "百炼 Token Plan #1",
  params: {},
};

function makeCtx(): AdapterContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 15_000,
    fetchedAt: 1_788_586_300,
    resolveCredential: () => Promise.resolve(""),
  };
}

/** 注入 runner: 返回预设 {stdout, code} (stderr 缺省空串) */
function runnerReturning(res: Omit<CommandRunResult, "stderr"> & { stderr?: string }) {
  const full: CommandRunResult = { stderr: "", ...res };
  return () => Promise.resolve(full);
}

/** 注入 runner: reject SpawnError(ENOENT=bl 不在 PATH) */
function runnerEnOent() {
  return () =>
    Promise.reject(
      new SpawnError("命令启动失败: bl: spawn bl ENOENT", Object.assign(new Error("spawn bl ENOENT"), { code: "ENOENT" })),
    );
}

describe("aliyun-bailian/token-plan golden sample(D-041 三态)", () => {
  it("健康态: per1WeekPercentage 0-1 小数归一 → 37.9±0.1, reset 毫秒→秒", async () => {
    const adapter = new BailianTokenPlanAdapter(runnerReturning({ stdout: HEALTHY, code: 0 }));
    const snap = await adapter.fetchSnapshot(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("ok");
    expect(snap.plan_type).toBe("window");
    expect(snap.metrics).toHaveLength(1); // 单窗口(周); 5h 窗缺席 = 正常
    const weekly = snap.metrics[0];
    expect(weekly).toMatchObject({ key: "weekly", kind: "window", unit: "percent", limit: 100 });
    // 0.37941547999999997 × 100 = 37.941… → 37.9±0.1
    expect(weekly.used).toBeGreaterThan(37.8);
    expect(weekly.used).toBeLessThan(38.0);
    // 1788586320000 ms → 1788586320 s
    expect(weekly.reset_at).toBe(1_788_586_320);
  });

  it("5h 窗字段在场时补 rolling_5h 指标(不限量缺席=正常)", async () => {
    const body = JSON.stringify({
      per5hPercentage: 0.12,
      per5hResetTime: 1788580000000,
      per1WeekPercentage: 0.37941547999999997,
      per1WeekResetTime: 1788586320000,
    });
    const adapter = new BailianTokenPlanAdapter(runnerReturning({ stdout: body, code: 0 }));
    const snap = await adapter.fetchSnapshot(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("ok");
    expect(snap.metrics.map((m) => m.key).sort()).toEqual(["rolling_5h", "weekly"]);
    const r5h = snap.metrics.find((m) => m.key === "rolling_5h")!;
    expect(r5h.used).toBeCloseTo(12, 5);
    expect(r5h.reset_at).toBe(1_788_580_000);
  });

  it("会话失效: exit=3 + 'No console access token found' → auth_expired + setup_hint", async () => {
    const adapter = new BailianTokenPlanAdapter(
      runnerReturning({ stdout: AUTH_EXPIRED, code: 3 }),
    );
    const snap = await adapter.fetchSnapshot(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("bl auth login --console");
    expect(snap.metrics).toEqual([]);
  });

  it("会话失效真实形态: exit=3 + body 写 stderr(stdout 空) → auth_expired + setup_hint", async () => {
    // t_c561c8a8 终审 BLOCKING 补证: 真实 bl(1.18.x, 未登录)错误 JSON 落 stderr、stdout 空
    const adapter = new BailianTokenPlanAdapter(
      runnerReturning({ stdout: "", code: 3, stderr: AUTH_EXPIRED_STDERR }),
    );
    const snap = await adapter.fetchSnapshot(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("bl auth login --console");
    expect(snap.metrics).toEqual([]);
  });

  it("服务端 NotLogined 错误码同判 auth_expired", async () => {
    const body = JSON.stringify({ error: { code: 400, message: "NotLogined: console not authorized" } });
    const adapter = new BailianTokenPlanAdapter(runnerReturning({ stdout: body, code: 3 }));
    const snap = await adapter.fetchSnapshot(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("auth_expired");
  });

  it("bl 不在 PATH(spawn ENOENT) → error 态, setup_hint 指向安装", async () => {
    const adapter = new BailianTokenPlanAdapter(runnerEnOent());
    const snap = await adapter.fetchSnapshot(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("error");
    expect(snap.setup_hint).toContain("安装");
    expect(snap.setup_hint).toContain("重启");
  });

  it("win32 cmd /c 包装: bl 缺失(exit=9009 + stderr 中文) → error + 安装 hint", async () => {
    // D-041 round2(#862): win32 下 spawn ENOENT 不可达, cmd 非零退出 + stderr 判别
    const adapter = new BailianTokenPlanAdapter(
      runnerReturning({
        stdout: "",
        code: 9009,
        stderr: "'bl' 不是内部或外部命令，也不是可运行的程序或批处理文件。",
      }),
    );
    const snap = await adapter.fetchSnapshot(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("error");
    expect(snap.setup_hint).toContain("安装");
    expect(snap.setup_hint).toContain("重启");
    // 脱敏纪律: stderr 全文不进 error_message
    expect(snap.error_message).not.toContain("不是内部或外部命令");
  });

  it("win32 cmd /c 包装: bl 缺失(stderr 英文 'not recognized') → error + 安装 hint", async () => {
    const adapter = new BailianTokenPlanAdapter(
      runnerReturning({
        stdout: "",
        code: 9009,
        stderr: "'bl' is not recognized as an internal or external command",
      }),
    );
    const snap = await adapter.fetchSnapshot(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());

    expect(snap.status).toBe("error");
    expect(snap.setup_hint).toContain("安装");
  });

  it("win32 shell 缺失分类不依赖具体 exit code(非 9009 也判)", async () => {
    // 契约: exit code 不可信; 分类以 stderr 判别串为准, 任意非零 code 均可命中
    const adapter = new BailianTokenPlanAdapter(
      runnerReturning({
        stdout: "",
        code: 1,
        stderr: "'bl' is not recognized as an internal or external command",
      }),
    );
    const snap = await adapter.fetchSnapshot(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(snap.status).toBe("error");
    expect(snap.setup_hint).toContain("安装");
  });

  it("usage 命令参数与 health_check 命令参数符合契约", () => {
    expect(ALIYUN_BAILIAN_TOKEN_PLAN.params_schema).toEqual([]); // 零录入(D-041)
    expect(ALIYUN_BAILIAN_TOKEN_PLAN.health_check?.command).toBe("bl auth status --output json");
    expect(ALIYUN_BAILIAN_TOKEN_PLAN.adapter).toBe("command");
  });
});

describe("healthCheck: bl auth status 判从未配置(exit code 不可信, 解析 body)", () => {
  it("未登录也 exit=0 + 含 'not logged in or has expired' → ok=false + setup_hint", async () => {
    const adapter = new BailianTokenPlanAdapter(
      runnerReturning({ stdout: NEVER_CONFIGURED, code: 0 }),
    );
    const res = await adapter.healthCheck(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.setupHint).toContain("bl auth login --console");
  });

  it("会话失效 body 写 stderr(与采集同口径) → ok=false + setup_hint", async () => {
    // t_c561c8a8 终审 BLOCKING 补证: healthCheck 判别同样要覆盖 stderr(真实 bl 未登录形态)
    const adapter = new BailianTokenPlanAdapter(
      runnerReturning({ stdout: "", code: 3, stderr: AUTH_EXPIRED_STDERR }),
    );
    const res = await adapter.healthCheck(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.setupHint).toContain("bl auth login --console");
  });

  it("已配置(正常 auth status) → ok=true", async () => {
    const body = JSON.stringify({ loggedIn: true, consoleAccount: "redacted@example.com" });
    const adapter = new BailianTokenPlanAdapter(runnerReturning({ stdout: body, code: 0 }));
    const res = await adapter.healthCheck(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(true);
  });

  it("ENOENT(未装 bl) → ok=false + 安装提示", async () => {
    const adapter = new BailianTokenPlanAdapter(runnerEnOent());
    const res = await adapter.healthCheck(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.setupHint).toContain("安装");
  });

  it("win32 cmd /c 包装: bl 缺失(exit=9009 + stderr) → ok=false + 安装提示", async () => {
    // D-041 round2(#862): win32 下 healthCheck 同样吃不到 spawn ENOENT,
    // 必须由 shell 包装分类兜住, 否则误报 ok=true
    const adapter = new BailianTokenPlanAdapter(
      runnerReturning({
        stdout: "",
        code: 9009,
        stderr: "'bl' 不是内部或外部命令，也不是可运行的程序或批处理文件。",
      }),
    );
    const res = await adapter.healthCheck(ALIYUN_BAILIAN_TOKEN_PLAN, INSTANCE, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.setupHint).toContain("安装");
  });
});

describe("Windows spawn 适配(D-041: .cmd shim / CVE-2024-27980 / 黑框)", () => {
  it("win32 → cmd /c bl …, windowsHide=true", () => {
    const plan = buildSpawnPlan(BL_USAGE_CMD, BL_USAGE_ARGS, "win32");
    expect(plan.command).toBe("cmd");
    expect(plan.args).toEqual(["/c", "bl", ...BL_USAGE_ARGS]);
    expect(plan.windowsHide).toBe(true);
  });

  it("非 win32 → 直接 spawn 原命令, 无 windowsHide", () => {
    const plan = buildSpawnPlan(BL_USAGE_CMD, BL_USAGE_ARGS, "linux");
    expect(plan.command).toBe("bl");
    expect(plan.args).toEqual(BL_USAGE_ARGS);
    expect(plan.windowsHide).toBe(false);
  });
});

describe("isShellCommandNotFound(D-041 round2: win32 包壳下 CLI 缺失分类)", () => {
  it("exit≠0 + stdout 空 + stderr 含判别串 → true(中/英)", () => {
    expect(
      isShellCommandNotFound({
        stdout: "",
        code: 9009,
        stderr: "'bl' 不是内部或外部命令，也不是可运行的程序或批处理文件。",
      }),
    ).toBe(true);
    expect(
      isShellCommandNotFound({
        stdout: "",
        code: 9009,
        stderr: "'bl' is not recognized as an internal or external command",
      }),
    ).toBe(true);
  });

  it("stdout 非空(命令真跑了但失败) → false, 不误判", () => {
    expect(
      isShellCommandNotFound({
        stdout: "{\"per1WeekPercentage\": 0.5}",
        code: 3,
        stderr: "not recognized",
      }),
    ).toBe(false);
  });

  it("code=0(成功) → false, 无论 stderr 内容", () => {
    expect(
      isShellCommandNotFound({ stdout: "", code: 0, stderr: "not recognized" }),
    ).toBe(false);
  });

  it("stderr 无判别串(其他非零失败) → false", () => {
    expect(
      isShellCommandNotFound({ stdout: "", code: 1, stderr: "some other error" }),
    ).toBe(false);
  });
});
