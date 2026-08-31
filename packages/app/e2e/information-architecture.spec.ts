import { expect as pwExpect } from "@playwright/test";
import { test, getCapturedInvokes } from "./fixtures";

/**
 * L2(D-038 信息架构改造): 操作分区 = **侧栏(全局动作) / 卡片(实例动作) / 设置(偏好)**
 *
 * 覆盖验收:
 *   - 侧栏三钮可点且行为正确: ＋ 添加 → 添加向导弹窗(流程本体不变) /
 *     ⟳ 刷新 → 真实触发采集 / ⚙ 设置 → 设置弹窗
 *   - 标题栏仅剩 4 控件(状态点 + 标题 + 图钉 + 最小化 + 关闭 中的可点控件为 3 个按钮),
 *     刷新/设置/主题三钮不在标题栏; 全部常显(hover 淡入语义见 pin-toolbar.spec)
 *   - 卡内删除流程走通(hover 淡入 → 确认气泡 → 取消保留 / 确认删除 + 清钥匙串 + 清库)
 *   - 设置页无 provider 增删元素, 通用偏好项齐全
 *   - 360px 宽下标题栏单行不换行; 侧栏 + 内容区无横向溢出
 */

/** 种子实例最小形状(避免 e2e tsconfig 不覆盖 app src 的模块解析) */
interface SeedInstance {
  id: string;
  channel: string;
  name: string;
  params: { api_key: { source: string; key: string } };
}

function inst(id: string, name: string, channel: string): SeedInstance {
  return { id, channel, name, params: { api_key: { source: "store", key: `${id}:api_key` } } };
}

/** 预置实例 + consent 到 localStorage 再 reload(mock 桥与真壳 instances.yaml 同语义) */
async function seedInstances(page: import("@playwright/test").Page, instances: SeedInstance[]) {
  await page.evaluate((list) => {
    localStorage.setItem("token-wallet.mock.consent.v1", "1");
    localStorage.setItem(
      "token-wallet.mock.instances.v1",
      JSON.stringify({ version: 1, instances: list }),
    );
    for (const one of list) {
      localStorage.setItem(`token-wallet.mock.keyring.token-wallet:${one.params.api_key.key}`, "sk-seed");
    }
  }, instances);
  await page.reload();
}

async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

/** 读 mock sqlite 当前快照行的 provider_id 集合(验证删除清库) */
async function mockSqliteProviderIds(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const rows = w.__MOCK_SQLITE__?.rows ?? [];
    return [...new Set(rows.map((r: { provider_id: string }) => r.provider_id))] as string[];
  });
}

/* ---------- 1. 侧栏三钮 ---------- */

test("侧栏常驻三钮: ＋添加开向导弹窗 / ⚙设置开设置弹窗(顺序与常显)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);

  const sidebar = page.getByTestId("sidebar");
  await pwExpect(sidebar).toBeVisible();
  // 顺序 上→下: 添加 / 刷新 / 主题快切 / 设置(t_66b67453 契约2; 快切+设置被弹性空隙推到底部)
  const ids = await sidebar.locator("button").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.testid),
  );
  pwExpect(ids).toEqual(["sidebar-add", "refresh-btn", "theme-cycle-btn", "settings-btn"]);
  // 常驻: 鼠标在面板外也全显(与标题栏同口径, 无 hover 显隐)
  await page.mouse.move(2, 2);
  for (const id of ids) {
    await pwExpect(sidebar.locator(`[data-testid="${id}"]`)).toHaveCSS("opacity", "1");
  }
  // 宽 ~44px 定宽
  const w = Math.round((await sidebar.boundingBox())!.width);
  pwExpect(w).toBe(44);

  // ＋ 添加 → 添加向导弹窗(流程本体不变: 先选平台)
  await sidebar.getByTestId("sidebar-add").click();
  await pwExpect(page.getByTestId("add-overlay")).toBeVisible();
  await pwExpect(page.getByTestId("add-wizard")).toBeVisible();
  await pwExpect(page.getByTestId("add-channel-step")).toBeVisible();
  await pwExpect(page.getByTestId("tree-product-deepseek-balance")).toBeVisible();
  // × 关闭回面板
  await page.getByTestId("add-close").click();
  await pwExpect(page.getByTestId("add-overlay")).toHaveCount(0);

  // ⚙ 设置 → 设置弹窗
  await sidebar.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-overlay")).toBeVisible();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("settings-close").click();
  await pwExpect(page.getByTestId("settings-overlay")).toHaveCount(0);

  // ESC 也能关添加向导(与设置弹窗同语义)
  await sidebar.getByTestId("sidebar-add").click();
  await pwExpect(page.getByTestId("add-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await pwExpect(page.getByTestId("add-overlay")).toHaveCount(0);
});

test("侧栏 ⟳ 刷新: 真实触发采集(http_get_json 调用次数增加)", async ({ hostPage, page }) => {
  void hostPage;
  await seedInstances(page, [inst("inst-a", "DeepSeek-按量 #1", "deepseek/balance")]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1, { timeout: 10_000 });

  const httpCalls = async () =>
    (await getCapturedInvokes(page)).filter((c) => c.cmd === "http_get_json").length;
  const before = await httpCalls();
  await page.getByTestId("sidebar").getByTestId("refresh-btn").click();
  await pwExpect.poll(httpCalls, { timeout: 10_000 }).toBeGreaterThan(before);
});

/* ---------- 2. 标题栏瘦身 ---------- */

test("标题栏瘦身: 仅 app-title + 图钉/最小化/关闭 3 钮, 刷新与设置在侧栏", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);

  const titlebar = page.locator(".titlebar");
  const titlebarIds = await titlebar.locator("button").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.testid),
  );
  pwExpect(titlebarIds).toEqual(["pin-btn", "win-min-btn", "win-close-btn"]);
  await pwExpect(titlebar.locator(".app-title")).toHaveText("token-wallet");

  // 刷新/设置迁到侧栏(同 testid 换了位置), 主题切换钮彻底移除
  await pwExpect(page.locator('.sidebar [data-testid="refresh-btn"]')).toHaveCount(1);
  await pwExpect(page.locator('.sidebar [data-testid="settings-btn"]')).toHaveCount(1);
  await pwExpect(page.getByTestId("theme-toggle")).toHaveCount(0);
  // hover 显隐类彻底消失
  await pwExpect(page.locator(".toolbar-btn")).toHaveCount(0);
});

/* ---------- 3. 卡内删除 ---------- */

test("卡内删除: hover 淡入 → 取消保留 → 确认删除(清钥匙串 + 清库)", async ({ hostPage, page }) => {
  void hostPage;
  await seedInstances(page, [
    inst("inst-a", "DeepSeek-按量 #1", "deepseek/balance"),
    inst("inst-b", "Opencode Go #1", "opencode/go"),
  ]);
  const cards = page.getByTestId("provider-card");
  await pwExpect(cards).toHaveCount(2, { timeout: 10_000 });

  const cardA = cards.filter({ hasText: "DeepSeek-按量 #1" });
  const delA = cardA.getByTestId("card-del-inst-a");

  // 未 hover 卡片 → 删除钮淡出(opacity 0, 不占常态视觉)
  await page.mouse.move(2, 2);
  await pwExpect(delA).toHaveCSS("opacity", "0");
  // hover 卡片 → 淡入
  await cardA.hover();
  await pwExpect(delA).toHaveCSS("opacity", "1");

  // 点删除 → 确认气泡(含取消); 取消 → 卡片保留, 库未动
  await delA.click();
  const bubble = cardA.getByTestId("card-confirm-row-inst-a");
  await pwExpect(bubble).toBeVisible();
  await pwExpect(bubble).toContainText("删除并清钥匙串?");
  await cardA.getByTestId("card-cancel-del-inst-a").click();
  await pwExpect(cardA.getByTestId("card-confirm-row-inst-a")).toHaveCount(0);
  await pwExpect(cards).toHaveCount(2);
  pwExpect(await mockSqliteProviderIds(page)).toContain("inst-a");

  // 再删一次 → 确认 → 卡片消失(仅剩 B)
  await cardA.hover();
  await cardA.getByTestId("card-del-inst-a").click();
  await cardA.getByTestId("card-confirm-del-inst-a").click();
  await pwExpect(cards).toHaveCount(1, { timeout: 10_000 });
  await pwExpect(cards.first().locator(".card-name")).toContainText("Opencode Go #1");

  // D-029 钥匙串清理 + t_2ac39613 DB 清理(purgeProvider 走 sqlite_exec)
  await pwExpect
    .poll(async () =>
      (await getCapturedInvokes(page)).some(
        (c) => c.cmd === "keyring_delete" && String(c.args?.key ?? "").startsWith("inst-a:"),
      ),
    )
    .toBe(true);
  await pwExpect.poll(() => mockSqliteProviderIds(page)).not.toContain("inst-a");
});

test("dev 场景预览卡(无真实实例)不渲染删除钮 —— 不给可点但无效的按钮", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);
  await page.getByTestId("scenario-mixed").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(4);
  await pwExpect(page.locator('[data-testid^="card-del-"]')).toHaveCount(0);
});

/* ---------- 4. 设置页瘦身 ---------- */

test("设置弹窗 = 纯偏好页: 无 provider 增删元素, 主题/排序/自启/存储路径齐全", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await seedInstances(page, [inst("inst-a", "DeepSeek-按量 #1", "deepseek/balance")]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1, { timeout: 10_000 });
  await page.getByTestId("settings-btn").click();
  const modal = page.getByTestId("settings-overlay");
  await pwExpect(modal.getByTestId("settings-view")).toBeVisible();

  // provider 管理彻底移出设置页(即使已有实例, 也不出实例列表)
  for (const id of ["add-instance", "instance-list", "no-instances", "add-channel-step"]) {
    await pwExpect(modal.getByTestId(id)).toHaveCount(0);
  }
  await pwExpect(modal.locator('[data-testid^="del-"]')).toHaveCount(0);
  await pwExpect(modal).not.toContainText("实例管理");

  // 通用偏好全在
  for (const id of ["theme-seg", "sort-key-seg", "sort-dir-seg", "autostart-toggle", "storage-paths"]) {
    await pwExpect(modal.getByTestId(id)).toBeVisible();
  }
});

/* ---------- 5. 360px 布局 ---------- */

test("360px: 标题栏单行不换行 + 侧栏与内容区无横向溢出", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  await seedInstances(page, [inst("inst-a", "DeepSeek-按量 #1", "deepseek/balance")]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1, { timeout: 10_000 });

  const titlebar = page.locator(".titlebar");
  const h360 = Math.round((await titlebar.boundingBox())!.height);
  const titleH = Math.round((await page.locator(".app-title").boundingBox())!.height);
  pwExpect(titleH).toBeLessThanOrEqual(h360); // 单行(换两行必然高于标题栏内容行)
  // 硬指标: inline 元素换行会产生多个 client rect —— 单行 ⇔ 恰好 1 个
  // (比高度比较更不易恒真: 整体等比撑高时高度断言仍会通过, rect 数不会)
  const titleRects = await page
    .locator(".app-title")
    .evaluate((el) => el.getClientRects().length);
  pwExpect(titleRects).toBe(1);

  // 800px 视口下标题栏高度一致(t_2ac39613 断言口径)
  await page.setViewportSize({ width: 800, height: 600 });
  pwExpect(Math.round((await titlebar.boundingBox())!.height)).toBe(h360);

  // 回到 360: 无横向溢出(文档级 + 内容区级), 侧栏定宽 44 不被压缩
  await page.setViewportSize({ width: 360, height: 600 });
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector('[data-testid="panel-main"]') as HTMLElement;
    const list = document.querySelector('[data-testid="card-list"]') as HTMLElement | null;
    const sidebar = document.querySelector('[data-testid="sidebar"]') as HTMLElement;
    return {
      docOverflow: doc.scrollWidth - doc.clientWidth,
      mainOverflow: main.scrollWidth - main.clientWidth,
      listOverflow: list ? list.scrollWidth - list.clientWidth : 0,
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
    };
  });
  // 360px: 标题栏单行不换行 + 侧栏与内容区无横向溢出 + 标题栏全宽(契约1)
  pwExpect(overflow.docOverflow).toBeLessThanOrEqual(0);
  pwExpect(overflow.mainOverflow).toBeLessThanOrEqual(0);
  pwExpect(overflow.listOverflow).toBeLessThanOrEqual(0);
  pwExpect(overflow.sidebarWidth).toBe(44);
});

test("t_66b67453 契约1: 标题栏横贯整行(全宽), 侧栏从第二行左缘开始", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  await agree(page);

  const geo = await page.evaluate(() => {
    const panel = document.querySelector(".panel") as HTMLElement;
    const titlebar = document.querySelector(".titlebar") as HTMLElement;
    const sidebar = document.querySelector('[data-testid="sidebar"]') as HTMLElement;
    const pr = panel.getBoundingClientRect();
    const tr = titlebar.getBoundingClientRect();
    const sr = sidebar.getBoundingClientRect();
    return {
      panelRight: pr.right,
      titlebarRight: tr.right,
      titlebarTop: tr.top,
      sidebarTop: sr.top,
      sidebarLeft: sr.left,
      panelLeft: pr.left,
    };
  });

  // 标题栏横贯整行: 右缘 = 面板右缘(不被 44px 侧栏切短)
  pwExpect(Math.round(geo.titlebarRight)).toBe(Math.round(geo.panelRight));
  // 标题栏第一行, 侧栏第二行: titlebar.top < sidebar.top(垂直堆叠生效)
  pwExpect(geo.titlebarTop).toBeLessThan(geo.sidebarTop);
  // 侧栏从面板左缘开始(第二行左缘)
  pwExpect(Math.round(geo.sidebarLeft)).toBe(Math.round(geo.panelLeft));
});

test("t_66b67453 契约4: auth_expired 卡 setup_hint 复制钮 → 剪贴板 = 反引号内命令原文", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await page.getByTestId("scenario-mixed").click();

  const hintBtn = page.getByTestId("setup-hint").getByTestId("hint-copy-btn");
  await pwExpect(hintBtn).toBeVisible();

  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__COPIED__ = null;
    // navigator.clipboard 是只读 getter → defineProperty 覆盖原型属性
    const nav = navigator as unknown as { clipboard: unknown };
    Object.defineProperty(nav, "clipboard", {
      value: {
        writeText: async (t: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__COPIED__ = t;
        },
      },
      configurable: true,
    });
  });
  await hintBtn.click();
  await pwExpect(hintBtn).toHaveText("已复制");
  const copied = await page.evaluate(() => (window as unknown as { __COPIED__: string }).__COPIED__);
  pwExpect(copied).toBe("bl auth login --console");
  // 1.5s 后还原
  await pwExpect(hintBtn).toHaveText("复制", { timeout: 3000 });
});
