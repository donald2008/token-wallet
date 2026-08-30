import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(t_05271be0 #1/#2): 真机复验第二批 ——
 * - 标题栏: 360px 视口下主题按钮(system→「自动」)不换行、不撑高 titlebar(三态高度一致)
 * - 进度条对齐: 三行 .progress 左缘 x 坐标差 ≤1px(tightest 行 2px 左缘+4px padding
 *   改为全行恒定占位, 只换 border-color)
 */

/** 预置一个 opencode 实例(golden: rolling 0% / weekly 100% / monthly 48% → 三条 bar-row) */
async function seedOpencodeInstance(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.consent.v1", "1");
    localStorage.setItem(
      "token-wallet.mock.instances.v1",
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: "inst-oc-1",
            channel: "opencode/go",
            name: "opencode Go #1",
            params: { api_key: { source: "store", key: "inst-oc-1:api_key" } },
          },
        ],
      }),
    );
    localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-oc-1:api_key", "sk-oc-1");
  });
  await page.reload();
}

test("标题栏: 360px 视口下主题切换不撑高 titlebar, 主题按钮不换行", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  await page.getByTestId("consent-agree").click();

  const titlebar = page.locator(".titlebar");
  const toggle = page.getByTestId("theme-toggle");

  // 文案缩短: system 态 = 「自动」, title 提示保留全语义
  await pwExpect(toggle).toHaveText("自动");
  await pwExpect(toggle).toHaveAttribute("title", "主题: 跟随系统(点击切换)");

  // CSS 层: 按钮文字禁止换行(根因①)
  const whiteSpace = await toggle.evaluate((el) => getComputedStyle(el).whiteSpace);
  pwExpect(whiteSpace).toBe("nowrap");

  // 三态轮换(system→light→dark), titlebar 高度必须不变(换行会撑高)
  const heights: number[] = [];
  for (let i = 0; i < 3; i++) {
    const box = await titlebar.boundingBox();
    heights.push(Math.round(box!.height));
    await toggle.click();
  }
  pwExpect(new Set(heights).size).toBe(1);
});

test("进度条对齐: 三行进度条左缘 x 坐标差 ≤1px(tightest 占位一致)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await seedOpencodeInstance(page);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  const bars = card.locator(".bar-row .progress");
  await pwExpect(bars).toHaveCount(3);
  // tightest 行(weekly 100% 耗尽)存在 —— 对齐断言必须覆盖它(历史漂移源)
  await pwExpect(card.locator(".bar-row[data-tightest]")).toHaveCount(1);

  const xs: number[] = [];
  for (let i = 0; i < 3; i++) {
    xs.push((await bars.nth(i).boundingBox())!.x);
  }
  const spread = Math.max(...xs) - Math.min(...xs);
  pwExpect(spread).toBeLessThanOrEqual(1);
});
