// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROBE_TIMEOUT_MS,
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
