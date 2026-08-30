import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(t_05271be0 #1/#2 + D-038): 真机复验第二批 ——
 * - 标题栏: 360px 视口下瘦身后控件(图钉/最小化/关闭)不换行、置顶轮换不撑高 titlebar
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

test("标题栏: 360px 视口下置顶切换不撑高 titlebar, 按钮文字不换行(D-038)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  await page.getByTestId("consent-agree").click();

  const titlebar = page.locator(".titlebar");
  const pinBtn = page.getByTestId("pin-btn");

  // D-038: 主题按钮已从标题栏移除(唯一入口 = 设置页既有分段控件)
  await pwExpect(page.getByTestId("theme-toggle")).toHaveCount(0);

  // CSS 层: 按钮文字禁止换行(根因①, .btn 全局 nowrap)
  const whiteSpace = await pinBtn.evaluate((el) => getComputedStyle(el).whiteSpace);
  pwExpect(whiteSpace).toBe("nowrap");

  // 置顶轮换(off→on→off), titlebar 高度必须不变(换行/图标切换都不得撑高)
  const heights: number[] = [];
  for (let i = 0; i < 3; i++) {
    const box = await titlebar.boundingBox();
    heights.push(Math.round(box!.height));
    await pinBtn.click();
  }
  pwExpect(new Set(heights).size).toBe(1);
});

test("标题栏: 360px 与 800px 视口高度一致, app-title 不换行两行(t_2ac39613 #1)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  await page.getByTestId("consent-agree").click();
  const titlebar = page.locator(".titlebar");
  const appTitle = page.locator(".app-title");

  const h360 = Math.round((await titlebar.boundingBox())!.height);
  // 标题单行: app-title 高度 == titlebar 高度(换行成两行必然更高)
  const titleH360 = Math.round((await appTitle.boundingBox())!.height);
  pwExpect(titleH360).toBeLessThanOrEqual(h360);

  // 800px 视口: 面板仍是 360 布局(定宽), titlebar 高度必须一致
  await page.setViewportSize({ width: 800, height: 600 });
  const h800 = Math.round((await titlebar.boundingBox())!.height);
  pwExpect(h800).toBe(h360);

  // 布局预算最紧时(360 面板宽)标题也不断词换行(white-space 计算值)
  const ws = await appTitle.evaluate((el) => getComputedStyle(el).whiteSpace);
  pwExpect(ws).toBe("nowrap");
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
