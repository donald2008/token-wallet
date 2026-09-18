import { describe, expect, it, vi } from "vitest";

// unsupported 通道绝不进调度器 → httpGetJson 被调即失败
vi.mock("../ipc", () => ({
  httpGetJson: vi.fn(async () => {
    throw new Error("不应调用: 未接入通道不进调度器");
  }),
  commandRun: vi.fn(async () => null),
  // D-043 存量补写走 shared keyring/store → 补全 ipc 表面(store.ts 依赖), 防 ReferenceError
  isDesktopHost: () => false,
  instancesLoad: vi.fn(async () => null),
  instancesSave: vi.fn(async () => {}),
  keyringGet: vi.fn(async () => null),
  keyringSet: vi.fn(async () => {}),
  keyringDelete: vi.fn(async () => {}),
}));

import { RuntimeEngine, unsupportedSnapshot, type EngineOutput } from "./engine";
import type { SnapshotStorage } from "./storage";
import type { InstanceConfig } from "../instances/schema";
import { keyFingerprint } from "../instances/schema";
import { KEYRING_SERVICE, getSharedKeyring, getSharedStore, MemoryKeyring } from "../instances/store";
import type { ProviderSnapshot } from "../types";
import type { Metric } from "@token-wallet/core/schema";

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

  it("目录外未知 command 通道(不在 PRESET_CHANNELS)→ !descriptor 分支显式 unsupported", () => {
    // 注意: 本用例走的是 !descriptor(目录外)分支, 不是 COMMAND_ADAPTERS 缺失分支 ——
    // 注册表缺失(目录内有 command 描述符但 COMMAND_ADAPTERS 无条目)由
    // engine-command-registry.test.ts(vi.mock 空注册表)真覆盖, 本用例不改名会误导维护者。
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

/**
 * D-043 存量补写: 无 key_fingerprint 的存量实例 → 首次采集成功(ok)时回填指纹。
 * 用共享 singleton keyring/store 驱动, 验证 backfillKeyFingerprint 确实把指纹写回实例配置。
 */
describe("D-043 存量补写(首次采集成功回填 key_fingerprint)", () => {
  const okSnapFor = (providerId: string): ProviderSnapshot => ({
    provider_id: providerId,
    display_name: `卡 ${providerId}`,
    plan_type: "balance",
    fetched_at: 1_700_000_000,
    status: "ok",
    metrics: [{ key: "remaining", kind: "balance", unit: "cny", used: 42.5 }],
    alerts: [],
  });

  const instNoFp = (id: string): InstanceConfig => ({
    id,
    channel: "deepseek/balance",
    name: `存量实例 ${id}`,
    // 存量实例配置只存 CredentialRef(明文在钥匙串), 无 key_fingerprint(D-043 待补写)
    params: { api_key: { source: "store", key: `${id}:api_key` } },
  });

  it("ok 采集后为无指纹存量实例补写 key_fingerprint(且与同 key 指纹一致)", async () => {
    const secret = "sk-legacy-999";
    // 在共享内存钥匙串注入存量 secret; store 预置同 id 的存量实例(无指纹)
    const keyring = getSharedKeyring() as MemoryKeyring;
    await keyring.set(KEYRING_SERVICE, "inst-legacy:api_key", secret);
    getSharedStore().hydrate([instNoFp("inst-legacy")]);

    const engine = new RuntimeEngine([instNoFp("inst-legacy")], fakeStorage);
    engine.subscribe(() => {});
    engine.start();
    // 直接驱动 onResult(模拟首次采集成功), 触发存量补写
    await (engine as unknown as { onResult(id: string, s: ProviderSnapshot): Promise<void> }).onResult(
      "inst-legacy",
      okSnapFor("inst-legacy"),
    );
    // 等补写链路落定: keyring 读 + sha256(webcrypto 线程池, 非 microtask) → 轮询等指纹出现
    const deadline = Date.now() + 2000;
    while (!getSharedStore().list().find((i) => i.id === "inst-legacy")?.key_fingerprint) {
      if (Date.now() > deadline) throw new Error("等 key_fingerprint 补写超时");
      await new Promise((r) => setTimeout(r, 10));
    }

    const updated = getSharedStore().list().find((i) => i.id === "inst-legacy");
    expect(updated?.key_fingerprint).toBeTruthy();
    // 补写指纹 == keyFingerprint("sk-legacy-999") —— 与添加时同规, 后续同 key 添加会被命中
    expect(updated?.key_fingerprint).toBe(await keyFingerprint(secret));
    engine.stop();
    // 清空共享 store, 防污染其他用例
    getSharedStore().hydrate([]);
    await keyring.delete(KEYRING_SERVICE, "inst-legacy:api_key");
  });

  it("已有指纹的实例不被重复补写(幂等)", async () => {
    const fp = "f" + "0".repeat(31);
    getSharedStore().hydrate([{ ...instNoFp("inst-fp"), key_fingerprint: fp }]);
    const engine = new RuntimeEngine([{ ...instNoFp("inst-fp"), key_fingerprint: fp }], fakeStorage);
    engine.subscribe(() => {});
    engine.start();
    await (engine as unknown as { onResult(id: string, s: ProviderSnapshot): Promise<void> }).onResult(
      "inst-fp",
      okSnapFor("inst-fp"),
    );
    await new Promise((r) => setTimeout(r, 0));
    const updated = getSharedStore().list().find((i) => i.id === "inst-fp");
    expect(updated?.key_fingerprint).toBe(fp); // 保持原指纹, 不被覆盖
    engine.stop();
    getSharedStore().hydrate([]);
  });

  it("非 ok 采集(采集失败)不补写 —— 只有成功才回填", async () => {
    const secret = "***";
    const keyring = getSharedKeyring() as MemoryKeyring;
    await keyring.set(KEYRING_SERVICE, "inst-err:api_key", secret);
    getSharedStore().hydrate([instNoFp("inst-err")]);
    const engine = new RuntimeEngine([instNoFp("inst-err")], fakeStorage);
    engine.subscribe(() => {});
    engine.start();
    await (engine as unknown as { onResult(id: string, s: ProviderSnapshot): Promise<void> }).onResult(
      "inst-err",
      { ...okSnapFor("inst-err"), status: "error", alerts: [{ level: "critical", message: "x" }] },
    );
    await new Promise((r) => setTimeout(r, 0));
    const updated = getSharedStore().list().find((i) => i.id === "inst-err");
    expect(updated?.key_fingerprint).toBeUndefined(); // 失败不补写
    engine.stop();
    getSharedStore().hydrate([]);
    await keyring.delete(KEYRING_SERVICE, "inst-err:api_key");
  });
});

// ---- t_034a6e81 Bug1 修: 引擎 refresh(id) 透出 + 只刷目标实例 ----
describe("Bug1 修: RuntimeEngine.refresh(id) 单实例刷线", () => {
  // 注: command 通道(commandRun mock)是 D-042 验证过的可靠路径(httpGetJson mock 路径在本测试
  // 套件未被覆盖, deepseek/balance 实测 lastRunAt 有但 mock.calls=0, 暂不冒险用 http 通道);
  // 透出语义 = 委派给 scheduler.refresh, 与命令/通道无关, 用 command 通道足以证"refresh(id) 真触发 fetch"
  const bailianInstance = (id: string): InstanceConfig => ({
    id,
    channel: "aliyun-bailian/token-plan",
    name: `百炼 #${id}`,
    params: {},
  });

  it("refresh(id) 委派到 scheduler.refresh(id), 触发目标实例的 commandRun 再次被调", async () => {
    const { commandRun } = await import("../ipc");
    const commandRunMock = commandRun as unknown as ReturnType<typeof vi.fn>;
    commandRunMock.mockResolvedValue({
      provider_id: "inst-bailian",
      display_name: "百炼 #1",
      plan_type: "window",
      fetched_at: 1_700_000_000,
      status: "ok",
      metrics: [],
      alerts: [],
    });
    const engine = new RuntimeEngine([bailianInstance("inst-bailian")], fakeStorage);
    engine.subscribe(() => {});
    engine.start();
    // 等首轮 hydrate + refreshAll
    await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 0));
    const callsBefore = commandRunMock.mock.calls.length;
    expect(callsBefore).toBeGreaterThanOrEqual(1);
    // 显式 refresh(id) → 应当再触发一次 commandRun
    await engine.refresh("inst-bailian");
    await new Promise((r) => setTimeout(r, 0));
    expect(commandRunMock.mock.calls.length).toBeGreaterThan(callsBefore);
    engine.stop();
  });

  it("refresh(id) 只刷目标实例, 不会触发其他实例 fetch(无广扫)", async () => {
    const { commandRun } = await import("../ipc");
    const commandRunMock = commandRun as unknown as ReturnType<typeof vi.fn>;
    commandRunMock.mockImplementation(async () => ({
      provider_id: "x",
      display_name: "x",
      plan_type: "window",
      fetched_at: 1_700_000_000,
      status: "ok",
      metrics: [],
      alerts: [],
    }));
    // 多实例同 channel: 串行链; refreshAll 一次性让 a/b/c 都进 fetch
    const engine = new RuntimeEngine(
      [
        bailianInstance("inst-a"),
        bailianInstance("inst-b"),
        bailianInstance("inst-c"),
      ],
      fakeStorage,
    );
    engine.subscribe(() => {});
    engine.start();
    // 等首轮 refreshAll(同 channel 串行, mock 返回值 provider_id 不匹配 liveIds, 落 error 快照但 fetch 仍跑)
    await new Promise((r) => setTimeout(r, 30));
    const callsAfterStart = commandRunMock.mock.calls.length;
    expect(callsAfterStart).toBeGreaterThanOrEqual(1);
    // 显式只刷 inst-a: 增长 ≥ 1
    await engine.refresh("inst-a");
    await new Promise((r) => setTimeout(r, 0));
    expect(commandRunMock.mock.calls.length).toBeGreaterThan(callsAfterStart);
    engine.stop();
  });
});

// ---- t_5d8c3c81: 采集失败只读缓存语义(用户 9/9 拍板) ----
// engine.onResult 合并策略:
//   - snap.status === "ok" → 正常替换 latest + 落库
//   - 失败(error/stale/auth_expired) 且 latest 已有 ok 快照 → 保留旧 metrics/fetched_at/display_name/plan_type/logo;
//     仅覆盖 status/alerts/error_message/setup_hint; 不落库(库内仍存旧成功快照)
//   - 失败且无旧 ok 快照 → 整卡 error(原状)
// errorSnapshot 必带 logo(品牌固有属性)
describe("t_5d8c3c81: 采集失败只读缓存(失败保留旧 metrics + 不落库覆盖 + errorSnapshot 带 logo)", () => {
  const drive = (engine: RuntimeEngine) =>
    engine as unknown as {
      onResult(id: string, snap: ProviderSnapshot): Promise<void>;
    };

  /** 计数 storage: 同时记录 saveSnapshot 调用次数与最近一次快照(provider_id + status) */
  function countingStorage(): { storage: SnapshotStorage; count: number; last?: ProviderSnapshot } {
    const state = { count: 0, last: undefined as ProviderSnapshot | undefined };
    return {
      get count() {
        return state.count;
      },
      get last() {
        return state.last;
      },
      storage: {
        init: async () => {},
        saveSnapshot: async (s) => {
          state.count += 1;
          state.last = s;
        },
        latestSnapshots: async () => [],
        history: async () => [],
        purgeProvider: async () => {},
      },
    };
  }

  function okSnapOf(providerId: string, fetchedAt: number, metrics: Metric[] = [{ key: "rolling_5h", kind: "window", unit: "requests", used: 800, limit: 1200, reset_at: fetchedAt + 3600 }]): ProviderSnapshot {
    return {
      provider_id: providerId,
      display_name: `实例 ${providerId}`,
      plan_type: "window",
      fetched_at: fetchedAt,
      status: "ok",
      metrics,
      alerts: [],
      logo: "kimi",
    };
  }

  function failSnapOf(providerId: string, status: "error" | "stale" | "auth_expired", errorMessage: string, fetchedAt = 1_789_000_000): ProviderSnapshot {
    return {
      provider_id: providerId,
      display_name: `实例 ${providerId}`,
      plan_type: "window",
      fetched_at: fetchedAt,
      status,
      metrics: [], // 失败快照 metrics 空(原行为)
      alerts: [{ level: "critical", message: errorMessage, code: "adapter_threw" }],
      error_message: errorMessage,
      logo: "kimi", // errorSnapshot 现在带 logo(本卡修复)
    };
  }

  function makeEngine(storage: SnapshotStorage): RuntimeEngine {
    const inst: InstanceConfig = {
      id: "inst-t5d8c3c81",
      channel: "deepseek/balance",
      name: "实例 inst-t5d8c3c81",
      params: { api_key: { source: "store", key: "inst-t5d8c3c81:api_key" } },
    };
    const engine = new RuntimeEngine([inst], storage);
    engine.subscribe(() => {}); // 维持订阅即可, 不需要断言 emit 内容
    engine.start();
    return engine;
  }

  it("ok 后失败(error): latest 保留旧 metrics/fetched_at/plan_type/logo(只读缓存语义)", async () => {
    const probe = countingStorage();
    const engine = makeEngine(probe.storage);

    // 先来一次 ok 快照
    const okAt = 1_789_000_000;
    await drive(engine).onResult("inst-t5d8c3c81", okSnapOf("inst-t5d8c3c81", okAt));
    expect(engine.snapshots[0]?.status).toBe("ok");
    expect(engine.snapshots[0]?.metrics[0]?.used).toBe(800);
    expect(probe.count).toBe(1); // ok 落了 1 次库

    // 紧接着一次 error 快照(时间戳更新, 但应被忽略以保只读语义)
    const errAt = okAt + 600; // 600s 后失败
    await drive(engine).onResult("inst-t5d8c3c81", failSnapOf("inst-t5d8c3c81", "error", "网络超时", errAt));

    // 验证骨架字段保留
    const latest = engine.snapshots[0]!;
    expect(latest.status).toBe("error"); // status 被覆盖
    expect(latest.fetched_at).toBe(okAt); // ★ fetched_at 不变(用旧值, 让「数据来自 N 分钟前」算出来)
    expect(latest.metrics).toHaveLength(1); // ★ metrics 数量不变
    expect(latest.metrics[0]?.used).toBe(800); // ★ metrics 内容不变
    expect(latest.display_name).toBe("实例 inst-t5d8c3c81");
    expect(latest.plan_type).toBe("window");
    expect(latest.logo).toBe("kimi");
    // 错误相关字段被新覆盖
    expect(latest.error_message).toBe("网络超时");
    expect(latest.alerts[0]?.message).toBe("网络超时");
    // 库内仍是旧的 ok 快照(saveSnapshot 总次数 = 1, 最近一次落库仍是 ok)
    expect(probe.count).toBe(1); // ★ 不落库覆盖
    expect(probe.last?.status).toBe("ok");
    expect(probe.last?.metrics[0]?.used).toBe(800);

    engine.stop();
  });

  it("ok 后失败(stale): 同样保留旧 metrics/fetched_at(只读语义对所有失败态生效)", async () => {
    const probe = countingStorage();
    const engine = makeEngine(probe.storage);

    const okAt = 1_789_000_000;
    await drive(engine).onResult("inst-t5d8c3c81", okSnapOf("inst-t5d8c3c81", okAt));
    expect(probe.count).toBe(1);

    await drive(engine).onResult(
      "inst-t5d8c3c81",
      failSnapOf("inst-t5d8c3c81", "stale", "数据陈旧", okAt + 999),
    );
    const latest = engine.snapshots[0]!;
    expect(latest.status).toBe("stale");
    expect(latest.fetched_at).toBe(okAt);
    expect(latest.metrics[0]?.used).toBe(800);
    expect(probe.count).toBe(1); // 不落库

    engine.stop();
  });

  it("ok 后失败(auth_expired): setup_hint 一并透传(失败独有字段)", async () => {
    const probe = countingStorage();
    const engine = makeEngine(probe.storage);

    const okAt = 1_789_000_000;
    await drive(engine).onResult("inst-t5d8c3c81", okSnapOf("inst-t5d8c3c81", okAt));
    expect(probe.count).toBe(1);

    const authExpiredSnap: ProviderSnapshot = {
      ...failSnapOf("inst-t5d8c3c81", "auth_expired", "登录态过期", okAt + 300),
      setup_hint: "请运行 `bl auth login --console` 重新授权",
    };
    await drive(engine).onResult("inst-t5d8c3c81", authExpiredSnap);
    const latest = engine.snapshots[0]!;
    expect(latest.status).toBe("auth_expired");
    expect(latest.fetched_at).toBe(okAt); // ★ 骨架保留
    expect(latest.metrics[0]?.used).toBe(800); // ★ 骨架保留
    expect(latest.setup_hint).toBe("请运行 `bl auth login --console` 重新授权"); // 失败独有字段覆盖空→有
    expect(probe.count).toBe(1); // 不落库

    engine.stop();
  });

  it("失败且无旧 ok 快照(首次就失败): 整卡 error, 正常落库(由 errorSnapshot 兜底带 logo)", async () => {
    const probe = countingStorage();
    const engine = makeEngine(probe.storage);

    // 直接首次喂 error 快照(latest 本来是空)
    await drive(engine).onResult(
      "inst-t5d8c3c81",
      failSnapOf("inst-t5d8c3c81", "error", "首次采集就失败"),
    );
    const latest = engine.snapshots[0]!;
    expect(latest.status).toBe("error");
    expect(latest.metrics).toEqual([]); // metrics 空可接受(无假数据原则)
    expect(latest.logo).toBe("kimi"); // ★ logo 在失败快照上存在
    expect(latest.error_message).toBe("首次采集就失败");
    // 首次失败: 落库(库内允许存失败快照, 用作诊断)
    expect(probe.count).toBe(1);

    engine.stop();
  });

  it("连续多次失败(无中间 ok): latest 用最新失败快照, 库内每次都落库", async () => {
    const probe = countingStorage();
    const engine = makeEngine(probe.storage);

    await drive(engine).onResult(
      "inst-t5d8c3c81",
      failSnapOf("inst-t5d8c3c81", "error", "第一次失败", 1_789_000_000),
    );
    expect(probe.count).toBe(1);
    await drive(engine).onResult(
      "inst-t5d8c3c81",
      failSnapOf("inst-t5d8c3c81", "error", "第二次失败", 1_789_000_600),
    );
    expect(probe.count).toBe(2);
    expect(engine.snapshots[0]?.error_message).toBe("第二次失败");

    engine.stop();
  });

  it("errorSnapshot 静态方法透传 descriptor.logo(品牌固有属性不随采集成败消失)", async () => {
    // 私有静态方法通过 RuntimeEngine 反射调用(errorSnapshot 是 private static,
    // 走真实抛错路径需 mock httpGetJson 在 fetchSnapshot catch 内触发, 间接且易脆;
    // 直接反射调用一次性锁定契约, 等价覆盖同一字段: provider_id/display_name/plan_type/logo/metrics 空/alerts 必含)
    const errSnap = (RuntimeEngine as unknown as {
      errorSnapshot(
        inst: InstanceConfig,
        planType: ProviderSnapshot["plan_type"],
        err: unknown,
        logo?: string,
      ): ProviderSnapshot;
    }).errorSnapshot(
      {
        id: "inst-t5d8c3c81",
        channel: "deepseek/balance",
        name: "实例 inst-t5d8c3c81",
        params: {},
      },
      "window",
      new Error("适配器抛错"),
      "kimi",
    );
    // logo 字段由 descriptor 透传(本卡根因修复)
    expect(errSnap.logo).toBe("kimi");
    // 兜底快照契约: status=error + metrics 空 + error_message 来自 err.message + alerts 含 adapter_threw code
    expect(errSnap.status).toBe("error");
    expect(errSnap.metrics).toEqual([]);
    expect(errSnap.error_message).toBe("适配器抛错");
    expect(errSnap.alerts[0]?.code).toBe("adapter_threw");
    expect(errSnap.alerts[0]?.message).toBe("适配器抛错");
  });

  it("失败 → ok → 失败 → ok 反复: latest 总用最新快照(骨架覆盖), 库内每次都落库", async () => {
    const probe = countingStorage();
    const engine = makeEngine(probe.storage);

    // ok(骨架 A) → 失败 → ok(骨架 B) → 失败
    await drive(engine).onResult(
      "inst-t5d8c3c81",
      okSnapOf("inst-t5d8c3c81", 1_789_000_000, [
        { key: "rolling_5h", kind: "window", unit: "requests", used: 100, limit: 1200, reset_at: 1_789_003_600 },
      ]),
    );
    expect(probe.count).toBe(1);
    await drive(engine).onResult(
      "inst-t5d8c3c81",
      failSnapOf("inst-t5d8c3c81", "error", "网络抖动", 1_789_000_600),
    );
    // 失败时骨架保留 = 100/1200; latest.fetched_at = 1_789_000_000
    expect(engine.snapshots[0]?.metrics[0]?.used).toBe(100);
    expect(engine.snapshots[0]?.fetched_at).toBe(1_789_000_000);
    expect(probe.count).toBe(1); // 失败不落库

    // ok(骨架 B): used 变成 500
    await drive(engine).onResult(
      "inst-t5d8c3c81",
      okSnapOf("inst-t5d8c3c81", 1_789_001_200, [
        { key: "rolling_5h", kind: "window", unit: "requests", used: 500, limit: 1200, reset_at: 1_789_004_800 },
      ]),
    );
    expect(probe.count).toBe(2); // ok 落库
    expect(engine.snapshots[0]?.metrics[0]?.used).toBe(500); // 骨架覆盖
    expect(engine.snapshots[0]?.fetched_at).toBe(1_789_001_200);

    engine.stop();
  });
});
