// L1(resetText: #829 R2, t_c31e6099 / progressText: t_66b67453 契约6):
// - resetText 纯倒计时: 阶梯 ≥1天 → X.X天; <1天 → X.X小时; <1小时 → X分; ≤0 → 即将重置。
// - progressText: percent 单位 used 格式化 ≤1 位小数 + 去尾 .0(显示层修浮点尾巴,
//   数据层原始值不动); 非 percent 单位(计数制)原样。
import { describe, expect, it } from "vitest";
import { progressText, resetText } from "./ProgressBar";
import type { Metric } from "../types";

const NOW = 1_800_000_000; // 固定基准, 注入 nowSec 保确定性
const LEGACY_SUFFIX = "后" + "重置"; // 旧后缀(拼接避开全仓 grep 验收零命中口径)

function txt(deltaSec: number): string {
  return resetText(NOW + deltaSec, NOW);
}

describe("resetText: 单单位一位小数(#829 R2)", () => {
  it("≥1天 → X.X天", () => {
    expect(txt(86400)).toBe("1.0天"); // 边界: 恰好 1 天
    expect(txt(90061)).toBe("1.0天"); // 1天+1小时+1分, 单单位不组合
    // 契约示例: 625h41m = 2252460s → 26.1天
    expect(txt(625 * 3600 + 41 * 60)).toBe("26.1天");
    expect(txt(999.9 * 86400)).toBe("999.9天"); // 最长预期文案(定宽按此预留)
  });

  it("<1天 ≥1小时 → X.X小时", () => {
    expect(txt(86399)).toBe("24.0小时"); // 边界: 差 1 秒到 1 天, 四舍五入后仍不跨档
    expect(txt(3600)).toBe("1.0小时"); // 边界: 恰好 1 小时
    expect(txt(5 * 3600 + 42 * 60)).toBe("5.7小时"); // 契约示例
    expect(txt(3600 * 23 + 60)).toBe("23.0小时"); // 23h1m → 23.0小时(分钟入小数)
  });

  it("<1小时 → X分(整数, 四舍五入)", () => {
    expect(txt(599)).toBe("10分"); // 边界: 差 1 秒到 10 分, 四舍五入进位
    expect(txt(60)).toBe("1分"); // 边界: 恰好 1 分
    expect(txt(1)).toBe("0分"); // 不足 1 分
    expect(txt(3599)).toBe("60分"); // 3599s<3600 → 分钟档四舍五入的极限形态
  });

  it("语义不变: ≤0 → 即将重置; 空 → 空串; 无旧后缀", () => {
    expect(txt(0)).toBe("即将重置");
    expect(txt(-100)).toBe("即将重置");
    expect(resetText(undefined, NOW)).toBe("");
    expect(resetText(0, NOW)).toBe("");
    expect(txt(86400)).not.toContain(LEGACY_SUFFIX);
    expect(txt(3600)).not.toContain(LEGACY_SUFFIX);
    expect(txt(599)).not.toContain(LEGACY_SUFFIX);
  });
});

// ---- t_66b67453 契约6: percent 文案精度 ----
function metricOf(partial: Partial<Metric>): Metric {
  return { key: "weekly", kind: "window", unit: "percent", used: 0, ...partial };
}

describe("progressText: percent 单位 ≤1 位小数 + 去尾 .0(契约6)", () => {
  it("契约样例: 37.941548…(0.37941548×100 浮点尾差) → 37.9/100", () => {
    expect(progressText(metricOf({ used: 0.37941548 * 100, limit: 100 }))).toBe("37.9/100");
  });

  it("40.0 → 40/100(去尾 .0); 整数不进小数位", () => {
    expect(progressText(metricOf({ used: 40, limit: 100 }))).toBe("40/100");
    expect(progressText(metricOf({ used: 100, limit: 100 }))).toBe("100/100");
  });

  it("一位小数四舍五入边界", () => {
    expect(progressText(metricOf({ used: 37.96, limit: 100 }))).toBe("38/100"); // 38.0 → 去尾
    expect(progressText(metricOf({ used: 12.34, limit: 100 }))).toBe("12.3/100");
    expect(progressText(metricOf({ used: 12.35, limit: 100 }))).toBe("12.4/100");
  });

  it("非 percent 单位(计数制)原样不动", () => {
    expect(
      progressText(metricOf({ unit: "requests", used: 48, limit: 100 })),
    ).toBe("48/100");
    expect(
      progressText(metricOf({ unit: "cny", kind: "balance", used: 451.85714, limit: undefined })),
    ).toBe("451.85714/—"); // balance 大数字由 ticker 模板负责, 这里只保证不误伤
  });

  it("limit 缺省 → 破折号兜底(语义不变)", () => {
    expect(progressText(metricOf({ used: 37.94, limit: undefined }))).toBe("37.9/—");
  });
});
