/**
 * 设置页 MCP 服务区 e2e(D-055 / t_4bd214de):
 * 验证三态(未运行/运行中/未安装)渲染 + 一键启停 + key 复制 + 引导页打开。
 *
 * 走 playwright browser 模式(D-030): mock 桌面桥 IPC, fixtures.ts 注入
 * mcp_* 系列 handler + seedMcpState 控制场景。
 *
 * 端口 1501 + reuseExistingServer:true(兄弟卡高频占用 1420-1441)。
 * 共用 e2e 模式: page.reload() 后 mock 重新挂载生效。
 */
import { test, expect } from "./fixtures";
import { seedMcpState } from "./fixtures";

test.describe("设置页 MCP 服务区", () => {
  test.beforeEach(async ({ hostPage: page }) => {
    // 跳过首开 consent(单独测 mcp 区块, 不测 consent 流; 真实测试在 i18n/panel 类)
    await page.evaluate(() => {
      localStorage.setItem("token-wallet.mock.consent.v1", "1");
    });
  });

  test("未安装场景: 状态点 red + 启动按钮 disabled", async ({ hostPage: page }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: false });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-status", "not_installed");
    await expect(panel.getByTestId("mcp-status")).toContainText("未找到 daemon");
    await expect(panel.getByTestId("mcp-start")).toBeDisabled();
    // 端点 + key 行常显(masked)
    await expect(panel.getByTestId("mcp-endpoint")).toContainText("127.0.0.1:9131");
    await expect(panel.getByTestId("mcp-key-masked")).toContainText("••••");
  });

  test("未运行场景: 一键启动 → 状态变绿(已 installed)", async ({ page }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: false, reason: "unreachable" });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await expect(panel).toHaveAttribute("data-status", "stopped");
    await expect(panel.getByTestId("mcp-start")).toBeEnabled();
    await expect(panel.getByTestId("mcp-stop")).toBeDisabled();
    await panel.getByTestId("mcp-start").click();
    // mcp_start mock 写 alive=true, 重 probe → running
    await expect(panel).toHaveAttribute("data-status", "running", { timeout: 5_000 });
    await expect(panel.getByTestId("mcp-status")).toContainText("运行中");
    await expect(panel.getByTestId("mcp-start")).toBeDisabled();
    await expect(panel.getByTestId("mcp-stop")).toBeEnabled();
  });

  test("运行中场景: 状态点绿 + stop 按钮启用", async ({ page }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await expect(panel).toHaveAttribute("data-status", "running");
    await expect(panel.getByTestId("mcp-start")).toBeDisabled();
    await expect(panel.getByTestId("mcp-stop")).toBeEnabled();
  });

  test("key 复制: 点击复制按钮 → 调 clipboard.writeText(明文)", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await expect(panel).toBeVisible();
    // 验证遮罩形态(4-••••-末4)
    await expect(panel.getByTestId("mcp-key-masked")).toHaveText(
      "0123-••••-••••-••••-cdef",
    );
    await panel.getByTestId("mcp-key-copy").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe("0123456789abcdef0123456789abcdef");
  });

  test("key 重生成: 二次确认 → 调 mcp_gen_key → 展示重启提示", async ({ page }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await panel.getByTestId("mcp-key-regen").click();
    // 二次确认弹窗出现
    await expect(page.getByTestId("mcp-regen-confirm-panel")).toBeVisible();
    await page.getByTestId("mcp-regen-confirm").click();
    // 重生成提示
    await expect(panel.getByTestId("mcp-regen-hint")).toBeVisible();
    await expect(panel.getByTestId("mcp-regen-hint")).toContainText("停止");
  });

  test("autostart toggle: 取消勾选 → mcp_set_autostart(false)", async ({ page }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    const toggle = panel.getByTestId("mcp-autostart");
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
  });

  test("引导页: 点击 [查看安装步骤] → portal 弹窗, daemon 未跑 → empty 文案", async ({
    page,
  }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: false });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await panel.getByTestId("mcp-open-guide").click();
    const overlay = page.getByTestId("mcp-guide-overlay");
    await expect(overlay).toBeVisible();
    await expect(page.getByTestId("mcp-guide-empty")).toBeVisible();
  });

  test("引导页: daemon 在跑 → 渲染 agent 列表(含 configure/verify 步骤)", async ({
    page,
  }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await panel.getByTestId("mcp-open-guide").click();
    const overlay = page.getByTestId("mcp-guide-overlay");
    await expect(overlay).toBeVisible();
    await expect(page.getByTestId("mcp-guide-list")).toBeVisible();
    await expect(page.getByTestId("mcp-guide-hermes")).toBeVisible();
    await expect(page.getByTestId("mcp-guide-claude-code")).toBeVisible();
    // 关闭弹窗
    await page.getByTestId("mcp-guide-close").click();
    await expect(overlay).not.toBeVisible();
  });
});
