/**
 * 设置页 MCP 服务区 e2e(D-055 / t_4bd214de):
 * 验证三态(未运行/运行中/未安装)渲染 + 一键启停 + key 复制 + 复制引导链接(OB-03)。
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

  test("复制引导链接: daemon 在跑 → clipboard = endpoint 同源 /guide URL + 瞬态反馈(SC-03)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    // 先锁 endpoint 形态, 引导链接 = 同源仅 path 换 /guide
    await expect(panel.getByTestId("mcp-endpoint")).toContainText("127.0.0.1:9131/mcp");
    await panel.getByTestId("mcp-copy-guide").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe("http://127.0.0.1:9131/guide");
    await expect(panel.getByTestId("mcp-copy-guide")).toContainText("已复制");
  });

  test("复制引导链接: endpoint 行旁内联钮 → 同源 /guide URL", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await panel.getByTestId("mcp-guide-copy").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe("http://127.0.0.1:9131/guide");
  });

  // GATE 2 S9 修订反向锁: daemon 离线 = 无引导语义, 不留静态兜底(旧 mcp-guide-overlay 已拆)
  test("daemon 离线(SC-05): 无引导弹窗死入口, 仅显状态 + 复制链接语义仍在", async ({ page, context }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: false });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await expect(panel).toHaveAttribute("data-status", "stopped");
    // 反向锁: 弹窗类 testid 不出街
    await expect(page.getByTestId("mcp-guide-overlay")).toHaveCount(0);
    await expect(page.getByTestId("mcp-guide-empty")).toHaveCount(0);
    // 操作行复制钮可点(URL 复制不依赖 daemon 存活) — 引导语义完全由 /guide 在线提供
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await panel.getByTestId("mcp-copy-guide").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe("http://127.0.0.1:9131/guide");
  });
});

// 9/24 老大反馈: 复制语义歧义消除 — 引导提示常驻 + guide 行展示 + endpoint 钮复制地址本体 + toast
test.describe("MCP 引导链路 UI(9/24 修订)", () => {
  test.beforeEach(async ({ hostPage: page }) => {
    await page.evaluate(() => {
      localStorage.setItem("token-wallet.mock.consent.v1", "1");
    });
  });

  test("引导 hint 常驻 + guide 行 URL 展示", async ({ hostPage: page }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    // 常驻提示(告诉用户复制后发给 agent)
    await expect(panel.getByTestId("mcp-guide-hint")).toContainText("agent");
    // guide 行独立展示, 与服务地址行分离
    await expect(panel.getByTestId("mcp-guide-url")).toContainText("/guide");
    // 零 gitee 外链语义: guide 行为 daemon 自产 URL
    const guideUrlText = await panel.getByTestId("mcp-guide-url").textContent();
    expect(guideUrlText).not.toContain("gitee");
  });

  test("服务地址行内联钮 → 复制地址本体(非 guide)", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await panel.getByTestId("mcp-endpoint-copy").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe("http://127.0.0.1:9131/mcp");
  });

  test("退出侧开关(t_d59a9ad8): 缺省不勾选 → 勾选 → mcp_set_stop_on_quit(true) 落盘回读", async ({ page }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    const toggle = panel.getByTestId("mcp-stop-on-quit");
    // 缺省 false = 退出保持 daemon 运行(D-059)
    await expect(toggle).not.toBeChecked();
    // 说明小字: 保持运行可让 agent 上报在 app 关闭期间持续
    await expect(panel.locator(".mcp-stop-on-quit-row .hint")).toContainText("agent 上报在 app 关闭期间可持续");
    await toggle.click();
    await expect(toggle).toBeChecked();
    // reload 后 mock 桥从 localStorage 回读 → 落盘语义验证
    await page.reload();
    await page.getByTestId("settings-btn").click();
    await expect(panel.getByTestId("mcp-stop-on-quit")).toBeChecked();
  });

  test("退出侧开关: 双开关并存不错位(autostart 与 stop-on-quit 垂直排布零重叠)", async ({ page }) => {
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    const auto = panel.getByTestId("mcp-autostart");
    const stop = panel.getByTestId("mcp-stop-on-quit");
    await expect(auto).toBeVisible();
    await expect(stop).toBeVisible();
    // 几何: 两个开关行无重叠(quantified DOM 探针, 非 vision)
    const boxes = await page.evaluate(() => {
      const rect = (tid: string) => {
        const el = document.querySelector(`[data-testid="${tid}"]`);
        return el ? el.getBoundingClientRect() : null;
      };
      return { auto: rect("mcp-autostart"), stop: rect("mcp-stop-on-quit") };
    });
    expect(boxes.auto).toBeTruthy();
    expect(boxes.stop).toBeTruthy();
    // stop 行 top 不早于 autostart 行 bottom(垂直排布, 不错位不叠压)
    expect(boxes.stop!.y).toBeGreaterThanOrEqual(boxes.auto!.y + boxes.auto!.height - 1);
  });

  test("主钮复制 guide → toast 行出现并说明下一步", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await seedMcpState(page, { installed: true, alive: true });
    await page.reload();
    await page.getByTestId("settings-btn").click();
    const panel = page.getByTestId("mcp-panel");
    await panel.getByTestId("mcp-copy-guide").click();
    await expect(panel.getByTestId("mcp-toast")).toContainText("agent");
    await expect(panel.getByTestId("mcp-toast")).toBeVisible();
  });
});
