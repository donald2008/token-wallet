/**
 * MCP daemon 配置文件 mcp.env 读写(D-055):
 * - 路径 = storagePaths().configDir/mcp.env(t_4bd214de 卡体钉死 ~/.config/token-wallet/mcp.env,
 *   与 storagePaths().configDir 派生结果在 Linux/macOS/Windows 三平台一致: Roaming 或 XDG_CONFIG_HOME
 *   都等效 ~/.config, 见 paths.ts 注释)
 * - 5 个键位由卡体定稿(TOKEN_WALLET_MCP_KEY / PORT / HOST / DB_PATH / USAGE_TTL_DAYS),
 *   不增不减
 * - 32hex key 由 randomBytes 生成; 第一次读不到/键位缺失 → 启动时自动生成 + atomic 写盘
 *   (按 D-019 配置侧一致: 目录原子写)
 * - 纯逻辑无 electron 依赖, 注入 file reader/writer/path 便于 node vitest 单测
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

export interface McpEnvConfig {
  TOKEN_WALLET_MCP_KEY: string;
  TOKEN_WALLET_PORT: number;
  TOKEN_WALLET_HOST: string;
  TOKEN_WALLET_DB_PATH: string;
  USAGE_TTL_DAYS: number;
}

export const DEFAULT_MCP_ENV: Omit<McpEnvConfig, "TOKEN_WALLET_MCP_KEY"> & {
  TOKEN_WALLET_MCP_KEY: () => string;
} = {
  TOKEN_WALLET_MCP_KEY: () => randomBytes(16).toString("hex"), // 32 hex
  TOKEN_WALLET_PORT: 9131,
  TOKEN_WALLET_HOST: "127.0.0.1",
  TOKEN_WALLET_DB_PATH: "~/.local/share/token-wallet/token-wallet.db",
  USAGE_TTL_DAYS: 90,
};

/** INI 序列化 — 简化版(本项目只这 5 个键, 无 section, 不引第三方 INI 库) */
export function serializeMcpEnv(cfg: McpEnvConfig): string {
  return [
    `# token-wallet MCP daemon 配置(自动生成, 不要手改)`,
    `# 路径参考: docs/DESIGN.md §MCP 服务区`,
    `TOKEN_WALLET_MCP_KEY=${cfg.TOKEN_WALLET_MCP_KEY}`,
    `TOKEN_WALLET_PORT=${cfg.TOKEN_WALLET_PORT}`,
    `TOKEN_WALLET_HOST=${cfg.TOKEN_WALLET_HOST}`,
    `TOKEN_WALLET_DB_PATH=${cfg.TOKEN_WALLET_DB_PATH}`,
    `USAGE_TTL_DAYS=${cfg.USAGE_TTL_DAYS}`,
    "",
  ].join("\n");
}

/** INI 解析 — 跳过注释/空行, key=value, value trim; 非法整数端口/天数 → 抛(主进程上抛 IPC reject) */
export function parseMcpEnv(text: string): Partial<McpEnvConfig> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  const result: Partial<McpEnvConfig> = {};
  if (typeof out.TOKEN_WALLET_MCP_KEY === "string" && /^[0-9a-f]{32,64}$/i.test(out.TOKEN_WALLET_MCP_KEY)) {
    result.TOKEN_WALLET_MCP_KEY = out.TOKEN_WALLET_MCP_KEY;
  }
  if (typeof out.TOKEN_WALLET_PORT === "string") {
    const n = Number(out.TOKEN_WALLET_PORT);
    if (Number.isInteger(n) && n > 0 && n < 65536) result.TOKEN_WALLET_PORT = n;
    else throw new Error(`mcp.env: 非法端口 ${out.TOKEN_WALLET_PORT}`);
  }
  if (typeof out.TOKEN_WALLET_HOST === "string" && out.TOKEN_WALLET_HOST) {
    result.TOKEN_WALLET_HOST = out.TOKEN_WALLET_HOST;
  }
  if (typeof out.TOKEN_WALLET_DB_PATH === "string" && out.TOKEN_WALLET_DB_PATH) {
    result.TOKEN_WALLET_DB_PATH = out.TOKEN_WALLET_DB_PATH;
  }
  if (typeof out.USAGE_TTL_DAYS === "string") {
    const n = Number(out.USAGE_TTL_DAYS);
    if (Number.isInteger(n) && n > 0) result.USAGE_TTL_DAYS = n;
    else throw new Error(`mcp.env: 非法 USAGE_TTL_DAYS ${out.USAGE_TTL_DAYS}`);
  }
  return result;
}

/** 补齐缺失键位(默认 key 随机生成), 返回完整 cfg */
export function fillDefaults(partial: Partial<McpEnvConfig>): McpEnvConfig {
  return {
    TOKEN_WALLET_MCP_KEY: partial.TOKEN_WALLET_MCP_KEY ?? DEFAULT_MCP_ENV.TOKEN_WALLET_MCP_KEY(),
    TOKEN_WALLET_PORT: partial.TOKEN_WALLET_PORT ?? DEFAULT_MCP_ENV.TOKEN_WALLET_PORT,
    TOKEN_WALLET_HOST: partial.TOKEN_WALLET_HOST ?? DEFAULT_MCP_ENV.TOKEN_WALLET_HOST,
    TOKEN_WALLET_DB_PATH: partial.TOKEN_WALLET_DB_PATH ?? DEFAULT_MCP_ENV.TOKEN_WALLET_DB_PATH,
    USAGE_TTL_DAYS: partial.USAGE_TTL_DAYS ?? DEFAULT_MCP_ENV.USAGE_TTL_DAYS,
  };
}

/**
 * 读 mcp.env — 不存在/解析失败 → 用默认值创建文件并返回完整 cfg
 * 解析存在但缺键位 → 不写, 内存补默认值返回(读侧稳健, 启动失败时再 writeAll 整体落)
 */
export interface IoShim {
  exists: (p: string) => boolean;
  readFile: (p: string) => string;
  writeFileAtomic: (p: string, content: string) => void;
  mkdirp: (dir: string) => void;
}

export function defaultIoShim(): IoShim {
  return {
    exists: (p) => fs.existsSync(p),
    readFile: (p) => fs.readFileSync(p, "utf8"),
    writeFileAtomic: (p, content) => atomicWriteText(p, content),
    mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
  };
}

/** Atomic write text — 写到 tmp + rename(D-019 同款, 见 persist.ts atomicWrite) */
export function atomicWriteText(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function loadMcpEnv(configDir: string, io: IoShim = defaultIoShim()): McpEnvConfig {
  const filePath = path.join(configDir, "mcp.env");
  if (!io.exists(filePath)) {
    const full = fillDefaults({});
    io.writeFileAtomic(filePath, serializeMcpEnv(full));
    return full;
  }
  let text: string;
  try {
    text = io.readFile(filePath);
  } catch {
    // 读失败(权限/损坏)→ 用默认值重建(用户失去旧 key, 但 daemon 反正要重启)
    const full = fillDefaults({});
    io.writeFileAtomic(filePath, serializeMcpEnv(full));
    return full;
  }
  let parsed: Partial<McpEnvConfig>;
  try {
    parsed = parseMcpEnv(text);
  } catch {
    // 解析失败 → 重建(同上)
    const full = fillDefaults({});
    io.writeFileAtomic(filePath, serializeMcpEnv(full));
    return full;
  }
  return fillDefaults(parsed);
}

/** 整体写回 mcp.env — 改 key 或改 host/port/dbpath/ttl 用 */
export function saveMcpEnv(configDir: string, cfg: McpEnvConfig, io: IoShim = defaultIoShim()): void {
  const filePath = path.join(configDir, "mcp.env");
  io.mkdirp(path.dirname(filePath));
  io.writeFileAtomic(filePath, serializeMcpEnv(cfg));
}

/** 仅生成新 key 并写盘; 返回新 key 明文(用于 UI 一次展示 + toast, 之后只显示遮罩) */
export function regenerateKey(configDir: string, io: IoShim = defaultIoShim()): string {
  const current = loadMcpEnv(configDir, io);
  const newKey = randomBytes(16).toString("hex");
  saveMcpEnv(configDir, { ...current, TOKEN_WALLET_MCP_KEY: newKey }, io);
  return newKey;
}

/** 把 key 折叠成 4-4-4-...-4-末4, 用于 UI 遮罩(避免整串明文常显) */
export function maskKey(key: string): string {
  if (key.length <= 12) return "•".repeat(key.length);
  return `${key.slice(0, 4)}-••••-••••-••••-${key.slice(-4)}`;
}
