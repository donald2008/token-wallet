/**
 * auth-defs 单元测试(t_12bdc277, 2026-09-11 P0 三连):
 *   - arkParseOk 三层判据: ① JSON ok===true(1.0.23) ② JSON 含 auth_method 且无 error(1.0.27 刷新)
 *     ③ strip ANSI 后文本匹配 SSO 认证成功/同账号 SSO refresh(兜底)
 *   - stripAnsi: CSI SGR 序列剥离(arkcli 1.0.27 Rust 颜色码)
 *
 * 真机原文 fixture 来自用户 9/11 实证(卡 body 贴的原文), 不是凭据/私密信息, 可入库。
 */
import { describe, expect, it } from "vitest";
import { arkParseOk, extractJsonObjects, stripAnsi } from "./auth-defs";

describe("stripAnsi(2026-09-11, t_12bdc277 P0)", () => {
  it("剥离 SGR CSI 序列: 颜色码 + 重置码", () => {
    const raw = "\x1b[38;2;22;100;255m▶ 正在交换访问令牌…\x1b[0m";
    expect(stripAnsi(raw)).toBe("▶ 正在交换访问令牌…");
  });

  it("剥离单色 ANSI(16 色)", () => {
    expect(stripAnsi("\x1b[31m红色文字\x1b[0m")).toBe("红色文字");
  });

  it("无 ANSI 时原样返回(零误伤)", () => {
    expect(stripAnsi("纯文本")).toBe("纯文本");
    expect(stripAnsi("")).toBe("");
  });

  it("连续多个 ANSI 序列全部清掉(arkcli 1.0.27 真机每行一码)", () => {
    const raw = "\x1b[38;2;22;100;255m[arkcli]\x1b[0m \x1b[38;2;22;100;255m✓ 同账号 SSO refresh\x1b[0m";
    expect(stripAnsi(raw)).toBe("[arkcli] ✓ 同账号 SSO refresh");
  });
});

describe("arkParseOk 三层判据(t_12bdc277, 2026-09-11)", () => {
  // ① 1.0.23 老契约: JSON ok===true
  it("① 1.0.23 旧契约: {\"ok\":true} → 成功", () => {
    expect(arkParseOk('{"ok":true}')).toBe(true);
    expect(arkParseOk('前置提示\n{"ok":true}\n尾行')).toBe(true);
  });

  // ② 1.0.27 同账号 refresh 新分支(用户真机原文, 9/11 实测):
  //   ▶ 正在交换访问令牌…√ 火山 SSO 认证成功! [arkcli] ✓ 同账号 SSO refresh, profile 保留 {"auth_method": "sso_no_browser", "path": "same"}
  it("② 1.0.27 同账号 refresh: JSON 含 auth_method + 无 error → 成功(用户真机原文)", () => {
    const real1027 =
      '\x1b[38;2;22;100;255m▶ 正在交换访问令牌…\x1b[0m√ 火山 SSO 认证成功! [arkcli] ✓ 同账号 SSO refresh, profile 保留 {"auth_method": "sso_no_browser", "path": "same"}';
    expect(arkParseOk(real1027)).toBe(true);
  });

  // 反向对照关键测试(任务硬验收): 只有 auth_method、无 SSO 文本的最小 fixture
  // → 摘掉 ② 分支后此测试必红。文本兜底 ③ 不能覆盖(否则失去分层意义)
  it("② 反向对照: 最小 fixture 仅 auth_method 无 SSO 文本 → 必须命中 ② 分支成功", () => {
    const minimal = '{"auth_method":"sso_no_browser","path":"same"}';
    expect(arkParseOk(minimal)).toBe(true);
  });

  it("② 1.0.27 真失败: JSON 含 error 字段 → 失败(防止把真失败误判成功)", () => {
    expect(arkParseOk('{"ok":false,"error":{"message":"invalid code"}}')).toBe(false);
    expect(arkParseOk('{"auth_method":"sso_no_browser","error":"token expired"}')).toBe(false);
  });

  it("② 1.0.27 auth_method 为空串 → 不算成功", () => {
    expect(arkParseOk('{"auth_method":""}')).toBe(false);
  });

  // ③ 文本兜底: 文本匹配(防未来 CLI 形态再漂移, 兜底仍命中成功)
  it("③ 文本兜底: 含「√ 火山 SSO 认证成功!」文本 → 成功", () => {
    expect(arkParseOk("√ 火山 SSO 认证成功!")).toBe(true);
    expect(arkParseOk("前置日志\n√ 火山 SSO 认证成功!\n尾日志")).toBe(true);
  });

  it("③ 文本兜底: 含「✓ 同账号 SSO refresh」文本 → 成功", () => {
    expect(arkParseOk("✓ 同账号 SSO refresh, profile 保留")).toBe(true);
  });

  it("③ 文本兜底: ANSI 混排不干扰", () => {
    const raw = "\x1b[38;2;22;100;255m√ 火山 SSO 认证成功!\x1b[0m";
    expect(arkParseOk(raw)).toBe(true);
  });

  // 真失败 case(用户贴出的真实失败原文 arkcli --code <invalid>)
  it("真失败: 错误码 + 无 ok/auth_method/SSO 文本 → 失败", () => {
    expect(arkParseOk('{"ok":false}')).toBe(false);
    expect(arkParseOk("command failed: invalid code")).toBe(false);
    expect(arkParseOk("")).toBe(false);
  });

  // 极端 case: JSON 损坏不抛 + 不算成功
  it("JSON 损坏时跳过该对象不抛", () => {
    expect(arkParseOk("{not json}")).toBe(false);
    expect(arkParseOk('{"ok":notjson} {"ok":true}')).toBe(true); // 第二个 JSON 仍是 ok:true
  });

  // 兜底 vs JSON 优先级: JSON 命中即短路, 文本兜底不重复
  it("JSON 成功短路文本(优先级 ①/② > ③)", () => {
    expect(arkParseOk('{"ok":true}\n失败文本')).toBe(true);
  });
});

describe("extractJsonObjects(沿用, t_12bdc277 回归)", () => {
  it("提取嵌套花括号的 JSON 块", () => {
    const text = '前文 {"ok":true, "data":{"k":1}} 后文 {"auth_method":"sso_no_browser"}';
    const objs = extractJsonObjects(text);
    expect(objs).toHaveLength(2);
    expect(JSON.parse(objs[0]).ok).toBe(true);
    expect(JSON.parse(objs[1]).auth_method).toBe("sso_no_browser");
  });

  it("字符串内花括号不误判嵌套深度", () => {
    const text = '{"msg":"hello {world}"}';
    const objs = extractJsonObjects(text);
    expect(objs).toHaveLength(1);
    expect(JSON.parse(objs[0]).msg).toBe("hello {world}");
  });

  it("空文本返回空数组", () => {
    expect(extractJsonObjects("")).toEqual([]);
  });
});