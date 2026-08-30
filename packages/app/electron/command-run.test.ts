/**
 * D-042 主进程 command_run 桥单测(node vitest)。
 *
 * 取证重点(验收 2): 本机 bl 未装 → 真实 spawn 路径(不注入 runner!)产出
 * error 快照 + 安装 setup_hint。这是真实路径取证, 非 mock 模拟。
 * 测试环境(两兄弟 WSL/服务器)天然满足 bl 缺失; 若某环境装了 bl,
 * 该用例会自动探测跳过(避免 flaky, 取证仍在本机完成)。
 */
import { describe, it, expect, vi } from "vitest";
import { runCommandFetch } from "./command-run";
import { ALIYUN_BAILIAN_TOKEN_PLAN } from "@token-wallet/core/channels";
import type { InstanceConfig } from "@token-wallet/core/generic-http";
import type { ProviderSnapshot } from "@token-wallet/core/schema";

const INSTANCE: InstanceConfig = {
  id: "bailian",
  channel: "aliyun-bailian/token-plan",
  name: "百炼 Token Plan #1",
  params: {},
};

/** 探测 bl 是否在 PATH(真实 spawn 取证的前置条件) */
async function blInstalled(): Promise<boolean> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    await exec("bl", ["--version"], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

describe("command_run 桥 — 载荷校验与透传", () => {
  it("channel 缺失 → 抛错 fail-fast", async () => {
    await expect(runCommandFetch({})).rejects.toThrow("channel 缺失");
  });

  it("descriptor 缺失 → 抛错 fail-fast", async () => {
    await expect(runCommandFetch({ channel: "aliyun-bailian/token-plan" })).rejects.toThrow(
      "缺 descriptor",
    );
  });

  it("未注册 command 通道 → 抛错(默认 executor 查注册表)", async () => {
    const fakeDescriptor = {
      ...ALIYUN_BAILIAN_TOKEN_PLAN,
      channel: "no-such/command",
    };
    await expect(
      runCommandFetch({
        channel: "no-such/command",
        descriptor: fakeDescriptor,
        instance: INSTANCE,
      }),
    ).rejects.toThrow("未注册 command 适配器");
  });

  it("注入 executor: 真实快照原样透传 + ctx 带零凭据 resolveCredential", async () => {
    const executor = vi.fn(
      async (
        _ch: string,
        _d: unknown,
        _inst: unknown,
        ctx: { resolveCredential: (ref: unknown) => Promise<string>; fetchedAt: number },
      ) => {
        const cred = await ctx.resolveCredential({ source: "store" });
        return {
          provider_id: "bailian",
          display_name: "百炼 Token Plan #1",
          plan_type: "window",
          fetched_at: ctx.fetchedAt,
          status: "ok",
          metrics: [{ key: "weekly", kind: "window", unit: "percent", used: 37.9, limit: 100, reset_at: 1_788_586_320 }],
          alerts: [],
          __credValue: cred, // 取证: command 通道零凭据
        } as unknown as ProviderSnapshot;
      },
    );
    const snap = await runCommandFetch(
      {
        channel: "aliyun-bailian/token-plan",
        descriptor: ALIYUN_BAILIAN_TOKEN_PLAN,
        instance: INSTANCE,
        fetchedAt: 1_700_000_000,
      },
      executor,
    );
    expect(snap.status).toBe("ok");
    expect((snap as unknown as { __credValue: string }).__credValue).toBe("");
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("注入 executor: auth_expired 快照原样透传(主进程不二次分类)", async () => {
    const executor = vi.fn(async () => ({
      provider_id: "bailian",
      display_name: "百炼 Token Plan #1",
      plan_type: "window",
      fetched_at: 1_700_000_000,
      status: "auth_expired",
      metrics: [],
      alerts: [{ level: "warn", message: "bl 控制台会话已失效", code: "auth_expired" }],
      setup_hint: "运行 `bl auth login --console` 重新授权",
    } as ProviderSnapshot));
    const snap = await runCommandFetch(
      {
        channel: "aliyun-bailian/token-plan",
        descriptor: ALIYUN_BAILIAN_TOKEN_PLAN,
        instance: INSTANCE,
      },
      executor,
    );
    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toContain("bl auth login");
  });
});

describe("command_run 桥 — 真实 spawn 取证(bl 未装机器)", () => {
  const realSpawn = it;

  realSpawn(
    "默认 executor 真实 spawn: bl 未装 → error 快照 + 安装 setup_hint(验收 2 真实路径取证)",
    async () => {
      if (await blInstalled()) {
        // 环境装了 bl → 本用例跳过(取证目标机器是 bl 未装的 WSL/服务器)
        console.warn("[command-run.test] bl 已安装, 跳过真实 spawn 取证用例");
        return;
      }
      const snap = await runCommandFetch({
        channel: "aliyun-bailian/token-plan",
        descriptor: ALIYUN_BAILIAN_TOKEN_PLAN,
        instance: INSTANCE,
        fetchedAt: Math.floor(Date.now() / 1000),
        timeoutMs: 5_000,
      });
      // bl 缺失 → spawn ENOENT(POSIX) → error + 安装 hint(D-041/D-023 语义)
      expect(snap.status).toBe("error");
      expect(snap.setup_hint).toContain("安装");
      expect(snap.error_message).toContain("bl CLI");
    },
    15_000,
  );
});
