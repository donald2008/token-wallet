import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(P1 t_9639078b): 主页过滤三枚 icon 钮(chips 收敛重设计)。
 *
 * 覆盖验收(t_9639078b 契约):
 *   - 三枚 24px icon 钮(全部◇ / 可用✓ / 异常⚠)浮在卡片列表右上角, 与卡片列表同容器(绝对定位)
 *   - 无计数角标 / 无文字 / 无平台 chips —— 颜色即信息
 *   - 单选语义: 点选切换视角, 再点当前选中 = 回「全部」; 过滤行为与 v0.1.2 一致
 *   - 过滤后空态 → 居中「无匹配实例」(钮组仍在, 可点回其他视角)
 *   - 钮组不与滚动内容重叠(在卡片列表容器内、随内容滚动运动, 非吸顶独立行)
 *
 * 驱动方式: dev scenario 场景切换器(mixed=4 卡 → expired=1 异常卡 → error), 与 dev 预览卡共用。
 */

async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

test("三枚 icon 钮在卡片列表内右上角: 3 个 radio, 无计数角标/无文字/无平台 chips", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click(); // 4 卡

  // 钮组在卡片列表容器内(同容器), 非上方独立行
  const icons = page.getByTestId("filter-icons");
  await pwExpect(icons).toBeVisible();
  const iconsBox = (await icons.boundingBox())!;
  const listBox = (await page.getByTestId("card-list").boundingBox())!;
  // 三者 y 都在卡片列表容器纵向范围内(非独立行) → 与容器同高带, 不吸顶盖不住滚动内容
  pwExpect(iconsBox.y).toBeGreaterThanOrEqual(listBox.y);
  pwExpect(iconsBox.y + iconsBox.height).toBeLessThanOrEqual(listBox.y + listBox.height);
  // 关键: 绝对定位在卡片列表容器内(非 fixed/sticky 独立层) → 随内容滚动运动, 不吸顶不重叠
  await pwExpect(icons).toHaveCSS("position", "absolute");
  const offsetParent = await icons.evaluate(
    (el) => ((el as HTMLElement).offsetParent as HTMLElement)?.getAttribute("class"),
  );
  pwExpect(offsetParent).toContain("card-list");

  // 恰好三枚钮(全部/可用/异常), role=radio
  await pwExpect(icons.locator('[role="radio"]')).toHaveCount(3);
  await pwExpect(page.getByTestId("filter-all")).toHaveAttribute("aria-checked", "true"); // 默认「全部」
  // 收敛: 无计数角标、无文字 label、无平台 chips
  await pwExpect(page.locator(".filter-chip-count")).toHaveCount(0);
  await pwExpect(page.locator('[data-testid^="filter-platform-"]')).toHaveCount(0);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);
});

test("单选切换: 点可用→2卡, 点已选→回全部(4卡)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();

  // 点「可用」→ 只剩 2 卡(deepseek ok + ark ok; kimi-code 即将耗尽/aliyun auth_expired 隐藏)
  await page.getByTestId("filter-available").click();
  await pwExpect(page.getByTestId("filter-available")).toHaveAttribute("aria-checked", "true");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(2);
  await pwExpect(page.locator('[data-testid="provider-card"][data-provider="aliyun"]')).toHaveCount(0);

  // 点已选「可用」→ 取消回「全部」4 卡
  await page.getByTestId("filter-available").click();
  await pwExpect(page.getByTestId("filter-all")).toHaveAttribute("aria-checked", "true");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);
});

test("单选切换: 点异常→1卡(aliyun), 点已选→回全部", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();

  await page.getByTestId("filter-abnormal").click();
  await pwExpect(page.getByTestId("filter-abnormal")).toHaveAttribute("aria-checked", "true");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1);
  await pwExpect(page.locator('[data-testid="provider-card"][data-provider="aliyun"]')).toHaveCount(1);

  // 点已选「异常」→ 取消回「全部」
  await page.getByTestId("filter-abnormal").click();
  await pwExpect(page.getByTestId("filter-all")).toHaveAttribute("aria-checked", "true");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);
});

test("过滤后空态 → 居中文案「无匹配实例」; 钮组仍在可切回", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  // expired 场景只有 1 张异常卡(auth_expired), 点「可用」→ 0 命中 → 无匹配实例
  await page.getByTestId("scenario-expired").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1);

  await page.getByTestId("filter-available").click();
  await pwExpect(page.getByTestId("no-match")).toBeVisible();
  await pwExpect(page.getByTestId("no-match")).toContainText("无匹配实例");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(0);
  // 钮组仍在(卡片列表容器内), 用户可切回异常视角
  await pwExpect(page.getByTestId("filter-icons")).toBeVisible();

  // 切回「异常」→ 恢复 1 卡(空态消失)
  await page.getByTestId("filter-abnormal").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1);
  await pwExpect(page.getByTestId("no-match")).toHaveCount(0);
});

test("默认态三枚钮半透明、选中态描边高亮(computed-style 客观核验, 主题无关)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();

  // 默认「全部」选中: 全不透明 + 描边非透明(accent 生效); 未选中「可用」半透明 + 描边透明
  // (toHaveCSS 自动重试, 跨过 opacity 0.15s 过渡期, 稳定断言最终 computed 态)
  await pwExpect(page.getByTestId("filter-all")).toHaveCSS("opacity", "1");
  await pwExpect(page.getByTestId("filter-all")).toHaveCSS("border-color", /^rgb/);
  await pwExpect(page.getByTestId("filter-available")).toHaveCSS("opacity", "0.4");
  await pwExpect(page.getByTestId("filter-available")).toHaveCSS("border-color", "rgba(0, 0, 0, 0)");

  // 选「可用」→ 其描边变非透明(accent 高亮), 原「全部」回落半透明 + 描边透明
  await page.getByTestId("filter-available").click();
  await pwExpect(page.getByTestId("filter-available")).toHaveCSS("opacity", "1");
  await pwExpect(page.getByTestId("filter-available")).toHaveCSS("border-color", /^rgb/);
  await pwExpect(page.getByTestId("filter-all")).toHaveCSS("opacity", "0.4");
  await pwExpect(page.getByTestId("filter-all")).toHaveCSS("border-color", "rgba(0, 0, 0, 0)");
});

/** 两矩形交集面积 px²(负数/无交集返回 0)。 */
function intersectArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

test("钮组与首卡零重叠(360px 最窄档几何断言, round2 BLOCKING 回归)", async ({ hostPage, page }) => {
  void hostPage;
  // 验收第 1 条「钮组不与任何滚动内容重叠(360px 最窄档实拍)」: 真实产品视口下
  // 钮组必须与首卡头行/状态字交集面积==0 —— round1 BLOCKING(q: 钮组骑跨首卡顶框盖状态字)。
  await page.setViewportSize({ width: 360, height: 800 });
  await agree(page);
  await page.getByTestId("scenario-mixed").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);

  const icons = await page.getByTestId("filter-icons").boundingBox();
  pwExpect(icons).not.toBeNull();
  pwExpect(icons!.width).toBeGreaterThan(0);
  pwExpect(icons!.height).toBeGreaterThan(0);

  const firstCard = page.locator('[data-testid="provider-card"]').first();
  const head = await firstCard.locator(".card-head").boundingBox();
  const status = await firstCard.locator(".card-head .card-status-text").boundingBox();
  pwExpect(head).not.toBeNull();
  pwExpect(status).not.toBeNull();

  // 交集面积 0 = 钮组与首卡内容零重叠(验收硬指标)
  pwExpect(intersectArea(icons!, head!)).toBe(0);
  pwExpect(intersectArea(icons!, status!)).toBe(0);
  // 兜底: 纵向上也要求首卡头行起点在钮组底边之下(预留带清空)
  pwExpect(head!.y).toBeGreaterThanOrEqual(icons!.y + icons!.height);
});