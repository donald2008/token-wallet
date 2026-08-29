import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2 持久化(P0-7, §5.0.1/§10): mock 桌面桥 IPC 状态走 localStorage(跨 reload 存活),
 * page.reload() 模拟应用重启。
 *
 * 覆盖验收:
 * - consent 持久化: 同意后重启不再弹隐私声明页
 * - 实例持久化: 添加 provider → 重启 → 实例仍在(instances.yaml 恢复)且面板直接出数
 * - 损坏 instances.yaml: fail-fast 配置错误页, 不静默丢配置
 */

test("consent 持久化: 同意后重启不再弹隐私声明(§10)", async ({ hostPage, page }) => {
  void hostPage;
  await pwExpect(page.getByTestId("consent-page")).toBeVisible();
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();

  // 重启: 不再弹 consent; 进入面板(无实例时 scenario 默认 mixed 显示 dev 预览卡片,
  // 空态仅首次同意后进入 — 断言"已越过 consent 页"为验收核心)
  await page.reload();
  await pwExpect(page.getByTestId("consent-page")).toHaveCount(0);
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
});

test("实例持久化: 添加 provider → 重启 → 实例仍在且面板直接出数(§5.0.1)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await page.getByTestId("add-provider").click();
  await page.getByTestId("tree-product-deepseek-balance").click();
  await page.getByTestId("param-api_key").fill("sk-persist");
  await page.getByTestId("save-instance").click();
  await pwExpect(page.getByTestId("instance-list")).toContainText("DeepSeek-按量 #1");

  // 重启: 不再弹 consent; 实例从 instances.yaml 恢复 → 引擎拉取 → 面板出数(golden 448.45)
  await page.reload();
  await pwExpect(page.getByTestId("consent-page")).toHaveCount(0);
  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  await pwExpect(page.getByTestId("card-list")).toContainText("DeepSeek-按量 #1");
  await pwExpect(page.getByTestId("ticker-template").locator(".ticker-number")).toContainText(
    "¥448.45",
  );
});

test("损坏 instances.yaml: fail-fast 配置错误页, 不静默丢配置(§5.0.1)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  // 预置损坏配置(重复实例名, D-026 双重校验第 2 道应拒绝) + 已同意 consent
  await page.addInitScript(() => {
    try {
      localStorage.setItem("token-wallet.mock.consent.v1", "1");
      localStorage.setItem(
        "token-wallet.mock.instances.v1",
        JSON.stringify({
          version: 1,
          instances: [
            { id: "a", channel: "deepseek/balance", name: "dup", params: {} },
            { id: "b", channel: "deepseek/balance", name: "dup", params: {} },
          ],
        }),
      );
    } catch {
      /* ignore */
    }
  });
  await page.reload();
  await pwExpect(page.getByTestId("config-error")).toBeVisible();
  await pwExpect(page.getByTestId("config-error-detail")).toContainText("实例名重复");
  // 不停留面板/空态: 拒绝用空配置继续
  await pwExpect(page.getByTestId("empty-state")).toHaveCount(0);
  await pwExpect(page.getByTestId("card-list")).toHaveCount(0);
});
