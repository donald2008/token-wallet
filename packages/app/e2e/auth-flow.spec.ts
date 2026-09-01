import { expect as pwExpect } from "@playwright/test";
import { test, getCapturedInvokes } from "./fixtures";

/**
 * L2 一键授权按钮流 e2e(t_fb8c44d8 修正轮, 评审 round1 验收缺口补位)。
 *
 * 覆盖 app 层按钮流真实 renderer 路径(纯 mock 桥, 契约同 e2e/command-channel.spec):
 *   1. arkcli 两段(设备码): 点「一键授权」→ finishMode=code → 粘贴框出现 → 输 code →
 *      command_auth_finish(code) → 完成「已授权 ✓」
 *   2. bl 自闭环: 点「一键授权」→ finishMode=callback → **免粘贴**等待提示 → 自动 finish(空 code) → 完成
 *   3. 取消: code 粘贴态点取消 → 回 idle 按钮 + command_auth_cancel 被调
 *   4. 启动失败: command_auth_start ok:false → error + 重试可用
 *
 * mock 语义与主进程 auth-defs.ts 对齐(bl→callback / arkcli→code), finishMode 分流由 renderer
 * ProviderCard.OneClickAuth 真实执行; 真实 spawn 协议由 electron/auth-session.test.ts 真实子进程取证。
 */

/** 同意首开隐私声明 → 空态 */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

/** 添加百炼实例(σ command_run mock 统一注入 auth_expired, OneClickAuth 泛型组件对 CLI 不分渠道) */
async function addBailianInstance(page: import("@playwright/test").Page) {
  await page.getByTestId("add-provider").click();
  await page.getByTestId("tree-product-aliyun-bailian-token-plan").click();
  await page.getByTestId("save-instance").click();
  await pwExpect(page.getByTestId("add-wizard")).toHaveCount(0);
}

/** auth_expired 卡定位(默认名 = "阿里云百炼-Token Plan #1") */
function expiredCard(page: import("@playwright/test").Page) {
  return page.locator('[data-testid="provider-card"]').filter({ hasText: "阿里云百炼-Token Plan #1" });
}

test("一键授权 arkcli(设备码两段): 点授权→粘贴框→输 code→已授权 ✓", async ({ hostPage, page }) => {
  void hostPage;
  // 置 auth_expired(arkcli 形态) → 首轮采集即 warn 卡 + 授权钮
  await page.evaluate(() => localStorage.setItem("token-wallet.mock.authexpired", "arkcli"));
  await agree(page);
  await addBailianInstance(page);

  const card = expiredCard(page);
  await pwExpect(card.getByTestId("oneclick-auth-btn")).toBeVisible({ timeout: 10_000 });

  // 点「一键授权」→ start(arkcli) → finishMode=code → 粘贴面板 + 输入框出现
  await card.getByTestId("oneclick-auth-btn").click();
  await pwExpect(card.getByTestId("oneclick-auth-panel")).toBeVisible({ timeout: 10_000 });
  await pwExpect(card.getByTestId("oneclick-auth-code")).toBeVisible();

  // 输 code → 确认 → command_auth_finish(code) → 完成
  await card.getByTestId("oneclick-auth-code").fill("CODE-E2E-ARK");
  await card.getByTestId("oneclick-auth-confirm").click();
  await pwExpect(card.getByTestId("oneclick-auth-btn")).toContainText("已授权", { timeout: 10_000 });

  // 桥载荷断言: start(cli=arkcli) + finish(code 原样透传)
  const calls = await getCapturedInvokes(page);
  const start = calls.find((c) => c.cmd === "command_auth_start");
  pwExpect((start?.args as { cli?: string }).cli).toBe("arkcli");
  const finish = calls.find((c) => c.cmd === "command_auth_finish");
  pwExpect((finish?.args as { code?: string }).code).toBe("CODE-E2E-ARK");
});

test("一键授权 bl(自闭环): 免粘贴等待提示→自动 finish(空 code)→已授权 ✓", async ({ hostPage, page }) => {
  void hostPage;
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.authexpired", "bl");
    // finish 延迟 600ms, 让等待态可见(自闭环免粘贴 UI 断言窗口)
    localStorage.setItem("token-wallet.mock.authfinishdelay", "600");
  });
  await agree(page);
  await addBailianInstance(page);

  const card = expiredCard(page);
  await pwExpect(card.getByTestId("oneclick-auth-btn")).toBeVisible({ timeout: 10_000 });

  await card.getByTestId("oneclick-auth-btn").click();

  // bl 免回喂: 无粘贴输入框, 显等待提示, 自动等待完成
  await pwExpect(card.getByTestId("oneclick-auth-code")).toHaveCount(0);
  await pwExpect(card.getByTestId("oneclick-auth-panel")).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).toContainText("等待浏览器授权", { timeout: 10_000 });

  // 自闭环完成后自动转「已授权 ✓」(finish 在 start 后自动以空 code 调用)
  await pwExpect(card.getByTestId("oneclick-auth-btn")).toContainText("已授权", { timeout: 10_000 });

  const calls = await getCapturedInvokes(page);
  const finish = calls.find((c) => c.cmd === "command_auth_finish");
  pwExpect(finish).toBeTruthy();
  pwExpect((finish!.args as { code?: string }).code).toBe("");
});

test("一键授权: code 粘贴态点取消 → 回 idle 按钮 + command_auth_cancel 被调", async ({ hostPage, page }) => {
  void hostPage;
  await page.evaluate(() => localStorage.setItem("token-wallet.mock.authexpired", "arkcli"));
  await agree(page);
  await addBailianInstance(page);

  const card = expiredCard(page);
  await pwExpect(card.getByTestId("oneclick-auth-btn")).toBeVisible({ timeout: 10_000 });
  await card.getByTestId("oneclick-auth-btn").click();
  await pwExpect(card.getByTestId("oneclick-auth-panel")).toBeVisible({ timeout: 10_000 });

  await card.getByTestId("oneclick-auth-cancel").click();

  // 取消 → 面板消失, 回到 idle 授权钮
  await pwExpect(card.getByTestId("oneclick-auth-panel")).toHaveCount(0);
  await pwExpect(card.getByTestId("oneclick-auth-btn")).toContainText("一键授权");
  const calls = await getCapturedInvokes(page);
  pwExpect(calls.some((c) => c.cmd === "command_auth_cancel")).toBeTruthy();
});

test("一键授权: 启动失败(command_auth_start ok:false)→ error 可重试", async ({ hostPage, page }) => {
  void hostPage;
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.authexpired", "bl");
    localStorage.setItem("token-wallet.mock.authfail", "1");
  });
  await agree(page);
  await addBailianInstance(page);

  const card = expiredCard(page);
  await pwExpect(card.getByTestId("oneclick-auth-btn")).toBeVisible({ timeout: 10_000 });
  await card.getByTestId("oneclick-auth-btn").click();

  // start 失败 → error 文案 + 重试钮
  await pwExpect(card.getByTestId("oneclick-auth-error")).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).toContainText("CLI 不在 PATH");
  await card.getByTestId("oneclick-auth-retry").click();

  // 重试回 idle 授权钮(可再次发起)
  await pwExpect(card.getByTestId("oneclick-auth-error")).toHaveCount(0);
  await pwExpect(card.getByTestId("oneclick-auth-btn")).toBeVisible();
});
