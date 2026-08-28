import { mkdtemp, chmod, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CommandCredentialSource,
  CredentialNotFoundError,
  CredentialRefSchema,
  CredentialSourceRegistry,
  EnvCredentialSource,
  FileCredentialSource,
  StoreCredentialSource,
  createDefaultCredentialSources,
  type KeychainBackend,
} from "../src/credentials.js";

class MemoryKeychain implements KeychainBackend {
  private data = new Map<string, string>();
  async get(service: string, key: string) {
    return this.data.get(`${service}:${key}`) ?? null;
  }
  async set(service: string, key: string, value: string) {
    this.data.set(`${service}:${key}`, value);
  }
  async delete(service: string, key: string) {
    this.data.delete(`${service}:${key}`);
  }
}

describe("CredentialRefSchema", () => {
  it("四种 source 枚举 + 可选 key", () => {
    for (const source of ["store", "env", "file", "command"]) {
      expect(CredentialRefSchema.safeParse({ source }).success).toBe(true);
      expect(CredentialRefSchema.safeParse({ source, key: "k" }).success).toBe(true);
    }
    expect(CredentialRefSchema.safeParse({ source: "vault" }).success).toBe(false);
  });
});

describe("EnvCredentialSource", () => {
  it("读出环境变量; 未设置抛 NotFound 且不携带值", async () => {
    const src = new EnvCredentialSource({ DS_KEY: "sk-secret-value" });
    await expect(src.resolve({ source: "env", key: "DS_KEY" })).resolves.toBe(
      "sk-secret-value",
    );
    const err = await src
      .resolve({ source: "env", key: "MISSING" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CredentialNotFoundError);
    expect((err as Error).message).toContain("MISSING");
    expect((err as Error).message).not.toContain("sk-secret-value");
  });

  it("缺 key 抛错", async () => {
    const src = new EnvCredentialSource({});
    await expect(src.resolve({ source: "env" })).rejects.toThrow(/缺少 key/);
  });
});

describe("FileCredentialSource", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tw-cred-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("600 权限文件可读, 内容 trim", async () => {
    const p = join(dir, "key.txt");
    await writeFile(p, "  sk-file-value\n");
    await chmod(p, 0o600);
    const src = new FileCredentialSource();
    await expect(src.resolve({ source: "file", key: p })).resolves.toBe("sk-file-value");
  });

  it("权限过宽(644)拒绝读取", async () => {
    const p = join(dir, "open.txt");
    await writeFile(p, "sk-x");
    await chmod(p, 0o644);
    const src = new FileCredentialSource();
    await expect(src.resolve({ source: "file", key: p })).rejects.toThrow(/权限过宽/);
  });

  it("文件不存在抛 NotFound", async () => {
    const src = new FileCredentialSource();
    await expect(
      src.resolve({ source: "file", key: join(dir, "nope") }),
    ).rejects.toBeInstanceOf(CredentialNotFoundError);
  });
});

describe("CommandCredentialSource", () => {
  it("stdout 即凭据", async () => {
    const src = new CommandCredentialSource();
    await expect(
      src.resolve({ source: "command", key: "printf 'sk-from-consul'" }),
    ).resolves.toBe("sk-from-consul");
  });

  it("非零退出抛错, 超时硬切", async () => {
    const src = new CommandCredentialSource({ timeoutMs: 500 });
    await expect(
      src.resolve({ source: "command", key: "exit 1" }),
    ).rejects.toThrow(/失败/);
    await expect(
      src.resolve({ source: "command", key: "sleep 5" }),
    ).rejects.toThrow(/超时/);
  }, 10_000);
});

describe("StoreCredentialSource + Registry", () => {
  it("store 源经注入后端读写删; 默认 key", async () => {
    const backend = new MemoryKeychain();
    const src = new StoreCredentialSource(backend);
    await src.store("deepseek", "sk-store-value");
    await expect(
      src.resolve({ source: "store", key: "deepseek" }),
    ).resolves.toBe("sk-store-value");
    await src.remove("deepseek");
    await expect(
      src.resolve({ source: "store", key: "deepseek" }),
    ).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it("registry 按 source 分发; 未注册源报错; 四源工厂", async () => {
    const reg = createDefaultCredentialSources(new MemoryKeychain());
    expect(reg.get("env")).toBeDefined();
    expect(reg.get("file")).toBeDefined();
    expect(reg.get("command")).toBeDefined();
    expect(reg.get("store")).toBeDefined();

    process.env.TW_TEST_KEY = "sk-env-via-registry";
    await expect(
      reg.resolve({ source: "env", key: "TW_TEST_KEY" }),
    ).resolves.toBe("sk-env-via-registry");
    delete process.env.TW_TEST_KEY;

    await expect(reg.resolve({ source: "env", key: "NOPE" })).rejects.toBeInstanceOf(
      CredentialNotFoundError,
    );
    // 非法 ref 被 zod 拒
    await expect(reg.resolve({ source: "nope" })).rejects.toThrow();
    // 未注册源
    const empty = new CredentialSourceRegistry();
    await expect(empty.resolve({ source: "env", key: "X" })).rejects.toThrow(/未注册/);
  });
});
