import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2 面板数据语义(P0-8 + D-036 修订):
 * - 未支持通道(本卡后 kimi/opencode 已接入, 用真正未接入的 aliyun/bailian 预置)
 *   → 面板出"该通道暂未接入"显式卡, 不静默空态
 * - 已配置实例但快照未到(引擎启动/采集中) → "数据采集中"状态, 不渲染"添加 Provider"空态
 * - 通道树列出的通道都能真采集: kimi/opencode 走真实引擎链路出数据卡
 *   (mock http 返回 L3 golden), 不再出现"选得到但暂未接入"
 * - 生产构建 mock 门禁为编译期行为(import.meta.env.PROD), 由 L1 panelProviders.test.ts
 *   + vite build 产物验证兜底(见任务 evidence)
 */

/** 同意首开隐私声明 → 空态 */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

/** 预置一个 aliyun/bailian 实例(真正未接入通道)到 localStorage, 再 reload */
async function seedUnsupportedInstance(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.consent.v1", "1");
    localStorage.setItem(
      "token-wallet.mock.instances.v1",
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: "inst-aliyun-1",
            channel: "aliyun/bailian",
            name: "百炼 Token Plan #1",
            params: { api_key: { source: "store", key: "inst-aliyun-1:api_key" } },
          },
        ],
      }),
    );
    localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-aliyun-1:api_key", "sk-aliyun-1");
  });
  await page.reload();
}

test("未支持通道: 预置 aliyun/bailian 实例 → 面板出'该通道暂未接入'显式卡(不是空态)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await seedUnsupportedInstance(page);

  // 面板: 显式"暂未接入"灰卡(unsupported → unknown 健康度), 不再是误导空态
  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).toHaveAttribute("data-health", "unknown");
  await pwExpect(card).toContainText("该通道暂未接入");
  await pwExpect(card).toContainText("百炼 Token Plan #1");
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

test("混合: aliyun(暂未接入) + deepseek(数据卡) 同面板共存", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await seedUnsupportedInstance(page);
  // 再通过树形通道添加 deepseek(真实链路; D-038: 入口 = 侧栏 ＋ 添加向导)
  await page.getByTestId("sidebar-add").click();
  await pwExpect(page.getByTestId("add-wizard")).toBeVisible();
  await page.getByTestId("tree-product-deepseek-balance").click();
  await page.getByTestId("param-api_key").fill("sk-ds-valid");
  await page.getByTestId("save-instance").click();
  // 保存即关向导回面板(D-038)
  await pwExpect(page.getByTestId("add-overlay")).toHaveCount(0);

  // 两张卡: deepseek 出数 + aliyun 暂未接入
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(2, { timeout: 10_000 });
  const names = await page.getByTestId("provider-card").allInnerTexts();
  pwExpect(names.join("\n")).toContain("该通道暂未接入");
  pwExpect(names.join("\n")).toContain("448.45");
  await pwExpect(page.getByTestId("empty-state")).toHaveCount(0);
});

test("真实通道: 树形添加 kimi → 面板出真实数据卡(71/100 + 5h 窗耗尽管红)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  // 树形通道列表来自 core PRESET_CHANNELS(设置页真实源, D-036)
  await page.getByTestId("add-provider").click();
  await pwExpect(page.getByTestId("tree-platform-kimi")).toBeVisible();
  await page.getByTestId("tree-product-kimi-coding").click();
  await pwExpect(page.getByTestId("dynamic-form")).toBeVisible();
  await page.getByTestId("inst-name").first().waitFor();
  // 默认实例名 = 平台-产品 自动编号(D-026)
  pwExpect(await page.getByTestId("inst-name").inputValue()).toBe("Kimi-Coding #1");
  await page.getByTestId("param-api_key").fill("sk-kimi-1");
  await page.getByTestId("save-instance").click();
  // D-038: 保存即回面板(页内向导自行收起, 无需再点返回)
  await pwExpect(page.getByTestId("add-wizard")).toHaveCount(0);

  // kimi 是真实通道 → 采集出数据卡(不是"暂未接入")
  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).not.toContainText("该通道暂未接入");
  await pwExpect(card).toContainText("Kimi-Coding #1");
  // 主窗 71/100(71 来自 golden), 5h 窗 100/100 → 最紧窗口标红(D-022 单窗受限判红)
  await pwExpect(card).toContainText("71");
  await pwExpect(card).toHaveAttribute("data-health", "bad");
  await pwExpect(page.getByTestId("empty-state")).toHaveCount(0);
});

test("真实通道: 树形添加 opencode → 面板出三窗数据卡(weekly 单窗受限不污整卡)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("add-provider").click();
  await pwExpect(page.getByTestId("tree-platform-opencode")).toBeVisible();
  await page.getByTestId("tree-product-opencode-go").click();
  await pwExpect(page.getByTestId("dynamic-form")).toBeVisible();
  pwExpect(await page.getByTestId("inst-name").inputValue()).toBe("opencode-Go Coding #1");
  await page.getByTestId("param-api_key").fill("sk-oc-1");
  await page.getByTestId("save-instance").click();
  // D-038: 保存即回面板
  await pwExpect(page.getByTestId("add-wizard")).toHaveCount(0);

  // opencode 是真实通道 → 数据卡; 整卡 ok 语义: weekly rate-limited 是单窗,
  // 由 bars 最紧窗口判红, 不是整卡 error/unsupported(D-036)
  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).not.toContainText("该通道暂未接入");
  await pwExpect(card).toContainText("opencode-Go Coding #1");
  // 三窗 percent: 0 / 100(weekly 受限) / 48
  await pwExpect(card).toContainText("48");
  // weekly 100% → 最紧窗口 bad
  await pwExpect(card).toHaveAttribute("data-health", "bad");
  await pwExpect(page.getByTestId("empty-state")).toHaveCount(0);
});
