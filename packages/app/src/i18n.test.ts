import { describe, expect, it } from "vitest";
import { t, getLang, setLang, setCurrentLang, tKey, LANGS } from "./i18n";

describe("i18n 字典骨架", () => {
  it("缺省语言 = zh(既有文案原样搬)", () => {
    // localStorage 干净的 node 环境 → zh
    setCurrentLang("zh");
    expect(getLang()).toBe("zh");
    expect(t("badge.ok")).toBe("健康");
    expect(t("filter.available")).toBe("可用");
  });

  it("setLang 切 en: 同键返回英文文案", () => {
    setLang("en");
    expect(getLang()).toBe("en");
    expect(t("badge.ok")).toBe("OK");
    expect(t("card.confirmDelete")).toBe("Delete and clear keychain?");
    setLang("zh");
  });

  it("插值: {name} 占位符替换; 缺参保留占位", () => {
    setCurrentLang("zh");
    expect(t("card.deleteNamed", { name: "DeepSeek-按量 #1" })).toBe("删除 DeepSeek-按量 #1");
    expect(t("card.deleteNamed")).toContain("{name}");
    expect(t("ago.minutes", { n: 5 })).toBe("5 分钟前");
    expect(t("tpl.granted", { amount: "¥0" })).toBe("赠送 ¥0");
  });

  it("en 插值形态", () => {
    setLang("en");
    expect(t("card.deleteNamed", { name: "x" })).toBe("Delete x");
    expect(t("tray.countBadge", { count: 2, label: "OK" })).toBe("2 OK");
    setLang("zh");
    expect(t("tray.countBadge", { count: 2, label: "健康" })).toBe("2健康");
  });

  it("未知键回退: zh → 键名原样(不抛错)", () => {
    setCurrentLang("en");
    // tKey 接受任意串(运行时动态拼键场景), 未知键回退 zh 再回退键名
    expect(tKey("nope.missing")).toBe("nope.missing");
    setCurrentLang("zh");
  });

  it("LANGS 固定 zh+en", () => {
    expect(LANGS).toEqual(["zh", "en"]);
  });
});
