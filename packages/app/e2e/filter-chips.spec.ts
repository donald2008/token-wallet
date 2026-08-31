import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(P1 t_6484ecc6): 主页过滤 chips。
 *
 * 覆盖验收:
 *   - 卡片列表顶部、主区第一行出现 (filter-chips 在 card-list 上方)
 *   - 固定三态: 全部(n)/✓可用(n)/⚠异常(n), 数量角标正确(数据驱动不硬编码)
 *   - 平台 chips 动态生成(有实例的平台才出, 带 BrandLogo), 单选语义
 *   - 点击已选 chip → 取消回「全部」
 *   - 过滤后空态 → 居中「无匹配实例」
 *   - 增删实例/采集状态变化 → 数量角标实时联动(scenario 切换驱动)
 *   - 键盘可达(radiogroup role + Tab/Enter)
 *
 * 驱动方式: dev scenario 场景切换器(mixed=4 卡 → expired=1 异常卡 → error), 无真实实例,
 * 与 dev 预览卡共用, chip 过滤作用于当前 providers 视角。
 */

/** 读某个 chip 的数量角标文本。 */
async function chipCount(page: import("@playwright/test").Page, testid: string): Promise<string> {
  return (await page.getByTestId(testid).locator(".filter-chip-count").textContent()) ?? "";
}

async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

test("chips 在卡片列表顶部主区第一行(常驻低调), 固定三态 + 平台动态生成", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click(); // 4 卡

  // chips 在 panel-main 内、card-list 之上
  const chips = page.getByTestId("filter-chips");
  await pwExpect(chips).toBeVisible();
  const chipsBox = (await chips.boundingBox())!;
  const listBox = (await page.getByTestId("card-list").boundingBox())!;
  pwExpect(chipsBox.y).toBeLessThan(listBox.y); // chips 在主区第一行, 卡片在其下

  // 固定三态角标(数据驱动): mixed = deepseek(ok) kimi-code(即将耗尽warn) aliyun(auth_expired) ark(ok)
  // all=4, available=2(deepseek/ark ok), abnormal=1(aliyun auth_expired)。
  // (kimi-code remaining 18%≈warn, 非异常桶 only≤10% 已耗尽, 故 available 不计数)
  await pwExpect(page.getByTestId("filter-all")).toContainText("全部");
  pwExpect(await chipCount(page, "filter-all")).toBe("4");
  pwExpect(await chipCount(page, "filter-available")).toBe("2");
  pwExpect(await chipCount(page, "filter-abnormal")).toBe("1");

  // 平台 chips 动态生成(alias 归一: aliyun→aliyun-bailian, ark→volcengine-ark)
  await pwExpect(page.getByTestId("filter-platform-deepseek")).toBeVisible();
  await pwExpect(page.getByTestId("filter-platform-kimi")).toBeVisible();
  await pwExpect(page.getByTestId("filter-platform-aliyun-bailian")).toBeVisible();
  await pwExpect(page.getByTestId("filter-platform-volcengine-ark")).toBeVisible();
  pwExpect(await chipCount(page, "filter-platform-deepseek")).toBe("1");
});

test("单选语义: 点可用→3卡, 点已选→取消回全部(4卡); radiogroup 键盘可达", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();

  // 默认「全部」选中
  await pwExpect(page.getByTestId("filter-all")).toHaveAttribute("aria-checked", "true");

  // 点「可用」→ 只剩 2 卡(deepseek + ark; kimi w旧耗尽/aliyun auth_expired 隐藏)
  await page.getByTestId("filter-available").click();
  await pwExpect(page.getByTestId("filter-available")).toHaveAttribute("aria-checked", "true");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(2);
  await pwExpect(
    page.locator('[data-testid="provider-card"][data-provider="aliyun"]'),
  ).toHaveCount(0);

  // 点已选「可用」→ 回「全部」4 卡
  await page.getByTestId("filter-available").click();
  await pwExpect(page.getByTestId("filter-all")).toHaveAttribute("aria-checked", "true");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);
});

test("平台 chip 单选: 点 DeepSeek → 仅 1 卡; 点已选 → 回全部", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();

  await page.getByTestId("filter-platform-deepseek").click();
  await pwExpect(page.getByTestId("filter-platform-deepseek")).toHaveAttribute("aria-checked", "true");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1);
  await pwExpect(page.locator(".card-name")).toContainText("DeepSeek-按量 #1");

  // 点已选平台 → 取消回「全部」
  await page.getByTestId("filter-platform-deepseek").click();
  await pwExpect(page.getByTestId("filter-all")).toHaveAttribute("aria-checked", "true");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);
});

test("过滤后空态 → 居中文案「无匹配实例」", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  // expired 场景只有 1 张异常卡(auth_expired), 点「可用」→ 0 命中 → 无匹配实例
  await page.getByTestId("scenario-expired").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1);
  await page.getByTestId("filter-available").click();
  await pwExpect(page.getByTestId("no-match")).toBeVisible();
  await pwExpect(page.getByTestId("no-match")).toContainText("无匹配实例");
  await pwExpect(page.getByTestId("card-list")).toHaveCount(0);
});

test("数量角标随采集/增删实例实时联动(scenario 切换)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();
  pwExpect(await chipCount(page, "filter-all")).toBe("4");
  pwExpect(await chipCount(page, "filter-abnormal")).toBe("1");

  // 切 expired(仅 aliyun auth_expired) → 计数联动
  await page.getByTestId("scenario-expired").click();
  pwExpect(await chipCount(page, "filter-all")).toBe("1");
  pwExpect(await chipCount(page, "filter-available")).toBe("0");
  pwExpect(await chipCount(page, "filter-abnormal")).toBe("1");
  // 平台 chip 只剩 aliyun-bailian
  await pwExpect(page.getByTestId("filter-platform-deepseek")).toHaveCount(0);
  await pwExpect(page.getByTestId("filter-platform-aliyun-bailian")).toBeVisible();

  // 切 error(1 异常卡) → 计数再联动
  await page.getByTestId("scenario-error").click();
  pwExpect(await chipCount(page, "filter-all")).toBe("1");
  pwExpect(await chipCount(page, "filter-available")).toBe("0");
  pwExpect(await chipCount(page, "filter-abnormal")).toBe("1");
});