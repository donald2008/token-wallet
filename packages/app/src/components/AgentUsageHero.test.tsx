/**
 * AgentUsageHero 单测(t_56c66972 ②, 方案 A-rev3 置顶组件):
 * 正常态 / 边界② 全局零数据 / 边界④ 不足窗口(断线绘制 + 首点标记) / hour 降级(数据积累中)
 * + buildHeroSeries 纯函数边界。
 */
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentUsageHero, buildHeroAxisLabels, buildHeroSeries, type HourBucket } from "./AgentUsageHero";

const SINCE = "2026-09-24T06:00:00+08:00"; // 窗口起点(-5h)
const UNTIL = "2026-09-24T11:00:00+08:00"; // 窗口终点(now)

const fullBuckets: HourBucket[] = [
  { hour: "2026-09-24T06:00", tokens: 1_000_000 },
  { hour: "2026-09-24T07:00", tokens: 1_200_000 },
  { hour: "2026-09-24T08:00", tokens: 1_100_000 },
  { hour: "2026-09-24T09:00", tokens: 1_500_000 },
  { hour: "2026-09-24T10:00", tokens: 1_800_000 },
  { hour: "2026-09-24T11:00", tokens: 2_000_000 },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: React.ReactNode): HTMLDivElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r = createRoot(c);
  act(() => {
    r.render(node);
  });
  container = c;
  root = r;
  return c;
}

afterEach(() => {
  const r = root;
  const c = container;
  if (r !== null && c !== null) {
    act(() => r.unmount());
    c.remove();
  }
  container = null;
  root = null;
});

function hero(over: Partial<Parameters<typeof AgentUsageHero>[0]> = {}) {
  return (
    <AgentUsageHero
      globalTotalTokens={258_613_940}
      hourBuckets={fullBuckets}
      hourAvailable={true}
      windowSince={SINCE}
      windowUntil={UNTIL}
      emptyPage={false}
      onOpenDashboard={() => {}}
      {...over}
    />
  );
}

describe("AgentUsageHero 正常态(plan-a-v3 对稿)", () => {
  it("行0: 「近 5 小时」标签 + 大屏钮(全局唯一入口)", () => {
    const c = mount(hero());
    expect(c.querySelector('[data-testid="hero-window-label"]')?.textContent).toBe("近 5 小时");
    const btn = c.querySelector('[data-testid="hero-dashboard-btn"]') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("用量大屏 →");
    expect(btn.getAttribute("aria-label")).toBe("打开用量大屏");
  });

  it("行1: 全局总 tokens 大数字(千分位全数字) + unit", () => {
    const c = mount(hero());
    expect(c.querySelector('[data-testid="hero-total-tokens"]')?.textContent).toBe("258,613,940");
    expect(c.textContent).toContain("tokens");
  });

  it("折线: svg 存在 + 折线 path + 末点标记 + 6 刻度轴(真实时钟) + 无边界提示", () => {
    const c = mount(hero());
    const svg = c.querySelector('[data-testid="hero-chart"]');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 320 52");
    const line = c.querySelector('[data-testid="hero-line"]');
    expect(line?.getAttribute("d")).toMatch(/^M0,/); // 首个桶在窗口起点 → 折线自刻度 0 起
    expect(c.querySelector('[data-testid="hero-point-last"]')).toBeTruthy();
    // 数据覆盖整窗 → 不标首点/不生星
    expect(c.querySelector('[data-testid="hero-point-first"]')).toBeNull();
    expect(c.querySelector('[data-testid="hero-axis-first"]')).toBeNull();
    // 9/24 时间轴真实时钟化: 刻度锚定整点/半点; 整点 HH:00 major, 半点 :30 短标, 末刻度=until
    // 单测窗口 06:00→11:00(整对齐) → 06:00(major)/:30/07:00(major)/.../10:30/11:00(major) = 11 枚
    const labels = buildHeroAxisLabels(SINCE, UNTIL);
    expect(labels).toHaveLength(11);
    expect(labels[0]).toMatchObject({ text: "06:00", major: true });
    expect(labels[1]).toMatchObject({ text: ":30", major: false, fullText: "06:30" });
    expect(labels[2]).toMatchObject({ text: "07:00", major: true });
    expect(labels[labels.length - 1]).toMatchObject({ text: "11:00", major: true });
    expect(labels.some((l) => l.text === "-5h")).toBe(false);
    expect(labels.some((l) => l.text === "now")).toBe(false);
    expect(c.querySelectorAll('[data-testid="hero-axis-tick"]').length).toBe(labels.length);
    expect(c.querySelector('[data-testid="hero-hint"]')).toBeNull();
    expect(c.querySelector('[data-testid="hero-chart-degrade"]')).toBeNull();
  });

  it("大屏钮点击 → onOpenDashboard 回调", () => {
    const onOpen = vi.fn();
    const c = mount(hero({ onOpenDashboard: onOpen }));
    act(() => (c.querySelector('[data-testid="hero-dashboard-btn"]') as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("AgentUsageHero 边界态", () => {
  it("边界② 全局零数据: 0(暗色) + 虚线基线 + 引导句, 不画折线", () => {
    const c = mount(hero({ globalTotalTokens: 0, emptyPage: true, hourBuckets: [] }));
    const num = c.querySelector('[data-testid="hero-total-tokens"]');
    expect(num?.textContent).toBe("0");
    expect(num?.classList.contains("is-empty")).toBe(true);
    expect(c.querySelector('[data-testid="hero-baseline"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="hero-line"]')).toBeNull();
    expect(c.querySelector('[data-testid="hero-hint"]')?.textContent).toBe(
      "暂无上报数据 — agent 完成首次调用并接入上报后，这里会出现用量曲线。",
    );
  });

  it("边界④ 不足窗口(<1h): 断线自首数据点起 + 首点标记 + 轴星标 + 「首次上报 N 分钟前」", () => {
    // 首数据点 = 10:20(距 11:00 仅 40min) → 前段无数据的刻度必须断线(禁零值平线)
    const c = mount(
      hero({
        hourBuckets: [
          { hour: "2026-09-24T10:20", tokens: 18_425_400 },
          { hour: "2026-09-24T11:00", tokens: 20_000_000 },
        ],
      }),
    );
    const d = c.querySelector('[data-testid="hero-line"]')?.getAttribute("d") ?? "";
    // 9/24 坐标系统一(真实时间比例): 首点 10:20 距窗口起点 260min / 300min = 0.8667 → x=277.33
    expect(parseFloat(d.match(/^M([\d.]+),/)![1])).toBeCloseTo(277.33, 0);
    expect(c.querySelector('[data-testid="hero-point-first"]')).toBeTruthy();
    // 时间轴真实时钟化: 星标刻度 = 首点(10:20)之后最近的半点刻度 = 10:30 → 「10:30*」
    expect(c.querySelector('[data-testid="hero-axis-first"]')?.textContent).toBe("10:30*");
    expect(c.querySelector('[data-testid="hero-hint"]')?.textContent).toBe(
      "首次上报 40 分钟前 — 曲线自首条数据起绘制",
    );
  });

  it("折线降级: hour 查询不可用 → 「数据积累中」, 大数字不受牵动(卡体的失败域边界)", () => {
    const c = mount(hero({ hourAvailable: false, hourBuckets: [] }));
    expect(c.querySelector('[data-testid="hero-chart-degrade"]')?.textContent).toBe("数据积累中");
    expect(c.querySelector('[data-testid="hero-chart"]')).toBeNull();
    expect(c.querySelector('[data-testid="hero-total-tokens"]')?.textContent).toBe("258,613,940");
  });
});

describe("buildHeroSeries 纯函数", () => {
  it("桶按 hour 升序 + 零值桶丢弃(禁零值平线)", () => {
    const s = buildHeroSeries(
      [
        { hour: "2026-09-24T10:00", tokens: 5 },
        { hour: "2026-09-24T07:00", tokens: 0 }, // 零值桶不落点
        { hour: "2026-09-24T08:00", tokens: 3 },
      ],
      SINCE,
      UNTIL,
    );
    expect(s.points.length).toBe(2);
    expect(s.points[0]!.tokens).toBe(3); // 08:00 在前
    expect(s.points[1]!.tokens).toBe(5);
    // 峰值为最高桶 → 其 y = 顶部内边距
    expect(s.points[1]!.y).toBe(6);
  });

  it("空桶 / 全零桶 → 无点(交给边界②/降级分支)", () => {
    expect(buildHeroSeries([], SINCE, UNTIL).points.length).toBe(0);
    expect(buildHeroSeries([{ hour: "2026-09-24T07:00", tokens: 0 }], SINCE, UNTIL).points.length).toBe(0);
  });

  it("不足窗口判据 = 首数据点距窗口终点 < 60min(边界值 60min 不算不足)", () => {
    const at60 = buildHeroSeries([{ hour: "2026-09-24T10:00", tokens: 1 }], SINCE, UNTIL);
    expect(at60.minutesSinceFirstReport).toBe(60);
    expect(at60.insufficientWindow).toBe(false);
    // 9/24 坐标系统一: firstTickIndex 移交 Hero(按半点刻度系定位), series 恒 null
    expect(at60.firstTickIndex).toBeNull();

    const at59 = buildHeroSeries([{ hour: "2026-09-24T10:01", tokens: 1 }], SINCE, UNTIL);
    expect(at59.minutesSinceFirstReport).toBe(59);
    expect(at59.insufficientWindow).toBe(true);
  });

  it("桶落在窗口外 → x 坐标钳制在 0..VIEW_W(不越轴)", () => {
    const s = buildHeroSeries(
      [
        { hour: "2026-09-24T04:00", tokens: 1 }, // 早于窗口
        { hour: "2026-09-24T14:00", tokens: 2 }, // 晚于窗口
      ],
      SINCE,
      UNTIL,
    );
    expect(s.points.map((p) => p.x)).toEqual([0, 320]);
  });

  it("window 缺失/不可解析 → 退化为 5h 窗并按比例落点, 不抛错", () => {
    const s = buildHeroSeries([{ hour: "2026-09-24T07:00", tokens: 1 }], "", "");
    expect(s.points.length).toBe(1);
    expect(s.minutesSinceFirstReport).toBe(0); // 无 until 基准 → 不做「首次上报」推断
    expect(s.insufficientWindow).toBe(false);
  });
});
