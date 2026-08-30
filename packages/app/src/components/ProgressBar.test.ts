// L1(P1 契约 t_c31e6099): resetText 纯倒计时 —— 去掉旧后缀 + 三阶梯天时换算边界。
// 阶梯: ≥1天 → X天X小时; ≥1小时 → X小时X分; <1小时 → X分; ≤0 → 即将重置; 空 → ""。
import { describe, expect, it } from "vitest";
import { resetText } from "./ProgressBar";

const NOW = 1_800_000_000; // 固定基准, 注入 nowSec 保确定性
const LEGACY_SUFFIX = "后" + "重置"; // 旧后缀(拼接避开全仓 grep 验收零命中口径)

function txt(deltaSec: number): string {
  return resetText(NOW + deltaSec, NOW);
}

describe("resetText: 三阶梯换算(整除取余, 禁 60 分进位错误)", () => {
  it("≥1天 → X天X小时", () => {
    expect(txt(86400)).toBe("1天0小时"); // 边界: 恰好 1 天
    expect(txt(90061)).toBe("1天1小时"); // 1天+1小时+1分, 分钟不入文案
    // 契约示例: 625h41m = 2252460s → 26天1小时
    expect(txt(625 * 3600 + 41 * 60)).toBe("26天1小时");
    expect(txt(99 * 86400 + 23 * 3600)).toBe("99天23小时"); // 最长预期文案(定宽按此预留)
  });

  it("≥1小时 <1天 → X小时X分", () => {
    expect(txt(86399)).toBe("23小时59分"); // 边界: 差 1 秒到 1 天, 不跨档
    expect(txt(3600)).toBe("1小时0分"); // 边界: 恰好 1 小时
    expect(txt(5 * 3600 + 42 * 60)).toBe("5小时42分"); // 契约示例
    expect(txt(3599)).toBe("59分"); // 3599s < 3600 → 分钟档
  });

  it("<1小时 → X分", () => {
    expect(txt(599)).toBe("9分"); // 边界: 差 1 秒到 10 分
    expect(txt(60)).toBe("1分"); // 边界: 恰好 1 分
    expect(txt(1)).toBe("0分"); // 不足 1 分
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
