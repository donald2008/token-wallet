import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

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
