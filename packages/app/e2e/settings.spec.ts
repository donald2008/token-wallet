import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2 添加向导 + 设置页(D-017/D-019/D-021/D-024/D-025/D-026, D-038 信息架构改造后)
 *
 * 覆盖(任务 comment #710 必带):
 *   - 首开向导: 隐私声明须同意才进面板; 空态"添加 Provider"进入引导添加首个 provider
 *   - 树形通道选择器(平台→产品, D-025)
 *   - 动态表单: params_schema 渲染, secret 密码框不回显
 *   - 测试连接: 成功显示余额快照 / 失败显示具体错误(D-017)
 *   - 实例增(向导)/删(卡内删除钮, D-038 起不再在设置页; 删除同步清钥匙串 D-029)
 *   - 双重 zod 拒绝重复 name(D-026)
 *   - 存储路径显示(D-019) / 开机自启默认关(D-024)
 *   - D-038: 设置弹窗 = 纯偏好页(provider 管理不在此处, 见 information-architecture.spec)
 */

/** 同意首开隐私声明 → 空态 */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

/** 从空态"添加 Provider"进入添加向导(首个 provider 引导, D-021 页内导航不变) */
async function openAddFlow(page: import("@playwright/test").Page) {
  await page.getByTestId("add-provider").click();
  await pwExpect(page.getByTestId("add-channel-step")).toBeVisible();
}

/** 侧栏 ＋ 添加 → 添加向导弹窗(非首开路径, D-038) */
async function openAddModal(page: import("@playwright/test").Page) {
  await page.getByTestId("sidebar-add").click();
  await pwExpect(page.getByTestId("add-channel-step")).toBeVisible();
}

/** 树形选择 deepseek/balance 产品 → 动态表单 */
async function pickDeepseekBalance(page: import("@playwright/test").Page) {
  await page.getByTestId("tree-product-deepseek-balance").click();
  await pwExpect(page.getByTestId("dynamic-form")).toBeVisible();
}

test("首开向导: 隐私声明须同意 → 空态 → 引导添加第一个 provider", async ({ hostPage, page }) => {
  void hostPage;
  await pwExpect(page.getByTestId("consent-page")).toBeVisible();
  await agree(page);
  await openAddFlow(page);
  // 树形选择器: 平台父节点可见(collapsible) + 产品叶子(默认展开)
  await pwExpect(page.getByTestId("tree-platform-deepseek")).toBeVisible();
  await pwExpect(page.getByTestId("tree-product-deepseek-balance")).toBeVisible();
});

test("树形通道选择器: 平台可折叠 + 产品叶子一点直达表单(D-025)", async ({ hostPage, page }) => {
  void hostPage;
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

test("动态表单: secret 字段为密码框且不回显(D-017)", async ({ hostPage, page }) => {
  void hostPage;
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

test("测试连接: 成功显示余额快照(D-017)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openAddFlow(page);
  await pickDeepseekBalance(page);
  await page.getByTestId("param-api_key").fill("sk-ds-valid");
  await page.getByTestId("test-conn").click();
  await pwExpect(page.getByTestId("test-ok")).toBeVisible();
  await pwExpect(page.getByTestId("test-ok")).toContainText("余额");
});

test("测试连接: 失败显示具体错误(D-017)", async ({ hostPage, page }) => {
  void hostPage;
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

test("实例: 向导添加 → 面板出卡 → 卡内删除 → 回空态(D-038; keyring_delete 直接断言见 information-architecture.spec)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openAddFlow(page);
  await pickDeepseekBalance(page);
  // 默认名自动编号 "<平台>-<产品> #N"
  await pwExpect(page.getByTestId("inst-name")).toHaveValue("DeepSeek-按量 #1");
  await page.getByTestId("param-api_key").fill("sk-keep");
  // 填 secret 后保存
  await page.getByTestId("save-instance").click();
  // D-038: 保存即关向导回面板, 新实例直接出卡(不再回落"实例列表")
  const card = page.getByTestId("provider-card").filter({ hasText: "DeepSeek-按量 #1" });
  await pwExpect(card).toHaveCount(1, { timeout: 10_000 });
  // 删除 = 卡内删除钮 + 确认气泡(两次点击, 就近操作)
  await card.hover();
  await card.getByTestId(/^card-del-/).click();
  await card.getByTestId(/^card-confirm-del-/).click();
  // 删完回空态(scenario=empty), 空态大按钮引导首加不受影响
  await pwExpect(page.getByTestId("empty-state")).toBeVisible({ timeout: 10_000 });
  await pwExpect(page.getByTestId("add-provider")).toBeVisible();
});

test("双重 zod 校验: 表单拒绝重复实例名(D-026)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  // 先加一个实例
  await openAddFlow(page);
  await pickDeepseekBalance(page);
  await page.getByTestId("param-api_key").fill("sk-1");
  await page.getByTestId("save-instance").click();
  await pwExpect(
    page.getByTestId("provider-card").filter({ hasText: "DeepSeek-按量 #1" }),
  ).toHaveCount(1, { timeout: 10_000 });
  // 再加第二个(侧栏 ＋), 手动改成重复名 → 拒绝
  await openAddModal(page);
  await pickDeepseekBalance(page);
  await page.getByTestId("inst-name").fill("DeepSeek-按量 #1");
  await page.getByTestId("param-api_key").fill("sk-2");
  await page.getByTestId("save-instance").click();
  await pwExpect(page.getByTestId("name-error")).toContainText("实例名已存在");
});

test("存储路径显示运行时解析路径(D-019)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openSettings(page);
  await pwExpect(page.getByTestId("config-dir")).toContainText("/home/test/.config/token-wallet");
  await pwExpect(page.getByTestId("data-dir")).toContainText("/home/test/.local/share/token-wallet");
});

test("开机自启默认关 + 可切换(D-024)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openSettings(page);
  const toggle = page.getByTestId("autostart-toggle");
  await pwExpect(toggle).not.toBeChecked();
  await toggle.check();
  await pwExpect(toggle).toBeChecked();
  await toggle.uncheck();
  await pwExpect(toggle).not.toBeChecked();
});

/** 从侧栏"设置"按钮进入设置(弹窗, P0-6; D-038 起入口在侧栏底部) */
async function openSettings(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
}

/* ---------- P0-6: 设置 = 模态弹窗(overlay 叠面板), 非页内导航 ---------- */

/** 打开设置弹窗: 遮罩 + 弹层可见, 面板内容仍在下方 */
async function openSettingsModal(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-overlay")).toBeVisible();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
}

test("设置弹窗: 打开后叠在面板上方, × 关闭回面板(P0-6)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();
  await openSettingsModal(page);
  // 弹层叠在面板上方: 面板标题栏/卡片仍在 DOM 且渲染
  await pwExpect(page.getByTestId("settings-btn")).toBeVisible();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  // 弹窗内是设置内容, 无"返回"导航概念
  await pwExpect(page.getByTestId("settings-close")).toBeVisible();
  await pwExpect(page.getByTestId("settings-back")).toHaveCount(0);
  // × 关闭 → 回面板
  await page.getByTestId("settings-close").click();
  await pwExpect(page.getByTestId("settings-overlay")).toHaveCount(0);
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
});

test("设置弹窗: 点遮罩关闭(P0-6)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openSettingsModal(page);
  // 点遮罩(弹层外角落)关闭
  await page.getByTestId("settings-overlay").click({ position: { x: 4, y: 4 } });
  await pwExpect(page.getByTestId("settings-overlay")).toHaveCount(0);
});

test("设置弹窗: ESC 键关闭(P0-6)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openSettingsModal(page);
  await page.keyboard.press("Escape");
  await pwExpect(page.getByTestId("settings-overlay")).toHaveCount(0);
});

test("设置弹窗: 内容 = 纯偏好(主题/排序/开机自启/存储路径), 无 provider 增删(D-038)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  await openSettingsModal(page);
  const modal = page.getByTestId("settings-overlay");
  await pwExpect(modal.getByTestId("instance-list")).toHaveCount(0);
  await pwExpect(modal.getByTestId("add-instance")).toHaveCount(0);
  await pwExpect(modal.getByTestId("storage-paths")).toBeVisible();
  await pwExpect(modal.getByTestId("autostart-toggle")).toBeVisible();
  await pwExpect(modal.getByTestId("theme-seg")).toBeVisible();
  await pwExpect(modal.getByTestId("sort-sec")).toBeVisible();
});

test("首开向导回归: 空态添加 Provider 仍走页内导航, 不弹模态(D-021)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);
  await openAddFlow(page);
  // 页内导航: 设置视图直接替换面板, 无遮罩弹层
  await pwExpect(page.getByTestId("settings-overlay")).toHaveCount(0);
  await pwExpect(page.getByTestId("add-overlay")).toHaveCount(0);
  await pwExpect(page.getByTestId("add-wizard")).toBeVisible();
  await pwExpect(page.getByTestId("add-back")).toBeVisible();
});

/* ---------- #829 R1: 卡间排序配置(key×dir 两正交参数, 缺省名称正排) ---------- */

test("排序配置: 缺省名称正排 + 切紧要度生效 + 方向倒排 + 重启保持(#829 R1)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();
  const cards = page.getByTestId("provider-card");
  await pwExpect(cards).toHaveCount(4);

  // 缺省 = 名称正排(无历史设置时); 期望钉 "zh" 与 sortProviders 的 Intl.Collator("zh") 同语义,
  // 消除 Node 测试进程默认 locale 跨机差异(t_6c6dd54f)
  const names = await cards.locator(".card-name").allTextContents();
  pwExpect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "zh", { numeric: true })));

  // 设置弹窗: 排序键/方向两正交控件, 缺省态高亮
  await openSettingsModal(page);
  await pwExpect(page.getByTestId("sort-key-name")).toHaveClass(/active/);
  await pwExpect(page.getByTestId("sort-dir-asc")).toHaveClass(/active/);
  // 切紧要度 → 最紧卡(kimi 5h 窗 100/100 耗尽, 剩余比例最小)置顶
  await page.getByTestId("sort-key-urgency").click();
  await page.getByTestId("settings-close").click();
  await pwExpect(cards.first().locator(".card-name")).toContainText("Kimi");

  // 方向独立生效: 倒排 → 整体反转, kimi 到最末
  await openSettingsModal(page);
  await page.getByTestId("sort-dir-desc").click();
  await page.getByTestId("settings-close").click();
  await pwExpect(cards.last().locator(".card-name")).toContainText("Kimi");

  // 重启保持(mock 桥 localStorage 与真壳 settings.json 同语义, reload 不丢)
  await page.reload();
  await pwExpect(cards).toHaveCount(4);
  await pwExpect(cards.last().locator(".card-name")).toContainText("Kimi");
  await openSettingsModal(page);
  await pwExpect(page.getByTestId("sort-key-urgency")).toHaveClass(/active/);
  await pwExpect(page.getByTestId("sort-dir-desc")).toHaveClass(/active/);
});

/* ---------- #829 R3: 设置弹窗头部固定, 滚动只在内容区 ---------- */

test("设置弹窗: 头部固定不随内容滚动, 内容区滚到底 × 仍可见可点(#829 R3)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  await openSettingsModal(page);

  // 结构断言: .settings-head 不是滚动容器 .settings-body 的子元素(modal variant)
  const headInsideBody = await page.evaluate(() => {
    const body = document.querySelector(".settings-body");
    const head = document.querySelector(".settings-head");
    return body && head ? body.contains(head) : true;
  });
  pwExpect(headInsideBody).toBe(false);

  // CSS 断言: .settings-view 不滚, .settings-body 内滚且链式滚动截断(背景不跟滚)
  const css = await page.evaluate(() => {
    const view = document.querySelector(".settings-view")!;
    const body = document.querySelector(".settings-body")!;
    const vcs = getComputedStyle(view);
    const bcs = getComputedStyle(body);
    return {
      viewOverflowY: vcs.overflowY,
      bodyOverflowY: bcs.overflowY,
      bodyOverscroll: bcs.overscrollBehaviorY,
    };
  });
  pwExpect(css.viewOverflowY).toBe("hidden");
  pwExpect(css.bodyOverflowY).toBe("auto");
  pwExpect(css.bodyOverscroll).toBe("contain");

  // 行为断言: 内容区滚到底后头部(标题+×)仍在视口, × 可点关闭
  const body = page.getByTestId("settings-body");
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await pwExpect(page.locator(".settings-head")).toBeVisible();
  await page.getByTestId("settings-close").click();
  await pwExpect(page.getByTestId("settings-overlay")).toHaveCount(0);
});