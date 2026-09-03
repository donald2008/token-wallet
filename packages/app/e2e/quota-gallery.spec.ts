import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(完整四元素组件实例方案页, t_af01e265, feat/theme-glass 实验):
 * - 同意首开 → 设置 → 「额度组件实例方案」入口 → 方案页打开
 * - 竖排多个完整四元素实例(标题+重置+进度条+用量), 非表格矩阵
 * - 三态色(ok/warn/bad)齐全; 复用 e2e DOM 契约(.progress/.progress-fill[data-health]/role=progressbar)
 * - 返回按钮回面板
 */

/** 同意首开隐私声明 → 面板(侧栏出现) */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
}

/** 打开设置 → 进入额度组件实例方案页 */
async function openGallery(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("quota-open").click();
  await pwExpect(page.getByTestId("quota-gallery")).toBeVisible();
}

test("方案页: 从设置打开, 竖排完整四元素实例, 三态色齐全, 契约复用", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openGallery(page);

  const gallery = page.getByTestId("quota-gallery");

  // 竖排实例列表(非表格): N 条实例, 每条完整四元素
  const instances = gallery.locator(".quota-instance");
  await pwExpect(instances).toHaveCount(5);

  // 每条实例 = 标题 + 重置 + 进度条 + 用量(四元素齐全)
  for (let i = 0; i < 5; i++) {
    const inst = instances.nth(i);
    await pwExpect(inst.locator(".quota-title")).toHaveCount(1);
    await pwExpect(inst.locator(".quota-reset")).toHaveCount(1);
    await pwExpect(inst.locator('[role="progressbar"]')).toHaveCount(1);
    await pwExpect(inst.locator(".quota-usage")).toHaveCount(1);
  }

  // 进度条契约: 全部带 role=progressbar + aria-valuenow; 首条 flash_40 = 40% ok
  await pwExpect(gallery.locator('[role="progressbar"]')).toHaveCount(5);
  await pwExpect(gallery.locator(".progress")).toHaveCount(5);
  await pwExpect(gallery.locator('[role="progressbar"]').first()).toHaveAttribute("aria-valuenow", "40");

  // 三态色齐全(数据驱动 mock: flash_40/perf_23 ok, deep_58/week_72 warn, month_91 bad)
  await pwExpect(gallery.locator('.progress-fill[data-health="ok"]')).toHaveCount(2);
  await pwExpect(gallery.locator('.progress-fill[data-health="warn"]')).toHaveCount(2);
  await pwExpect(gallery.locator('.progress-fill[data-health="bad"]')).toHaveCount(1);

  // 非表格确认: 旧矩阵结构(.quota-table/.quota-row/.quota-vhead)不残留
  await pwExpect(gallery.locator(".quota-table, .quota-row, .quota-vhead")).toHaveCount(0);

  // 图例三态色
  await pwExpect(page.getByTestId("quota-legend")).toBeVisible();

  // 返回面板(侧栏仍在)
  await page.getByTestId("quota-back").click();
  await pwExpect(page.getByTestId("quota-gallery")).toHaveCount(0);
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
});

test("方案页截图取证(完整实例三态渲染, 落 /tmp)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openGallery(page);
  // 等 grow-in 动画落定避免截到半透明帧
  await page.waitForTimeout(700);
  await page.getByTestId("quota-gallery").screenshot({ path: "/tmp/quota-instances-proof.png" });
});