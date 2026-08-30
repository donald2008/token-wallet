import { expect as pwExpect } from "@playwright/test";
import { test, getCapturedInvokes } from "./fixtures";

/**
 * L2(D-039 卡片拖动排序): manual 模式(拖动即切 + order 持久化 + 实例集为真相源) + 设置页排序三档。
 *
 * 覆盖验收:
 *   - 拖 A 到首位 → 面板顺序变 + 设置页显示「手动」+ 重启后顺序保持
 *   - 切名称排序再切回手动 → 自定义顺序恢复(order 保留不清)
 *   - 删除一张后 order 幽灵 id 不影响渲染(实例集合是真相源)
 *   - 拖动过程(未松手)无写盘: set_sort_config 调用次数 = drop 次数
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

/** 读当前面板卡片顺序(按 data-provider) */
async function cardOrder(page: import("@playwright/test").Page): Promise<string[]> {
  return page
    .getByTestId("provider-card")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-provider") ?? ""));
}

/** 拖动手柄(品牌色块)拖到目标卡上方/下方: fromId 的 handle → 与 toId 卡中点对齐 */
async function dragCard(
  page: import("@playwright/test").Page,
  fromId: string,
  toId: string,
  position: "above" | "below" = "below",
) {
  const from = page.getByTestId(`drag-handle-${fromId}`);
  const to = page.locator(`[data-testid="provider-card"][data-provider="${toId}"]`);
  await pwExpect(from).toBeVisible();
  const fromBox = (await from.boundingBox())!;
  const toBox = (await to.boundingBox())!;
  const steps = 12;
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  // 分步移动(pointermove 逐步触发, 模拟真实拖动)
  const targetY = position === "above" ? toBox.y - 4 : toBox.y + toBox.height + 4;
  const startY = fromBox.y + fromBox.height / 2;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      fromBox.x + fromBox.width / 2,
      startY + ((targetY - startY) * i) / steps,
    );
  }
  await page.mouse.up();
}

async function openSettingsModal(page: import("@playwright/test").Page) {
  await page.getByTestId("sidebar").getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-overlay")).toBeVisible();
}

/* ---------- 1. 拖动即切 manual + 顺序生效 + 设置页联动 + 重启保持 ---------- */

test("拖 A 到首位 → 面板顺序变 + 设置页显示手动 + 重启后顺序保持(D-039)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  // 三个真实实例, 名称拉丁序: Alpha < Bravo < Charlie(缺省名称正排)
  await seedInstances(page, [
    inst("alpha", "Alpha", "deepseek/balance"),
    inst("bravo", "Bravo", "deepseek/balance"),
    inst("charlie", "Charlie", "deepseek/balance"),
  ]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(3);
  pwExpect(await cardOrder(page)).toEqual(["alpha", "bravo", "charlie"]);

  // 拖动: Charlie(当前第三)拖到首位(Alpha 上方)
  await dragCard(page, "charlie", "alpha", "above");
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(3);
  pwExpect(await cardOrder(page)).toEqual(["charlie", "alpha", "bravo"]);

  // 设置页显示「手动」且高亮; 方向控件禁用(manual 按拖拽顺序)
  await openSettingsModal(page);
  await pwExpect(page.getByTestId("sort-key-manual")).toHaveClass(/active/);
  await pwExpect(page.getByTestId("sort-dir-asc")).toBeDisabled();
  await pwExpect(page.getByTestId("sort-dir-desc")).toBeDisabled();
  await page.getByTestId("settings-close").click();

  // 重启后顺序保持(manual order 持久化到 mock localStorage)
  await page.reload();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(3);
  pwExpect(await cardOrder(page)).toEqual(["charlie", "alpha", "bravo"]);
  // 设置页仍是手动
  await openSettingsModal(page);
  await pwExpect(page.getByTestId("sort-key-manual")).toHaveClass(/active/);
});

/* ---------- 2. 切名称再切回手动 → 自定义顺序恢复 ---------- */

test("切名称排序再切回手动 → 自定义顺序恢复(order 保留不清, D-039)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await seedInstances(page, [
    inst("alpha", "Alpha", "deepseek/balance"),
    inst("bravo", "Bravo", "deepseek/balance"),
    inst("charlie", "Charlie", "deepseek/balance"),
  ]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(3);

  // 先拖出自定义顺序: Charlie 到首位
  await dragCard(page, "charlie", "alpha", "above");
  pwExpect(await cardOrder(page)).toEqual(["charlie", "alpha", "bravo"]);

  // 切到名称正排 → 面板按名称排, order 保留在配置里
  await openSettingsModal(page);
  await page.getByTestId("sort-key-name").click();
  await pwExpect(page.getByTestId("sort-key-name")).toHaveClass(/active/);
  await page.getByTestId("settings-close").click();
  pwExpect(await cardOrder(page)).toEqual(["alpha", "bravo", "charlie"]);

  // 切回手动 → 自定义顺序恢复
  await openSettingsModal(page);
  await page.getByTestId("sort-key-manual").click();
  await page.getByTestId("settings-close").click();
  pwExpect(await cardOrder(page)).toEqual(["charlie", "alpha", "bravo"]);
});

/* ---------- 3. 删除一张后 order 幽灵 id 不影响渲染 ---------- */

test("删除一张后 order 幽灵 id 不影响渲染(实例集合是真相源, D-039)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await seedInstances(page, [
    inst("alpha", "Alpha", "deepseek/balance"),
    inst("bravo", "Bravo", "deepseek/balance"),
    inst("charlie", "Charlie", "deepseek/balance"),
  ]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(3);

  // 拖出顺序: charlie 首位; 此时 order = [charlie, alpha, bravo]
  await dragCard(page, "charlie", "alpha", "above");
  pwExpect(await cardOrder(page)).toEqual(["charlie", "alpha", "bravo"]);

  // 删除 bravo(卡内删除: hover → 删除钮 → 确认)
  const bravoCard = page.locator('[data-testid="provider-card"][data-provider="bravo"]');
  await bravoCard.hover();
  await bravoCard.getByTestId("card-del-bravo").click();
  await bravoCard.getByTestId("card-confirm-del-bravo").click();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(2);

  // order 里仍有幽灵 id "bravo"(已删除) → 忽略, 不丢卡不崩
  pwExpect(await cardOrder(page)).toEqual(["charlie", "alpha"]);

  // reload 后仍正常(幽灵 id 依旧忽略)
  await page.reload();
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(2);
  pwExpect(await cardOrder(page)).toEqual(["charlie", "alpha"]);
});

/* ---------- 4. 拖动过程(未松手)无写盘: set_sort_config 次数 = drop 次数 ---------- */

test("拖动过程零写盘: pointermove 不触发 set_sort_config, drop 才写一次(D-039)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await seedInstances(page, [
    inst("alpha", "Alpha", "deepseek/balance"),
    inst("bravo", "Bravo", "deepseek/balance"),
    inst("charlie", "Charlie", "deepseek/balance"),
  ]);
  await pwExpect(page.getByTestId("provider-card")).toHaveCount(3);

  const countSetSort = async (): Promise<number> => {
    const invokes = await getCapturedInvokes(page);
    return invokes.filter((i) => i.cmd === "set_sort_config").length;
  };

  const before = await countSetSort();

  // 起拖 + 移动(未松手): 零写盘
  const from = page.getByTestId("drag-handle-charlie");
  const alphaCard = page.locator('[data-testid="provider-card"][data-provider="alpha"]');
  const fromBox = (await from.boundingBox())!;
  const alphaBox = (await alphaCard.boundingBox())!;
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  // 拖动过程中应出现指示线(视觉)
  await pwExpect(page.getByTestId("drop-line")).toBeVisible();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(
      fromBox.x + fromBox.width / 2,
      fromBox.y + fromBox.height / 2 + ((alphaBox.y - 4 - (fromBox.y + fromBox.height / 2)) * i) / 8,
    );
  }
  await pwExpect(page.getByTestId("drop-line")).toBeVisible();
  pwExpect(await countSetSort()).toBe(before); // 拖动中未松手 → 未写盘

  // 松手(drop) → 写盘恰一次
  await page.mouse.up();
  await pwExpect(page.getByTestId("drop-line")).toHaveCount(0);
  pwExpect(await countSetSort()).toBe(before + 1);

  // 面板顺序已生效
  pwExpect(await cardOrder(page)).toEqual(["charlie", "alpha", "bravo"]);
});
