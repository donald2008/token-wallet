/**
 * t_56c66972 local-agent ② 置顶组件 AgentUsageHero + AgentCard 重构 e2e
 * (方案 A-rev3, GATE 2 approved, 形态唯一依据 = plan-a-v3.html 正常态 + 四边界态)
 *
 * 覆盖:
 *  ① 正常态对稿: 近 5 小时标签 / 全局大数字 / 52px 折线 / 时间轴 -5h…now / 大屏入口全局唯一
 *  ② AgentCard 重构: 卡内大屏钮零残留 + meta 去词化(左=calls 数字 右=HH:MM)
 *  ③ 边界① 数据滞后(>30min): 黄点 + 「数据滞后」 + 快照提示带
 *  ④ 边界② 全局零数据: hero 0 + 虚线基线 + 引导句
 *  ⑤ 边界③ 列表空 + 删除生效回执(虚线扁平卡)
 *  ⑥ 边界④ 不足窗口: 首点标记 + 轴星标 + 「首次上报 N 分钟前」; 有数据的窗口断线自首桶起(非零值平线)
 *  ⑦ hour 查询失败 → 折线区「数据积累中」, 大数字不受牵动(失败域隔离)
 */
import { expect, expect as pwExpect } from "@playwright/test";
import { test, seedAgentUsageMulti, seedDeleteUsage } from "./fixtures";
import {
  deriveMultiFromSingle,
  emptySummary,
  fakeHourSummary,
  fakeHourSummaryLate,
  fakeHourSummaryShort,
  fakeSummary,
  staleAgentSummary,
} from "./agent-fixture";

type MultiSeed = Parameters<typeof seedAgentUsageMulti>[1];

/** agent 维 seed = hour 维 seed = 同一份(向后兼容 mock 语义), 但 hero 折线由 hour 键驱动 */
function seedAll(hourData: unknown, agentData: unknown = fakeSummary): MultiSeed {
  const derived = deriveMultiFromSingle(fakeSummary);
  return {
    agent: { ok: true, data: agentData },
    "agent,model": derived["agent,model"],
    day: derived["day"],
    hour: { ok: true, data: hourData },
  };
}

async function agreeAndOpenLocalAgent(
  page: import("@playwright/test").Page,
  seed: MultiSeed,
): Promise<void> {
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, seed);
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
}

// ─────────────────────────── ① 正常态对稿 ───────────────────────────

test("① 置顶组件正常态对稿: 标签/大数字 28px/折线/时间轴 + 大屏入口全局唯一", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agreeAndOpenLocalAgent(page, seedAll(fakeHourSummary));

  const hero = page.getByTestId("agent-usage-hero");
  await pwExpect(hero).toBeVisible();
  // 行0: 左 = 窗口标签, 右 = 大屏钮
  await pwExpect(page.getByTestId("hero-window-label")).toHaveText("近 5 小时");
  const btn = page.getByTestId("hero-dashboard-btn");
  await pwExpect(btn).toHaveText("用量大屏 →");
  await pwExpect(btn).toHaveAttribute("aria-label", "打开用量大屏");
  // 行1: 全局总 tokens(主 summary 全局行 = 4,555,000, 千分位全数字)
  await pwExpect(page.getByTestId("hero-total-tokens")).toHaveText("4,555,000");
  const numStyle = await page.getByTestId("hero-total-tokens").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, num: cs.fontVariantNumeric };
  });
  expect(numStyle.fontSize, "mock 大数字 28px").toBe("28px");
  expect(numStyle.num).toContain("tabular-nums");

  // 折线: 52px 高 + 系列色 = --chart-1(#5794f2 两主题同值)
  const svg = page.getByTestId("hero-chart");
  await pwExpect(svg).toBeVisible();
  const svgBox = await svg.boundingBox();
  expect(svgBox?.height ?? 0, "折线区高 52px(mock)").toBe(52);
  const line = page.getByTestId("hero-line");
  await pwExpect(line).toHaveCount(1);
  const stroke = await line.evaluate((el) => getComputedStyle(el).stroke);
  expect(stroke, "折线色走 --chart-1").toBe("rgb(87, 148, 242)");
  // 9/24 坐标系统一(真实时间比例): 首桶 08:00 距窗口起点(07:34:56) 25.07min / 300min = 0.0836
  // → x = 0.0836*320 ≈ 26.74; 折线自首数据桶真实位置起, 无首点星标/无提示句
  const d = await line.getAttribute("d");
  expect(parseFloat(d!.match(/^M([\d.]+),/)![1])).toBeCloseTo(26.74, 0);
  await pwExpect(page.getByTestId("hero-point-last")).toHaveCount(1);
  await pwExpect(page.getByTestId("hero-point-first")).toHaveCount(0);
  await pwExpect(page.getByTestId("hero-hint")).toHaveCount(0);
  // 时间轴: 真实时钟刻度(整点 HH:00 major / 半点 :30 短标 / 末刻度=now)
  // e2e 窗口 07:34:56→12:34:56 → 刻度 08:00(major), :30, 09:00(major), ..., 12:00(major), 12:34
  const axisText = await page.getByTestId("hero-axis").textContent();
  expect(axisText).toContain("08:00");
  expect(axisText).toContain("12:00");
  expect(axisText).toContain("12:34");
  expect(axisText).not.toContain("-5h");
  expect(axisText).not.toContain("now");
  // 长短交替: major 整点(5 枚) + minor 半点(5 枚, 文本 :30)
  const majorCount = await page.locator(".hero-axis .is-major").count();
  const minorCount = await page.locator(".hero-axis .is-minor").count();
  expect(majorCount, "整点 major 5 枚(08~12)").toBe(5);
  expect(minorCount, "半点 minor 5 枚(:30)").toBe(5);

  // 大屏入口全局唯一: 置顶 1 枚 + 卡内 0 枚(agent-detail-* 零残留)
  await pwExpect(page.getByTestId("hero-dashboard-btn")).toHaveCount(1);
  await pwExpect(page.locator('[data-testid^="agent-detail-"]')).toHaveCount(0);
  await pwExpect(page.locator(".agent-detail-btn")).toHaveCount(0);
  await pwExpect(page.getByTestId("agent-card")).toHaveCount(4);

  // 置顶大屏钮 → 大屏(浏览器降级 = 页内视图, 与真壳开窗同一回调)
  await btn.click();
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible();
});

test("② AgentCard 重构: 卡内大屏钮移除 + meta 去词化(左=calls 数字, 右=HH:MM)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agreeAndOpenLocalAgent(page, seedAll(fakeHourSummary));

  const card = page.locator('[data-testid="agent-card"][data-agent="njbx02"]');
  await pwExpect(card).toBeVisible();
  // 卡内不出现任何大屏入口
  await pwExpect(card.locator('[data-testid^="agent-detail-"]')).toHaveCount(0);
  await pwExpect(card.getByText("大屏")).toHaveCount(0);

  const meta = card.getByTestId("agent-meta");
  await pwExpect(meta).toBeVisible();
  await pwExpect(card.getByTestId("agent-meta-calls")).toHaveText("100");
  const timeText = (await card.getByTestId("agent-meta-time").textContent()) ?? "";
  expect(timeText, `meta 右列应为 HH:MM 短格式, 实际 ${timeText}`).toMatch(/^\d{2}:\d{2}$/);
  const metaText = (await meta.textContent()) ?? "";
  expect(metaText, "meta 行去词化: 不得出现 calls/更新/数据 词").not.toMatch(/calls|更新|数据/);
  // tabular-nums(数字对齐纪律)
  const metaStyle = await meta.evaluate((el) => getComputedStyle(el).fontVariantNumeric);
  expect(metaStyle).toContain("tabular-nums");

  // t_56c66972 ④: 删除钮 hover 互斥显隐(mock .acard:hover .astatus{opacity:0}) —
  // hover 卡 → 状态徽章让位(opacity:0) + 删除钮显出, 禁几何重叠
  await pwExpect(card.getByTestId("agent-delete-njbx02")).toBeVisible(); // 常在 DOM(opacity:0 不影响 hit-test)
  await card.hover();
  await pwExpect(card.getByTestId("agent-activity-badge")).toHaveCSS("opacity", "0");
  const delOpacity = await card
    .getByTestId("agent-delete-njbx02")
    .evaluate((el) => getComputedStyle(el).opacity);
  expect(delOpacity, "hover 时删除钮必须显出").toBe("1");
  // 无删除钮的卡不该被藏状态 — is-deletable 门控(置顶组件不是卡, 不受影响)
  await page.mouse.move(0, 0);
  await pwExpect(card.getByTestId("agent-activity-badge")).toHaveCSS("opacity", "1");
});

// ─────────────────────────── ③ 边界① 数据滞后 ───────────────────────────

test("③ 边界① 数据滞后: 黄点 + 「数据滞后」 + 快照提示带 + 大数字降饱和", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agreeAndOpenLocalAgent(page, seedAll(fakeHourSummary, staleAgentSummary));

  const stale = page.locator('[data-testid="agent-card"][data-agent="k3-worker"]');
  await pwExpect(stale).toHaveAttribute("data-stale", "true");
  await pwExpect(stale.getByTestId("agent-activity-badge")).toHaveText("数据滞后");
  await pwExpect(stale.getByTestId("agent-status-dot")).toHaveAttribute("data-health", "warn");
  const dotColor = await stale.getByTestId("agent-status-dot").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(dotColor, "黄点 = --warn #facc15").toBe("rgb(250, 204, 21)");
  // 快照提示带(mock 逐字)
  await pwExpect(stale.getByTestId("agent-stale-band-k3-worker")).toContainText(
    "◇ 数据为 2026-09-08 22:14 前的快照 — agent 可能已下线",
  );
  // 大数字降饱和(fg-dim), meta 右列 = 隔日文案
  await pwExpect(stale.locator(".agent-tokens-number")).toHaveClass(/is-stale/);
  await pwExpect(stale.getByTestId("agent-meta-time")).toHaveText("昨天 22:14");

  // 未超阈值的同屏卡不误报(同快照 12:34:56, latest 12:30 → 4.9min)
  const fresh = page.locator('[data-testid="agent-card"][data-agent="njbx02"]');
  await pwExpect(fresh).not.toHaveAttribute("data-stale", "true");
  await pwExpect(fresh.getByTestId("agent-activity-badge")).toHaveText("有活动");
  await pwExpect(page.locator('[data-testid^="agent-stale-band-"]')).toHaveCount(1);
});

// ─────────────────────────── ④ 边界② 全局零数据 ───────────────────────────

test("④ 边界② 全局零数据: hero 0 + 虚线基线 + 引导句(非删除场景保留原空态)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agreeAndOpenLocalAgent(page, {
    agent: { ok: true, data: emptySummary },
    "agent,model": { ok: true, data: emptySummary },
    day: { ok: true, data: emptySummary },
    hour: { ok: true, data: emptySummary },
  });

  const num = page.getByTestId("hero-total-tokens");
  await pwExpect(num).toHaveText("0");
  await pwExpect(num).toHaveClass(/is-empty/);
  await pwExpect(page.getByTestId("hero-baseline")).toHaveCount(1);
  await pwExpect(page.getByTestId("hero-line")).toHaveCount(0);
  await pwExpect(page.getByTestId("hero-hint")).toHaveText(
    "暂无上报数据 — agent 完成首次调用并接入上报后，这里会出现用量曲线。",
  );
  // 非删除导致的空列表 → 保留原「暂无 Agent 上报数据」空态(与边界③ 的回执卡区分)
  await pwExpect(page.getByTestId("agent-rows-empty")).toBeVisible();
  await pwExpect(page.getByTestId("agent-rows-empty-flat")).toHaveCount(0);
});

// ─────────────────────────── ⑤ 边界③ 删除生效回执 ───────────────────────────

test("⑤ 边界③ 列表空(删除后): 虚线扁平卡 + 删除生效回执", async ({ hostPage, page }) => {
  void hostPage;
  // 单 agent 场景: 删掉它 → 列表真空, 走回执态
  const singleAgent = {
    ...fakeSummary,
    rows: [fakeSummary.rows[0]!],
    total: { ...fakeSummary.rows[0]! },
  };
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, {
    agent: { ok: true, data: singleAgent },
    "agent,model": { ok: true, data: singleAgent },
    day: { ok: true, data: singleAgent },
    hour: { ok: true, data: fakeHourSummary },
  });
  // 删除成功后 daemon 面变空(usageAfter 写回 usage seed) → 下一拍列表为空 + 回执
  await seedDeleteUsage(page, {
    ok: true,
    usageAfter: {
      byGroupBy: {
        agent: { ok: true, data: emptySummary },
        "agent,model": { ok: true, data: emptySummary },
        day: { ok: true, data: emptySummary },
        hour: { ok: true, data: emptySummary },
      },
    },
  });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();
  await pwExpect(page.getByTestId("agent-card")).toHaveCount(1);

  const card = page.locator('[data-testid="agent-card"][data-agent="njbx02"]');
  await card.hover();
  await page.getByTestId("agent-delete-njbx02").click();
  await page.getByTestId("agent-confirm-del-njbx02").click();

  const flat = page.getByTestId("agent-rows-empty-flat");
  await pwExpect(flat).toBeVisible();
  await pwExpect(flat).toContainText("没有 agent 用量数据");
  await pwExpect(flat).toContainText("删除操作已生效 — 新上报到达后 agent 卡会重新出现");
  await pwExpect(page.getByTestId("agent-rows-empty")).toHaveCount(0);
  await pwExpect(page.getByTestId("agent-card")).toHaveCount(0);
  // 点状虚线边框(mock .empty-flat)
  const border = await flat.evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(border).toBe("dashed");
  // hero 同步落 ② 全局零数据
  await pwExpect(page.getByTestId("hero-total-tokens")).toHaveText("0");
});

// ─────────────────────────── ⑥ 边界④ 不足窗口 ───────────────────────────

test("⑥ 边界④ 不足窗口(<1h): 首点标记 + 轴星标 + 「首次上报 N 分钟前」; 有数据的桶断线起始", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agreeAndOpenLocalAgent(page, seedAll(fakeHourSummaryShort));

  // 唯一桶 12:00 距窗口终点(12:34:56) 34 分钟 → 不足窗口
  await pwExpect(page.getByTestId("hero-point-first")).toHaveCount(1);
  // 时间轴真实时钟化: 星标 = 首点所在刻度(12:00, major) → 「12:00*」
  await pwExpect(page.getByTestId("hero-axis-first")).toHaveText("12:00*");
  await pwExpect(page.getByTestId("hero-hint")).toHaveText(
    "首次上报 34 分钟前 — 曲线自首条数据起绘制",
  );
  // 单桶 → 只落点不连线(禁零值平线: 不画基线)
  await pwExpect(page.getByTestId("hero-line")).toHaveCount(0);
  await pwExpect(page.getByTestId("hero-baseline")).toHaveCount(0);
  // 大数字不受折线窗口影响(全局行)
  await pwExpect(page.getByTestId("hero-total-tokens")).toHaveText("4,555,000");

  // 断线起始: 换 11:00/12:00 两桶(首桶距终点 94 分钟 > 60min) → 折线自刻度 3 起, 头部不留零值平线
  await seedAgentUsageMulti(page, seedAll(fakeHourSummaryLate));
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();
  const d = (await page.getByTestId("hero-line").getAttribute("d")) ?? "";
  // 9/24 坐标系统一: 首桶 11:00 距窗口起点(07:34:56) 205.07min/300min = 0.6836 → x ≈ 218.74
  // 头部无零值平线(折线不从 x=0 起), 断线起始语义保持
  expect(d, `折线应从首个有数据的桶起画, 实际 d=${d}`).toMatch(/^M218\.7/);
  await pwExpect(page.getByTestId("hero-baseline")).toHaveCount(0);
  await pwExpect(page.getByTestId("hero-axis-first")).toHaveCount(0);
});

// ─────────────────────────── ⑦ hour 失败域隔离 ───────────────────────────

test("⑦ hour 查询失败: 折线区「数据积累中」, 大数字/卡片列表不受牵动", async ({ hostPage, page }) => {
  void hostPage;
  // hour 键缺失 → mock 面该维 unreachable(其它维正常)
  await agreeAndOpenLocalAgent(page, {
    agent: { ok: true, data: fakeSummary },
    "agent,model": { ok: true, data: deriveMultiFromSingle(fakeSummary)["agent,model"] },
    day: { ok: true, data: deriveMultiFromSingle(fakeSummary)["day"] },
    hour: { ok: false, reason: "unreachable" },
  });

  await pwExpect(page.getByTestId("hero-chart-degrade")).toHaveText("数据积累中");
  await pwExpect(page.getByTestId("hero-chart")).toHaveCount(0);
  await pwExpect(page.getByTestId("hero-total-tokens")).toHaveText("4,555,000");
  await pwExpect(page.getByTestId("agent-card")).toHaveCount(4);
  await pwExpect(page.getByTestId("hero-dashboard-btn")).toBeVisible();
});
