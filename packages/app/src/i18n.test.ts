import { describe, expect, it } from "vitest";
import { t, getLang, setLang, setCurrentLang, tKey, LANGS } from "./i18n";
import * as i18nModule from "./i18n";

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

/** t_36b7ecb1 SL-04: zh/en 结构性零缺漏断言。
 * Dict = typeof zh 只在编译期兜底; 本测试在运行时锁死 zh/en 叶键路径集合全等,
 * 防止后续卡片绕过类型检查(如 as any / 动态拼键)漏补 en。 */
describe("i18n 结构性断言(zh/en key 零缺漏)", () => {
  /** 递归收集字典叶键路径(值为 string 的节点) */
  function leafPaths(dict: unknown, prefix = ""): string[] {
    if (typeof dict !== "object" || dict === null) return [];
    const out: string[] = [];
    for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") out.push(p);
      else out.push(...leafPaths(v, p));
    }
    return out.sort();
  }

  it("zh/en 叶键路径集合全等(零缺漏)", () => {
    const { zh, en } = i18nModule;
    const zhKeys = leafPaths(zh);
    const enKeys = leafPaths(en);
    expect(zhKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(zhKeys);
  });

  it("en 每个键都有非空文案(防漏译留空串)", () => {
    const { zh, en } = i18nModule;
    for (const path of leafPaths(zh)) {
      const segs = path.split(".");
      let node: unknown = en;
      for (const s of segs) node = (node as Record<string, unknown>)?.[s];
      expect(typeof node).toBe("string");
      expect(node as string).not.toBe("");
    }
  });

  it("dash 命名空间(大屏文案)双语抽查", () => {
    setCurrentLang("zh");
    expect(t("dash.title")).toBe("Agent 用量");
    expect(t("dash.bannerTitle")).toBe("DAEMON 未连接");
    expect(t("dash.retry")).toBe("重试");
    expect(t("dash.kpiTokens", { window: "09-12 ~ 09-18" })).toBe("Tokens · 09-12 ~ 09-18");
    setLang("en");
    expect(t("dash.title")).toBe("Agent Usage");
    expect(t("dash.bannerTitle")).toBe("DAEMON not connected");
    expect(t("dash.retry")).toBe("Retry");
    expect(t("dash.pTrend")).toBe("Trend · tokens");
    expect(t("dash.weekday.3" as never)).toBe("Wed");
    setLang("zh");
    expect(tKey("dash.weekday.3")).toBe("周三");
    expect(t("dash.fetchFailed")).toBe("数据拉取失败");
  });
});
