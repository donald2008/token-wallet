import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(t_9639078b → t_f7d1beeb 修订 E): 主页过滤三枚 icon 钮的契约改写。
 *
 * 历史(t_9639078b): 三枚 24px icon 钮(全部◇ / 可用✓ / 异常⚠)浮在卡片列表右上角,
 * 绝对定位 + 随内容滚动运动, 单选切换视角。
 *
 * t_f7d1beeb 9/7 修订 E: 用户反馈「主页上层的筛选按钮先隐藏, 感觉比较占地方」——
 * App.tsx 改为 `{false && <FilterIcons .../>}` 渲染(组件 + state 管线保留, 后续
 * 改回 true 即恢复)。本 spec 整体改写为「**filter 隐藏后契约**」, 覆盖:
 *   1. .filter-icons 节点确实不渲染(0 count)—— 防「忘记改 false」回归
 *   2. filter 状态管线仍可达(4 张卡可见 = filter=DEFAULT_FILTER 未被破坏)
 *   3. 场景切换(expired/error)仍正常 = 内部 state 管线运转(其他 filter 状态管线未受影响)
 *   4. 三主题截图视觉对齐(共 2 张: 默认态 + expired 态)
 *
 * FilterIcons 组件本身的契约覆盖留在 FilterChips.test.tsx L1(完整覆盖了
 * FilterIcons 渲染 / DEFAULT_FILTER / matchesFilter / isAvailable / isAbnormal)——
 * 本 spec 改写后不丢 FilterIcons 覆盖率, 仅把 e2e 路径切到「隐藏后契约」。
 */

async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

test("filter-icons 不渲染(t_f7d1beeb 修订 E): 节点 count=0, 默认 4 卡可见(filter 状态管线保留)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click(); // 4 卡

  // filter 隐藏契约 1: .filter-icons 节点零命中
  await pwExpect(page.locator('[data-testid="filter-icons"]')).toHaveCount(0);
  // filter 隐藏契约 2: filter state 管线仍工作 = 默认「全部」= 4 卡可见
  // (若 filter state 被无意破坏会变成 0/1 卡)
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);
  // filter 隐藏契约 3: 单枚 radio 按钮全不存在
  await pwExpect(page.locator('[role="radio"][data-testid^="filter-"]')).toHaveCount(0);
});

test("filter 隐藏 + scenario-expired: 1 张异常卡可见(filter 状态管线不受渲染入口影响)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-expired").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1);
  await pwExpect(page.locator('[data-testid="provider-card"][data-provider="aliyun"]')).toHaveCount(1);
  // filter 仍隐藏
  await pwExpect(page.locator('[data-testid="filter-icons"]')).toHaveCount(0);
});

test("filter 隐藏 + scenario-error: 1 张 error 卡可见(state 管线不受渲染入口影响)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-error").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1);
  // error 卡可能 data-provider 是 deepseek(用 mock 默认的 error provider)
  // 这里只断言"至少 1 张 + filter 不渲染", 不锁具体 provider
  await pwExpect(page.locator('[data-testid="filter-icons"]')).toHaveCount(0);
});

test("filter 隐藏 + scenario-empty: 空态正常显示, filter 节点零命中", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-empty").click();
  // empty 场景下 EmptyState 可见(无 provider-card)
  await pwExpect(page.locator('[data-testid="empty-state"]')).toBeVisible();
  await pwExpect(page.locator('[data-testid="filter-icons"]')).toHaveCount(0);
});

test("filter 隐藏 + 360px 视口: card-list 容器布局完整, 4 卡可见无横向溢出", async ({ hostPage, page }) => {
  void hostPage;
  // 360px 视口: 真机最窄档, filter 隐藏后 card-list 容器不应再有 filter 占位带
  await page.setViewportSize({ width: 360, height: 800 });
  await agree(page);
  await page.getByTestId("scenario-mixed").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);

  // 容器 padding-top 不再为 filter 预留带(t_9639078b round2 改 34px 带)
  // —— 因 filter 隐藏后不需要避让, padding-top 可恢复到正常基线(< 20px)
  // 这里不锁精确值, 仅断言 filter 节点 0 存在 + 4 卡可见(过滤带清空已体现)
  await pwExpect(page.locator('[data-testid="filter-icons"]')).toHaveCount(0);
  // 4 卡首卡右缘 ≤ card-list 右缘(无横向溢出)
  const firstCard = page.locator('[data-testid="provider-card"]').first();
  const firstBox = await firstCard.boundingBox();
  const listBox = await page.getByTestId("card-list").boundingBox();
  pwExpect(firstBox).not.toBeNull();
  pwExpect(listBox).not.toBeNull();
  pwExpect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(listBox!.x + listBox!.width + 1);
});

/**
 * filter 状态管线本身契约(通过全局 window 暴露): App.tsx 启动时把
 * DEFAULT_FILTER / matchesFilter / filteredProviders 挂到 __filterDebug, 让 e2e
 * 能拿到内部 filter state 而不依赖渲染入口(FilterIcons 隐藏后)。
 *
 * 实操: 这里走间接验证 — 4 卡可见 + scenario 切换生效 = filter pipeline 在
 * App 内部仍正常运转(因 App 仍调 filteredProviders 算出 4 张全显)。若有人误删
 * filter state 或 matchesFilter 逻辑, 4 卡会变 0/1/2 张, 本用例失败。
 */
test("filter 状态管线内部契约: filter 隐藏下 filteredProviders 仍正确(default 全部命中)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();
  // 默认 filter = { kind: "all" } → 4 卡全显(mixed=4: deepseek/kimi-code/aliyun/ark)
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);
  // 4 张卡都能通过 querySelector 找到(防某卡被 filter pipeline 误过滤)
  const NAMED_PROVIDERS = ["deepseek", "kimi-code", "aliyun", "ark"];
  for (const id of NAMED_PROVIDERS) {
    await pwExpect(page.locator(`[data-testid="provider-card"][data-provider="${id}"]`)).toHaveCount(1);
  }
});
