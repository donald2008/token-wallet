import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2 徽章文案语义(t_553dcb5a, D-005 status 一等公民):
 * 徽章表达"原因"而非颜色带 ——
 * - remaining=0(额度打满) → 「已耗尽」, 不是「过期」
 * - auth_expired(401) → 「待授权」, 不是「偏低」
 * 颜色不变: data-health 仍由 providerHealth 判定(耗尽=bad 红 / auth_expired=warn 黄)。
 */

/** 预置一个 kimi/coding 实例(golden: 5h 窗 used=100/limit=100, remaining=0) */
async function seedKimiInstance(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.consent.v1", "1");
    localStorage.setItem(
      "token-wallet.mock.instances.v1",
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: "inst-kimi-1",
            channel: "kimi/coding",
            name: "Kimi-Code #1",
            params: { api_key: { source: "store", key: "inst-kimi-1:api_key" } },
          },
        ],
      }),
    );
    localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-kimi-1:api_key", "sk-kimi-1");
  });
  await page.reload();
}

/** 预置一个 deepseek 实例, key 含 "fail" 哨兵 → mock http 返回 401 → auth_expired */
async function seedAuthExpiredInstance(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.consent.v1", "1");
    localStorage.setItem(
      "token-wallet.mock.instances.v1",
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: "inst-ds-fail",
            channel: "deepseek/balance",
            name: "DeepSeek-按量 #1",
            params: { api_key: { source: "store", key: "inst-ds-fail:api_key" } },
          },
        ],
      }),
    );
    localStorage.setItem(
      "token-wallet.mock.keyring.token-wallet:inst-ds-fail:api_key",
      "sk-fail-expired",
    );
  });
  await page.reload();
}

test("徽章: remaining=0 窗口快照 → 「已耗尽」(非「过期」), 颜色仍红(bad)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await seedKimiInstance(page);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  // 颜色不变: 耗尽恒红(D-022)
  await pwExpect(card).toHaveAttribute("data-health", "bad");
  // 文案表达原因: 已耗尽, 不是过期
  const badge = card.locator(".card-status-text").first();
  await pwExpect(badge).toHaveText("已耗尽");
  await pwExpect(badge).toHaveClass(/text-bad/);
  await pwExpect(card).not.toContainText("过期");
});

test("徽章: auth_expired(401) → 「待授权」(非「偏低」), 颜色仍黄(warn)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await seedAuthExpiredInstance(page);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  // 颜色不变: auth_expired 亮黄灯(§2.1)
  await pwExpect(card).toHaveAttribute("data-health", "warn");
  const badge = card.locator(".card-status-text").first();
  await pwExpect(badge).toHaveText("待授权");
  await pwExpect(badge).toHaveClass(/text-warn/);
  // 卡体长文案保持不变(STATUS_TEXT), 与徽章短文案不是一回事
  await pwExpect(card.getByTestId("abnormal-body")).toContainText("登录态过期, 请重新授权");
  await pwExpect(badge).not.toHaveText("偏低");
});
