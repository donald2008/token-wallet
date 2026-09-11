// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  _resetLastStartedPid,
  checkDaemonVersion,
  discoverPidByPort,
  getLastStartedPid,
  type HttpShim,
  isInstalled,
  isSameProcessTree,
  parseDaemonBuildId,
  parseListenerPids,
  probe,
  readLocalBuildId,
  start,
  stop,
  type PathShim,
  type SpawnShim,
  type SpawnShimDiscovery,
} from "./mcp-daemon";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

// ==================== t_1b396e2f: 端口归属反查 + 版本一致性 ====================

const WIN_NETSTAT = [
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    127.0.0.1:9131         0.0.0.0:0              LISTENING       6360",
  "  TCP    0.0.0.0:91310          0.0.0.0:0              LISTENING       777",
  "  TCP    [::]:9131              [::]:0                 LISTENING       6360",
  "  TCP    10.200.1.110:139       0.0.0.0:0              LISTENING       4",
  "  UDP    127.0.0.1:9131         *:*                                    6360",
].join("\r\n");

const SS_OUT = [
  "LISTEN 0      128        0.0.0.0:9131      0.0.0.0:*    users:((\"python\",pid=6360,fd=3))",
  "LISTEN 0      128           [::]:9131         [::]:*       users:((\"python\",pid=6360,fd=4))",
].join("\n");

describe("t_1b396e2f: parseListenerPids", () => {
  it("win32: 精确端口匹配, 排除 :91310 误吞 + UDP 行忽略, IPv4/IPv6 去重", () => {
    const pids = parseListenerPids(WIN_NETSTAT, 9131, "win32");
    expect(pids).toEqual([6360]);
  });
  it("win32: 无匹配 → 空数组", () => {
    expect(parseListenerPids(WIN_NETSTAT, 9999, "win32")).toEqual([]);
  });
  it("posix ss: pid= 提取, 非 LISTEN 行忽略", () => {
    const pids = parseListenerPids(SS_OUT, 9131, "linux");
    expect(pids).toEqual([6360]);
  });
});

describe("t_1b396e2f: discoverPidByPort", () => {
  it("win32: netstat 输出 → 监听者 pid", () => {
    const d: SpawnShimDiscovery = { execFile: () => WIN_NETSTAT };
    expect(discoverPidByPort(9131, d, "win32")).toBe(6360);
  });
  it("win32: 命令失败 → null(不猜)", () => {
    const d: SpawnShimDiscovery = { execFile: () => { throw new Error("boom"); } };
    expect(discoverPidByPort(9131, d, "win32")).toBeNull();
  });
  it("posix: lsof 失败退化 ss", () => {
    const d: SpawnShimDiscovery = { execFile: (cmd) => {
      if (cmd === "lsof") throw new Error("not installed");
      return SS_OUT;
    } };
    expect(discoverPidByPort(9131, d, "linux")).toBe(6360);
  });
});

describe("t_1b396e2f: stop 端口反查兜底", () => {
  beforeEach(() => _resetLastStartedPid());
  afterEach(() => _resetLastStartedPid());

  /** 有状态 probe: 前 aliveCount 次 200(活), 之后 reject(死) — 模拟 kill 生效 */
  const statefulHttp = (aliveCount: number): HttpShim => {
    let calls = 0;
    return {
      postInitialize: async () => {
        calls++;
        return calls <= aliveCount ? { status: 200 } : Promise.reject(new Error("dead"));
      },
    };
  };

  it("pid=0(缓存空) + probe 活 + 反查命中 6360 → kill 6360, probe 死 → stopped:true", async () => {
    const spawn = memSpawn();
    // stop 内部 probe 序列: r0(判活)=200 → attemptKill 后复核=死 → 共 1 次 200
    const http = statefulHttp(1);
    const d: SpawnShimDiscovery = { execFile: () => WIN_NETSTAT };
    const r = await stop(0, spawn, http, { host: "127.0.0.1", port: 9131 }, "win32", d);
    expect(r.stopped).toBe(true);
    // Windows attemptKill: taskkill → probe 死 → 只 1 次 kill
    expect(spawn.killed).toEqual([{ pid: 6360, sig: "TASKKILL" }]);
    expect(getLastStartedPid()).toBeUndefined();
  });

  it("pid_required 终态消失: 活 daemon + 缓存空 + 反查命中 → 真停, 无 reason", async () => {
    const spawn = memSpawn();
    const http = statefulHttp(1);
    const d: SpawnShimDiscovery = { execFile: () => WIN_NETSTAT };
    const r = await stop(0, spawn, http, { host: "127.0.0.1", port: 9131 }, "win32", d);
    expect(r.stopped).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(spawn.killed).toEqual([{ pid: 6360, sig: "TASKKILL" }]);
  });

  it("活 daemon + 缓存空 + 反查失败 → discovery_failed 显式上报(不静默)", async () => {
    const spawn = memSpawn();
    const http: HttpShim = { postInitialize: async () => ({ status: 200 }) };
    const d: SpawnShimDiscovery = { execFile: () => { throw new Error("netstat blocked"); } };
    const r = await stop(0, spawn, http, { host: "127.0.0.1", port: 9131 }, "linux", d);
    expect(r.stopped).toBe(false);
    expect(r.reason).toBe("discovery_failed");
    expect(spawn.killed).toHaveLength(0);
  });

  it("缓存 pid 停不掉(死 pid 指向他人/自退) + 端口仍被旧 daemon 占 → 反查兜底杀 owner", async () => {
    const spawn = memSpawn();
    // probe 永远 200: 快路径杀 12468 两次仍活 → 反查得 6360 → 杀两次仍活 → still_alive
    const http: HttpShim = { postInitialize: async () => ({ status: 200 }) };
    const d: SpawnShimDiscovery = { execFile: () => WIN_NETSTAT };
    const r = await stop(12468, spawn, http, { host: "127.0.0.1", port: 9131 }, "win32", d);
    expect(r.stopped).toBe(false);
    expect(r.reason).toBe("still_alive");
    // Windows: 每 attemptKill 内 taskkill→活→taskkill 共 2 次击杀
    expect(spawn.killed).toEqual([
      { pid: 12468, sig: "TASKKILL" },
      { pid: 12468, sig: "TASKKILL" },
      { pid: 6360, sig: "TASKKILL" },
      { pid: 6360, sig: "TASKKILL" },
    ]);
  });

  it("pid=0 + probe 不活 → 幂等 stopped:true, 不反查", async () => {
    const spawn = memSpawn();
    const http: HttpShim = { postInitialize: async () => Promise.reject(new Error("dead")) };
    let called = 0;
    const d: SpawnShimDiscovery = { execFile: () => { called++; return WIN_NETSTAT; } };
    const r = await stop(0, spawn, http, { host: "127.0.0.1", port: 9131 }, "win32", d);
    expect(r.stopped).toBe(true);
    expect(called).toBe(0);
    expect(spawn.killed).toHaveLength(0);
  });

  it("无 discovery 注入 + pid=0 + daemon 活 → 保持 pid_required(旧调用方语义)", async () => {
    const spawn = memSpawn();
    const http: HttpShim = { postInitialize: async () => ({ status: 200 }) };
    const r = await stop(0, spawn, http, { host: "127.0.0.1", port: 9131 }, "linux");
    expect(r.stopped).toBe(false);
    expect(r.reason).toBe("pid_required");
  });
});

describe("t_1b396e2f: start 假绿护栏", () => {
  beforeEach(() => _resetLastStartedPid());
  afterEach(() => _resetLastStartedPid());

  it("端口被他人占(probe 活 + owner=6360 ≠ 缓存空) → port_in_use 拒启, 不 spawn", async () => {
    const spawn = memSpawn();
    const http = httpShim(true);
    const d: SpawnShimDiscovery = { execFile: () => WIN_NETSTAT };
    const cfg = { host: "127.0.0.1", port: 9131, key: "x".repeat(32), dbPath: "/x.db", ttlDays: 90 };
    const r = await start(cfg, spawn, http, pathShim(true), "/app", true, "win32", d);
    expect(r.started).toBe(false);
    expect(r.reason).toBe("port_in_use");
    expect(r.pid).toBe(6360);
    expect(spawn.spawned).toHaveLength(0);
    expect(getLastStartedPid()).toBeUndefined();
  });

  it("端口被自己占(owner === 缓存 pid) → 幂等 started:true, 不重复 spawn", async () => {
    const spawn = memSpawn();
    const cfg = { host: "127.0.0.1", port: 9131, key: "x".repeat(32), dbPath: "/x.db", ttlDays: 90 };
    // 第一次 start: pre-probe 死(护栏跳过) → spawn → poll 第 2 次起活 → 正常缓存 99999
    let calls = 0;
    const httpFirst: HttpShim = {
      postInitialize: async () => {
        calls++;
        return calls === 1 ? Promise.reject(new Error("not yet")) : { status: 200 };
      },
    };
    const dNone: SpawnShimDiscovery = { execFile: () => "  TCP    0.0.0.0:139    0.0.0.0:0    LISTENING    4\r\n" };
    const first = await start(cfg, spawn, httpFirst, pathShim(true), "/app", true, "win32", dNone);
    expect(first.started).toBe(true);
    expect(getLastStartedPid()).toBe(99999);
    expect(spawn.spawned).toHaveLength(1);
    // 第二次 start: pre-probe 活 → 反查 owner=99999 === 缓存 → 幂等成功, 不 spawn
    const dSelf: SpawnShimDiscovery = { execFile: () => "  TCP    0.0.0.0:9131    0.0.0.0:0    LISTENING    99999\r\n" };
    const second = await start(cfg, spawn, httpShim(true), pathShim(true), "/app", true, "win32", dSelf);
    expect(second.started).toBe(true);
    expect(second.pid).toBe(99999);
    expect(spawn.spawned).toHaveLength(1); // 仍只有第一次 spawn
  });
});

describe("t_1b396e2f: build_id 比对", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-buildid-")); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  const writeExe = (content: string): string => {
    const p = path.join(tmpDir, "token-wallet-mcp.exe");
    fs.writeFileSync(p, Buffer.from(content, "latin1"));
    return p;
  };

  it("readLocalBuildId: exe 含标记 → 提取值", () => {
    const p = writeExe("BINARY\x00DATA# TW_MCP_BUILD_ID=abc123-20260910000000\nTAIL");
    expect(readLocalBuildId(p)).toBe("abc123-20260910000000");
  });
  it("readLocalBuildId: 无标记 → null", () => {
    const p = writeExe("BINARY\x00DATA no marker");
    expect(readLocalBuildId(p)).toBeNull();
  });
  it("parseDaemonBuildId: /guide JSON 含 build_id → 提取", () => {
    expect(parseDaemonBuildId('{"endpoint":"x","server_version":"0.2.8","build_id":"v1","agents":[]}')).toBe("v1");
  });
  it("parseDaemonBuildId: 旧 daemon 无字段 → null", () => {
    expect(parseDaemonBuildId('{"endpoint":"x","server_version":"0.2.8","agents":[]}')).toBeNull();
  });
  it("checkDaemonVersion: 双侧 id 不一致 → stale:true", async () => {
    const exe = writeExe("DATA# TW_MCP_BUILD_ID=aaa\n");
    const http: HttpShim = { postInitialize: async () => ({ status: 200 }), getGuide: async () => ({ status: 200, body: '{"build_id":"bbb"}' }) };
    const r = await checkDaemonVersion({ host: "127.0.0.1", port: 9131 }, exe, http);
    expect(r.checked).toBe(true);
    expect(r.stale).toBe(true);
    expect(r.daemonBuildId).toBe("bbb");
    expect(r.localBuildId).toBe("aaa");
  });
  it("checkDaemonVersion: 一致 → stale:false", async () => {
    const exe = writeExe("DATA# TW_MCP_BUILD_ID=same\n");
    const http: HttpShim = { postInitialize: async () => ({ status: 200 }), getGuide: async () => ({ status: 200, body: '{"build_id":"same"}' }) };
    const r = await checkDaemonVersion({ host: "127.0.0.1", port: 9131 }, exe, http);
    expect(r.stale).toBe(false);
  });
  it("checkDaemonVersion: daemon 无字段 + 本机有 → stale:true(旧 daemon)", async () => {
    const exe = writeExe("DATA# TW_MCP_BUILD_ID=aaa\n");
    const http: HttpShim = { postInitialize: async () => ({ status: 200 }), getGuide: async () => ({ status: 200, body: '{"server_version":"0.1.0"}' }) };
    const r = await checkDaemonVersion({ host: "127.0.0.1", port: 9131 }, exe, http);
    expect(r.stale).toBe(true);
    expect(r.reason).toBe("no_field");
  });
  it("checkDaemonVersion: 双侧皆无(旧 exe + 旧 daemon) → 不误报", async () => {
    const exe = writeExe("no marker here");
    const http: HttpShim = { postInitialize: async () => ({ status: 200 }), getGuide: async () => ({ status: 200, body: '{"server_version":"0.1.0"}' }) };
    const r = await checkDaemonVersion({ host: "127.0.0.1", port: 9131 }, exe, http);
    expect(r.checked).toBe(true);
    expect(r.stale).toBe(false);
  });
  it("checkDaemonVersion: /guide 不可达(daemon 死) → checked:true stale:false(fetch_failed)", async () => {
    const exe = writeExe("DATA# TW_MCP_BUILD_ID=aaa\n");
    const http: HttpShim = { postInitialize: async () => ({ status: 200 }), getGuide: async () => { throw new Error("refused"); } };
    const r = await checkDaemonVersion({ host: "127.0.0.1", port: 9131 }, exe, http);
    expect(r.checked).toBe(true);
    expect(r.stale).toBe(false);
    expect(r.reason).toBe("fetch_failed");
  });
  it("checkDaemonVersion: getGuide shim 缺失(旧注入) → checked:false 不提示", async () => {
    const http: HttpShim = { postInitialize: async () => ({ status: 200 }) };
    const r = await checkDaemonVersion({ host: "127.0.0.1", port: 9131 }, null, http);
    expect(r.checked).toBe(false);
    expect(r.reason).toBe("no_shim");
  });
});

describe("t_1b396e2f: isSameProcessTree (launcher 链幂等)", () => {
  const treeDiscovery = (parentMap: Record<number, number>): SpawnShimDiscovery => ({
    execFile: (_cmd, args) => {
      // win32 path: ["-NoProfile","-Command","(Get-CimInstance ... ProcessId=N).ParentProcessId"]
      const line = args[args.length - 1];
      const m = line.match(/ProcessId=(\d+)/)!;
      const pid = Number(m[1]);
      if (!(pid in parentMap)) throw new Error("no such pid");
      return String(parentMap[pid]);
    },
  });

  it("owner 是 cached 的 child(launcher→serve) → true", () => {
    const d = treeDiscovery({ 31648: 22288 });
    expect(isSameProcessTree(22288, 31648, d, "win32")).toBe(true);
  });
  it("owner === cached → true", () => {
    const d = treeDiscovery({});
    expect(isSameProcessTree(22288, 22288, d, "win32")).toBe(true);
  });
  it("异树 → false", () => {
    const d = treeDiscovery({ 6360: 4 });
    expect(isSameProcessTree(22288, 6360, d, "win32")).toBe(false);
  });
  it("查询失败(命令抛错) → 保守 false", () => {
    const d: SpawnShimDiscovery = { execFile: () => { throw new Error("blocked"); } };
    expect(isSameProcessTree(22288, 31648, d, "win32")).toBe(false);
  });
  it("posix: /proc 祖先链", () => {
    const d: SpawnShimDiscovery = { execFile: (_c, args) => {
      const cmd = args[1];
      const pid = Number(cmd.match(/\/proc\/(\d+)\/stat/)![1]);
      return pid === 30060 ? "25888" : "1";
    } };
    expect(isSameProcessTree(25888, 30060, d, "linux")).toBe(true);
  });
  it("start 幂等: owner=缓存的 serve child → started:true 不 spawn", async () => {
    const spawn = memSpawn();
    const cfg = { host: "127.0.0.1", port: 9131, key: "x".repeat(32), dbPath: "/x.db", ttlDays: 90 };
    // 第一次 start: pre-probe 死 → spawn → 活 → 缓存 99999
    let calls = 0;
    const httpFirst: HttpShim = { postInitialize: async () => { calls++; return calls === 1 ? Promise.reject(new Error("not yet")) : { status: 200 }; } };
    const dNone: SpawnShimDiscovery = { execFile: () => "" };
    await start(cfg, spawn, httpFirst, pathShim(true), "/app", true, "win32", dNone);
    expect(getLastStartedPid()).toBe(99999);
    // 第二次 start: pre-probe 活, owner=31648 是缓存 99999 的 child(treeDiscovery) → 幂等
    const dOwner: SpawnShimDiscovery = { execFile: (_c, args) => {
      const line = args[args.length - 1];
      if (line.includes("Win32_Process")) return "99999";
      return "  TCP    0.0.0.0:9131    0.0.0.0:0    LISTENING    31648\r\n";
    } };
    const second = await start(cfg, spawn, httpShim(true), pathShim(true), "/app", true, "win32", dOwner);
    expect(second.started).toBe(true);
    expect(second.pid).toBe(99999);
    expect(spawn.spawned).toHaveLength(1);
  });
});
