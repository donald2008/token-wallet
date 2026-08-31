import { expect as pwExpect } from "@playwright/test";
import { test, getCapturedInvokes } from "./fixtures";

/**
 * L2 command 通道引擎接线(D-042): browser 模式 mock command_run IPC,
 * 验证 renderer 侧真实路径 —— 设置页添加「阿里云百炼 / Token Plan」实例(零录入)
 * → 引擎 COMMAND_ADAPTERS 解析 + command_run 桥 → 面板出真卡, 不再落 unsupported。
 *
 * ⚠️ 契约 5: browser mock 不经主进程, 对主进程接线零信息量——真实 spawn 接线由
 * electron/command-run.test.ts 真实取证(本机 bl 未装 → error + 安装 hint);
 * 本 spec 的 mock 语义与 core 适配器产出一致(healthy / commandfail=1 → error+install)。
 */

/** 同意首开隐私声明 → 空态 */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

/** 添加 aliyun-bailian/token-plan 实例: 侧栏 ＋ → 产品叶子(默认全展开, 不点平台避免折叠) → 保存(零录入, 无 key) */
async function addBailianInstance(page: import("@playwright/test").Page) {
  await page.getByTestId("add-provider").click();
  // ⚠️ 不要先点平台按钮(会 toggle 折叠隐藏叶子); ChannelTree 默认全展开, 直接点产品叶子
  await page.getByTestId("tree-product-aliyun-bailian-token-plan").click();
  // command 通道 params_schema=[] 零录入(D-041): 无 param 输入, 直接保存
  await page.getByTestId("save-instance").click();
  // D-038: 保存成功即关向导回面板
  await pwExpect(page.getByTestId("add-wizard")).toHaveCount(0);
}

test("command 通道: 添加百炼实例 → 引擎走 command_run 桥 → 面板出真卡(ok 态, 不再 unsupported)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  await addBailianInstance(page);

  // 引擎 command 分支 → command_run 桥(mock 返回健康快照) → 面板出真卡
  // ⚠️ 实例 id 是保存时生成的动态 id(DynamicForm inst-<ts>-<rand>), 按卡名内容定位;
  //    默认名 = "<平台显示名>-<产品显示名> #N"(D-026) → "阿里云百炼-Token Plan #1"
  const card = page.locator('[data-testid="provider-card"]').filter({ hasText: "阿里云百炼-Token Plan #1" });
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).toHaveAttribute("data-health", "ok");

  // weekly 窗口指标(bars 模板): 37.9% 已用
  await pwExpect(card.getByTestId("bars-template")).toBeVisible();
  await pwExpect(card).toContainText("37.9");

  // 桥确实被调用(channel=aliyun-bailian/token-plan 载荷)
  const calls = await getCapturedInvokes(page);
  const runCall = calls.find((c) => c.cmd === "command_run");
  pwExpect(runCall).toBeTruthy();
  pwExpect((runCall!.args as { channel?: string }).channel).toBe("aliyun-bailian/token-plan");

  // 面板不出现 unsupported 文案
  const bodyText = await page.locator("body").innerText();
  pwExpect(bodyText).not.toContain("暂未接入");
});

test("command 通道: bl 缺失(真实语义) → 面板出 error 卡 + 安装 setup_hint", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  // 预置 commandfail=1 → mock command_run 返回 error + 安装 hint(与真实 spawn 未装 CLI 同形态)
  // ⚠️ 用 evaluate 直接写当前页 localStorage(mock handler 每次调用实时读, 无需 reload;
  //    addInitScript 只对下次导航生效, hostPage fixture 已完成 goto 会漏)
  await page.evaluate(() => {
    try {
      localStorage.setItem("token-wallet.mock.commandfail", "1");
    } catch {
      /* ignore */
    }
  });
  await agree(page);
  await addBailianInstance(page);

  const card = page.locator('[data-testid="provider-card"]').filter({ hasText: "阿里云百炼-Token Plan #1" });
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  await pwExpect(card).toHaveAttribute("data-health", "bad");
  // 异常卡: 整卡文字替代图表(§2.1)
  await pwExpect(card.getByTestId("abnormal-body")).toBeVisible();
  await pwExpect(card).toContainText("采集失败");
  // 安装提示可见(error 态走 alerts.message 渲染; setup_hint 字段仅供 auth_expired 专用展示)
  await pwExpect(card).toContainText("bl CLI 不在 PATH");
  await pwExpect(card).toContainText("安装");
});

test("command 通道: CLI 重新授权后点 ⟳ → 15s 内恢复(不重启 app)(t_66b67453 契约5)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  // 1) 停摆制造: commandfail=1 → 前置一遍 CLI 安装失败(该 mock 只影响采集),
  //    真停摆走 auth_expired: mock 桥无此态, 用 expired 场景卡替代验证 UI 侧 ⟳ 可达性;
  //    调度器 halted 解除逻辑由 core scheduler.test.ts 双用例取证(本用例证 UI 链路)。
  await agree(page);
  await addBailianInstance(page);

  const card = page.locator('[data-testid="provider-card"]').filter({ hasText: "阿里云百炼-Token Plan #1" });
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  // 等首轮采集稳态 ok(引擎 start 自带 refreshAll, 在途 run 会让 ⟳ 防重叠跳过)
  await pwExpect(card).toHaveAttribute("data-health", "ok", { timeout: 10_000 });

  // 2) 采集失败 → error 卡
  await page.evaluate(() => localStorage.setItem("token-wallet.mock.commandfail", "1"));
  await page.getByTestId("sidebar").getByTestId("refresh-btn").click();
  await pwExpect(card).toContainText("采集失败", { timeout: 15_000 });

  // 3) 用户在 CLI 完成修复(模拟: 撤掉失败标记) → 点 ⟳ 不重启 → 卡片恢复 ok
  await page.evaluate(() => localStorage.removeItem("token-wallet.mock.commandfail"));
  await page.getByTestId("sidebar").getByTestId("refresh-btn").click();
  await pwExpect(card).toHaveAttribute("data-health", "ok", { timeout: 15_000 });
  await pwExpect(card).toContainText("37.9"); // 健康 mock 值(37.9% → 文案一位小数)
});

test("command 通道: testConnection 走真实桥(成功态预览快照)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  // 打开添加向导并选中百炼产品(默认全展开, 直接点叶子)
  await page.getByTestId("add-provider").click();
  await page.getByTestId("tree-product-aliyun-bailian-token-plan").click();

  // 测试连接 → command_run 桥(mock 健康) → 成功快照预览
  await page.getByTestId("test-conn").click();
  await pwExpect(page.getByTestId("test-ok")).toBeVisible({ timeout: 10_000 });
  await pwExpect(page.getByTestId("test-ok")).toContainText("连接成功");
});
