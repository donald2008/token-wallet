import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2 面板数据语义(P0-8):
 * - 未支持通道(kimi/opencode 等)添加后 → 面板出"该通道暂未接入"显式卡, 不静默空态
 * - 已配置实例但快照未到(引擎启动/采集中) → "数据采集中"状态, 不渲染"添加 Provider"空态
 * - 生产构建 mock 门禁为编译期行为(import.meta.env.PROD), 由 L1 panelProviders.test.ts
 *   + vite build 产物验证兜底(见任务 evidence)
 */

/** 同意首开隐私声明 → 空态 */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

test("未支持通道: 添加 kimi 实例 → 面板出'该通道暂未接入'显式卡(不是空态)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("add-provider").click();
  await page.getByTestId("tree-product-kimi-kimi-code").click();
  await pwExpect(page.getByTestId("dynamic-form")).toBeVisible();
  await page.getByTestId("param-api_key").fill("sk-kimi-1");
  await page.getByTestId("save-instance").click();
  await pwExpect(page.getByTestId("instance-list")).toContainText("Kimi-Coding #1");
  await page.getByTestId("settings-back").click();

  // 面板: 显式"暂未接入"灰卡(unsupported → unknown 健康度), 不再是误导空态
  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).toHaveAttribute("data-health", "unknown");
  await pwExpect(card).toContainText("该通道暂未接入");
  await pwExpect(card).toContainText("Kimi-Coding #1");
  await pwExpect(page.getByTestId("empty-state")).toHaveCount(0);
});

test("空态语义: 已配置实例 + 首个快照未到 → '数据采集中', 不显示'添加 Provider'空态", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  // 预置: 已同意 + 已有一个 deepseek 实例 + 钥匙串有 key; http 延迟 3s 制造采集窗口
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.consent.v1", "1");
    localStorage.setItem(
      "token-wallet.mock.instances.v1",
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: "inst-ds-1",
            channel: "deepseek/balance",
            name: "DeepSeek-按量 #1",
            params: { api_key: { source: "store", key: "inst-ds-1:api_key" } },
          },
        ],
      }),
    );
    localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-ds-1:api_key", "sk-ds-1");
    localStorage.setItem("token-wallet.mock.httpdelayms", "3000");
  });
  await page.reload();

  // 采集窗口内: "数据采集中"状态, 且绝不渲染 EmptyState"添加 Provider"
  await pwExpect(page.getByTestId("collecting-state")).toBeVisible();
  await pwExpect(page.getByTestId("empty-state")).toHaveCount(0);

  // 快照到达后: 正常数据卡(golden 448.45)
  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).toHaveAttribute("data-health", "ok");
  await pwExpect(page.getByTestId("collecting-state")).toHaveCount(0);
});

test("混合: kimi(暂未接入) + deepseek(数据卡) 同面板共存", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  // 先加 kimi
  await page.getByTestId("add-provider").click();
  await page.getByTestId("tree-product-kimi-kimi-code").click();
  await page.getByTestId("param-api_key").fill("sk-kimi-1");
  await page.getByTestId("save-instance").click();
  await pwExpect(page.getByTestId("instance-list")).toContainText("Kimi-Coding #1");
  // 再加 deepseek
  await page.getByTestId("add-instance").click();
  await page.getByTestId("tree-product-deepseek-balance").click();
  await page.getByTestId("param-api_key").fill("sk-ds-valid");
  await page.getByTestId("save-instance").click();
  await pwExpect(page.getByTestId("instance-list")).toContainText("DeepSeek-按量 #1");
  await page.getByTestId("settings-back").click();

  // 两张卡: deepseek 出数 + kimi 暂未接入
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(2, { timeout: 10_000 });
  const names = await page.getByTestId("provider-card").allInnerTexts();
  pwExpect(names.join("\n")).toContain("该通道暂未接入");
  pwExpect(names.join("\n")).toContain("448.45");
  await pwExpect(page.getByTestId("empty-state")).toHaveCount(0);
});
