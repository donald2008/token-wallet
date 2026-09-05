import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(四元素排版变体对比页, t_35ff3c1f + t_23800bd4 mock 修正, feat/theme-glass 实验):
 * - 同意首开 → 设置 → 「排版变体方案」入口 → 方案页打开
 * - 5 段排版(qvar-row/duo/hero/micro/ticker) × 每段 4 条完整四元素(标题+重置+条+用量)
 * - 同一组数据喂所有排版(各段首条标题/用量一致, 首条 aria-valuenow=40)
 * - 数据(t_23800bd4): 前 3 条百分制三态(40%/72%/91%, 真实 provider 风格名, 无「xx 次」误导),
 *   第 4 条计数制演示(credits 2300/10000); 填充 ok 10 / warn 5 / bad 5
 * - 复用 e2e DOM 契约(.progress/.progress-fill[data-health]/role=progressbar)
 * - 返回按钮回面板
 * - t_85237167 9/5 清空重建: 旧 S1-S4 删, 新 4 方案(A/B/C/D) + 异常段,
 *   全部基于 tooltip QuotaMeter(BarRowTooltip + QuotaMeter layout=micro) 组合
 *   总 progressbar 36 = 5 排版段 20 + 4 方案卡片段 16
 */

const LAYOUTS = ["row", "duo", "hero", "micro", "ticker"] as const;

/** 同意首开隐私声明 → 面板(侧栏出现) */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
}

/** 打开设置 → 进入排版变体方案页 */
async function openGallery(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("quota-open").click();
  await pwExpect(page.getByTestId("quota-gallery")).toBeVisible();
}

test("方案页: 同数据×5种排版, 每段 4 条完整四元素, 单位语义上屏, 契约复用", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openGallery(page);

  const gallery = page.getByTestId("quota-gallery");

  // 5 段排版齐; 每段画布内 4 条 meter, 每条四元素齐全
  for (const layout of LAYOUTS) {
    const canvas = page.getByTestId(`qvar-canvas-${layout}`);
    await pwExpect(canvas).toBeVisible();
    await pwExpect(canvas.locator("[data-testid='quota-meter']")).toHaveCount(4);
    await pwExpect(canvas.locator(".quota-title")).toHaveCount(4);
    await pwExpect(canvas.locator(".quota-reset")).toHaveCount(4);
    await pwExpect(canvas.locator('[role="progressbar"]')).toHaveCount(4);
    await pwExpect(canvas.locator(".quota-usage")).toHaveCount(4);
  }

  // 同数据跨段: 每段第 1 条标题一致 = OpenCode 5 小时窗(真实 provider 风格, 无「xx 次」误导);
  // 每段第 1 条 aria-valuenow = 40
  const firstTitles: string[] = [];
  for (const layout of LAYOUTS) {
    const canvas = page.getByTestId(`qvar-canvas-${layout}`);
    const firstTitle = (await canvas.locator(".quota-title").first().textContent()) ?? "";
    firstTitles.push(firstTitle);
    await pwExpect(canvas.locator('[role="progressbar"]').first()).toHaveAttribute("aria-valuenow", "40");
  }
  pwExpect(firstTitles).toEqual(Array(LAYOUTS.length).fill("OpenCode 5 小时窗"));

  // 单位语义: row 段首条百分制 "40% / 100%", 第 4 条计数制演示带 credits
  const rowCanvas = page.getByTestId("qvar-canvas-row");
  await pwExpect(rowCanvas.locator(".quota-usage").first()).toHaveText("40% / 100%");
  await pwExpect(rowCanvas.locator(".quota-usage").nth(3)).toContainText("2300 / 10000 credits");

  // 总契约: 39 条 progressbar/进度条
  //   5 排版段 4 × 5 = 20 + 4 方案卡片段 19 = 39
  //   A=4 / B=6(2 row + 2 BarRowTooltip + 2 触发器 BarRowTooltip) / C=4 / D=5(2 row + 2 BarRowTooltip + 1 头部触发器)
  //   异常 2 卡 0
  // 填充 ok 19 / warn 15 / bad 5
  // t_85237167 9/5 重建: 卡内方案段 4 方案 + 异常段
  await pwExpect(gallery.locator('[role="progressbar"]')).toHaveCount(39);
  await pwExpect(gallery.locator(".progress")).toHaveCount(39);
  await pwExpect(gallery.locator(".progress-fill[data-health='ok']")).toHaveCount(19);
  await pwExpect(gallery.locator(".progress-fill[data-health='warn']")).toHaveCount(15);
  await pwExpect(gallery.locator(".progress-fill[data-health='bad']")).toHaveCount(5);

  // 每段 meter 的 data-layout 与 class 和所在段一致(容器层排版生效)
  for (const layout of LAYOUTS) {
    const canvas = page.getByTestId(`qvar-canvas-${layout}`);
    const meters = canvas.locator("[data-testid='quota-meter']");
    await pwExpect(meters.first()).toHaveAttribute("data-layout", layout);
    await pwExpect(meters.first()).toHaveClass(new RegExp(`quota-meter--layout-${layout}`));
  }

  // 非表格确认: 旧矩阵结构不残留
  await pwExpect(gallery.locator(".quota-table, .quota-row, .quota-vhead")).toHaveCount(0);

  // 图例三态色
  await pwExpect(page.getByTestId("quota-legend")).toBeVisible();

  // Provider 卡片卡内排版方案段(t_85237167 9/5 重建): 4 方案 (A/B/C/D) + 异常段,
  // 全部基于 tooltip QuotaMeter(BarRowTooltip + QuotaMeter layout=micro) 组合
  for (const key of ["a", "b", "c", "d"]) {
    const canvas = page.getByTestId(`qvar-canvas-cards2-${key}`);
    await pwExpect(canvas).toBeVisible();
    const cards = canvas.locator("[data-testid='qcard2']");
    await pwExpect(cards).toHaveCount(1);
    const card = cards.first();
    // 卡头组合 + Kimi-Code #1(主页同形态)
    await pwExpect(card.locator("[data-testid='qcard2-name']")).toHaveText("Kimi-Code #1");
    // 每张 ok 卡 2 窗行, 每行嵌 1 个 BarRowTooltip(micro, tooltip 原语契约)
    const rows = card.locator("[data-testid='qcard2-bar-row']");
    await pwExpect(rows).toHaveCount(2);
    await pwExpect(rows.first().locator("[data-testid='bar-tooltip']")).toHaveCount(1);
  }
  // 异常段: 2 张卡(auth_expired warn + setup_hint / error bad 无 hint)
  const abn = page.getByTestId("qvar-canvas-cards2-abn");
  await pwExpect(abn.locator("[data-testid='qcard2']")).toHaveCount(2);
  await pwExpect(abn.locator("[data-testid='qcard2-hint']")).toHaveCount(1);
  await pwExpect(abn.locator('[role="progressbar"]')).toHaveCount(0);
  // 方案 C 锁住态容器: tabIndex + role=button + data-pinnable=true
  const cardC = page.getByTestId("qvar-canvas-cards2-c").locator("[data-testid='qcard2']");
  await pwExpect(cardC).toHaveAttribute("tabindex", "0");
  await pwExpect(cardC).toHaveAttribute("role", "button");
  // 方案 B 头部综合态: .qcard2-status-group + qcard2-trigger(ⓘ + 合并 tooltip)
  const cardB = page.getByTestId("qvar-canvas-cards2-b").locator("[data-testid='qcard2']");
  await pwExpect(cardB.locator("[data-testid='qcard2-status-group']")).toHaveCount(1);
  await pwExpect(cardB.locator("[data-testid='qcard2-trigger']")).toHaveCount(1);
  // 方案 D 头部承担最紧窗: qcard2-headline + qcard2-head-trigger(内嵌 BarRowTooltip)
  const cardD = page.getByTestId("qvar-canvas-cards2-d").locator("[data-testid='qcard2']");
  await pwExpect(cardD.locator("[data-testid='qcard2-headline']")).toHaveCount(1);
  await pwExpect(cardD.locator("[data-testid='qcard2-head-trigger'] [data-testid='bar-tooltip']")).toHaveCount(1);

  // 返回面板(侧栏仍在)
  await page.getByTestId("quota-back").click();
  await pwExpect(page.getByTestId("quota-gallery")).toHaveCount(0);
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
});

test("方案页截图取证(5 种排版 + 4 方案 + 异常段逐段落 /tmp)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openGallery(page);
  // 等 grow-in 动画落定避免截到半透明帧
  await page.waitForTimeout(700);
  await page.getByTestId("quota-gallery").screenshot({ path: "/tmp/quota-layouts-top.png" });
  for (const layout of LAYOUTS) {
    const section = page.getByTestId(`qvar-${layout}`);
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await section.screenshot({ path: `/tmp/quota-layout-${layout}.png` });
  }
  // t_85237167 9/5 重建: 4 方案 + 异常段逐段落 /tmp(每方案一张)
  for (const key of ["a", "b", "c", "d", "abn"]) {
    const section = page.getByTestId(`qvar-cards2-${key}`);
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await section.screenshot({ path: `/tmp/quota-card2-${key}.png` });
  }
});
