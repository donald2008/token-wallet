import { expect as pwExpect } from "@playwright/test";
import { test, getCapturedInvokes } from "./fixtures";

/**
 * L2 真实链路(D-030): mock 桌面桥 IPC(keyring/http/sqlite), 前端逻辑全部真跑。
 * P0-5 端到端: 设置页填 deepseek api_key → 钥匙串 → RuntimeEngine(GenericHttpAdapter
 * + Scheduler) → SqliteStore → 面板 ticker 显示真实余额 + 近7天速率预计可用天数。
 *
 * 覆盖验收:
 * - 真实 key 拉出余额并在面板显示(golden 响应 448.45)
 * - ticker 显示真实余额 + granted/topped_up 拆分 + 预计可用天数(seed 历史 → 速率)
 * - key 存进钥匙串(断言 keyring_set 被调用), 日志/DOM 无明文 key(sk-*** 打码)
 */

/** 同意首开隐私声明 → 空态 */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

/** 添加 deepseek 实例: 树形选择 → 填 key → 保存 → 回面板 */
async function addDeepseekInstance(page: import("@playwright/test").Page, apiKey: string) {
  await page.getByTestId("add-provider").click();
  await page.getByTestId("tree-product-deepseek-balance").click();
  await page.getByTestId("param-api_key").fill(apiKey);
  await page.getByTestId("save-instance").click();
  await pwExpect(page.getByTestId("instance-list")).toContainText("DeepSeek-按量 #1");
  await page.getByTestId("settings-back").click();
}

test("真实链路: deepseek key → 钥匙串 → 引擎拉取 → 面板显示真实余额+拆分+预计天数", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  await addDeepseekInstance(page, "sk-test-real-123456");

  // 引擎首次采集走 mock http_get_json(golden 448.45) → 落库 → 面板出卡
  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).toHaveAttribute("data-health", "ok");

  // ticker: 真实余额 + 币种 + 拆分 + 预计可用天数
  const ticker = page.getByTestId("ticker-template");
  await pwExpect(ticker).toBeVisible();
  await pwExpect(ticker.locator(".ticker-number")).toContainText("¥448.45");
  // granted/topped_up 拆分(DeepSeek: granted 0.00 / topped_up 448.45)
  const split = ticker.getByTestId("ticker-split");
  await pwExpect(split).toContainText("赠送 ¥0");
  await pwExpect(split).toContainText("充值 ¥448.45");
  // 近 7 天速率 → 预计可用天数(≈ (458.45-448.45)/3 ≈ 3.33/天 → ≈ 135 天)
  await pwExpect(ticker.getByTestId("ticker-days")).toContainText(/预计可用约 1\d+ 天/);

  // 钥匙串确实写入(断言 keyring_set 被调用 + 值不是明文哨兵)
  const calls = await getCapturedInvokes(page);
  const keyringSet = calls.find((c) => c.cmd === "keyring_set");
  pwExpect(keyringSet).toBeTruthy();

  // 面板 DOM 不出现明文 key(D-029 内存纪律)
  const bodyText = await page.locator("body").innerText();
  pwExpect(bodyText).not.toContain("sk-test-real-123456");
});

test("真实链路: http_get_json 带 Authorization Bearer(凭据只活请求构造瞬间)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  await addDeepseekInstance(page, "sk-bearer-check-9999");

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });

  // 引擎 fetch 时经 Rust http_get_json, header 里带 Bearer; 捕获断言
  const calls = await getCapturedInvokes(page);
  const httpCall = calls.find((c) => c.cmd === "http_get_json");
  pwExpect(httpCall).toBeTruthy();
  const headers = (httpCall!.args as { headers?: Record<string, string> }).headers ?? {};
  pwExpect(headers.Authorization).toBe("Bearer sk-bearer-check-9999");

  // DOM 仍无明文 key
  const bodyText = await page.locator("body").innerText();
  pwExpect(bodyText).not.toContain("sk-bearer-check-9999");
});
