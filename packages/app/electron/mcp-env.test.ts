// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  DEFAULT_MCP_ENV,
  fillDefaults,
  loadMcpEnv,
  maskKey,
  parseMcpEnv,
  regenerateKey,
  saveMcpEnv,
  serializeMcpEnv,
  type IoShim,
  type McpEnvConfig,
} from "./mcp-env";

/** 内存 IO shim: 模拟 atomic write(直接 set map) + 自动建目录 */
function memIo(): IoShim & { files: Record<string, string>; dirs: Set<string> } {
  const files: Record<string, string> = {};
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    exists: (p) => files[p] !== undefined || dirs.has(p),
    readFile: (p) => {
      if (files[p] === undefined) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    writeFileAtomic: (p, content) => {
      files[p] = content;
    },
    mkdirp: (dir) => {
      dirs.add(dir);
    },
  };
}

describe("mcp-env: serialize/parse roundtrip", () => {
  it("serialize 5 键位全在", () => {
    const cfg: McpEnvConfig = {
      TOKEN_WALLET_MCP_KEY: "a".repeat(32),
      TOKEN_WALLET_PORT: 9131,
      TOKEN_WALLET_HOST: "127.0.0.1",
      TOKEN_WALLET_DB_PATH: "~/.local/share/token-wallet/token-wallet.db",
      USAGE_TTL_DAYS: 90,
    };
    const text = serializeMcpEnv(cfg);
    expect(text).toContain("TOKEN_WALLET_MCP_KEY=" + "a".repeat(32));
    expect(text).toContain("TOKEN_WALLET_PORT=9131");
    expect(text).toContain("TOKEN_WALLET_HOST=127.0.0.1");
    expect(text).toContain("TOKEN_WALLET_DB_PATH=~/.local/share/token-wallet/token-wallet.db");
    expect(text).toContain("USAGE_TTL_DAYS=90");
  });

  it("parse 接受序列化结果往返", () => {
    const cfg: McpEnvConfig = {
      TOKEN_WALLET_MCP_KEY: "0123456789abcdef0123456789abcdef",
      TOKEN_WALLET_PORT: 9131,
      TOKEN_WALLET_HOST: "127.0.0.1",
      TOKEN_WALLET_DB_PATH: "/data/tw.db",
      USAGE_TTL_DAYS: 90,
    };
    const parsed = parseMcpEnv(serializeMcpEnv(cfg));
    expect(parsed).toEqual(cfg);
  });

  it("parse 跳过注释/空行", () => {
    const text = `
# 注释
TOKEN_WALLET_PORT=9131

TOKEN_WALLET_HOST=127.0.0.1
`;
    const p = parseMcpEnv(text);
    expect(p.TOKEN_WALLET_PORT).toBe(9131);
    expect(p.TOKEN_WALLET_HOST).toBe("127.0.0.1");
  });

  it("parse 拒绝非 32 hex 的 key", () => {
    const text = "TOKEN_WALLET_MCP_KEY=tooshort\n";
    expect(parseMcpEnv(text).TOKEN_WALLET_MCP_KEY).toBeUndefined();
  });

  it("parse 拒绝非法端口", () => {
    expect(() => parseMcpEnv("TOKEN_WALLET_PORT=99999\n")).toThrow(/非法端口/);
    expect(() => parseMcpEnv("TOKEN_WALLET_PORT=abc\n")).toThrow(/非法端口/);
  });

  it("parse 拒绝非正 TTL", () => {
    expect(() => parseMcpEnv("USAGE_TTL_DAYS=0\n")).toThrow(/非法 USAGE_TTL_DAYS/);
    expect(() => parseMcpEnv("USAGE_TTL_DAYS=-5\n")).toThrow(/非法 USAGE_TTL_DAYS/);
  });
});

describe("mcp-env: fillDefaults", () => {
  it("空对象 → 完整默认(随机 key)", () => {
    const full = fillDefaults({});
    expect(full.TOKEN_WALLET_PORT).toBe(DEFAULT_MCP_ENV.TOKEN_WALLET_PORT);
    expect(full.TOKEN_WALLET_HOST).toBe(DEFAULT_MCP_ENV.TOKEN_WALLET_HOST);
    expect(full.TOKEN_WALLET_DB_PATH).toBe(DEFAULT_MCP_ENV.TOKEN_WALLET_DB_PATH);
    expect(full.USAGE_TTL_DAYS).toBe(DEFAULT_MCP_ENV.USAGE_TTL_DAYS);
    expect(full.TOKEN_WALLET_MCP_KEY).toMatch(/^[0-9a-f]{32}$/);
    // 多次 fillDefaults 不会复用同一 key(独立性)
    const full2 = fillDefaults({});
    expect(full2.TOKEN_WALLET_MCP_KEY).not.toBe(full.TOKEN_WALLET_MCP_KEY);
  });

  it("partial 缺哪补哪", () => {
    const partial = { TOKEN_WALLET_PORT: 19131 };
    const full = fillDefaults(partial);
    expect(full.TOKEN_WALLET_PORT).toBe(19131);
    expect(full.TOKEN_WALLET_MCP_KEY).toMatch(/^[0-9a-f]{32}$/);
    expect(full.USAGE_TTL_DAYS).toBe(90);
  });
});

describe("mcp-env: load/save roundtrip", () => {
  it("load 文件不存在 → 创建并返回默认", () => {
    const io = memIo();
    const cfg = loadMcpEnv("/cfg", io);
    expect(cfg.TOKEN_WALLET_MCP_KEY).toMatch(/^[0-9a-f]{32}$/);
    expect(cfg.TOKEN_WALLET_PORT).toBe(9131);
    expect(io.files["/cfg/mcp.env"]).toBeDefined();
  });

  it("load 已有完整文件 → 解析返回", () => {
    const io = memIo();
    saveMcpEnv(
      "/cfg",
      {
        TOKEN_WALLET_MCP_KEY: "0123456789abcdef0123456789abcdef",
        TOKEN_WALLET_PORT: 9131,
        TOKEN_WALLET_HOST: "127.0.0.1",
        TOKEN_WALLET_DB_PATH: "/data/tw.db",
        USAGE_TTL_DAYS: 30,
      },
      io,
    );
    const cfg = loadMcpEnv("/cfg", io);
    expect(cfg.TOKEN_WALLET_MCP_KEY).toBe("0123456789abcdef0123456789abcdef");
    expect(cfg.USAGE_TTL_DAYS).toBe(30);
  });

  it("load 部分键位 → 内存补默认值返回(不写盘)", () => {
    const io = memIo();
    io.files["/cfg/mcp.env"] = "TOKEN_WALLET_PORT=19131\n";
    const cfg = loadMcpEnv("/cfg", io);
    expect(cfg.TOKEN_WALLET_PORT).toBe(19131);
    expect(cfg.TOKEN_WALLET_MCP_KEY).toMatch(/^[0-9a-f]{32}$/);
    // 没整体重写, 旧文件保留(让 daemon 启动失败时再 writeAll 整体落)
    expect(io.files["/cfg/mcp.env"]).toBe("TOKEN_WALLET_PORT=19131\n");
  });

  it("regenerateKey 写盘并返回新 key", () => {
    const io = memIo();
    const old = loadMcpEnv("/cfg", io);
    const newKey = regenerateKey("/cfg", io);
    expect(newKey).not.toBe(old.TOKEN_WALLET_MCP_KEY);
    expect(newKey).toMatch(/^[0-9a-f]{32}$/);
    // 文件已被新 key 覆盖
    const reread = loadMcpEnv("/cfg", io);
    expect(reread.TOKEN_WALLET_MCP_KEY).toBe(newKey);
  });
});

describe("mcp-env: maskKey", () => {
  it("32 字符 key → 4-4-4-4-末4 形态", () => {
    const key = "0123456789abcdef0123456789abcdef";
    expect(maskKey(key)).toBe("0123-••••-••••-••••-cdef");
  });
  it("短 key → 全遮罩", () => {
    expect(maskKey("abc")).toBe("•••");
  });
});

describe("mcp-env: 真盘 atomic write roundtrip", () => {
  it("在 tmpdir 写读一致", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-env-"));
    const cfg = loadMcpEnv(dir);
    expect(cfg.TOKEN_WALLET_PORT).toBe(9131);
    const reread = loadMcpEnv(dir);
    expect(reread.TOKEN_WALLET_MCP_KEY).toBe(cfg.TOKEN_WALLET_MCP_KEY);
    fs.rmSync(dir, { recursive: true });
  });
});
