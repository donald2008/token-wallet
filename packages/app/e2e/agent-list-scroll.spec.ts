/**
 * t_ec47affe: agent 列表区内滚 — 置顶 hero 加入后的滚动策略补全。
 *
 * 背景(老大 9/24 GATE 3 真机): AgentUsageHero 置顶后 agent 卡列表把整页撑长 —
 * 列表区自身没有滚动约束, 720 视口下是整页在滚而非列表内滚。
 * 修复: .agent-card-list max-height 400px(实测校准的 8px 网格预算) + overflow-y auto
 * + overscroll-behavior contain(列表底不穿透整页)。
 *
 * 判别力(同 DW-01 round-2 手法): 压力 fixture 把 agent 行抬到 8 行 —
 * 卡列表 min-content 总高 ≫ 400, 旧代码(无 max-height)①③ 断言必红;
 * 新代码列表自身内滚 + 整页零滚动。
 *
 * 整页零滚动口径(实测): D-031 透明无边框窗口 .panel margin:8px 常驻外壳 —
 * body overflow:hidden, docScrollHeight 恒 728(720 + 外壳 2×8px − panel 内收 8px),
 * 与内容量无关。「整页在滚」的真实特征 = 内容超预算时 docSH 千位级增长
 * (html 被撑出文档流滚动), 修复后恒 728。断言锚 728 基线而非 ≤720。 */
import { expect, expect as pwExpect } from "@playwright/test";
import { test, seedAgentUsageMulti } from "./fixtures";
import { fakeSummary as agentFixtureSummary, fakeHourSummary } from "./agent-fixture";

const fakeSummary = agentFixtureSummary;

/** 压力 fixture(本 spec 自足): 8 agent 行, total 严格 = rows 合计。
 *  hero 维(hour)沿用标准 fixture — 本卡只动列表区滚动策略, 不碰 hero 数据面。 */
function deriveStressScroll(base: typeof fakeSummary) {
  const agents = Array.from({ length: 8 }, (_, i) => ({
    group: `scroll-agent-${String(i).padStart(2, "0")}`,
    calls: 50 + i * 10,
    input_cache_hit_tokens: 200_000 + i * 80_000,
    input_cache_miss_tokens: 40_000 + i * 20_000,
    output_tokens: 10_000 + i * 5_000,
    cost_total: i % 2 === 0 ? i * 0.7 : null,
    currency: i % 2 === 0 ? "USD" : null,
    by_status: { completed: 40 + i, partial: 3, unknown: 0 },
  }));
  const sum = agents.reduce(
    (acc, r) => {
      acc.calls += r.calls;
      acc.input_cache_hit_tokens += r.input_cache_hit_tokens;
      acc.input_cache_miss_tokens += r.input_cache_miss_tokens;
      acc.output_tokens += r.output_tokens;
      acc.cost_total += r.cost_total ?? 0;
      acc.by_status.completed += r.by_status.completed;
      acc.by_status.partial += r.by_status.partial;
      acc.by_status.unknown += r.by_status.unknown;
      return acc;
    },
    {
      calls: 0,
      input_cache_hit_tokens: 0,
      input_cache_miss_tokens: 0,
      output_tokens: 0,
      cost_total: 0,
      by_status: { completed: 0, partial: 0, unknown: 0 },
    },
  );
  const stress = { ...base, rows: agents, total: { ...base.total, ...sum, currency: "USD" } };
  return {
    agent: { ok: true, data: stress },
    "agent,model": { ok: true, data: { ...stress, rows: agents.flatMap((r) => [{ ...r, group: `${r.group}|glm-5.3-flash` }]) } },
    day: { ok: true, data: { ...stress, rows: agents.map((r, i) => ({ ...r, group: i % 2 === 0 ? "2026-09-08" : "2026-09-09" })) } },
    hour: { ok: true, data: fakeHourSummary },
  };
}

/** 少卡 fixture: rows.slice(0, n) 张标准卡, total 严格 = rows 合计 — max-height 不约束场景。 */
function deriveThreeRows(base: typeof fakeSummary, n: number) {
  const agents = fakeSummary.rows.slice(0, n);
  const sum = agents.reduce(
    (acc, r) => {
      acc.calls += r.calls;
      acc.input_cache_hit_tokens += r.input_cache_hit_tokens;
      acc.input_cache_miss_tokens += r.input_cache_miss_tokens;
      acc.output_tokens += r.output_tokens;
      acc.cost_total += r.cost_total ?? 0;
      acc.by_status.completed += r.by_status.completed;
      acc.by_status.partial += r.by_status.partial;
      acc.by_status.unknown += r.by_status.unknown;
      return acc;
    },
    {
      calls: 0,
      input_cache_hit_tokens: 0,
      input_cache_miss_tokens: 0,
      output_tokens: 0,
      cost_total: 0,
      by_status: { completed: 0, partial: 0, unknown: 0 },
    },
  );
  const three = { ...base, rows: agents, total: { ...base.total, ...sum, currency: "USD" } };
  return {
    agent: { ok: true, data: three },
    "agent,model": { ok: true, data: { ...three, rows: agents.map((r) => ({ ...r, group: `${r.group}|glm-5.3-flash` })) } },
    day: { ok: true, data: { ...three, rows: agents.map((r) => ({ ...r, group: "2026-09-08" })) } },
    hour: { ok: true, data: fakeHourSummary },
  };
}

async function openLocalAgentTab(page: import("@playwright/test").Page) {
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
}

/** ① 多卡内滚: 列表容器自身是滚动容器(scrollHeight > clientHeight), 整页不滚。
 *  机制锁三件套(max-height 424px / overflow-y auto / overscroll-behavior contain)
 *  锁布局机制本身, 与数据量无关 — 回退到整页滚(无 max-height)必红。 */
test("t_ec47affe ① 多卡: 列表容器内滚 + 整页零滚动 + 滚动机制锁", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, deriveStressScroll(fakeSummary));
  await page.reload();
  await openLocalAgentTab(page);
  await pwExpect(page.getByTestId("agent-usage-hero")).toBeVisible();
  await pwExpect(page.getByTestId("agent-card")).toHaveCount(8);
  await page.waitForTimeout(300);

  const box = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="agent-card-list"]') as HTMLElement;
    const html = document.documentElement;
    return {
      listScrollH: list.scrollHeight,
      listClientH: list.clientHeight,
      overflowY: getComputedStyle(list).overflowY,
      overscrollY: getComputedStyle(list).overscrollBehaviorY,
      maxHeight: getComputedStyle(list).maxHeight,
      docScrollH: html.scrollHeight,
      docClientH: html.clientHeight,
    };
  });
  // 机制锁: 滚动机制在列表容器上(回退=无 max-height → overflowY 不在容器生效)
  pwExpect(box.maxHeight, "列表容器 max-height 必须是 400px 预算(实测校准)").toBe("400px");
  pwExpect(box.overflowY, "列表容器必须自身内滚(overflow-y: auto)").toBe("auto");
  pwExpect(box.overscrollY, "overscroll-behavior: contain — 滚到列表底不穿透整页").toBe("contain");
  // 判别力: 8 卡总高远超 400 — 若列表没被约束, scrollHeight == clientHeight(整页撑长)断言必红
  pwExpect(
    box.listScrollH,
    `压力数据下列表必须真实可滚(scrollHeight ${box.listScrollH} 应 > clientHeight ${box.listClientH})`,
  ).toBeGreaterThan(box.listClientH + 1);
  // 整页零滚动: D-031 外壳基线 728(见文件头口径注) — 内容超预算时旧布局 docSH 千位级增长
  pwExpect(
    box.docScrollH,
    `整页不得滚动(docScrollH ${box.docScrollH} > 外壳基线 728 = 整页在滚回退态)`,
  ).toBeLessThanOrEqual(728 + 1);

  // 真滚动行为: 列表滚到底 → 末卡进入视口, 整页 scrollTop 仍为 0
  await page.getByTestId("agent-card-list").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    docTop: document.documentElement.scrollTop,
    bodyTop: document.body.scrollTop,
    lastCardTop: document.querySelector('[data-testid="agent-card"]:last-child')!.getBoundingClientRect().top,
  }));
  pwExpect(after.docTop, "列表滚到底整页也不得跟着滚").toBe(0);
  pwExpect(after.bodyTop).toBe(0);
  pwExpect(after.lastCardTop, "列表滚到底后末卡应进入视口").toBeLessThan(720);

  // ⑤ 滚动条样式 = 全局细滚动条(8px 主题化 thumb), 无默认灰条(scrollbar.spec 同款手法)
  const sb = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="agent-card-list"]')!;
    const track = getComputedStyle(el, "::-webkit-scrollbar");
    const thumb = getComputedStyle(el, "::-webkit-scrollbar-thumb");
    return { width: track.width, thumbColor: thumb.backgroundColor };
  });
  pwExpect(sb.width, "列表滚动条宽度必须 8px(全局细滚动条)").toBe("8px");
  // thumb 主题化着色(非默认灰条): Chromium color-mix 序列化为 color(srgb r g b / a)
  const alpha =
    sb.thumbColor.match(/\/\s*([\d.]+)\s*\)$/)?.[1] ??
    sb.thumbColor.match(/,\s*([\d.]+)\)$/)?.[1] ??
    (/^rgb/.test(sb.thumbColor) ? "1" : "0");
  pwExpect(parseFloat(alpha), `thumb 必须主题化着色(实测 ${sb.thumbColor})`).toBeGreaterThan(0);
});

/** ② 少卡: max-height 不约束 → 列表不可滚, 无空滚区。
 *  实测注: 标准卡实测高 ~160px(老大估算 ~133 偏小), 3 卡总高 491 > 400 预算 —
 *  「≤3 无滚动」按字面物理不可满足(预算是给 720−hero 后的内滚区, 不是容纳 3 整卡)。
 *  卡体意图(max-height 不产生空滚区)以 2 卡 fixture 断言: 总高 < 预算 → 无滚动。 */
test("t_ec47affe ② 少卡: 无内滚出现(max-height 不产生空滚区)", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, deriveThreeRows(fakeSummary, 2));
  await page.reload();
  await openLocalAgentTab(page);
  await pwExpect(page.getByTestId("agent-card")).toHaveCount(2);

  const box = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="agent-card-list"]') as HTMLElement;
    return {
      listScrollH: list.scrollHeight,
      listClientH: list.clientHeight,
      overflowY: getComputedStyle(list).overflowY,
    };
  });
  pwExpect(box.overflowY, "机制常在(auto), 只是少卡时不触发").toBe("auto");
  pwExpect(
    box.listScrollH,
    `少卡时列表不得出现滚动区(scrollHeight ${box.listScrollH} > clientHeight ${box.listClientH})`,
  ).toBeLessThanOrEqual(box.listClientH + 1);
});

/** ④ 交互回归: 滚动容器内悬浮删除钮照常工作(hover 显钮 + 确认气泡)。 */
test("t_ec47affe ④ 滚动容器内删除钮 hover 交互回归", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, deriveStressScroll(fakeSummary));
  await page.reload();
  await openLocalAgentTab(page);

  // 先把列表滚到中部再 hover — 证明 hover 显钮不因滚动容器改变失效
  await page.getByTestId("agent-card-list").evaluate((el) => el.scrollTo(0, el.scrollHeight / 2));
  await page.waitForTimeout(200);
  const delBtn = page.getByTestId("agent-delete-scroll-agent-00");
  const card = page.locator('[data-testid="agent-card"][data-agent="scroll-agent-00"]');
  await card.hover();
  await pwExpect(delBtn).toBeVisible();

  await delBtn.click();
  const confirmRow = page.getByTestId("agent-confirm-row-scroll-agent-00");
  await pwExpect(confirmRow).toBeVisible();
  await pwExpect(confirmRow).toContainText("scroll-agent-00");
  await pwExpect(confirmRow).toContainText("不可逆");
  // 取消收尾, 不触发删除
  await page.getByTestId("agent-confirm-cancel-scroll-agent-00").click();
  await pwExpect(confirmRow).toHaveCount(0);
  const inv = (await page.evaluate(() => (window as unknown as { __capturedInvokes?: { cmd: string }[] }).__capturedInvokes ?? [])).filter(
    (c) => c.cmd === "mcp_delete_usage",
  );
  expect(inv.length, "取消路径不得触发 mcp_delete_usage").toBe(0);
});
