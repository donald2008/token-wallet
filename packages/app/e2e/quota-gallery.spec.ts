import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(QuotaMeter 最小组件 + 方案页, t_37416b22, feat/theme-glass 实验):
 * - 同意首开 → 设置 → 「进度条形态方案」入口 → 方案页打开
 * - 4 形态 × 3 窗口 = 12 条进度条; 三态色(ok/warn/bad)各 4 条
 * - 复用 e2e DOM 契约(.progress/.progress-fill[data-health]) —— 正文卡一例不破(计入回归面)
 * - 返回按钮回面板
 */

/** 同意首开隐私声明 → 面板(侧栏出现) */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
}

/** 打开设置 → 进入进度条方案页 */
async function openGallery(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("quota-open").click();
  await pwExpect(page.getByTestId("quota-gallery")).toBeVisible();
}

test("方案页: 从设置打开, 4形态×3窗口渲染, 三态色齐全, 契约复用", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openGallery(page);

  // 4 形态列头 + 3 窗口行
  await pwExpect(page.getByTestId("quota-gallery").locator(".quota-vhead")).toHaveCount(4);
  await pwExpect(page.getByTestId("quota-gallery").locator('.quota-row[data-metric]')).toHaveCount(3);

  // 12 条进度条(4×3), 全部带 role=progressbar + aria-valuenow
  const bars = page.getByTestId("quota-gallery").locator('[role="progressbar"]');
  await pwExpect(bars).toHaveCount(12);
  await pwExpect(bars.first()).toHaveAttribute("aria-valuenow", "40"); // 5h 40% ok

  // 三态色各 4 条(数据驱动 mock: 5h ok / 周 warn / 月 bad)
  const gallery = page.getByTestId("quota-gallery");
  await pwExpect(gallery.locator('.progress-fill[data-health="ok"]')).toHaveCount(4);
  await pwExpect(gallery.locator('.progress-fill[data-health="warn"]')).toHaveCount(4);
  await pwExpect(gallery.locator('.progress-fill[data-health="bad"]')).toHaveCount(4);

  // 契约复用: 方案页的条就是 .progress(与正文卡同一 DOM 契约)
  await pwExpect(gallery.locator(".progress")).toHaveCount(12);

  // 图例三态色
  await pwExpect(page.getByTestId("quota-legend")).toBeVisible();

  // 返回面板(侧栏仍在)
  await page.getByTestId("quota-back").click();
  await pwExpect(page.getByTestId("quota-gallery")).toHaveCount(0);
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
});

test("方案页截图取证(三态渲染, 落 /tmp)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openGallery(page);
  // 等 grow-in 动画落定避免截到半透明帧
  await page.waitForTimeout(700);
  await page.getByTestId("quota-gallery").screenshot({ path: "/tmp/quota-gallery-proof.png" });
});