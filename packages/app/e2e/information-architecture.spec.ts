import { expect as pwExpect } from "@playwright/test";
import { test, getCapturedInvokes } from "./fixtures";

/**
 * L2(D-038 信息架构改造 + t_d086543b 布局重构): 操作分区 =
 * **标题栏(窗口/全局态: 刷新/主题/图钉/最小化/关闭) / 底边栏(低频全局动作: 添加/设置) / 卡片(实例动作) / 设置(偏好)**
 *
 * 覆盖验收(t_d086543b):
 *   - 侧栏消失; 底边栏两钮(＋添加/⚙设置)可点且行为正确; 标题栏五钮(刷新/主题/图钉/最小化/关闭)全常显
 *   - 刷新在标题栏 → 真实触发采集; 设置/添加在底边栏 → 开弹窗
 *   - 卡内删除流程走通(hover 淡入 → 确认气泡 → 取消保留 / 确认删除 + 清钥匙串 + 清库)
 *   - 设置页无 provider 增删元素与排序选择控件, 通用偏好项齐全
 *   - 360px 宽下标题栏单行不换行 + 内容区无横向溢出; 标题栏/底边栏都横贯整行
 *   - 新添加 provider 出现在第一位, 重启后保持
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

/** 经底边栏添加一个 deepseek/balance 实例(t_d086543b: 添加钮在底边栏 add-btn) */
async function addDeepseekInstance(page: import("@playwright/test").Page, name: string, secret: string) {
  await page.getByTestId("add-btn").click();
  const modal = page.getByTestId("add-overlay");
  await pwExpect(modal).toBeVisible();
  await modal.getByTestId("tree-product-deepseek-balance").click();
  await pwExpect(modal.getByTestId("dynamic-form")).toBeVisible();
  await modal.getByTestId("inst-name").fill(name);
  await modal.getByTestId("param-api_key").fill(secret);
  await modal.getByTestId("save-instance").click();
  // 保存即关向导回面板(新卡即时出现)
  await pwExpect(page.getByTestId("add-overlay")).toHaveCount(0);
}

/* ---------- 1. 底边栏两钮(添加/设置) ---------- */

test("底边栏两钮: ＋添加开向导弹窗 / ⚙设置开设置弹窗(顺序与常显)", async ({ hostPage, page }) => {
  void hostPage;
  await agree(page);

  const bottombar = page.getByTestId("bottombar");
  await pwExpect(bottombar).toBeVisible();
  // 顺序 左→右: 添加 / 设置(t_d086543b: 左右分布 space-between)
  const ids = await bottombar.locator("button").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.testid),
  );
  pwExpect(ids).toEqual(["add-btn", "settings-btn"]);
  // 常驻: 鼠标在面板外也全显(无 hover 显隐)
  await page.mouse.move(2, 2);
  for (const id of ids) {
    await pwExpect(bottombar.locator(`[data-testid="${id}"]`)).toHaveCSS("opacity", "1");
  }

  // ＋ 添加 → 添加向导弹窗(流程本体不变: 先选平台)
  await bottombar.getByTestId("add-btn").click();
  await pwExpect(page.getByTestId("add-overlay")).toBeVisible();
  await pwExpect(page.getByTestId("add-wizard")).toBeVisible();
  await pwExpect(page.getByTestId("add-channel-step")).toBeVisible();
  await pwExpect(page.getByTestId("tree-product-deepseek-balance")).toBeVisible();
  // × 关闭回面板
  await page.getByTestId("add-close").click();
  await pwExpect(page.getByTestId("add-overlay")).toHaveCount(0);

  // ⚙ 设置 → 设置弹窗
  await bottombar.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-overlay")).toBeVisible();
  await pwExpect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("settings-close").click();
  await pwExpect(page.getByTestId("settings-overlay")).toHaveCount(0);

  // ESC 也能关添加向导(与设置弹窗同语义)
  await bottombar.getByTestId("add-btn").click();
  await pwExpect(page.getByTestId("add-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await pwExpect(page.getByTestId("add-overlay")).toHaveCount(0);
});

test("标题栏 ⟳ 刷新: 真实触发采集(http_get_json 调用次数增加)", async ({ hostPage, page }) => {
  void hostPage;
  await seedInstances(page, [inst("inst-a", "DeepSeek-按量 #1", "deepseek/balance")]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1, { timeout: 10_000 });

  const httpCalls = async () =>
    (await getCapturedInvokes(page)).filter((c) => c.cmd === "http_get_json").length;
  const before = await httpCalls();
  await page.locator('.titlebar [data-testid="refresh-btn"]').click();
  await pwExpect.poll(httpCalls, { timeout: 10_000 }).toBeGreaterThan(before);
});

/* ---------- 2. 标题栏五钮(t_d086543b 重排) ---------- */

test("标题栏五钮: 刷新/主题快切/图钉/最小化/关闭, 设置与添加在底边栏", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agree(page);

  const titlebar = page.locator(".titlebar");
  const titlebarIds = await titlebar.locator("button").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.testid),
  );
  pwExpect(titlebarIds).toEqual([
    "refresh-btn",
    "theme-cycle-btn",
    "pin-btn",
    "win-min-btn",
    "win-close-btn",
  ]);
  await pwExpect(titlebar.locator(".app-title")).toHaveText("token-wallet");

  // 刷新/主题迁到标题栏(同 testid), 添加/设置落在底边栏; 侧栏彻底消失
  await pwExpect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);
  await pwExpect(page.locator('.titlebar [data-testid="refresh-btn"]')).toHaveCount(1);
  await pwExpect(page.locator('.titlebar [data-testid="theme-cycle-btn"]')).toHaveCount(1);
  await pwExpect(page.locator('[data-testid="bottombar"] [data-testid="add-btn"]')).toHaveCount(1);
  await pwExpect(page.locator('[data-testid="bottombar"] [data-testid="settings-btn"]')).toHaveCount(1);
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

  // 未 hover 卡片/热区 → 删除钮淡出(opacity 0, 不占常态视觉)
  await page.mouse.move(2, 2);
  await pwExpect(delA).toHaveCSS("opacity", "0");
  // hover 右上角热区(.card-del-zone) → 删除钮淡入(修订 H: 不再依赖整卡 hover)
  await cardA.locator(".card-del-zone").hover();
  await cardA.locator(".card-del-btn").hover(); // 触发按钮完全显出(visibility:visible)
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
  await cardA.locator(".card-del-zone").hover();
  await cardA.getByTestId("card-del-inst-a").click({ force: true });
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

test("设置弹窗 = 纯偏好页: 无 provider 增删元素, 无排序选择控件, 通用偏好齐全", async ({
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

  // 排序只留手动: sort-sec 在但只剩提示文案, sort-key-*/sort-dir-* 选择控件零残留
  await pwExpect(modal.getByTestId("sort-sec")).toBeVisible();
  await pwExpect(modal.locator('[data-testid^="sort-key-"], [data-testid^="sort-dir-"]')).toHaveCount(0);
  await pwExpect(modal.getByTestId("sort-sec")).toContainText("拖动");

  // 通用偏好全在
  for (const id of ["theme-seg", "autostart-toggle", "storage-paths"]) {
    await pwExpect(modal.getByTestId(id)).toBeVisible();
  }
});

/* ---------- 5. 360px 布局 ---------- */

test("360px: 标题栏单行不换行 + 内容区无横向溢出 + 底边栏不被压缩", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  await seedInstances(page, [inst("inst-a", "DeepSeek-按量 #1", "deepseek/balance")]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(1, { timeout: 10_000 });

  const titlebar = page.locator(".titlebar");
  const h360 = Math.round((await titlebar.boundingBox())!.height);
  const titleH = Math.round((await page.locator(".app-title").boundingBox())!.height);
  pwExpect(titleH).toBeLessThanOrEqual(h360); // 单行(换两行必然高于标题栏内容行)
  // 硬指标: inline 元素换行会产生多个 client rect —— 单行 ⇔ 恰好 1 个
  const titleRects = await page
    .locator(".app-title")
    .evaluate((el) => el.getClientRects().length);
  pwExpect(titleRects).toBe(1);

  // t_2ca0af5e P0 终审: 360px 默认态标题完整可见.
  // DOM 文本与 CSS ellipsis 解耦 —— toHaveText / getClientRects 都不挡 ellipsis,
  // 必须 scrollWidth <= clientWidth 直接断"文本是否被裁" (text-overflow:ellipsis
  // 触发时 scrollWidth > clientWidth, 文本内容超出可视区).
  const titleFit = await page.locator(".app-title").evaluate((el) => ({
    scrollWidth: (el as HTMLElement).scrollWidth,
    clientWidth: (el as HTMLElement).clientWidth,
  }));
  pwExpect(titleFit.scrollWidth).toBeLessThanOrEqual(titleFit.clientWidth);

  // 800px 视口下标题栏高度一致(t_2ac39613 断言口径)
  await page.setViewportSize({ width: 800, height: 600 });
  pwExpect(Math.round((await titlebar.boundingBox())!.height)).toBe(h360);

  // 回到 360: 无横向溢出(文档级 + 内容区级)
  await page.setViewportSize({ width: 360, height: 600 });
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector('[data-testid="panel-main"]') as HTMLElement;
    const list = document.querySelector('[data-testid="card-list"]') as HTMLElement | null;
    const bottombar = document.querySelector('[data-testid="bottombar"]') as HTMLElement;
    return {
      docOverflow: doc.scrollWidth - doc.clientWidth,
      mainOverflow: main.scrollWidth - main.clientWidth,
      listOverflow: list ? list.scrollWidth - list.clientWidth : 0,
      bottombarWidth: Math.round(bottombar.getBoundingClientRect().width),
    };
  });
  pwExpect(overflow.docOverflow).toBeLessThanOrEqual(0);
  pwExpect(overflow.mainOverflow).toBeLessThanOrEqual(0);
  pwExpect(overflow.listOverflow).toBeLessThanOrEqual(0);
  // 底边栏占满内容宽(不被压缩), 且侧栏不存在
  pwExpect(overflow.bottombarWidth).toBe(360 - 16); // .panel margin 8px 两侧
  await pwExpect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);
});

test("t_66b67453 契约1 语义延续: 标题栏横贯整行, 底边栏第二行也横贯整行", async ({ hostPage, page }) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 600 });
  await agree(page);

  const geo = await page.evaluate(() => {
    const panel = document.querySelector(".panel") as HTMLElement;
    const titlebar = document.querySelector(".titlebar") as HTMLElement;
    const bottombar = document.querySelector('[data-testid="bottombar"]') as HTMLElement;
    const pr = panel.getBoundingClientRect();
    const tr = titlebar.getBoundingClientRect();
    const br = bottombar.getBoundingClientRect();
    return {
      panelRight: pr.right,
      panelBottom: pr.bottom,
      titlebarRight: tr.right,
      titlebarTop: tr.top,
      bottombarTop: br.top,
      bottombarLeft: br.left,
      bottombarRight: br.right,
      bottombarBottom: br.bottom,
      panelLeft: pr.left,
    };
  });

  // 标题栏横贯整行: 右缘 = 面板右缘
  pwExpect(Math.round(geo.titlebarRight)).toBe(Math.round(geo.panelRight));
  // 底边栏也在最底部横贯整行: 左缘=面板左缘, 右缘=面板右缘, 底缘=面板底缘
  pwExpect(Math.round(geo.bottombarLeft)).toBe(Math.round(geo.panelLeft));
  pwExpect(Math.round(geo.bottombarRight)).toBe(Math.round(geo.panelRight));
  pwExpect(Math.round(geo.bottombarBottom)).toBe(Math.round(geo.panelBottom));
  // 标题栏第一行, 底边栏在面板底部(titlebar.top < bottombar.top, 垂直堆叠)
  pwExpect(geo.titlebarTop).toBeLessThan(geo.bottombarTop);
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

/* ---------- 6. 新 provider 置顶(t_d086543b) ---------- */

test("新添加 provider 出现在第一位, 重启后保持(t_d086543b)", async ({ hostPage, page }) => {
  void hostPage;
  await seedInstances(page, [
    inst("inst-a", "Alpha 旧实例", "deepseek/balance"),
    inst("inst-b", "Bravo 旧实例", "deepseek/balance"),
  ]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(2, { timeout: 10_000 });

  // 经底边栏添加新实例(Zeta 名字在名称正排下本应排最后 → 置顶语义必须压过它)
  await addDeepseekInstance(page, "Zeta 新实例", "sk-zeta-new");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(3, { timeout: 10_000 });
  await pwExpect(
    page.locator('[data-testid="provider-card"]').first().locator(".card-name"),
  ).toContainText("Zeta 新实例");

  // 重启后顺序保持: store.unshift(实例序) + order prepend(手动序)双保险
  await page.reload();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(3, { timeout: 10_000 });
  await pwExpect(
    page.locator('[data-testid="provider-card"]').first().locator(".card-name"),
  ).toContainText("Zeta 新实例");
});
