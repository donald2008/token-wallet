/**
 * 主页 P1 形态三主题截图取证(t_27eeadad, 9/7 用户拍板):
 * - 360x720 视口, 主页 P1 形态接入 + 窗口高度 720
 * - 3 张 provider 卡(2 ok + 1 异常 = auth_expired)
 * - 三主题截图 dark / light / glass 各 1 张, 落仓内 verification/ 目录
 * - 顺带检查: 主页 provider-card 内无 .bar-tooltip、QuotaMeter 排版 = micro、窗口行数 = 3
 */
import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

const SHOTS_DIR = "verification";

/** 预置 3 张 provider 数据: opencode×2(ok + weekly 100% tightest) + aliyun-bailian/token-plan(auth_expired)
 *  异常卡走 fixtures.ts 已实现的 token-wallet.mock.authexpired="bl" 哨兵 + command_run 路径
 *  (aliyun-bailian/channel descriptor.adapter="command", D-042), 不依赖真实引擎支持 bl CLI。 */
async function seedThreeProviders(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.consent.v1", "1");
    localStorage.setItem(
      "token-wallet.mock.instances.v1",
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: "inst-oc-1",
            channel: "opencode/go",
            name: "opencode Go #1",
            params: { api_key: { source: "store", key: "inst-oc-1:api_key" } },
          },
          {
            id: "inst-oc-2",
            channel: "opencode/go",
            name: "opencode Go #2",
            params: { api_key: { source: "store", key: "inst-oc-2:api_key" } },
          },
          {
            id: "inst-aliyun-1",
            channel: "aliyun-bailian/token-plan",
            name: "百炼 Token Plan",
            params: { api_key: { source: "store", key: "inst-aliyun-1:api_key" } },
          },
        ],
      }),
    );
    localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-oc-1:api_key", "sk-oc-1");
    localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-oc-2:api_key", "sk-oc-2");
    localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-aliyun-1:api_key", "sk-aliyun-1");
    // 异常卡哨兵: aliyun-bailian 通道走 command_run, fixtures 命中 "bl" 哨兵返回 auth_expired + setup_hint
    localStorage.setItem("token-wallet.mock.authexpired", "bl");
  });
  await page.reload();
}

for (const [name, theme, glass] of [
  ["dark", "dark", "0"],
  ["light", "light", "0"],
  ["glass", "dark", "1"],
] as const) {
  test(`主页 P1 形态截图(${name}) - 360x720, 3 张卡(2 ok + 1 异常), 三主题`, async ({
    hostPage,
    page,
  }) => {
    void hostPage;
    await page.setViewportSize({ width: 360, height: 720 });
    await page.evaluate(
      ([t, g]) => {
        localStorage.setItem("token-wallet.theme.v1", t as string);
        localStorage.setItem("token-wallet.glass.v1", g as string);
      },
      [theme, glass],
    );
    await seedThreeProviders(page);

    // 等第一张 provider-card 渲染出来
    const cards = page.getByTestId("provider-card");
    await pwExpect(cards.first()).toBeVisible({ timeout: 15_000 });

    // 3 张卡(顺序按 sortProviders 默认: 健康度带 + statusSeverity + minRemainingRatio)
    // 实际可见卡数可能因窗口高度受限, 但 DOM 节点应该都在 card-list 内
    const cardCount = await cards.count();
    if (cardCount < 2) {
      throw new Error(`期望至少 2 张 provider-card 可见, 实际 ${cardCount}`);
    }

    // 至少 1 张 ok 卡含 3 个 bar-row(window 制) —— first() 卡可能是异常卡(auth_expired 排序置顶),
    // 用 has: .bars-template 过滤定位 ok 卡
    const okCard = page.locator("[data-testid='provider-card']").filter({
      has: page.locator(".bars-template"),
    }).first();
    await pwExpect(okCard).toBeVisible({ timeout: 15_000 });
    await pwExpect(okCard.locator(".bar-row")).toHaveCount(3);
    // QuotaMeter 排版 = micro(用户拍板 P1)
    await pwExpect(okCard.locator(".bar-row > .quota-meter").first()).toHaveAttribute(
      "data-layout",
      "micro",
    );
    // 同时存在 auth_expired 卡(异常段 AbnormalBody, 不渲染 BarsTemplate)
    await pwExpect(page.locator("[data-testid='abnormal-body']")).toHaveCount(1);

    // 硬契约: 主页所有 provider-card 内零 .bar-tooltip 节点(P1 化后无悬停复读)
    await pwExpect(page.locator(".bar-tooltip")).toHaveCount(0);

    // 等动画落定
    await page.waitForTimeout(700);

    // 截图(整 panel 含标题栏 + 卡列表)
    await page.locator(".panel").screenshot({ path: `${SHOTS_DIR}/p1-home-${name}.png` });
  });
}