import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

/**
 * L2(t_27eeadad, 2026-09-07 用户拍板): 主页 P1 化后 BarRowTooltip 不再挂载。
 *
 * 历史契约(t_a398348b): 窗口行悬停 → micro tooltip 四元素揭示。
 * 新契约(t_27eeadad): 主页窗口行已是 QuotaMeter(layout="micro") 三窗常驻直显,
 *   悬浮复读同一信息是冗余 → BarRowTooltip 从主页窗口行移除。
 *
 * 本规约断言:
 *   - 主页 provider-card 内 .bar-tooltip 节点数 == 0(无悬停复读)
 *   - 窗口行 hover 不再揭示 tooltip(@srsholmes/tauri-playwright 断言节点空)
 *   - 微 meter = QuotaMeter[data-layout="micro"] 仍在窗口行直接子级(信息常驻)
 *   - 三态截图(dark/light/glass)仍取, 落 /tmp 取证主页 P1 形态
 *
 * 组件本身(BarRowTooltip.tsx)保留作为契约锚点 + 旧 BarRowTooltip 自身的 vitest 回归护栏;
 * 方案页 ProviderCardLayouts/QuotaGallery 也不再挂 BarRowTooltip(quota-gallery.spec.ts 沿检 .bar-tooltip == 0)。
 */

/** 预置一个 opencode 实例(golden: rolling 0% / weekly 100% / monthly 48% → 三条 bar-row) */
async function seedOpencodeInstance(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.consent.v1", "1");
    localStorage.setItem(
      "token-wallet.mock.instances.v1",
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: "inst-oc-1",
            channel: "opencode/go",
            name: "opencode Go #1",
            params: { api_key: { source: "store", key: "inst-oc-1:api_key" } },
          },
        ],
      }),
    );
    localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-oc-1:api_key", "sk-oc-1");
  });
  await page.reload();
}

test("主页 P1 化: provider-card 内 .bar-tooltip == 0(无悬停复读, t_27eeadad)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  await seedOpencodeInstance(page);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });
  const rows = card.locator(".bar-row");
  await pwExpect(rows).toHaveCount(3); // 主页仍是 3 窗

  // 硬契约: 主页窗口行不挂 BarRowTooltip(整卡零 .bar-tooltip 节点)
  await pwExpect(card.locator(".bar-tooltip")).toHaveCount(0);

  // 窗口行 hover 也不揭示 tooltip(已无 .bar-tooltip 子节点)
  const monthlyRow = rows.nth(2);
  await monthlyRow.hover();
  await pwExpect(card.locator(".bar-tooltip")).toHaveCount(0);

  // micro meter 仍在窗口行直接子级(.bar-row > .quota-meter[data-layout="micro"], 常驻直显)
  const monthlyMeter = monthlyRow.locator(".quota-meter");
  await pwExpect(monthlyMeter).toHaveAttribute("data-layout", "micro");
  await pwExpect(monthlyMeter.locator(".quota-title")).toHaveText("月窗");
  // micro 排版短格式(t_f7d1beeb 9/7): micro quota-usage 只显百分比, 不走 usageText 完整文案
  await pwExpect(monthlyMeter.locator(".quota-usage")).toHaveText("48%");
  await pwExpect(monthlyMeter.locator(".progress-fill")).toHaveAttribute("data-health", "ok");
});

test("P1 头: handle+name+StatusDot+状态徽章 三件套一行, 删除钮仍存在(D-038 兼容)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  await seedOpencodeInstance(page);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 10_000 });

  const head = card.locator(".card-head");
  await pwExpect(head.locator(".brand-block")).toHaveCount(1); // 拖把手
  await pwExpect(head.locator(".card-name")).toHaveText("opencode Go #1");
  await pwExpect(head.locator(".status-dot")).toHaveCount(1); // P1 新增
  await pwExpect(head.locator(".card-status-text").first()).not.toBeEmpty(); // 状态徽章
  // 删除钮: 需 hover 卡片才能 visibility:opacity 1(D-038 opacity 0 默认态)
  // 修订 H: 改 hover 右上角热区 .card-del-zone 才让按钮浮出
  await card.locator(".card-del-zone").hover();
  await pwExpect(card.locator('[data-testid="card-del-inst-oc-1"]')).toBeVisible();
});

test("三态截图取证(dark/light/glass 各 hover monthly 行落 /tmp, 主页 P1 形态)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  for (const [name, theme, glass] of [
    ["dark", "dark", "0"],
    ["light", "light", "0"],
    ["glass", "dark", "1"],
  ] as const) {
    await page.evaluate(
      ([t, g]) => {
        localStorage.setItem("token-wallet.theme.v1", t as string);
        localStorage.setItem("token-wallet.glass.v1", g as string);
      },
      [theme, glass],
    );
    await seedOpencodeInstance(page);
    const card = page.getByTestId("provider-card").first();
    await pwExpect(card).toBeVisible({ timeout: 10_000 });
    const monthlyRow = card.locator(".bar-row").nth(2);
    await monthlyRow.hover();
    await page.waitForTimeout(600);
    // 三态正常取证: micro meter 在行直接子级 + 无 .bar-tooltip
    await pwExpect(monthlyRow.locator(".quota-meter")).toHaveAttribute("data-layout", "micro");
    await pwExpect(card.locator(".bar-tooltip")).toHaveCount(0);
    await page.locator(".panel").screenshot({ path: `/tmp/bar-tooltip-${name}.png` });
  }
});
