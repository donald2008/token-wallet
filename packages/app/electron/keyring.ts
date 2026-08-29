/**
 * E2 主进程 safeStorage 凭据存取(D-029 钥匙串语义的 Electron 落地):
 *
 * - 加密来源: electron safeStorage(OS 级, Windows=DPAPI / macOS=Keychain / Linux=libsecret),
 *   main.ts 注入真实现; 本文件零 electron 依赖, node vitest 用 AES-256-GCM fake 单测(仿 persist.ts)
 * - 写路径: encryptString → `<dataDir>/secrets/<ref>.blob`(tmp + fsync + rename 原子写,
 *   复用 persist.ts 的断电语义), 文件 0600 / 目录 0700
 * - 读路径: 读文件 → decryptString; 条目不存在返回 null(与 renderer keyringGet 契约一致)
 * - 删除纪律(D-029): 删实例同步删 blob; 条目不存在时 delete 幂等不报错
 * - 每次操作前检查 isEncryptionAvailable(), 不可用抛结构化显式错误,
 *   绝不静默降级为明文; secret 任何时刻不得明文落盘或写入日志
 * - blob 文件名 = encodeURIComponent(service:key), ':' 与 '/' 被转义,
 *   Windows 文件系统合法且天然防路径穿越; 内容为密文 Buffer, 非 utf8
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** safeStorage 最小面(与 electron SafeStorage 的用到的子集同形, 供测试注入) */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** 诊断信息(OS 后端名); electron 由 getSelectedStorageBackend 提供, 测试可注常量 */
  getSelectedBackendName(): string;
}

/** safeStorage 不可用的结构化显式错误(调用方按 message 前缀识别, 不静默降级) */
export function encryptionUnavailableError(backend: string): Error {
  return new Error(
    `safeStorage 不可用(backend=${backend}): 无法加密落盘凭据, 拒绝明文降级(D-029)`,
  );
}

export function secretsDirPath(dataDir: string): string {
  return path.join(dataDir, "secrets");
}

/** blob 路径; encodeURIComponent 使 ':'/'%' 等在 Win 文件名合法且防穿越 */
export function blobPath(dataDir: string, service: string, key: string): string {
  const ref = `${service}:${key}`;
  return path.join(secretsDirPath(dataDir), `${encodeURIComponent(ref)}.blob`);
}

/** 目录收权(0700): 已存在时也再 chmod 一次, 防历史目录权限过宽 */
function ensureSecretsDir(dataDir: string): void {
  const dir = secretsDirPath(dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* 个别文件系统(如部分挂载盘)不支持 chmod → 不阻塞, 依赖目录默认权限 */
  }
}

function assertEncryptionAvailable(safeStorage: SafeStorageLike): void {
  let available = false;
  try {
    available = safeStorage.isEncryptionAvailable();
  } catch {
    available = false;
  }
  if (!available) {
    throw encryptionUnavailableError(safeStorage.getSelectedBackendName());
  }
}

/** 原子写密文(tmp + fsync + rename 覆盖, 与 persist.ts 同断电语义); 严禁 remove-then-rename */
function atomicWriteBlob(filePath: string, contents: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* 同上, chmod 不支持不阻塞 */
  }
}

/** 存 secret: 加密 → 原子落盘。任何失败向上抛(IPC 层转结构化错误), 不静默 */
export function setSecret(
  safeStorage: SafeStorageLike,
  dataDir: string,
  service: string,
  key: string,
  value: string,
): void {
  assertEncryptionAvailable(safeStorage);
  ensureSecretsDir(dataDir);
  const encrypted = safeStorage.encryptString(value);
  atomicWriteBlob(blobPath(dataDir, service, key), encrypted);
}

/** 读 secret: 条目不存在 → null; 存在但解密失败 → 抛错(fail-fast, 不静默) */
export function getSecret(
  safeStorage: SafeStorageLike,
  dataDir: string,
  service: string,
  key: string,
): string | null {
  assertEncryptionAvailable(safeStorage);
  let blob: Buffer;
  try {
    blob = fs.readFileSync(blobPath(dataDir, service, key));
  } catch {
    return null; // 条目不存在(keyring 契约: null = 无条目)
  }
  return safeStorage.decryptString(blob);
}

/** 删 secret blob(D-029 删除纪律): 不存在时幂等 no-op */
export function deleteSecret(
  safeStorage: SafeStorageLike,
  dataDir: string,
  service: string,
  key: string,
): void {
  assertEncryptionAvailable(safeStorage);
  fs.rmSync(blobPath(dataDir, service, key), { force: true });
}
