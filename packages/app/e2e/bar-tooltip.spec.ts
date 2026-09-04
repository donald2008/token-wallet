import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(t_a398348b): 窗口行悬停 tooltip —— micro 排版四元素微型展示。
 * - 悬停窗口行 → 行内 .bar-tooltip 揭示, 内含 quota-meter[data-layout="micro"]
 *   四元素(标题/重置/条/用量), 数据与行同源(golden 真实链路)
 * - 定位不溢出面板: tooltip rect 含于 card-list rect(1px 容差)
 * - 模板首行向下弹出(防首卡吸顶时上缘被裁剪), 其余行向上
 * - 移出即隐藏; 深/浅/玻璃三态渲染正常(截图取证落 /tmp)
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

/** 窗口按时间窗升序: weekly(周,100%) → monthly(月,48%) → rolling(未识别,0%) */
const ROW_WEEKLY = 0;
const ROW_MONTHLY = 1;

type Box = { x: number; y: number; width: number; height: number };

/** tooltip 四边含于容器四边(1px 容差) */
function expectContained(inner: Box, outer: Box) {
  pwExpect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  pwExpect(inner.y).toBeGreaterThanOrEqual(outer.y - 1);
  pwExpect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
  pwExpect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1);
}

test("悬停窗口行 → micro tooltip 四元素揭示, 与行同源, 不溢出面板; 移出隐藏", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  await seedOpencodeInstance(page);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  const rows = card.locator(".bar-row");
  await pwExpect(rows).toHaveCount(3);

  const monthlyRow = rows.nth(ROW_MONTHLY);
  const tip = monthlyRow.getByTestId("bar-tooltip");

  // 悬停前: 隐藏(visibility)
  await pwExpect(tip).toBeHidden();

  // 悬停 monthly 行 → tooltip 揭示, micro 排版四元素
  await monthlyRow.hover();
  await pwExpect(tip).toBeVisible();
  const meter = tip.getByTestId("quota-meter");
  await pwExpect(meter).toHaveAttribute("data-layout", "micro");
  await pwExpect(meter).toHaveClass(/quota-meter--layout-micro/);
  await pwExpect(tip.locator(".quota-title")).toHaveText("月窗");
  await pwExpect(tip.locator(".quota-usage")).toHaveText("48 / 100 (48%)");
  await pwExpect(tip.locator(".quota-reset")).not.toBeEmpty(); // 重置倒计时(≥1天档)
  await pwExpect(tip.locator("[role='progressbar']")).toHaveAttribute("aria-valuenow", "48");
  await pwExpect(tip.locator(".progress-fill")).toHaveAttribute("data-health", "ok"); // 48% 剩余 52% → ok

  // 不溢出面板: tooltip ⊂ card-list
  const tipBox = (await tip.boundingBox())!;
  const listBox = (await page.locator(".card-list").boundingBox())!;
  expectContained(tipBox, listBox);

  // micro 结构取证: 条 4px + 重置并入用量行(usage.y ≈ reset.y)
  const barBox = (await tip.locator("[role='progressbar']").boundingBox())!;
  pwExpect(barBox.height).toBeLessThanOrEqual(5);
  const usageBox = (await tip.locator(".quota-usage").boundingBox())!;
  const resetBox = (await tip.locator(".quota-reset").boundingBox())!;
  pwExpect(Math.abs(usageBox.y - resetBox.y)).toBeLessThanOrEqual(4);

  // 移出(悬停标题栏) → tooltip 隐藏
  await page.locator(".titlebar").hover();
  await pwExpect(tip).toBeHidden();
});

test("模板首行 tooltip 向下弹出(防吸顶裁剪), 仍含于面板", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  await seedOpencodeInstance(page);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  const weeklyRow = card.locator(".bar-row").nth(ROW_WEEKLY);
  const tip = weeklyRow.getByTestId("bar-tooltip");

  await weeklyRow.hover();
  await pwExpect(tip).toBeVisible();
  await pwExpect(tip.locator(".quota-title")).toHaveText("周窗");
  await pwExpect(tip.locator(".quota-usage")).toHaveText("100 / 100 (100%)");
  await pwExpect(tip.locator(".progress-fill")).toHaveAttribute("data-health", "bad"); // 耗尽 → bad

  // 首行: tooltip 在行下方(top ≥ row.bottom - 1), 非上方
  const tipBox = (await tip.boundingBox())!;
  const rowBox = (await weeklyRow.boundingBox())!;
  pwExpect(tipBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1);

  // 仍含于 card-list
  const listBox = (await page.locator(".card-list").boundingBox())!;
  expectContained(tipBox, listBox);
});

test("三态截图取证(dark/light/glass 各悬停 monthly 行落 /tmp)", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  for (const [name, theme, glass] of [
    ["dark", "dark", "0"],
    ["light", "light", "0"],
    ["glass", "dark", "1"],
  ] as const) {
    await page.evaluate(
      ([t, g]) => {
        localStorage.setItem("token-wallet.theme.v1", t as string);
        localStorage.setItem("token-wallet.glass.v1", g as string);
      },
      [theme, glass],
    );
    await seedOpencodeInstance(page);
    const card = page.getByTestId("provider-card").first();
    await pwExpect(card).toBeVisible({ timeout: 10_000 });
    const monthlyRow = card.locator(".bar-row").nth(ROW_MONTHLY);
    await monthlyRow.hover();
    const tip = monthlyRow.getByTestId("bar-tooltip");
    await pwExpect(tip).toBeVisible();
    // 等 grow-in/淡入动画落定避免截到半透明帧
    await page.waitForTimeout(600);
    // 三态正常取证: tooltip 仍含于面板 + micro meter 在
    const tipBox = (await tip.boundingBox())!;
    const listBox = (await page.locator(".card-list").boundingBox())!;
    expectContained(tipBox, listBox);
    await pwExpect(tip.getByTestId("quota-meter")).toHaveAttribute("data-layout", "micro");
    await page.locator(".panel").screenshot({ path: `/tmp/bar-tooltip-${name}.png` });
  }
});
