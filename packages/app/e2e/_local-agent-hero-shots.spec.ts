/**
 * 临时截图 spec(t_56c66972 视觉对稿证据采集) — 跑完即删, 不进 git 树。
 * 与 local-agent-hero.spec 同源 fixture, 断言之后再截图(证据画面 = 断言通过的画面)。
 */
import { expect as pwExpect } from "@playwright/test";
import { test, seedAgentUsageMulti } from "./fixtures";
import {
  deriveMultiFromSingle,
  emptySummary,
  fakeHourSummary,
  fakeHourSummaryShort,
  fakeSummary,
  staleAgentSummary,
} from "./agent-fixture";

const SHOT = "verification/local-agent-hero";

function seed(hourData: unknown, agentData: unknown = fakeSummary) {
  const d = deriveMultiFromSingle(fakeSummary);
  return {
    agent: { ok: true, data: agentData },
    "agent,model": d["agent,model"],
    day: d["day"],
    hour: { ok: true, data: hourData },
  };
}

const THEMES = [
  { key: "dark", theme: "dark", glass: "0" },
  { key: "light", theme: "light", glass: "0" },
  { key: "glass", theme: "dark", glass: "1" },
] as const;

for (const t of THEMES) {
  test(`对稿截图 ${t.key}`, async ({ hostPage, page }) => {
    void hostPage;
    await page.setViewportSize({ width: 360, height: 720 });
    await page.getByTestId("consent-agree").click();
    await seedAgentUsageMulti(page, seed(fakeHourSummary));
    await page.evaluate(
      ([theme, glass]) => {
        localStorage.setItem("token-wallet.theme.v1", theme);
        localStorage.setItem("token-wallet.glass.v1", glass);
      },
      [t.theme, t.glass],
    );
    await page.reload();
    await pwExpect(page.getByTestId("card-list")).toBeVisible();
    await page.getByTestId("main-tab-local-agent").click();
    await pwExpect(page.getByTestId("agent-usage-hero")).toBeVisible();
    await pwExpect(page.getByTestId("hero-total-tokens")).toHaveText("4,555,000");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT}/${t.key}-full.png`, fullPage: false });
    await page.getByTestId("agent-usage-hero").screenshot({ path: `${SHOT}/${t.key}-hero.png` });
    // 对稿辅助: 首屏可见卡数(mock 一屏 ~2 卡)
    const visible = await page.getByTestId("agent-card").evaluateAll((els) => {
      const vh = window.innerHeight;
      return els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= vh;
      }).length;
    });
    console.log(`[shots] ${t.key} 一屏完整可见卡数 = ${visible}`);
  });
}

test("对稿截图 边界态(dark)", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  // ① 陈旧 + ④ 不足窗口 同屏(hero 短窗 + 陈旧卡)
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, seed(fakeHourSummaryShort, staleAgentSummary));
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();
  await pwExpect(page.getByTestId("agent-usage-hero")).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByTestId("agent-usage-hero").screenshot({ path: `${SHOT}/boundary-hero-short.png` });
  await page
    .locator('[data-testid="agent-card"][data-agent="k3-worker"]')
    .screenshot({ path: `${SHOT}/boundary-stale-card.png` });
  await page.screenshot({ path: `${SHOT}/boundary-full-short-stale.png`, fullPage: false });

  // ② 全局零数据
  await seedAgentUsageMulti(page, {
    agent: { ok: true, data: emptySummary },
    "agent,model": { ok: true, data: emptySummary },
    day: { ok: true, data: emptySummary },
    hour: { ok: true, data: emptySummary },
  });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();
  await pwExpect(page.getByTestId("hero-baseline")).toHaveCount(1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT}/boundary-empty-full.png`, fullPage: false });
});
