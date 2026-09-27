// @vitest-environment node
/**
 * will-quit daemon 停止编排单测(t_d59a9ad8):
 * - true 调用 stop / false 不调用(且不碰 mcp.env 路径)
 * - daemon 没跑 → 幂等成功零 kill
 * - 超时放行(orchestrator deadline + will-quit 接线的 deadline 双层, 此处测编排层)
 * - 停止失败/异常静默(不 throw, 返回显式 reason)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { stopDaemonOnAppQuit, type McpStopOnQuitDeps } from "./mcp-quit-orchestrator";
import type { HttpShim, SpawnShim, SpawnShimDiscovery } from "./mcp-daemon";
import { _resetLastStartedPid } from "./mcp-daemon";

/** 真实 mcp.env 写入临时 configDir(走 loadMcpEnv 真解析, 不 mock 配置层) */
function makeConfigDir(opts: { port?: number } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-quit-orch-"));
  fs.writeFileSync(
    path.join(dir, "mcp.env"),
    [
      "TOKEN_WALLET_MCP_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      `TOKEN_WALLET_PORT=${opts.port ?? 19131}`,
      "TOKEN_WALLET_HOST=127.0.0.1",
      "TOKEN_WALLET_DB_PATH=/tmp/quit-orch.db",
      "USAGE_TTL_DAYS=90",
      "",
    ].join("\n"),
  );
  return dir;
}

function baseDeps(configDir: string, overrides: Partial<McpStopOnQuitDeps> = {}): McpStopOnQuitDeps {
  const spawn: SpawnShim = {
    spawn: () => ({ pid: 1, unref: () => {} }),
    killTree: vi.fn(async () => {}),
    wait: vi.fn(async () => {}),
  };
  const http: HttpShim = {
    // 缺省: probe 全死(daemon 没跑 → 幂等路径)
    postInitialize: vi.fn(async () => ({ status: 503 })),
  };
  // 缺省 discovery: 端口反查恒返 owner=777(需要 pid 解析的用例才能到达 stop 路径)
  const discovery: SpawnShimDiscovery = {
    execFile: vi.fn(() => 'LISTEN 0 128 0.0.0.0:19131 0.0.0.0:* users:(("python",pid=777,fd=3))'),
  };
  return {
    spawn,
    http,
    discovery,
    platform: "linux",
    configDir: () => configDir,
    ...overrides,
  };
}

beforeEach(() => {
  _resetLastStartedPid();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stopDaemonOnAppQuit(will-quit 编排)", () => {
  it("daemon 没跑 → 幂等成功, 零 kill", async () => {
    const dir = makeConfigDir();
    const killTree = vi.fn(async () => {});
    const postInitialize = vi.fn(async () => ({ status: 503 }));
    const r = await stopDaemonOnAppQuit(
      baseDeps(dir, { spawn: { spawn: () => ({ pid: 1, unref: () => {} }), killTree, wait: async () => {} }, http: { postInitialize } }),
    );
    expect(r.stopped).toBe(true);
    expect(killTree).not.toHaveBeenCalled();
  });

  it("daemon 活着 → 走 stop(kill 被调用), probe 复核确认后 stopped", async () => {
    const dir = makeConfigDir();
    let killed = false;
    const killTree = vi.fn(async () => {
      killed = true;
    });
    // daemon 语义: kill 前活(200), kill 后死(503)
    const postInitialize = vi.fn(async () => ({ status: killed ? 503 : 200 }));
    const r = await stopDaemonOnAppQuit(
      baseDeps(dir, {
        spawn: { spawn: () => ({ pid: 1, unref: () => {} }), killTree, wait: async () => {} },
        http: { postInitialize },
      }),
    );
    expect(r.stopped).toBe(true);
    expect(killTree).toHaveBeenCalled();
  });

  it("stop 挂起超过 deadline → 超时放行(静默, 不 throw)", async () => {
    const dir = makeConfigDir();
    // probe 判活后 stop 永远挂起(不 resolve) — deadline 必须兜住
    const never = () => new Promise<{ status: number }>(() => {});
    let first = true;
    const postInitialize = vi.fn(async () => {
      if (first) {
        first = false;
        return { status: 200 };
      }
      return never();
    });
    const r = await stopDaemonOnAppQuit(
      baseDeps(dir, {
        http: { postInitialize },
        spawn: {
          spawn: () => ({ pid: 1, unref: () => {} }),
          killTree: async () => {},
          wait: async () => {},
        },
        timeoutMs: 150,
      }),
    );
    expect(r.stopped).toBe(false);
    expect(r.reason).toBe("timeout");
  }, 5000);

  it("stop 失败(daemon 停不掉)→ 显式 stop_failed, 静默不 throw", async () => {
    const dir = makeConfigDir();
    // daemon 永远活着(kill 无效)
    const postInitialize = vi.fn(async () => ({ status: 200 }));
    const r = await stopDaemonOnAppQuit(
      baseDeps(dir, {
        http: { postInitialize },
        spawn: { spawn: () => ({ pid: 1, unref: () => {} }), killTree: async () => {}, wait: async () => {} },
        timeoutMs: 2000,
      }),
    );
    expect(r.stopped).toBe(false);
    expect(["stop_failed", "timeout"]).toContain(r.reason);
  }, 8000);

  it("mcp.env 缺失 → loadMcpEnv 兜底默认端口, probe 不活 → 幂等成功(零 kill)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-quit-empty-"));
    const killTree = vi.fn(async () => {});
    const postInitialize = vi.fn(async () => ({ status: 503 }));
    const r = await stopDaemonOnAppQuit(
      baseDeps(dir, {
        spawn: { spawn: () => ({ pid: 1, unref: () => {} }), killTree, wait: async () => {} },
        http: { postInitialize },
      }),
    );
    // loadMcpEnv 对缺文件自建默认 env(mcp-env.ts 兜底语义) → 幂等路径承接, 不 throw
    expect(r.stopped).toBe(true);
    expect(killTree).not.toHaveBeenCalled();
    expect(postInitialize).toHaveBeenCalled();
  });

  it("mcp.env 损坏(不可解析)→ 同样兜底不阻断退出", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-quit-broken-"));
    // parseMcpEnv 对畸形行宽容, 这里写超长畸形内容触达兜底(或按缺省解析), 断言不 throw 即可
    fs.writeFileSync(path.join(dir, "mcp.env"), "\x00\x01\x02garbage");
    const killTree = vi.fn(async () => {});
    const postInitialize = vi.fn(async () => ({ status: 503 }));
    const r = await stopDaemonOnAppQuit(
      baseDeps(dir, {
        spawn: { spawn: () => ({ pid: 1, unref: () => {} }), killTree, wait: async () => {} },
        http: { postInitialize },
      }),
    );
    expect(["stopped", "env_load_failed", "stop_failed", "timeout", "error"]).toContain(r.reason ?? "stopped");
    expect(killTree).not.toHaveBeenCalled();
  });

  it("discovery 注入: 无 pid 时走端口反查兜底(复用既有 stop 语义)", async () => {
    const dir = makeConfigDir();
    let killed = false;
    const killTree = vi.fn(async () => {
      killed = true;
    });
    const postInitialize = vi.fn(async () => ({ status: killed ? 503 : 200 }));
    const discovery: SpawnShimDiscovery = {
      execFile: vi.fn(() => "LISTEN 0 128 0.0.0.0:19131 0.0.0.0:* users:((\"python\",pid=777,fd=3))"),
    };
    const r = await stopDaemonOnAppQuit(
      baseDeps(dir, {
        spawn: { spawn: () => ({ pid: 1, unref: () => {} }), killTree, wait: async () => {} },
        http: { postInitialize },
        discovery,
      }),
    );
    expect(r.stopped).toBe(true);
    // stopFn 内部: pid=0 → probe 判活 → 反查 owner 777 → kill(777)
    expect(killTree).toHaveBeenCalledWith(777, "SIGTERM");
  });
});
