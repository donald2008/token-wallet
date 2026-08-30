/**
 * E1 主进程持久化单测(node vitest, D-033) — 移植 f318b3c src-tauri lib.rs
 * 尾部 #[cfg(test)] 的 3 个 Rust 测试语义, 逐条对应:
 *
 * 1. atomic_write_overwrites_existing_and_cleans_tmp (W1 真原子替换)
 * 2. consent_read_modify_write_preserves_other_fields (W2 RMW 保字段)
 * 3. consent_corrupt_settings_falls_back_to_fresh (损坏回首开态)
 *
 * 断电语义注释(与 persist.ts 文件头互证): tmp 写入 + fsync + rename 覆盖,
 * 崩溃时旧/新必居其一完整; 严禁 remove-then-rename(会制造"文件消失"窗口,
 * 被首开判定静默吞掉)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { atomicWrite, consentSettingsJson, normalizeSortConfigValue, readSettingsFile, recordAlwaysOnTop, recordConsent, recordSortConfig } from "./persist";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-electron-persist-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("atomicWrite(W1 原子写)", () => {
  it("覆盖既有文件且 tmp 不残留(真原子替换, 无 remove-then-rename)", () => {
    const file = path.join(dir, "instances.yaml");
    atomicWrite(file, "v1");
    atomicWrite(file, "v2-longer-content"); // 覆盖既有文件
    expect(fs.readFileSync(file, "utf8")).toBe("v2-longer-content");
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it("父目录不存在时自动创建(settings.json 首开写盘路径)", () => {
    const file = path.join(dir, "nested", "settings.json");
    atomicWrite(file, "{}");
    expect(fs.readFileSync(file, "utf8")).toBe("{}");
  });
});

describe("consentSettingsJson(W2 consent read-modify-write)", () => {
  it("只改 consent 两字段, 既有/前瞻字段原样保留, 往返幂等", () => {
    const existing = JSON.stringify({
      version: 1,
      consentAgreed: false,
      theme: "dark",
      pollInterval: "5m",
    });
    const out = consentSettingsJson(existing, 1_700_000_000);
    const v = JSON.parse(out) as Record<string, unknown>;
    expect(v.consentAgreed).toBe(true);
    expect(v.consentAt).toBe(1_700_000_000);
    // 前瞻字段不丢(JSON 合并透传)
    expect(v.theme).toBe("dark");
    expect(v.pollInterval).toBe("5m");
    // 往返再写一次仍不丢(幂等)
    const out2 = consentSettingsJson(out, 1_700_000_100);
    const v2 = JSON.parse(out2) as Record<string, unknown>;
    expect(v2.theme).toBe("dark");
    expect(v2.consentAt).toBe(1_700_000_100);
  });

  it("settings 损坏 → 保守回退首开态重写, 不崩应用", () => {
    const out = consentSettingsJson("{ not json", 42);
    const v = JSON.parse(out) as Record<string, unknown>;
    expect(v.consentAgreed).toBe(true);
    expect(v.consentAt).toBe(42);
  });

  it("首开(文件不存在 → existing=null) → 全新 consent 落盘", () => {
    const v = JSON.parse(consentSettingsJson(null, 7)) as Record<string, unknown>;
    expect(v).toEqual({ version: 1, consentAgreed: true, consentAt: 7 });
  });
});

describe("readSettingsFile / recordConsent 全链路", () => {
  it("record_consent 后 get_bootstrap 判定 firstRun=false(§10 首开判定接真)", () => {
    const file = path.join(dir, "settings.json");
    // 首开: 无文件 → 首开态
    expect(readSettingsFile(file).consentAgreed).toBe(false);
    recordConsent(file, 1_700_000_000);
    const settings = readSettingsFile(file);
    expect(settings.consentAgreed).toBe(true);
    expect(settings.consentAt).toBe(1_700_000_000);
  });

  it("损坏 settings.json → fail-open 回首开态(重弹 consent)", () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "{ not json", "utf8");
    expect(readSettingsFile(file).consentAgreed).toBe(false);
    // 损坏后同意一次 → 修复为合法 JSON 且 consent 落盘
    recordConsent(file, 99);
    expect(readSettingsFile(file).consentAgreed).toBe(true);
  });

  it("record_consent 保留 settings.json 未知字段(端到端 RMW)", () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, JSON.stringify({ theme: "dark", pollInterval: "5m" }), "utf8");
    recordConsent(file, 1_700_000_000);
    const settings = readSettingsFile(file);
    expect(settings.consentAgreed).toBe(true);
    expect(settings.theme).toBe("dark");
    expect(settings.pollInterval).toBe("5m");
  });
});

describe("alwaysOnTop(P1 置顶开关, autostart 同款 RMW)", () => {
  it("默认值 false: 文件不存在 / 旧文件无该字段 → false", () => {
    const file = path.join(dir, "settings.json");
    // 文件不存在(首开)
    expect(readSettingsFile(file).alwaysOnTop).toBe(false);
    // 旧版文件无 alwaysOnTop 字段 → defaultSettings 合并为 false
    fs.writeFileSync(file, JSON.stringify({ version: 1, consentAgreed: true }), "utf8");
    expect(readSettingsFile(file).alwaysOnTop).toBe(false);
  });

  it("写入 → 读回 → 应用: 往返 true/false, RMW 保留未知字段", () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, consentAgreed: true, theme: "dark", pollInterval: "5m" }),
      "utf8",
    );
    recordAlwaysOnTop(file, true);
    let settings = readSettingsFile(file);
    expect(settings.alwaysOnTop).toBe(true);
    // RMW: 既有/未知字段不丢
    expect(settings.consentAgreed).toBe(true);
    expect(settings.theme).toBe("dark");
    expect(settings.pollInterval).toBe("5m");
    // 再关一次: 往返幂等, 字段仍保留
    recordAlwaysOnTop(file, false);
    settings = readSettingsFile(file);
    expect(settings.alwaysOnTop).toBe(false);
    expect(settings.theme).toBe("dark");
  });

  it("settings 损坏 → 保守回退重写, 不崩应用", () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "{ not json", "utf8");
    recordAlwaysOnTop(file, true);
    const settings = readSettingsFile(file);
    expect(settings.alwaysOnTop).toBe(true);
  });
});

describe("sortConfig(#829 R1 卡间排序, autostart 同款 RMW)", () => {
  it("缺省: 文件不存在 / 旧文件无该字段 / 非法值 → 名称正排", () => {
    const file = path.join(dir, "settings.json");
    // 文件不存在(首开)
    expect(normalizeSortConfigValue(readSettingsFile(file).sortConfig)).toEqual({
      key: "name",
      dir: "asc",
    });
    // 旧版文件无 sortConfig 字段
    fs.writeFileSync(file, JSON.stringify({ version: 1, consentAgreed: true }), "utf8");
    expect(normalizeSortConfigValue(readSettingsFile(file).sortConfig)).toEqual({
      key: "name",
      dir: "asc",
    });
    // 脏数据(非法 key/dir) → 缺省
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, sortConfig: { key: "size", dir: "up" } }),
      "utf8",
    );
    expect(normalizeSortConfigValue(readSettingsFile(file).sortConfig)).toEqual({
      key: "name",
      dir: "asc",
    });
  });

  it("写入 → 读回: {key,dir} 整体往返, RMW 保留 consent/autostart/未知字段", () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, consentAgreed: true, autostart: true, theme: "dark" }),
      "utf8",
    );
    recordSortConfig(file, { key: "urgency", dir: "desc" });
    const settings = readSettingsFile(file);
    expect(settings.sortConfig).toEqual({ key: "urgency", dir: "desc" });
    // RMW: 既有/未知字段不丢
    expect(settings.consentAgreed).toBe(true);
    expect(settings.autostart).toBe(true);
    expect(settings.theme).toBe("dark");
  });

  it("写入非法配置 → 归一化落缺省(防脏数据入盘); settings 损坏 → 回退重写不崩", () => {
    const file = path.join(dir, "settings.json");
    recordSortConfig(file, { key: "bogus", dir: "sideways" });
    expect(readSettingsFile(file).sortConfig).toEqual({ key: "name", dir: "asc" });
    fs.writeFileSync(file, "{ not json", "utf8");
    recordSortConfig(file, { key: "urgency", dir: "asc" });
    expect(readSettingsFile(file).sortConfig).toEqual({ key: "urgency", dir: "asc" });
  });
});
