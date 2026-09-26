/**
 * t_e371caca U2/U4 e2e — web_session 一键授权(浏览器模式 mock 桥)
 *
 * 覆盖:
 *  - 设置页→添加向导→MiMo 通道: 表单呈「授权登录」块(无 key 输入框, 卡面 ②)
 *  - 点授权 → mock 桥 web_session_auth_start → 成功态「✓ 已授权」(会话状态)
 *  - 失败路径(wsauthfail=1): 显式错误 + 重试钮(静默取消语义由真壳承担, mock 不覆盖)
 *  - MiMo 进添加向导通道树(数据源 = core PRESET_CHANNELS)
 */
import { test, expect } from "./fixtures";

/** 同意首开隐私声明 → 空态 → 添加向导(settings.spec 同流程) */
async function openMimoForm(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await page.getByTestId("empty-state").waitFor({ state: "visible" });
  await page.getByTestId("add-provider").click();
  await page.getByTestId("add-channel-step").waitFor({ state: "visible" });
  // 通道树默认全展开(ChannelTree 契约): 直接点产品 chip, 不点平台头(点了=收起)
  await page.getByTestId("tree-product-mimo-token-plan").click();
}

test.describe("web_session 一键授权表单(t_e371caca U2)", () => {
  test("MiMo 通道表单: 授权块 + 会话状态 + 无 key 输入框", async ({ hostPage: page }) => {
    await openMimoForm(page);
    // 表单形态: 授权块在, key 输入框不在(卡面 ② 硬约束)
    await expect(page.getByTestId("web-session-auth-block")).toBeVisible();
    await expect(page.getByTestId("web-session-auth-btn")).toContainText("授权登录");
    await expect(page.getByTestId("web-session-auth-state")).toHaveAttribute("data-state", "idle");
    await expect(page.getByTestId("param-web_session")).toHaveCount(0);
  });

  test("点授权登录 → mock 桥成功 → 会话状态=已授权 → 可保存实例", async ({ hostPage: page }) => {
    await openMimoForm(page);
    await page.getByTestId("web-session-auth-btn").click();
    await expect(page.getByTestId("web-session-auth-state")).toHaveAttribute("data-state", "authorized");
    await expect(page.getByTestId("web-session-auth-state")).toContainText("已授权");
    // 保存 → 实例落 store(mock 桥 instances_save) → 回面板出卡(auth_expired 或 ok 由引擎采集态决定)
    await page.getByTestId("save-instance").click();
    await expect(page.getByTestId("card-list")).toBeVisible();
  });

  test("授权失败路径: 显式错误态 + 重试钮回 idle", async ({ hostPage: page }) => {
    await page.evaluate(() => localStorage.setItem("token-wallet.mock.wsauthfail", "1"));
    await openMimoForm(page);
    await page.getByTestId("web-session-auth-btn").click();
    await expect(page.getByTestId("web-session-auth-state")).toHaveAttribute("data-state", "error");
    await page.getByTestId("web-session-auth-reset").click();
    await expect(page.getByTestId("web-session-auth-state")).toHaveAttribute("data-state", "idle");
  });
});
