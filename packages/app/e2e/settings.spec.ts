import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2 设置页 + 首开向导(D-017/D-019/D-021/D-024/D-025/D-026)
 *
 * 覆盖(任务 comment #710 必带):
 *   - 首开向导: 隐私声明须同意才进面板; 空态"添加 Provider"进入引导添加首个 provider
 *   - 树形通道选择器(平台→产品, D-025)
 *   - 动态表单: params_schema 渲染, secret 密码框不回显
 *   - 测试连接: 成功显示余额快照 / 失败显示具体错误(D-017)
 *   - 实例增/列/删(删除同步清钥匙串, D-029)
 *   - 双重 zod 拒绝重复 name(D-026)
 *   - 存储路径显示(D-019) / 开机自启默认关(D-024)
 */

/** 同意首开隐私声明 → 空态 */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

/** 从空态"添加 Provider"进入设置页添加流程(首个 provider 引导) */
async function openAddFlow(page: import("@playwright/test").Page) {
  await page.getByTestId("add-provider").click();
  await pwExpect(page.getByTestId("add-channel-step")).toBeVisible();
}

/** 树形选择 deepseek/balance 产品 → 动态表单 */
async function pickDeepseekBalance(page: import("@playwright/test").Page) {
  await page.getByTestId("tree-product-deepseek-balance").click();
  await pwExpect(page.getByTestId("dynamic-form")).toBeVisible();
}

test("首开向导: 隐私声明须同意 → 空态 → 引导添加第一个 provider", async ({ tauriPage, page }) => {
  void tauriPage;
  await pwExpect(page.getByTestId("consent-page")).toBeVisible();
  await agree(page);
  await openAddFlow(page);
  // 树形选择器: 平台父节点可见(collapsible) + 产品叶子(默认展开)
  await pwExpect(page.getByTestId("tree-platform-deepseek")).toBeVisible();
  await pwExpect(page.getByTestId("tree-product-deepseek-balance")).toBeVisible();
});

test("树形通道选择器: 平台可折叠 + 产品叶子一点直达表单(D-025)", async ({ tauriPage, page }) => {
  void tauriPage;
  await agree(page);
  await openAddFlow(page);
  const platformBtn = page.getByTestId("tree-platform-deepseek");
  // 默认展开 → 叶子可见
  await pwExpect(page.getByTestId("tree-product-deepseek-balance")).toBeVisible();
  // 点击平台折叠 → 叶子隐藏
  await platformBtn.click();
  await pwExpect(page.getByTestId("tree-product-deepseek-balance")).toHaveCount(0);
  // 再点展开 → 叶子回来
  await platformBtn.click();
  await pwExpect(page.getByTestId("tree-product-deepseek-balance")).toBeVisible();
  // 一点直达表单
  await pickDeepseekBalance(page);
});

test("动态表单: secret 字段为密码框且不回显(D-017)", async ({ tauriPage, page }) => {
  void tauriPage;
  await agree(page);
  await openAddFlow(page);
  await pickDeepseekBalance(page);
  const secret = page.getByTestId("param-api_key");
  await pwExpect(secret).toBeVisible();
  // 密码框: type=password, 输入不回显为明文
  await pwExpect(secret).toHaveAttribute("type", "password");
  await secret.fill("sk-test-secret");
  const shown = await secret.inputValue();
  pwExpect(shown).toBe("sk-test-secret"); // 值在 DOM value, 但 UI 密码框遮罩显示
});

test("测试连接: 成功显示余额快照(D-017)", async ({ tauriPage, page }) => {
  void tauriPage;
  await agree(page);
  await openAddFlow(page);
  await pickDeepseekBalance(page);
  await page.getByTestId("param-api_key").fill("sk-ds-valid");
  await page.getByTestId("test-conn").click();
  await pwExpect(page.getByTestId("test-ok")).toBeVisible();
  await pwExpect(page.getByTestId("test-ok")).toContainText("余额");
});

test("测试连接: 失败显示具体错误(D-017)", async ({ tauriPage, page }) => {
  void tauriPage;
  await agree(page);
  await openAddFlow(page);
  await pickDeepseekBalance(page);
  // 必填 secret 缺失 → 失败
  await page.getByTestId("test-conn").click();
  await pwExpect(page.getByTestId("test-err")).toContainText("缺少必填参数");
  // 哨兵值 fail → 认证失败错误
  await page.getByTestId("param-api_key").fill("fail");
  await page.getByTestId("test-conn").click();
  await pwExpect(page.getByTestId("test-err")).toContainText("401");
});

test("实例: 添加 → 列表 → 删除(D-029 同步清钥匙串)", async ({ tauriPage, page }) => {
  void tauriPage;
  await agree(page);
  await openAddFlow(page);
  await pickDeepseekBalance(page);
  // 默认名自动编号 "<平台>-<产品> #N"
  await pwExpect(page.getByTestId("inst-name")).toHaveValue("DeepSeek-按量 #1");
  await page.getByTestId("param-api_key").fill("sk-keep");
  // 填 secret 后保存
  await page.getByTestId("save-instance").click();
  // 回到 overview: 实例出现在列表, 空态按钮变"+ 添加 Provider"
  await pwExpect(page.getByTestId("instance-list")).toBeVisible();
  await pwExpect(page.getByTestId("instance-list")).toContainText("DeepSeek-按量 #1");
  // 删除(两次确认)
  const dyn = page.getByTestId("instance-list").first();
  await dyn.getByTestId(/^del-/).click();
  await dyn.getByTestId(/^confirm-del-/).click();
  await pwExpect(page.getByTestId("no-instances")).toBeVisible();
});

test("双重 zod 校验: 表单拒绝重复实例名(D-026)", async ({ tauriPage, page }) => {
  void tauriPage;
  await agree(page);
  // 先加一个实例
  await openAddFlow(page);
  await pickDeepseekBalance(page);
  await page.getByTestId("param-api_key").fill("sk-1");
  await page.getByTestId("save-instance").click();
  await pwExpect(page.getByTestId("instance-list")).toContainText("DeepSeek-按量 #1");
  // 再加第二个, 手动改成重复名 → 拒绝
  await page.getByTestId("add-instance").click();
  await pickDeepseekBalance(page);
  await page.getByTestId("inst-name").fill("DeepSeek-按量 #1");
  await page.getByTestId("param-api_key").fill("sk-2");
  await page.getByTestId("save-instance").click();
  await pwExpect(page.getByTestId("name-error")).toContainText("实例名已存在");
});

test("存储路径显示运行时解析路径(D-019)", async ({ tauriPage, page }) => {
  void tauriPage;
  await agree(page);
  await openSettings(page);
  await pwExpect(page.getByTestId("config-dir")).toContainText("/home/test/.config/token-wallet");
  await pwExpect(page.getByTestId("data-dir")).toContainText("/home/test/.local/share/token-wallet");
});

test("开机自启默认关 + 可切换(D-024)", async ({ tauriPage, page }) => {
  void tauriPage;
  await agree(page);
  await openSettings(page);
  const toggle = page.getByTestId("autostart-toggle");
  await pwExpect(toggle).not.toBeChecked();
  await toggle.check();
  await pwExpect(toggle).toBeChecked();
  await toggle.uncheck();
  await pwExpect(toggle).not.toBeChecked();
});

/** 从面板标题栏"设置"按钮进入设置页 */
async function openSettings(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
}