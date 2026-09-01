import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * Phase B(i18n): 设置页语言分段控件 + 语言持久化(重启保持)
 *
 * 覆盖(验收要求逐条):
 *   - 设置页「语言」分段控件(zh/en, 主题同款 seg)存在, 默认 zh active
 *   - zh→en 切换: 设置页 + 主页文案即时生效(Provider 重渲染, 无需重启)
 *   - 持久化: set_lang 落 mock settings(mock=localStorage) → reload 后语言保持 en
 *   - en→zh 切回即时生效
 *   - data-testid 全程不动(仅新增 lang-sec/lang-seg/lang-zh/lang-en)
 */
test("语言切换即时生效 + reload 保持(zh→en→reload→en→zh)", async ({ hostPage, page }) => {
  void hostPage;
  // 同意首开 → 空态(默认 zh)
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
  await pwExpect(page.getByTestId("empty-state")).toContainText("暂无 Provider");

  // 打开设置弹窗 → 语言段默认 zh active
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
  await pwExpect(page.getByTestId("lang-zh")).toHaveClass(/active/);
  await pwExpect(page.getByTestId("lang-en")).not.toHaveClass(/active/);

  // 切 en → 设置页即时英文(标题/语言段/主题段)
  await page.getByTestId("lang-en").click();
  await pwExpect(page.getByTestId("lang-en")).toHaveClass(/active/);
  await pwExpect(page.getByTestId("lang-zh")).not.toHaveClass(/active/);
  await pwExpect(page.getByTestId("settings-view")).toContainText("Theme");
  await pwExpect(page.getByTestId("settings-view")).toContainText("Language");

  // 关设置 → 主页也英文(空态标题)
  await page.getByTestId("settings-close").click();
  await pwExpect(page.getByTestId("empty-state")).toContainText("No providers yet");

  // reload(模拟重启) → 语言保持 en: 主页英文 + 设置页仍英文
  await page.reload();
  await pwExpect(page.getByTestId("sidebar")).toHaveAttribute("aria-label", "Action bar");
  // dev 默认 mixed 场景 → 卡片视图; 开设置确认仍英文
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
  await pwExpect(page.getByTestId("lang-en")).toHaveClass(/active/);
  await pwExpect(page.getByTestId("settings-view")).toContainText("Theme");

  // 切回 zh → 即时生效 + 持久化同样落盘
  await page.getByTestId("lang-zh").click();
  await pwExpect(page.getByTestId("lang-zh")).toHaveClass(/active/);
  await pwExpect(page.getByTestId("settings-view")).toContainText("主题");
  await page.getByTestId("settings-close").click();
});