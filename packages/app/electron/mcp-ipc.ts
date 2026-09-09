/**
 * MCP daemon IPC 桥注册(D-048, t_4bd214de):
 * 把 mcp-env/mcp-daemon/mcp-autostart 三个纯逻辑模块挂到 ipcMain.handle。
 *
 * 7 通道: mcp_probe / mcp_start / mcp_stop / mcp_get_config / mcp_gen_key /
 *         mcp_set_autostart / mcp_get_autostart / mcp_get_guide
 *
 * 默认 shim:
 * - SpawnShim: 默认实现 spawn/killTree/wait(走 node:child_process + signal)
 * - PathShim: 默认实现 resolveDaemonPath(resources/token-wallet-mcp[.exe])
 * - HttpShim: 默认实现 fetch + AbortController(POST /mcp initialize, 卡体钉死不裸 TCP)
 * - AppShim: 注入 electron app 的 setLoginItemSettings/getLoginItemSettings;
 *   真运行时由 main.ts 注入 {setLoginItemSettings, getLoginItemSettings}; 单测注入 mock。
 */
import { ipcMain } from "electron";
import * as path from "node:path";
import {
  type HttpShim,
  type PathShim,
  type ProbeResult,
  type SpawnShim,
  defaultPathShim,
  defaultSpawnShim,
  isInstalled as isInstalledFn,
  probe as probeFn,
  start as startFn,
  stop as stopFn,
} from "./mcp-daemon";
import { loadMcpEnv, regenerateKey } from "./mcp-env";
import { readMcpAutostart, resolveOsAutostart, writeMcpAutostart } from "./mcp-autostart";
import type { StoragePaths } from "./paths";

/** electron app 的最小接口注入(单测可用 mock 替代) */
export interface AppShim {
  setLoginItemSettings(opts: { openAtLogin: boolean }): void;
  getLoginItemSettings(): { openAtLogin: boolean };
}

export interface McpIpcDeps {
  isPackaged: boolean;
  appRoot: string;
  platform: NodeJS.Platform;
  storagePathsFn: () => StoragePaths;
  settingsFilePathFn: () => string;
  app: AppShim;
  spawn?: SpawnShim;
  paths?: PathShim;
  http?: HttpShim;
}

/** 默认 fetch 实现: POST /mcp initialize + AbortController 超时, 返回 { status } */
export function defaultHttpShim(): HttpShim {
  return {
    postInitialize: async (url, timeoutMs) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          // MCP initialize envelope 最小骨架(daemon 端具体字段由 A 卡定义)
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-03-26", capabilities: {} },
          }),
          signal: ctrl.signal,
        });
        return { status: resp.status };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function registerMcpIpc(deps: McpIpcDeps): void {
  const spawn = deps.spawn ?? defaultSpawnShim();
  const paths = deps.paths ?? defaultPathShim();
  const http = deps.http ?? defaultHttpShim();
  const app = deps.app;
  const configDir = (): string => deps.storagePathsFn().configDir;

  // ---- 通道: mcp_probe ----
  ipcMain.handle("mcp_probe", async (): Promise<ProbeResult & { installed: boolean }> => {
    const installed = isInstalledFn(paths, deps.platform, deps.isPackaged, deps.appRoot);
    if (!installed) return { alive: false, reason: "unreachable", installed: false };
    const cfg = loadMcpEnv(configDir());
    const r = await probeFn({ host: cfg.TOKEN_WALLET_HOST, port: cfg.TOKEN_WALLET_PORT }, http);
    return { ...r, installed: true };
  });

  // ---- 通道: mcp_start ----
  ipcMain.handle("mcp_start", async () => {
    const cfg = loadMcpEnv(configDir());
    return startFn(
      {
        host: cfg.TOKEN_WALLET_HOST,
        port: cfg.TOKEN_WALLET_PORT,
        key: cfg.TOKEN_WALLET_MCP_KEY,
        dbPath: cfg.TOKEN_WALLET_DB_PATH,
        ttlDays: cfg.USAGE_TTL_DAYS,
      },
      spawn,
      http,
      paths,
      deps.appRoot,
      deps.isPackaged,
      deps.platform,
    );
  });

  // ---- 通道: mcp_stop ----
  // 真实 OS pid 由 mcp_start 返回, renderer 持有; 若 renderer 无 pid, stop 走
  // "无 pid 仍 probe → 不活即 ok", 否则提示 pid_required。
  ipcMain.handle(
    "mcp_stop",
    async (_event, payload: { pid?: number } | undefined): Promise<{ stopped: boolean; reason?: string }> => {
      const cfg = loadMcpEnv(configDir());
      const pid = Number(payload?.pid ?? 0);
      if (!pid) {
        const r = await probeFn(
          { host: cfg.TOKEN_WALLET_HOST, port: cfg.TOKEN_WALLET_PORT },
          http,
        );
        if (!r.alive) return { stopped: true };
        return { stopped: false, reason: "pid_required" };
      }
      return stopFn(
        pid,
        spawn,
        http,
        { host: cfg.TOKEN_WALLET_HOST, port: cfg.TOKEN_WALLET_PORT },
        deps.platform,
      );
    },
  );

  // ---- 通道: mcp_get_config ----
  // 返回 5 键位 + mcpEnvPath + installed; key 明文仅 IPC 内部用, UI 走 mcp_get_config 拿后前端 maskKey
  ipcMain.handle("mcp_get_config", async () => {
    const cfg = loadMcpEnv(configDir());
    return {
      TOKEN_WALLET_MCP_KEY: cfg.TOKEN_WALLET_MCP_KEY,
      TOKEN_WALLET_PORT: cfg.TOKEN_WALLET_PORT,
      TOKEN_WALLET_HOST: cfg.TOKEN_WALLET_HOST,
      TOKEN_WALLET_DB_PATH: cfg.TOKEN_WALLET_DB_PATH,
      USAGE_TTL_DAYS: cfg.USAGE_TTL_DAYS,
      mcpEnvPath: path.join(configDir(), "mcp.env"),
      installed: isInstalledFn(paths, deps.platform, deps.isPackaged, deps.appRoot),
    };
  });

  // ---- 通道: mcp_gen_key ----
  // 生成新 32hex key, 写盘; daemon 重启由前端持有 pid 调 mcp_stop + mcp_start
  // (后端无 pid 持有, 此通道只负责生成 + 写盘, 重启逻辑由 renderer 编排)
  ipcMain.handle("mcp_gen_key", async (): Promise<{ key: string; daemonWasRunning: boolean }> => {
    const cfg = loadMcpEnv(configDir());
    const newKey = regenerateKey(configDir());
    const probeResult = await probeFn(
      { host: cfg.TOKEN_WALLET_HOST, port: cfg.TOKEN_WALLET_PORT },
      http,
    );
    return { key: newKey, daemonWasRunning: probeResult.alive };
  });

  // ---- 通道: mcp_set_autostart ----
  // Q1 决议 B 联动: mcp 开 ⇒ app 自启也开; mcp 关 ⇒ 保持 app 原态
  ipcMain.handle("mcp_set_autostart", async (_event, payload: { enabled?: boolean }) => {
    const enabled = Boolean(payload?.enabled);
    writeMcpAutostart(deps.settingsFilePathFn(), enabled);
    const appActual = safeGetLoginItem(app);
    const osTarget = resolveOsAutostart(enabled, appActual);
    try {
      app.setLoginItemSettings({ openAtLogin: osTarget });
    } catch {
      /* 平台不支持时静默(同 D-024) */
    }
    if (osTarget !== appActual) {
      try {
        const { recordAutostart } = await import("./persist");
        recordAutostart(deps.settingsFilePathFn(), osTarget);
      } catch {
        /* 写盘失败不阻断 UI */
      }
    }
    return { mcpAutostart: enabled, osAutostart: osTarget };
  });

  // ---- 通道: mcp_get_autostart ----
  ipcMain.handle("mcp_get_autostart", async () => {
    const mcp = readMcpAutostart(deps.settingsFilePathFn());
    const appActual = safeGetLoginItem(app);
    return { mcpAutostart: mcp, osAutostart: resolveOsAutostart(mcp, appActual) };
  });

  // ---- 通道: mcp_get_guide ----
  // 调 daemon GET /guide → JSON(agents 数组); daemon 未跑 → 返回空 + reason
  ipcMain.handle("mcp_get_guide", async () => {
    const cfg = loadMcpEnv(configDir());
    const probeR = await probeFn(
      { host: cfg.TOKEN_WALLET_HOST, port: cfg.TOKEN_WALLET_PORT },
      http,
    );
    if (!probeR.alive) return { agents: [], reason: "daemon_not_running" as const };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const url = `http://${cfg.TOKEN_WALLET_HOST}:${cfg.TOKEN_WALLET_PORT}/guide`;
        const resp = await fetch(url, { signal: ctrl.signal });
        if (!resp.ok) return { agents: [], reason: "fetch_failed" as const };
        const data = (await resp.json()) as { agents?: unknown };
        return { agents: Array.isArray(data.agents) ? data.agents : [], reason: undefined };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return { agents: [], reason: "fetch_failed" as const };
    }
  });
}

function safeGetLoginItem(app: AppShim): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}
