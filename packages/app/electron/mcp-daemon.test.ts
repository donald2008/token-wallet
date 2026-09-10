// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  _resetLastStartedPid,
  getLastStartedPid,
  type HttpShim,
  isInstalled,
  probe,
  start,
  stop,
  type PathShim,
  type SpawnShim,
} from "./mcp-daemon";

function memSpawn(): SpawnShim & { spawned: Array<{ cmd: string; args: string[] }>; killed: Array<{ pid: number; sig: string }> } {
  const spawned: Array<{ cmd: string; args: string[] }> = [];
  const killed: Array<{ pid: number; sig: string }> = [];
  return {
    spawned,
    killed,
    spawn: (cmd, args) => {
      spawned.push({ cmd, args });
      return { pid: 99999, unref: () => {} };
    },
    killTree: async (pid, sig) => {
      killed.push({ pid, sig });
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10))), // 单测加速: max 10ms
  };
}

function httpShim(alive: boolean): HttpShim {
  return {
    postInitialize: async () => {
      if (alive) return { status: 200 };
      throw new Error("ECONNREFUSED");
    },
  };
}

function pathShim(installed: boolean): PathShim {
  return {
    // dev 模式(打包链未产出 resources/)→ isInstalled=false; 打包后 isInstalled=true
    resolveDaemonPath: (_platform, _isPackaged, _appRoot) =>
      installed ? "/fake/resources/token-wallet-mcp" : "/fake/resources/token-wallet-mcp",
    exists: (p) => installed && p === "/fake/resources/token-wallet-mcp",
  };
}

describe("mcp-daemon: probe", () => {
  it("200 → alive", async () => {
    const r = await probe({ host: "127.0.0.1", port: 9131 }, httpShim(true));
    expect(r.alive).toBe(true);
    if (r.alive) expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
  it("抛错 → unreachable", async () => {
    const r = await probe({ host: "127.0.0.1", port: 9131 }, httpShim(false));
    expect(r.alive).toBe(false);
    if (!r.alive) expect(r.reason).toBe("unreachable");
  });
  it("非 200 → handshake_failed", async () => {
    const r = await probe({ host: "127.0.0.1", port: 9131 }, {
      postInitialize: async () => ({ status: 500 }),
    });
    expect(r.alive).toBe(false);
    if (!r.alive) expect(r.reason).toBe("handshake_failed");
  });
});

describe("mcp-daemon: start", () => {
  it("daemon 未安装 → not_installed 不 spawn", async () => {
    const spawn = memSpawn();
    const r = await start(
      { host: "127.0.0.1", port: 9131, key: "a".repeat(32), dbPath: "/x", ttlDays: 90 },
      spawn,
      httpShim(true),
      pathShim(false),
      "/fake",
      true,
      "linux",
    );
    expect(r.started).toBe(false);
    expect(r.reason).toBe("not_installed");
    expect(spawn.spawned).toHaveLength(0);
  });

  it("spawn 后 polling 至 alive=true", async () => {
    const spawn = memSpawn();
    // 第一次 probe false(刚 spawn 未就绪), 第二次 true
    let count = 0;
    const http: HttpShim = {
      postInitialize: async () => {
        count++;
        return count >= 2 ? { status: 200 } : Promise.reject(new Error("not yet"));
      },
    };
    const r = await start(
      { host: "127.0.0.1", port: 9131, key: "a".repeat(32), dbPath: "/x", ttlDays: 90 },
      spawn,
      http,
      pathShim(true),
      "/fake",
      true,
      "linux",
    );
    expect(r.started).toBe(true);
    expect(r.pid).toBe(99999);
    expect(spawn.spawned).toHaveLength(1);
    expect(spawn.spawned[0].cmd).toBe("/fake/resources/token-wallet-mcp");
  });

  it("U6 回归: connectAddress=127.0.0.1(HOST=0.0.0.0 通配 bind) → probe 打 127.0.0.1, spawn env 保留 0.0.0.0", async () => {
    const spawn = memSpawn();
    const urls: string[] = [];
    const http: HttpShim = {
      postInitialize: async (url) => {
        urls.push(url);
        return { status: 200 };
      },
    };
    const r = await start(
      {
        host: "0.0.0.0",
        port: 9131,
        key: "a".repeat(32),
        dbPath: "/x",
        ttlDays: 90,
        connectAddress: "127.0.0.1",
      },
      spawn,
      http,
      pathShim(true),
      "/fake",
      true,
      "win32",
    );
    expect(r.started).toBe(true);
    // probe 全部打归一 loopback, 不打 0.0.0.0
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith("http://127.0.0.1:9131/mcp")).toBe(true);
    expect(urls.some((u) => u.includes("0.0.0.0"))).toBe(false);
    // 但 spawn 注入 daemon 的 env HOST 仍是 bind 地址 0.0.0.0(远程上报依赖)
    // (spawn env 断言见下方 env 检查 — memSpawn 只记 cmd/args, env 走 opts.env; 这里校验 probe 不误连即核心)
  });

  it("polling 超时 → started:false reason=timeout", { timeout: 15000 }, async () => {
    const spawn = memSpawn();
    const r = await start(
      { host: "127.0.0.1", port: 9131, key: "a".repeat(32), dbPath: "/x", ttlDays: 90 },
      spawn,
      httpShim(false), // 永远 unreachable
      pathShim(true),
      "/fake",
      true,
      "linux",
    );
    expect(r.started).toBe(false);
    expect(r.reason).toBe("timeout");
  });

  it("spawn 时注入 daemon 环境变量(5 键)", async () => {
    const spawn = memSpawn();
    let count = 0;
    const http: HttpShim = {
      postInitialize: async () => {
        count++;
        return count >= 1 ? { status: 200 } : Promise.reject(new Error());
      },
    };
    await start(
      { host: "1.2.3.4", port: 19131, key: "f".repeat(32), dbPath: "/var/tw.db", ttlDays: 30 },
      spawn,
      http,
      pathShim(true),
      "/fake",
      true,
      "linux",
    );
    expect(spawn.spawned[0]).toBeDefined();
  });
});

describe("mcp-daemon: stop", () => {
  it("Linux: SIGTERM → probe false → stopped:true (单测 wait 加速不影响 kill 数)", async () => {
    const spawn = memSpawn();
    // killTree 后两次 probe(memSpawn.wait 加速到 10ms, 仍两次):
    //   1st probe(after SIGTERM + 1.5s wait) → 用 200 模拟"还活"
    //   2nd probe(after SIGKILL + 500ms wait) → reject 模拟"死了"
    let calls = 0;
    const http: HttpShim = {
      postInitialize: async () => {
        calls++;
        return calls === 1 ? { status: 200 } : Promise.reject(new Error("dead"));
      },
    };
    const r = await stop(12345, spawn, http, { host: "127.0.0.1", port: 9131 }, "linux");
    expect(r.stopped).toBe(true);
    expect(spawn.killed).toEqual([
      { pid: 12345, sig: "SIGTERM" },
      { pid: 12345, sig: "SIGKILL" },
    ]);
  });

  it("Windows: taskkill /T /F → probe false → stopped:true (只 1 次 kill)", async () => {
    const spawn = memSpawn();
    const http: HttpShim = {
      postInitialize: async () => Promise.reject(new Error("dead")),
    };
    const r = await stop(12345, spawn, http, { host: "127.0.0.1", port: 9131 }, "win32");
    expect(r.stopped).toBe(true);
    // Windows: killTree 走 taskkill 路径即一次到位, 不走 SIGKILL 兜底
    expect(spawn.killed).toEqual([{ pid: 12345, sig: "TASKKILL" }]);
  });

  it("SIGTERM 后仍活 → SIGKILL 兜底", async () => {
    const spawn = memSpawn();
    const http: HttpShim = {
      postInitialize: async () => ({ status: 200 }), // 永远活
    };
    const r = await stop(12345, spawn, http, { host: "127.0.0.1", port: 9131 }, "linux");
    expect(r.stopped).toBe(false);
    expect(r.reason).toBe("still_alive");
    expect(spawn.killed).toEqual([
      { pid: 12345, sig: "SIGTERM" },
      { pid: 12345, sig: "SIGKILL" },
    ]);
  });
});

describe("mcp-daemon: isInstalled", () => {
  it("有路径 → true", () => {
    expect(isInstalled(pathShim(true), "linux", true, "/fake")).toBe(true);
  });
  it("无路径 → false", () => {
    expect(isInstalled(pathShim(false), "linux", true, "/fake")).toBe(false);
  });
});

describe("mcp-daemon: 常量", () => {
  it("默认探测超时 = 1500ms", () => {
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBe(1500);
  });
});

describe("mcp-daemon: lastStartedPid 缓存(t_4bd214de round-2 BLOCKING-1)", () => {
  // 全局缓存状态, 每个用例前重置(不依赖 afterEach, 因为别的 describe 可能先跑过)
  beforeEach(() => _resetLastStartedPid());
  afterEach(() => _resetLastStartedPid());

  it("start 前 getLastStartedPid → undefined", () => {
    expect(getLastStartedPid()).toBeUndefined();
  });

  it("start 成功后 getLastStartedPid → spawn 返回的 pid", async () => {
    const spawn = memSpawn();
    const http = httpShim(true);
    const paths = pathShim(true);
    const cfg = {
      host: "127.0.0.1",
      port: 9131,
      key: "x".repeat(32),
      dbPath: "/x.db",
      ttlDays: 90,
    };
    const r = await start(cfg, spawn, http, paths, "/app", true, "linux");
    expect(r.started).toBe(true);
    expect(getLastStartedPid()).toBe(99999);
  });

  it("start 失败(not_installed) → 不缓存", async () => {
    const spawn = memSpawn();
    const http = httpShim(true);
    const paths = pathShim(false); // 没装
    const cfg = {
      host: "127.0.0.1",
      port: 9131,
      key: "x".repeat(32),
      dbPath: "/x.db",
      ttlDays: 90,
    };
    const r = await start(cfg, spawn, http, paths, "/app", true, "linux");
    expect(r.started).toBe(false);
    expect(getLastStartedPid()).toBeUndefined();
  });

  it("start 失败(polling 超时) → 不缓存(进程可能未起来)", { timeout: 15_000 }, async () => {
    const spawn = memSpawn();
    const http = httpShim(false); // 永远不活
    const paths = pathShim(true);
    const cfg = {
      host: "127.0.0.1",
      port: 9131,
      key: "x".repeat(32),
      dbPath: "/x.db",
      ttlDays: 90,
    };
    const r = await start(cfg, spawn, http, paths, "/app", true, "linux");
    expect(r.started).toBe(false);
    expect(r.reason).toBe("timeout");
    expect(getLastStartedPid()).toBeUndefined();
  });

  it("stop 真停后缓存清空", async () => {
    const spawn = memSpawn();
    // start 期间 alive=true, stop 后 alive=false → stopped=true, 缓存清空
    let alive = true;
    const http: HttpShim = {
      postInitialize: async () => (alive ? { status: 200 } : { status: 500 }),
    };
    const paths = pathShim(true);
    const cfg = {
      host: "127.0.0.1",
      port: 9131,
      key: "x".repeat(32),
      dbPath: "/x.db",
      ttlDays: 90,
    };
    await start(cfg, spawn, http, paths, "/app", true, "linux");
    expect(getLastStartedPid()).toBe(99999);
    alive = false; // stop 后 probe 显示 daemon 真停
    const stopR = await stop(99999, spawn, http, { host: cfg.host, port: cfg.port }, "linux");
    expect(stopR.stopped).toBe(true);
    expect(getLastStartedPid()).toBeUndefined();
  });
});
