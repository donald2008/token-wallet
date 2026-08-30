// L1(#829 R1, t_c31e6099): sortProviders —— 卡间排序 key(名称|紧要度)×dir(正排|倒排) 两正交参数。
// 覆盖: 四象限 / 缺省值(名称正排) / limit 缺失卡排最后 / 同比例并列按健康度稳定 / 名称并列稳定 /
// normalizeSortConfig 非法值兜底 / sortByHealth 保留回归(urgency 次级稳定键)。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT_CONFIG,
  normalizeSortConfig,
  sortByHealth,
  sortProviders,
} from "./health";
import type { Metric, ProviderSnapshot, ProviderStatus } from "./types";

const NOW = 1_780_000_000;

function metric(used: number, limit?: number): Metric {
  return { key: "rolling_5h", kind: "window", unit: "requests", used, limit, reset_at: NOW + 3600 };
}

function snap(name: string, status: ProviderStatus = "ok", metrics: Metric[] = []): ProviderSnapshot {
  return {
    provider_id: name,
    display_name: name,
    plan_type: "window",
    fetched_at: NOW - 60,
    status,
    metrics,
    alerts: [],
  };
}

function names(list: ProviderSnapshot[]): string[] {
  return list.map((p) => p.display_name);
}

describe("sortProviders: name 键(localeCompare 自然序)", () => {
  const cards = [snap("beta"), snap("Alpha"), snap("gamma 10"), snap("gamma 2")];

  it("asc 正排(缺省默认)", () => {
    expect(names(sortProviders(cards, { key: "name", dir: "asc" }))).toEqual([
      "Alpha",
      "beta",
      "gamma 2",
      "gamma 10",
    ]);
    // 缺省 = 名称正排(无历史设置时的出厂行为)
    expect(DEFAULT_SORT_CONFIG).toEqual({ key: "name", dir: "asc" });
    expect(names(sortProviders(cards))).toEqual(["Alpha", "beta", "gamma 2", "gamma 10"]);
  });

  it("desc 倒排 = asc 整体反转", () => {
    expect(names(sortProviders(cards, { key: "name", dir: "desc" }))).toEqual([
      "gamma 10",
      "gamma 2",
      "beta",
      "Alpha",
    ]);
  });

  it("同名并列保持原相对顺序(稳定)", () => {
    const dup = [snap("same", "ok"), snap("other"), snap("same", "error")];
    const sorted = sortProviders(dup, { key: "name", dir: "asc" });
    // "other" < "same"; 两个 same 之间保持输入顺序: 先 ok 后 error
    expect(names(sorted)).toEqual(["other", "same", "same"]);
    expect(sorted[1].status).toBe("ok");
    expect(sorted[2].status).toBe("error");
  });

  it("中文名拼音序 + 中英混合(locale 显式钉 zh, 不随运行时默认 locale 漂移, t_6c6dd54f)", () => {
    // zh 拼音序: 百炼(bai) < 方舟(fang) < DeepSeek(d) < Kimi(k)
    // —— 拼音与拉丁同序列比对, 与 en(拉丁整体在前)不同; 钉 zh 后 Node/Chrome 结果一致
    const cards = [snap("Kimi"), snap("方舟"), snap("DeepSeek"), snap("百炼")];
    expect(names(sortProviders(cards, { key: "name", dir: "asc" }))).toEqual([
      "百炼",
      "方舟",
      "DeepSeek",
      "Kimi",
    ]);
    // 与 e2e 期望值计算同式(localeCompare 钉 zh) —— 两侧锁同一语义
    const e2eNames = ["Kimi", "方舟", "DeepSeek", "百炼"];
    expect([...e2eNames].sort((a, b) => a.localeCompare(b, "zh", { numeric: true }))).toEqual([
      "百炼",
      "方舟",
      "DeepSeek",
      "Kimi",
    ]);
  });
});

describe("sortProviders: urgency 键(卡内最紧窗口剩余比例)", () => {
  // tightest: 剩余 10% / loose: 剩余 90% / nolimit: limit 缺失 → 视为 1(排最后)
  const tight = snap("tight", "ok", [metric(90, 100)]);
  const loose = snap("loose", "ok", [metric(10, 100)]);
  const noLimit = snap("nolimit", "ok", [metric(5)]);
  const zeroLimit = snap("zerolimit", "ok", [metric(5, 0)]);
  const cards = [noLimit, loose, tight, zeroLimit];

  it("asc: 越快耗尽越靠前; limit 缺失/为 0 排最后不崩", () => {
    expect(names(sortProviders(cards, { key: "urgency", dir: "asc" }))).toEqual([
      "tight",
      "loose",
      "nolimit",
      "zerolimit",
    ]);
  });

  it("desc: 整体反转(limit 缺失卡到最前)", () => {
    expect(names(sortProviders(cards, { key: "urgency", dir: "desc" }))).toEqual([
      "zerolimit",
      "nolimit",
      "loose",
      "tight",
    ]);
  });

  it("同比例并列 → sortByHealth 次序稳定(健康差在前)", () => {
    // 两张卡剩余比例同为 1(无 limit): error(红) 应在 stale(灰) 前
    const err = snap("z-err", "error");
    const stale = snap("a-stale", "stale");
    expect(names(sortProviders([stale, err], { key: "urgency", dir: "asc" }))).toEqual([
      "z-err",
      "a-stale",
    ]);
  });
});

describe("normalizeSortConfig: 非法/缺失 → 缺省名称正排, 不抛错", () => {
  it("合法值原样通过", () => {
    expect(normalizeSortConfig({ key: "urgency", dir: "desc" })).toEqual({
      key: "urgency",
      dir: "desc",
    });
  });

  it("非法 key/dir/非对象/null → 缺省", () => {
    for (const raw of [
      null,
      undefined,
      "urgency",
      [],
      { key: "size", dir: "asc" },
      { key: "name", dir: "up" },
      { key: "name" },
      { dir: "asc" },
      {},
    ]) {
      expect(normalizeSortConfig(raw)).toEqual(DEFAULT_SORT_CONFIG);
    }
  });
});

describe("sortByHealth 保留回归(urgency 次级稳定键来源)", () => {
  it("健康带 > status 严重度 > 剩余比例 的三级次序不变", () => {
    const okTight = snap("ok-tight", "ok", [metric(50, 100)]); // 剩余 50% → ok 带
    const warnExpired = snap("warn-expired", "auth_expired"); // warn 带
    const badErr = snap("bad-err", "error"); // bad 带
    expect(names(sortByHealth([okTight, warnExpired, badErr]))).toEqual([
      "bad-err",
      "warn-expired",
      "ok-tight",
    ]);
  });
});
