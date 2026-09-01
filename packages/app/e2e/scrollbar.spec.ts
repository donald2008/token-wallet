import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(v0.1.4 真机反馈): 滚动条槽常驻 + 细滚动条重设计。
 *
 * 覆盖验收:
 *   - 漂移回归: .card-list scrollbar-gutter: stable —— 滚动条出现/消失时,
 *     卡片右缘与过滤钮组横向位置零位移(修 v0.1.3「滚动条出现钮组向左漂移」)
 *   - 细滚动条: ::-webkit-scrollbar 宽 8px, thumb 有主题化背景色(非默认 17px 灰条)
 *
 * 手法: 先高视口(不滚动)记录右缘基线, 逐步压低视口高度强制滚动条出现, 复测右缘。
 * 驱动方式与 filter-chips.spec.ts 同款(dev scenario 切换器, mixed=4 卡)。
 */

async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

/** 卡片右缘 + 过滤钮组右缘(漂移断言的观测点)。 */
async function rightEdges(page: import("@playwright/test").Page) {
  const card = await page.locator('[data-testid="provider-card"]').first().boundingBox();
  const icons = await page.getByTestId("filter-icons").boundingBox();
  pwExpect(card).not.toBeNull();
  pwExpect(icons).not.toBeNull();
  return { cardRight: card!.x + card!.width, iconsRight: icons!.x + icons!.width };
}

test("滚动条槽常驻: 滚动条出现前后卡片/钮组右缘零位移(漂移回归)", async ({ hostPage, page }) => {
  void hostPage;
  // 高视口起步: mixed 4 卡放得下, 无滚动条 → 基线
  await page.setViewportSize({ width: 480, height: 900 });
  await agree(page);
  await page.getByTestId("scenario-mixed").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);

  const list = page.getByTestId("card-list");
  pwExpect(await list.evaluate((el) => getComputedStyle(el).scrollbarGutter)).toBe("stable");

  const before = await rightEdges(page);

  // 逐步压低视口直到列表真实可滚(scrollbar 出现; 步进 120px, 保底 320px)
  let scrollable = false;
  for (let h = 780; h >= 320; h -= 120) {
    await page.setViewportSize({ width: 480, height: h });
    scrollable = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    if (scrollable) break;
  }
  pwExpect(scrollable).toBe(true); // 测试自身有效性: 确实进入了滚动条可见态

  const after = await rightEdges(page);
  // 交集断言: 滚动条出现挤压内容宽度 → 右缘左移 = 修复前必挂的漂移特征; stable 下必须零位移
  pwExpect(Math.abs(after.cardRight - before.cardRight)).toBeLessThan(0.5);
  pwExpect(Math.abs(after.iconsRight - before.iconsRight)).toBeLessThan(0.5);
});

test("细滚动条: ::-webkit-scrollbar 宽 8px, thumb 主题化着色(非默认灰条)", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 480, height: 900 });
  await agree(page);
  await page.getByTestId("scenario-mixed").click();

  const list = page.getByTestId("card-list");
  const style = await list.evaluate((el) => {
    const sb = getComputedStyle(el, "::-webkit-scrollbar");
    const thumb = getComputedStyle(el, "::-webkit-scrollbar-thumb");
    return { width: sb.width, thumbColor: thumb.backgroundColor };
  });
  pwExpect(style.width).toBe("8px");
  // thumb 走主题 color-mix(前景色低透明混合)。断言语义 = 有主题化非透明色(默认滚动条此处
  // 为空串/全透明)。Chromium 对 color-mix 序列化为 CSS Color 4 形态 color(srgb r g b / a),
  // 兼容 rgba(...) 与不透明 rgb(...) 三种形态取 alpha:
  const alpha =
    style.thumbColor.match(/\/\s*([\d.]+)\s*\)$/)?.[1] ?? // color(srgb ... / a)
    style.thumbColor.match(/,\s*([\d.]+)\)$/)?.[1] ?? // rgba(r, g, b, a)
    /^rgb/.test(style.thumbColor) // rgb(r, g, b) 不透明形态
      ? "1"
      : "0";
  pwExpect(parseFloat(alpha)).toBeGreaterThan(0);
});
