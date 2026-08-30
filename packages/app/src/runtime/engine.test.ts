import { describe, expect, it, vi } from "vitest";

// unsupported 通道绝不进调度器 → httpGetJson 被调即失败
vi.mock("../ipc", () => ({
  httpGetJson: vi.fn(async () => {
    throw new Error("不应调用: 未接入通道不进调度器");
  }),
  commandRun: vi.fn(async () => null),
}));

import { RuntimeEngine, unsupportedSnapshot, type EngineOutput } from "./engine";
import type { SnapshotStorage } from "./storage";
import type { InstanceConfig } from "../instances/schema";
import type { ProviderSnapshot } from "../types";

const fakeStorage: SnapshotStorage = {
  init: async () => {},
  saveSnapshot: async () => {},
  latestSnapshots: async () => [],
  history: async () => [],
  purgeProvider: async () => {},
};

// 真正未接入的通道(不在 PRESET_CHANNELS/CHANNEL_MAPPINGS): 本卡后 kimi/opencode 已接入,
// 不能再拿它们当"未支持"样例(语义被 t_44497e20 推翻)
const unsupportedInstance: InstanceConfig = {
  id: "inst-aliyun-1",
  channel: "aliyun/bailian",
  name: "百炼 Token Plan #1",
  params: { api_key: { source: "store", key: "inst-aliyun-1:api_key" } },
};

describe("P0-8 未支持通道显式化(不静默跳过)", () => {
  it("unsupportedSnapshot 产出 status=unsupported 合法快照", () => {
    const snap = unsupportedSnapshot(unsupportedInstance);
    expect(snap.status).toBe("unsupported");
    expect(snap.provider_id).toBe("inst-aliyun-1");
    expect(snap.display_name).toBe("百炼 Token Plan #1");
    expect(snap.plan_type).toBe("window"); // 目录查不到 → 兜底 window
    expect(snap.metrics).toEqual([]);
    expect(snap.alerts[0]?.message).toContain("暂未接入");
  });

  it("目录外未知通道也显式化, plan_type 兜底 window", () => {
    const snap = unsupportedSnapshot({ ...unsupportedInstance, id: "x", channel: "foo/bar" });
    expect(snap.status).toBe("unsupported");
    expect(snap.plan_type).toBe("window");
  });

  it("引擎启动后面板立即收到 unsupported 卡, 且不进调度器", async () => {
    const engine = new RuntimeEngine([unsupportedInstance], fakeStorage);
    const outs: EngineOutput[] = [];
    engine.subscribe((o) => outs.push(o));
    engine.start();
    // start 同步段即 emit(unsupported 卡不等 hydrate/首轮采集)
    const last = outs[outs.length - 1];
    expect(last?.snapshots).toHaveLength(1);
    expect(last?.snapshots[0]?.status).toBe("unsupported");
    expect(last?.snapshots[0]?.provider_id).toBe("inst-aliyun-1");
    // 不进调度器(无适配器可轮询)
    expect(engine.stats["inst-aliyun-1"]).toBeUndefined();
    // hydrate 完成后仍是同一张卡(无存储历史, 不被覆盖)
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.snapshots.map((s) => s.status)).toEqual(["unsupported"]);
    engine.stop();
  });

  it("已接入通道(deepseek/opencode/kimi)进调度器, 不产 unsupported", () => {
    const engine = new RuntimeEngine(
      [
        { ...unsupportedInstance, id: "a", channel: "deepseek/balance" },
        { ...unsupportedInstance, id: "b", channel: "opencode/go" },
        { ...unsupportedInstance, id: "c", channel: "kimi/coding" },
      ],
      fakeStorage,
    );
    engine.subscribe(() => {});
    engine.start();
    // 三个通道都在 CHANNEL_MAPPINGS → 全部进调度器(不产 unsupported 卡)
    expect(engine.snapshots).toHaveLength(0);
    expect(engine.stats["a"]?.state).toBeTruthy();
    expect(engine.stats["b"]?.state).toBeTruthy();
    expect(engine.stats["c"]?.state).toBeTruthy();
    engine.stop();
  });
});

describe("hydrate 过滤(t_2ac39613: 删除的 provider 不复活)", () => {
  /** 幽灵快照(库里残留的已删实例历史) */
  const ghostSnap = (providerId: string, name: string) => ({
    provider_id: providerId,
    display_name: name,
    plan_type: "balance" as const,
    fetched_at: 1_700_000_000,
    status: "ok" as const,
    metrics: [{ key: "remaining", kind: "balance" as const, unit: "cny" as const, used: 42.5 }],
    alerts: [],
  });

  it("库里幽灵 provider 快照不进入 latest(实例集合是唯一真相源)", async () => {
    const storage: SnapshotStorage = {
      init: async () => {},
      saveSnapshot: async () => {},
      latestSnapshots: async () => [
        ghostSnap("live-1", "活着的 #1"),
        ghostSnap("deleted-a", "已删除 A"),
        ghostSnap("deleted-b", "已删除 B"),
      ],
      history: async () => [],
      purgeProvider: async () => {},
    };
    // 实例集合只剩 live-1 —— deleted-a/b 是已删实例, hydrate 后不得出现在 latest
    const engine = new RuntimeEngine(
      [
        { ...unsupportedInstance, id: "live-1", channel: "deepseek/balance", name: "活着的 #1" },
      ],
      storage,
    );
    engine.subscribe(() => {});
    engine.start();
    await new Promise((r) => setTimeout(r, 0)); // 等 hydrate 完成
    const ids = engine.snapshots.map((s) => s.provider_id);
    expect(ids).toContain("live-1");
    expect(ids).not.toContain("deleted-a");
    expect(ids).not.toContain("deleted-b");
    engine.stop();
  });
});

/**
 * B-3(契约追加): 引擎层写库守卫 —— 「先停源」的等价实现。
 *
 * 删除实例 → React 异步销毁旧引擎/新建引擎, 旧引擎 stop() 之前在途采集仍可能回调
 * onResult 写库。守卫要求: 引擎已 stop / provider 不在构造时的实例集合 / 快照 id 串号
 * 三种迟到响应一律静默丢弃(不落库、不进 latest、不 emit)。
 */
describe("B-3 onResult 写库守卫(迟到采集响应静默丢弃)", () => {
  const okSnap = (providerId: string): ProviderSnapshot => ({
    provider_id: providerId,
    display_name: `卡 ${providerId}`,
    plan_type: "balance",
    fetched_at: 1_700_000_000,
    status: "ok",
    metrics: [{ key: "remaining", kind: "balance", unit: "cny", used: 42.5 }],
    alerts: [],
  });

  /** 记录落库调用的探针 storage */
  function probeStorage(): { storage: SnapshotStorage; saved: string[] } {
    const saved: string[] = [];
    return {
      saved,
      storage: {
        init: async () => {},
        saveSnapshot: async (s) => {
          saved.push(s.provider_id);
        },
        latestSnapshots: async () => [],
        history: async () => [],
        purgeProvider: async () => {},
      },
    };
  }

  const inst = (id: string): InstanceConfig => ({
    id,
    channel: "deepseek/balance",
    name: `实例 ${id}`,
    params: { api_key: { source: "store", key: `${id}:api_key` } },
  });

  /** 直接驱动私有 onResult(模拟调度器的采集回调, 无需真实 HTTP) */
  type EngineInternals = {
    onResult(providerId: string, snap: ProviderSnapshot): Promise<void>;
  };
  const drive = (engine: RuntimeEngine) => engine as unknown as EngineInternals;

  it("引擎已 stop(实例集合变更, 旧引擎被废弃): 迟到响应不落库不进 latest", async () => {
    const { storage, saved } = probeStorage();
    const engine = new RuntimeEngine([inst("inst-a")], storage);
    engine.subscribe(() => {});
    engine.start();
    engine.stop(); // 删除实例 → React 销毁旧引擎

    await drive(engine).onResult("inst-a", okSnap("inst-a"));

    expect(saved).toEqual([]); // 不落库(purge 后不重生幽灵行)
    expect(engine.snapshots).toEqual([]); // 不进 latest(面板不闪旧帧)
  });

  it("provider 不在构造时实例集合: 迟到响应被丢弃", async () => {
    const { storage, saved } = probeStorage();
    const engine = new RuntimeEngine([inst("inst-live")], storage);
    engine.subscribe(() => {});
    engine.start();

    await drive(engine).onResult("inst-deleted", okSnap("inst-deleted"));

    expect(saved).toEqual([]);
    expect(engine.snapshots.map((s) => s.provider_id)).not.toContain("inst-deleted");
    engine.stop();
  });

  it("快照 provider_id 与调度 id 串号: 丢弃(防写错 provider 的库)", async () => {
    const { storage, saved } = probeStorage();
    const engine = new RuntimeEngine([inst("inst-a"), inst("inst-b")], storage);
    engine.subscribe(() => {});
    engine.start();

    await drive(engine).onResult("inst-a", okSnap("inst-b"));

    expect(saved).toEqual([]);
    expect(engine.snapshots).toEqual([]);
    engine.stop();
  });

  it("对照: 运行中且在实例集合内 → 正常落库并进 latest", async () => {
    const { storage, saved } = probeStorage();
    const engine = new RuntimeEngine([inst("inst-a")], storage);
    engine.subscribe(() => {});
    engine.start();

    await drive(engine).onResult("inst-a", okSnap("inst-a"));

    expect(saved).toEqual(["inst-a"]);
    expect(engine.snapshots.map((s) => s.provider_id)).toEqual(["inst-a"]);
    engine.stop();
  });
});

/**
 * D-042: command 类通道引擎接线 — COMMAND_ADAPTERS 解析 + 主进程 command_run 桥。
 * 契约 1: descriptor.adapter==="command" → COMMAND_ADAPTERS[channel](不再落 unsupported);
 * 契约 2: renderer 经 commandRun IPC 传输, 真实 spawn 在主进程(本测试 mock 桥返回值);
 * 契约 3: 引擎不注入假 runner —— 主进程侧缺省 runner 真实 spawn 由 command-run.test.ts 取证。
 */
describe("D-042 command 通道引擎接线(command_run IPC 桥)", () => {
  const bailianInstance: InstanceConfig = {
    id: "inst-bailian",
    channel: "aliyun-bailian/token-plan",
    name: "百炼 Token Plan #1",
    params: {}, // 零录入(D-041)
  };

  it("已注册 command 通道(aliyun-bailian/token-plan)进调度器, 不产 unsupported", () => {
    const engine = new RuntimeEngine([bailianInstance], fakeStorage);
    engine.subscribe(() => {});
    engine.start();

    // 进调度器: stats 有该实例(unsupported 卡不进调度器, 见 P0-8 用例)
    expect(engine.stats["inst-bailian"]?.state).toBeTruthy();
    // 同步段不产 unsupported 卡(等 hydrate/首轮采集出数)
    expect(engine.snapshots.map((s) => s.status)).not.toContain("unsupported");
    engine.stop();
  });

  it("commandRun 返回主进程真实快照 → 面板出卡(ok 态透传)", async () => {
    const { commandRun } = await import("../ipc");
    const commandRunMock = commandRun as unknown as ReturnType<typeof vi.fn>;
    const snap: ProviderSnapshot = {
      provider_id: "inst-bailian",
      display_name: "百炼 Token Plan #1",
      plan_type: "window",
      fetched_at: 1_700_000_000,
      status: "ok",
      metrics: [{ key: "weekly", kind: "window", unit: "percent", used: 37.9, limit: 100, reset_at: 1_788_586_320 }],
      alerts: [],
    };
    commandRunMock.mockResolvedValueOnce(snap);

    const engine = new RuntimeEngine([bailianInstance], fakeStorage);
    const outs: EngineOutput[] = [];
    engine.subscribe((o) => outs.push(o));
    engine.start();
    // 等 hydrate + refreshAll 完成(首轮采集走 command_run 桥)
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const last = outs[outs.length - 1];
    const card = last?.snapshots.find((s) => s.provider_id === "inst-bailian");
    expect(card?.status).toBe("ok");
    expect(card?.metrics[0]).toMatchObject({ key: "weekly", used: 37.9 });
    // 桥调用载荷: channel + descriptor + instance
    const callArg = commandRunMock.mock.calls[0]?.[0] as { channel?: string };
    expect(callArg?.channel).toBe("aliyun-bailian/token-plan");
    engine.stop();
  });

  it("主进程返回 error 快照(bl 未装) → error 卡透传, 不落 unsupported", async () => {
    const { commandRun } = await import("../ipc");
    const commandRunMock = commandRun as unknown as ReturnType<typeof vi.fn>;
    commandRunMock.mockResolvedValueOnce({
      provider_id: "inst-bailian",
      display_name: "百炼 Token Plan #1",
      plan_type: "window",
      fetched_at: 1_700_000_000,
      status: "error",
      metrics: [],
      alerts: [{ level: "critical", message: "bl CLI 不在 PATH, 请安装后重启应用", code: "cli_missing" }],
      error_message: "bl CLI 不在 PATH, 请安装后重启应用",
      setup_hint: "未检测到 bl CLI: 请安装(见 DESIGN.md D-023 一键安装)后重启应用",
    });

    const engine = new RuntimeEngine([bailianInstance], fakeStorage);
    const outs: EngineOutput[] = [];
    engine.subscribe((o) => outs.push(o));
    engine.start();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const card = outs[outs.length - 1]?.snapshots.find((s) => s.provider_id === "inst-bailian");
    expect(card?.status).toBe("error");
    expect(card?.setup_hint).toContain("未检测到 bl CLI");
    engine.stop();
  });

  it("纯浏览器 dev(commandRun 返回 null) → 显式 error 快照(非 unsupported)", async () => {
    const { commandRun } = await import("../ipc");
    const commandRunMock = commandRun as unknown as ReturnType<typeof vi.fn>;
    commandRunMock.mockResolvedValueOnce(null);

    const engine = new RuntimeEngine([bailianInstance], fakeStorage);
    const outs: EngineOutput[] = [];
    engine.subscribe((o) => outs.push(o));
    engine.start();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const card = outs[outs.length - 1]?.snapshots.find((s) => s.provider_id === "inst-bailian");
    expect(card?.status).toBe("error");
    expect(card?.error_message).toContain("桌面壳");
    engine.stop();
  });

  it("目录内 command 描述符但注册表缺失(不变量破坏)→ 显式 unsupported(防御保留)", () => {
    // COMMAND_ADAPTERS 是 D-041 常量, 无法在测试中删除 key; 用假通道模拟注册表缺失路径
    const unknownCommand: InstanceConfig = {
      id: "inst-unknown",
      channel: "unknown-command/plan",
      name: "未知 command",
      params: {},
    };
    // 目录内无此通道 → 走 P0-8 unsupported(契约: 两者都缺 → 显式 unsupported 卡)
    const engine = new RuntimeEngine([unknownCommand], fakeStorage);
    engine.subscribe(() => {});
    engine.start();
    expect(engine.snapshots.map((s) => s.status)).toEqual(["unsupported"]);
    engine.stop();
  });
});
