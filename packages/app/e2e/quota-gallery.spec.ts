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

  // 总契约: 24 条 progressbar/进度条(4 数据 × 5 排版 + Provider 卡 2 窗 × 2 方案);
  // 填充 ok 12 / warn 7 / bad 5(t_698a43c9 卡片段: A/B 各加 kimi 5h 80% warn + 周窗 20% ok)
  await pwExpect(gallery.locator('[role="progressbar"]')).toHaveCount(24);
  await pwExpect(gallery.locator(".progress")).toHaveCount(24);
  await pwExpect(gallery.locator(".progress-fill[data-health='ok']")).toHaveCount(12);
  await pwExpect(gallery.locator(".progress-fill[data-health='warn']")).toHaveCount(7);
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

  // Provider 卡片组合层方案段(t_698a43c9): A=row(2窗) B=duo(2窗) 同数据; 异常段无假窗口行
  for (const [key, layout] of [
    ["a", "row"],
    ["b", "duo"],
  ] as const) {
    const canvas = page.getByTestId(`qvar-canvas-cards-${key}`);
    await pwExpect(canvas).toBeVisible();
    const meters = canvas.locator("[data-testid='quota-meter']");
    await pwExpect(meters).toHaveCount(2);
    await pwExpect(meters.first()).toHaveAttribute("data-layout", layout);
    await pwExpect(meters.first()).toHaveClass(new RegExp(`quota-meter--layout-${layout}`));
  }
  // A 卡头组合 + 真实感用量(kimi 5h requests 计数制, 主页同形态)
  const cardA = page.getByTestId("qvar-canvas-cards-a").locator("[data-testid='qcard']");
  await pwExpect(cardA).toHaveAttribute("data-health", "warn");
  await pwExpect(cardA.locator(".qcard-name")).toHaveText("Kimi-Code #1");
  await pwExpect(cardA.locator("[data-testid='status-dot']")).toHaveAttribute("data-health", "warn");
  await pwExpect(cardA.locator(".qcard-windows .quota-usage").first()).toContainText("960 / 1200");
  // 异常段: auth_expired 卡(黄+hint) + error 卡(红) 且无任何 progressbar(§2.1 不显示假数据)
  const abn = page.getByTestId("qvar-canvas-cards-abn");
  await pwExpect(abn.locator("[data-testid='qcard']")).toHaveCount(2);
  await pwExpect(abn.locator("[data-testid='qcard-hint']")).toHaveCount(1);
  await pwExpect(abn.locator('[role="progressbar"]')).toHaveCount(0);

  // 返回面板(侧栏仍在)
  await page.getByTestId("quota-back").click();
  await pwExpect(page.getByTestId("quota-gallery")).toHaveCount(0);
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
});

test("方案页截图取证(5 种排版逐段落 /tmp)", async ({ hostPage, page }) => {
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
  // Provider 卡片组合层方案(t_698a43c9): 方案 A(row 卡) / B(duo 卡) / 异常段逐段落 /tmp
  for (const key of ["a", "b", "abn"]) {
    const section = page.getByTestId(`qvar-cards-${key}`);
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await section.screenshot({ path: `/tmp/quota-card-${key}.png` });
  }
});
