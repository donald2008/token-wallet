import { expect as pwExpect } from "@playwright/test";
import { seedSqliteHistory, test } from "./fixtures";

/**
 * L2(t_2ac39613 #2): 删除全部 provider 后重新添加, 已删除的 provider 不得复活。
 *
 * 场景(契约): 添加 A、B → 删除 A、B → 添加 C → 面板仅 C;
 *           重启 app(reload)后仍仅 C。
 *
 * 防复活双保险各自被验到:
 * 1. 删除即清库(store.remove → purgeProvider → DELETE FROM snapshots/usage_records):
 *    删完 A、B 后断言 mock sqlite 里 A/B 快照行已不存在。
 * 2. hydrate 过滤(engine 按现有实例 id 过滤 latestSnapshots):
 *    reload 后即使库里还有残留也不复活。
 */

/** 种子实例最小形状(避免 e2e tsconfig 不覆盖 app src 的模块解析) */
interface SeedInstance {
  id: string;
  channel: string;
  name: string;
  params: { api_key: { source: string; key: string } };
}

/** 造一个实例(不同通道 → mock http 各回 golden, 卡名可区分) */
function inst(id: string, name: string, channel: string): SeedInstance {
  return {
    id,
    channel,
    name,
    params: { api_key: { source: "store", key: `${id}:api_key` } },
  };
}

/** 预置 instances 到 localStorage + reload(mock 桥 localStorage 与真壳 instances.yaml 同语义) */
async function seedInstances(page: import("@playwright/test").Page, instances: SeedInstance[]) {
  await page.evaluate((list) => {
    localStorage.setItem("token-wallet.mock.consent.v1", "1");
    localStorage.setItem(
      "token-wallet.mock.instances.v1",
      JSON.stringify({ version: 1, instances: list }),
    );
    for (const inst of list) {
      const ref = inst.params.api_key as { source: string; key: string };
      localStorage.setItem(`token-wallet.mock.keyring.token-wallet:${ref.key}`, "sk-seed");
    }
  }, instances);
  await page.reload();
}

/** 打开设置弹窗(标题栏设置按钮) */
async function openSettings(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-btn").click();
  await pwExpect(page.getByTestId("settings-overlay")).toBeVisible();
}

/** 添加一个 deepseek/balance 实例(modal 内: 通道树 → 表单 → 保存) */
async function addDeepseekInstance(page: import("@playwright/test").Page, name: string, secret: string) {
  const modal = page.getByTestId("settings-overlay");
  await modal.getByTestId("add-instance").click();
  await modal.getByTestId("tree-product-deepseek-balance").click();
  await pwExpect(modal.getByTestId("dynamic-form")).toBeVisible();
  await modal.getByTestId("inst-name").fill(name);
  await modal.getByTestId("param-api_key").fill(secret);
  await modal.getByTestId("save-instance").click();
  await pwExpect(modal.getByTestId("instance-list")).toContainText(name);
}

/** 读 mock sqlite 当前快照行的 provider_id 集合(验证 purge 真的清了库) */
async function mockSqliteProviderIds(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const rows = w.__MOCK_SQLITE__?.rows ?? [];
    return [...new Set(rows.map((r: { provider_id: string }) => r.provider_id))] as string[];
  });
}

test("删除全部 provider 后重添加: 面板仅新实例, reload 后仍仅新实例(t_2ac39613 #2)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  // 添加 A、B(seed 等价于设置页添加; reload 后两张卡都出数)
  await seedInstances(page, [
    inst("inst-a", "DeepSeek-按量 #1", "deepseek/balance"),
    inst("inst-b", "Opencode Go #1", "opencode/go"),
  ]);
  const cards = page.getByTestId("provider-card");
  await pwExpect(cards).toHaveCount(2, { timeout: 10_000 });
  await pwExpect(cards.filter({ hasText: "DeepSeek-按量 #1" })).toBeVisible();
  await pwExpect(cards.filter({ hasText: "Opencode Go #1" })).toBeVisible();

  // 删除 A、B(两次确认, 同 settings.spec D-029 流程)
  await openSettings(page);
  const list = page.getByTestId("settings-overlay").getByTestId("instance-list");
  for (const id of ["inst-a", "inst-b"]) {
    await list.getByTestId(`del-${id}`).click();
    await list.getByTestId(`confirm-del-${id}`).click();
  }
  await pwExpect(page.getByTestId("settings-overlay").getByTestId("no-instances")).toBeVisible();

  // 删除即清库: mock sqlite 里 A/B 快照已被 purge(DELETE 走既有 sqlite_exec 通道)
  await pwExpect.poll(() => mockSqliteProviderIds(page)).toEqual([]);

  // 添加 C(modal 内 deepseek/balance)
  await addDeepseekInstance(page, "DeepSeek-按量 #2", "sk-c");
  await page.getByTestId("settings-close").click();

  // 面板仅 C: 一张卡, A/B 不复活
  await pwExpect(cards).toHaveCount(1, { timeout: 10_000 });
  await pwExpect(cards.first().locator(".card-name")).toContainText("DeepSeek-按量 #2");
  await pwExpect(page.getByText("Opencode Go #1")).toHaveCount(0);
  await pwExpect(page.getByText("Kimi")).toHaveCount(0);

  // 重启 app(reload)后仍仅 C(instances_load 只剩 C; hydrate 过滤兜底)
  await page.reload();
  await pwExpect(cards).toHaveCount(1, { timeout: 10_000 });
  await pwExpect(cards.first().locator(".card-name")).toContainText("DeepSeek-按量 #2");
  await pwExpect(page.getByText("Opencode Go #1")).toHaveCount(0);
});

/**
 * L2(B-3 契约追加): 删除 → 立即重添加同名通道 → 无旧数据闪现(历史从零开始)。
 *
 * 竞态确定性复现: 注入采集延迟 → 点刷新让 A 的请求"在途" → 在途期间删除 A(purge 跑完)
 * → 迟到响应确定落在 purge 之后。此时若无 B-3 写库守卫(store.remove 先停源 +
 * saveSnapshot 入口校验 + engine.onResult 校验), 迟到的采集结果会把 A 的快照行重新
 * 写回库 → 幽灵复活 / 重添加同通道时闪旧数据。
 *
 * 注: mock 的 http_get_json 在调用瞬间读取 delayMs 并 setTimeout, 故第 5 步清掉延迟
 * 不影响已在途的那次请求(它仍在原定时刻返回) —— 这正是我们需要的"迟到响应"。
 */
test("删除→立即重添加同名通道: 迟到采集响应不复活旧数据, 历史从零(B-3)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  // A(deepseek/balance) + 3 天前余额历史(有历史才能证"重添加后历史从零")
  await seedInstances(page, [inst("inst-a", "DeepSeek-按量 #1", "deepseek/balance")]);
  const cards = page.getByTestId("provider-card");
  await pwExpect(cards).toHaveCount(1, { timeout: 10_000 });
  await seedSqliteHistory(page, "inst-a", 3, 458.45);
  await pwExpect.poll(() => mockSqliteProviderIds(page)).toContain("inst-a");

  // 制造在途请求: 注入 4s 采集延迟 → 手动刷新(§3.1 立即同步)
  await page.evaluate(() => localStorage.setItem("token-wallet.mock.httpdelayms", "4000"));
  await page.getByTestId("refresh-btn").click();

  // 在途期间删除 A: 停源 → purge → 摘卡(契约五步)
  await openSettings(page);
  const list = page.getByTestId("settings-overlay").getByTestId("instance-list");
  await list.getByTestId("del-inst-a").click();
  await list.getByTestId("confirm-del-inst-a").click();
  await pwExpect(page.getByTestId("settings-overlay").getByTestId("no-instances")).toBeVisible();
  // 删除即清库: A 的快照行(含预置历史)已全清
  await pwExpect.poll(() => mockSqliteProviderIds(page)).toEqual([]);

  // 立即重添加同一通道(deepseek/balance)的新实例 C; 清掉延迟只影响 C 的新请求
  await page.evaluate(() => localStorage.removeItem("token-wallet.mock.httpdelayms"));
  await addDeepseekInstance(page, "DeepSeek-按量 #2", "sk-c");
  await page.getByTestId("settings-close").click();
  await pwExpect(cards).toHaveCount(1, { timeout: 10_000 });
  await pwExpect(cards.first().locator(".card-name")).toContainText("DeepSeek-按量 #2");

  // 等过在途窗口(4s): 旧引擎的 A 采集响应此刻返回并走 onResult → 必须被守卫丢弃
  await page.waitForTimeout(5_000);

  const ids = await mockSqliteProviderIds(page);
  // ① 写库守卫: 迟到响应没把 A 写回库(无守卫时 inst-a 会重新出现)
  pwExpect(ids).not.toContain("inst-a");
  // ② 历史从零: 库里只剩新实例自己的行, 没有任何一行属于已删的 A
  pwExpect(ids.length).toBeLessThanOrEqual(1);
  // ③ 无旧数据闪现: 面板仍只有 C, A 的卡名从未回来
  await pwExpect(cards).toHaveCount(1);
  await pwExpect(cards.first().locator(".card-name")).toContainText("DeepSeek-按量 #2");
  await pwExpect(page.getByText("DeepSeek-按量 #1")).toHaveCount(0);
});
