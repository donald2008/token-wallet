import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(QuotaGallery Provider 卡片排版方案页, t_73c110ea 9/7 重建):
 * - 同意首开 → 设置 → 「Provider 卡片排版方案」入口 → 方案页打开
 * - 4 排版段 (P1-P4) + 异常段 (auth_expired + error 共用 AbnormalBody 骨架)
 * - 同一套三窗真实数据 (kimi-code rolling_5h + weekly + monthly, unit=requests)
 * - 三窗 QuotaMeter(layout=row) **常驻直显** = 卡片信息主体(用户 9/7 硬约束)
 * - BarRowTooltip 仅作可选密度增强(行 hover 补 micro, 不替代 QuotaMeter)
 * - 复用 e2e DOM 契约(.progress/.progress-fill[data-health]/role=progressbar)
 * - 返回按钮回面板
 *
 * 旧契约(已作废, t_85237167 → t_73c110ea 9/7 重建):
 *   - 5 排版对比段(qvar-row/duo/hero/micro/ticker) → 整段删除
 *   - 4 方案 A/B/C/D + 异常段(qvar-cards2-*) → 替换为 P1/P2/P4 (qvar-cards3-*, 3 方案; P3 grid 在 360px 屏实测文字重叠 + 列被裁切, 本轮不交付)
 *   - 总 progressbar 39 → 18 (3 ok 卡 × 3 窗 × 2 QuotaMeter: 行内 + tooltip)
 *   - 旧"1 种排版 + 4 头部装饰"差异(已作废) → 新"真排版维度"差异
 */

/** 同意首开隐私声明 → 面板 */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
}

/** 打开设置 → 进入 Provider 卡片排版方案页 */
async function openGallery(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("quota-open").click();
  await pwExpect(page.getByTestId("quota-gallery")).toBeVisible();
}

const SCHEMES = ["p1", "p2", "p4"] as const;

test("方案页: 3 排版 + 异常段, 同一套三窗真实数据, QuotaMeter(row) 三窗常驻直显, 契约复用", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openGallery(page);

  const gallery = page.getByTestId("quota-gallery");

  // 4 排版段齐; 每段画布内 1 张 ok 卡, 卡名 = Kimi-Code #1, 健康由最紧窗 5h 80% → warn
  for (const key of SCHEMES) {
    const canvas = page.getByTestId(`qvar-canvas-cards3-${key}`);
    await pwExpect(canvas).toBeVisible();
    const card = canvas.locator("[data-testid='qcard3']");
    await pwExpect(card).toHaveCount(1);
    await pwExpect(card.locator("[data-testid='qcard3-name']")).toHaveText("Kimi-Code #1");
    // 卡头含 handle + 三态契约 data-health=warn
    await pwExpect(card.locator("[data-testid='qcard3-handle']")).toHaveCount(1);
    await pwExpect(card).toHaveAttribute("data-health", "warn");
  }

  // 三窗 QuotaMeter(row) **常驻直显**(用户硬约束):
  //   每张 ok 卡 = 3 bar-row, 每行嵌 1 行 QuotaMeter(row) + 1 BarRowTooltip(micro)
  //   → 每张 ok 卡 = 6 progressbar(3 行内 + 3 tooltip 内)
  for (const key of SCHEMES) {
    const card = page.getByTestId(`qvar-canvas-cards3-${key}`).locator("[data-testid='qcard3']");
    await pwExpect(card.locator("[data-testid='qcard3-bar-row']")).toHaveCount(3);
    await pwExpect(card.locator("[data-testid='quota-meter'][data-layout='row']")).toHaveCount(3);
    await pwExpect(card.locator("[data-testid='quota-meter'][data-layout='micro']")).toHaveCount(3);
    await pwExpect(card.locator(".progress")).toHaveCount(6);
    await pwExpect(card.locator('[role="progressbar"]')).toHaveCount(6);
  }

  // 同一套三窗真实数据: 4 张 ok 卡标题/用量文案一致
  // 数据契约: rolling_5h 960/1200 warn / weekly 1200/6000 ok / monthly 1800/6000 ok
  for (const key of SCHEMES) {
    const card = page.getByTestId(`qvar-canvas-cards3-${key}`).locator("[data-testid='qcard3']");
    const rowMeters = card.locator("[data-testid='quota-meter'][data-layout='row']");
    // 标题: 5 小时窗 / 周窗 / 月窗(zh)
    await pwExpect(rowMeters.locator(".quota-title").nth(0)).toHaveText("5 小时窗");
    await pwExpect(rowMeters.locator(".quota-title").nth(1)).toHaveText("周窗");
    await pwExpect(rowMeters.locator(".quota-title").nth(2)).toHaveText("月窗");
  }

  // P1/P2 两张卡的用量文案一致(计数制, zh 单位词「次」)
  for (const key of ["p1", "p2"] as const) {
    const card = page.getByTestId(`qvar-canvas-cards3-${key}`).locator("[data-testid='qcard3']");
    const rowMeters = card.locator("[data-testid='quota-meter'][data-layout='row']");
    await pwExpect(rowMeters.locator(".quota-usage").nth(0)).toContainText("(80%)"); // 5h 80%
    await pwExpect(rowMeters.locator(".quota-usage").nth(1)).toContainText("(20%)"); // weekly 20%
    await pwExpect(rowMeters.locator(".quota-usage").nth(2)).toContainText("(30%)"); // monthly 30%
  }

  // P4 头部数字(最紧窗数字内联):
  //   headline = 窗名 + 数字, 最紧窗行 hideUsage 不渲染 .quota-usage
  const cardP4 = page.getByTestId("qvar-canvas-cards3-p4").locator("[data-testid='qcard3']");
  await pwExpect(cardP4.locator("[data-testid='qcard3-headline']")).toHaveCount(1);
  // headline 含窗名 + requests 数字
  await pwExpect(cardP4.locator(".qcard3-headline-window")).toHaveText("5 小时窗");
  await pwExpect(cardP4.locator(".qcard3-headline-usage")).toContainText("960");
  // 最紧窗(rolling_5h)行 QuotaMeter(row) 无 .quota-usage(hideUsage)
  const p4TightestRow = cardP4.locator("[data-testid='qcard3-bar-row'][data-metric='rolling_5h']");
  await pwExpect(p4TightestRow.locator("[data-testid='quota-meter'][data-layout='row'] .quota-usage")).toHaveCount(0);
  // 非最紧窗行(weekly/monthly)行内 QuotaMeter 有 .quota-usage
  await pwExpect(cardP4.locator("[data-testid='qcard3-bar-row'][data-metric='weekly'] [data-testid='quota-meter'][data-layout='row'] .quota-usage")).toHaveCount(1);
  await pwExpect(cardP4.locator("[data-testid='qcard3-bar-row'][data-metric='monthly'] [data-testid='quota-meter'][data-layout='row'] .quota-usage")).toHaveCount(1);

  // P2 头部综合态(StatusDot+综合态文字同行, 一行内整合)
  const cardP2 = page.getByTestId("qvar-canvas-cards3-p2").locator("[data-testid='qcard3']");
  await pwExpect(cardP2.locator("[data-testid='qcard3-status-group']")).toHaveCount(1);
  await pwExpect(cardP2.locator("[data-testid='qcard3-status-group'] [data-testid='status-dot']")).toHaveCount(1);
  await pwExpect(cardP2.locator(".qcard3-status-label")).not.toBeEmpty();

  // (P3 双列 grid 在 360px 屏实测文字重叠 + 列被裁切, 本轮不交付, 故 e2e 不验证 P3)

  // 总契约: 18 条 progressbar/进度条 (3 ok 卡 × 3 窗 × 2 QuotaMeter)
  await pwExpect(gallery.locator('[role="progressbar"]')).toHaveCount(18);
  await pwExpect(gallery.locator(".progress")).toHaveCount(18);
  // 健康分布: rolling_5h 80% warn × 3 卡 × 2 QuotaMeter = 6 warn; weekly + monthly ok × 3 卡 × 2 × 2 = 12 ok
  await pwExpect(gallery.locator(".progress-fill[data-health='ok']")).toHaveCount(12);
  await pwExpect(gallery.locator(".progress-fill[data-health='warn']")).toHaveCount(6);
  await pwExpect(gallery.locator(".progress-fill[data-health='bad']")).toHaveCount(0);

  // 旧契约清空(无 5 排版段, 无旧 4 方案卡片段)
  for (const old of ["row", "duo", "hero", "micro", "ticker"]) {
    await pwExpect(page.getByTestId(`qvar-${old}`)).toHaveCount(0);
  }
  for (const old of ["a", "b", "c", "d"]) {
    await pwExpect(page.getByTestId(`qvar-canvas-cards2-${old}`)).toHaveCount(0);
    await pwExpect(page.getByTestId(`qvar-canvas-cards2-${old}`).locator("[data-testid='qcard2']")).toHaveCount(0);
  }
  await pwExpect(gallery.locator("[data-testid='qcard2'], .qcard2")).toHaveCount(0);

  // 异常段: 2 张卡(auth_expired warn + setup_hint / error bad 无 hint)
  const abn = page.getByTestId("qvar-canvas-cards3-abn");
  await pwExpect(abn.locator("[data-testid='qcard3']")).toHaveCount(2);
  await pwExpect(abn.locator("[data-testid='qcard3-abnormal']")).toHaveCount(2);
  // auth_expired: 黄灯 + setup_hint 授权面板(hint-copy-btn 复制命令原文)
  await pwExpect(abn.locator(".qcard3-lamp")).toHaveCount(1);
  await pwExpect(abn.locator("[data-testid='qcard3-hint']")).toHaveCount(1);
  await pwExpect(abn.locator("[data-testid='hint-copy-btn']")).toHaveCount(1);
  // 异常段无 progressbar(共用 AbnormalBody, 不渲染假窗口行 §2.1)
  await pwExpect(abn.locator('[role="progressbar"]')).toHaveCount(0);

  // 图例三态色
  await pwExpect(page.getByTestId("quota-legend")).toBeVisible();

  // 返回面板
  await page.getByTestId("quota-back").click();
  await pwExpect(page.getByTestId("quota-gallery")).toHaveCount(0);
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
});

test("方案页截图取证(4 排版 + 异常段逐段落 /tmp, t_73c110ea)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openGallery(page);
  // 等 grow-in 动画落定避免截到半透明帧
  await page.waitForTimeout(700);
  await page.getByTestId("quota-gallery").screenshot({ path: "/tmp/quota-cards3-top.png" });
  for (const key of SCHEMES) {
    const section = page.getByTestId(`qvar-cards3-${key}`);
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await section.screenshot({ path: `/tmp/quota-cards3-${key}.png` });
  }
  // 异常段截图
  const abn = page.getByTestId("qvar-cards3-abn");
  await abn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await abn.screenshot({ path: "/tmp/quota-cards3-abn.png" });
});