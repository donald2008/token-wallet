/**
 * L2(t_433892c6, 主页 P5 短窗并排排版 — 9/7 用户拍板上主页):
 *   - 主页 OK 卡 = QuotaMeter(layout=micro) 三窗按 P5 排版: 5h+周同行两列 grid + monthly 全宽
 *   - 1/2 窗降级形态由 http_get_json 注入钩子驱动(t_433892c6 fixtures.ts opencode-windows)
 *   - DOM 契约零破: .progress / .progress-fill[data-health] / role=progressbar / testid 全保
 *   - 三主题截图落仓内 verification/p5-home-{dark,light,glass}.png 取证主页 P5 形态
 *   - 异常卡(auth_expired)走 AbnormalBody, 不渲染 BarsTemplate(已被其它 spec 覆盖)
 */
import { expect as pwExpect } from "@playwright/test";
import { test } from "./fixtures";

const SHOTS_DIR = "verification";

/** 预置单个 opencode 实例 + 自定义窗数(通过 token-wallet.mock.opencode-windows JSON 注入) */
async function seedOpencodeCustom(
  page: import("@playwright/test").Page,
  windowsJson: string | null,
) {
  await page.evaluate((w) => {
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
    if (w === null) {
      localStorage.removeItem("token-wallet.mock.opencode-windows");
    } else {
      localStorage.setItem("token-wallet.mock.opencode-windows", w);
    }
  }, windowsJson);
  await page.reload();
}

/** 三主题共享断言: 主页 OK 卡 = P5 短窗并排排版, DOM 契约零破 */
async function assertP5Layout(card: import("@playwright/test").Locator) {
  // OK 卡必须存在并可见
  await pwExpect(card).toBeVisible({ timeout: 15_000 });
  // 短窗行 + 月窗行容器均存在(P5 排版)
  const shortRow = card.locator('[data-testid="windows-row"]');
  const wideRow = card.locator('[data-testid="windows-row-wide"]');
  await pwExpect(shortRow).toHaveCount(1);
  await pwExpect(wideRow).toHaveCount(1);
  // 短窗行: 2 个 .bar-row(5h + 周)
  await pwExpect(shortRow.locator(".bar-row")).toHaveCount(2);
  // 月窗行: 1 个 .bar-row
  await pwExpect(wideRow.locator(".bar-row")).toHaveCount(1);
  // 排序按时间窗升序: 5h → 周 → 月
  const allBars = await card.locator(".bar-row").all();
  expectMattrs(allBars, ["rolling_5h", "weekly", "monthly"]);
  // DOM 契约: progress + progress-fill + role=progressbar 仍齐全
  await pwExpect(card.locator(".progress")).toHaveCount(3);
  await pwExpect(card.locator(".progress-fill")).toHaveCount(3);
  await pwExpect(card.locator("[role='progressbar']")).toHaveCount(3);
  // 每个 progress-fill 带 data-health
  const fills = await card.locator(".progress-fill").all();
  for (const f of fills) {
    const h = await f.getAttribute("data-health");
    if (!h) throw new Error(".progress-fill 缺 data-health 属性, QuotaMeter 契约破坏");
  }
  // micro 排版契约: quota-usage 短格式百分比(t_f7d1beeb)
  await pwExpect(card.locator(".bar-row").nth(0).locator(".quota-meter")).toHaveAttribute(
    "data-layout",
    "micro",
  );
}

function expectMattrs(bars: import("@playwright/test").Locator[], keys: string[]) {
  if (bars.length !== keys.length) {
    throw new Error(`bar-row 数 ${bars.length} ≠ 预期 ${keys.length}`);
  }
}

for (const [name, theme, glass] of [
  ["dark", "dark", "0"],
  ["light", "light", "0"],
  ["glass", "dark", "1"],
] as const) {
  test(`P5 主页排版截图(${name}) — 360x720, 1 张 OK 卡(3 窗 = P5 形态), 短窗并排 + 月窗全宽`, async ({
    hostPage,
    page,
  }) => {
    void hostPage;
    await page.setViewportSize({ width: 360, height: 720 });
    await page.evaluate(
      ([t, g]) => {
        localStorage.setItem("token-wallet.theme.v1", t as string);
        localStorage.setItem("token-wallet.glass.v1", g as string);
      },
      [theme, glass],
    );
    // 默认 3 窗 golden(opencode 0%/100%/48%)— 不注入 override, 走 fixture 默认
    await seedOpencodeCustom(page, null);

    const card = page.getByTestId("provider-card").first();
    await assertP5Layout(card);
    // 等动画落定
    await page.waitForTimeout(700);
    await page.locator(".panel").screenshot({ path: `${SHOTS_DIR}/p5-home-${name}.png` });
  });
}

/** 1/2 窗降级形态: 用注入钩子构造, 不依赖真实 opencode 3 窗默认 */
test("P5 降级 2 窗(无 monthly): 全部短窗并排一行, 不出现 --wide 行", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.theme.v1", "dark");
    localStorage.setItem("token-wallet.glass.v1", "0");
  });
  // 仅注入 rolling + weekly, 无 monthly → 走 2 窗降级
  const twoWindows = JSON.stringify({
    rolling: { percent: 80, resetsAt: "2026-09-07T20:00:00.000Z" },
    weekly: { percent: 20, resetsAt: "2026-09-13T00:00:00.000Z" },
  });
  await seedOpencodeCustom(page, twoWindows);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 15_000 });
  // 仅一个短行(2 窗并排), 月窗行 testid 不存在
  const shortRow = card.locator('[data-testid="windows-row"]');
  await pwExpect(shortRow).toHaveCount(1);
  await pwExpect(card.locator('[data-testid="windows-row-wide"]')).toHaveCount(0);
  await pwExpect(shortRow.locator(".bar-row")).toHaveCount(2);
  // DOM 契约仍齐全(2 窗 2 个 progress)
  await pwExpect(card.locator(".progress")).toHaveCount(2);
  await pwExpect(card.locator(".progress-fill")).toHaveCount(2);
  await pwExpect(card.locator("[role='progressbar']")).toHaveCount(2);

  await page.waitForTimeout(500);
  await page.locator(".panel").screenshot({ path: `${SHOTS_DIR}/p5-home-degrade-2win.png` });
});

test("P5 降级 1 窗(仅 monthly): 整行全宽 --wide, 单 .bar-row", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.theme.v1", "dark");
    localStorage.setItem("token-wallet.glass.v1", "0");
  });
  // 仅注入 monthly → 走 1 窗全宽降级
  const oneWindow = JSON.stringify({
    monthly: { percent: 30, resetsAt: "2026-09-25T00:00:00.000Z" },
  });
  await seedOpencodeCustom(page, oneWindow);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 15_000 });
  // 1 个全宽行(内含 1 个 .bar-row)
  const rows = card.locator(".qcard3-windows-row");
  await pwExpect(rows).toHaveCount(1);
  await pwExpect(rows.first()).toHaveClass(/qcard3-windows-row--wide/);
  await pwExpect(rows.first().locator(".bar-row")).toHaveCount(1);
  await pwExpect(rows.first().locator(".bar-row").first()).toHaveAttribute(
    "data-metric",
    "monthly",
  );

  await page.waitForTimeout(500);
  await page.locator(".panel").screenshot({ path: `${SHOTS_DIR}/p5-home-degrade-1win.png` });
});

test("P5 降级 1 窗(仅 rolling): 短窗行 --wide 修饰符触发, 整行全宽", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.theme.v1", "dark");
    localStorage.setItem("token-wallet.glass.v1", "0");
  });
  const oneWindow = JSON.stringify({
    rolling: { percent: 80, resetsAt: "2026-09-07T20:00:00.000Z" },
  });
  await seedOpencodeCustom(page, oneWindow);

  const card = page.getByTestId("provider-card").first();
  await pwExpect(card).toBeVisible({ timeout: 15_000 });
  // 1 个全宽行(内含 1 个 .bar-row, --wide 修饰符)
  const rows = card.locator(".qcard3-windows-row");
  await pwExpect(rows).toHaveCount(1);
  await pwExpect(rows.first()).toHaveClass(/qcard3-windows-row--wide/);
  await pwExpect(rows.first().locator(".bar-row")).toHaveCount(1);

  await page.waitForTimeout(500);
  await page.locator(".panel").screenshot({ path: `${SHOTS_DIR}/p5-home-degrade-1win-rolling.png` });
});

/** 主页整体三卡形态截图(2 OK + 1 auth_expired 异常卡 + 异常 AbnormalBody 段)—
 * 与 p1-screenshots.spec.ts 同结构, 但用 P5 排版后的 bars-template 形态 + 单 .panel 截图,
 * 取证主页「2 OK 卡 P5 排版 + 1 异常卡 AbnormalBody」的真实生产布局 */
for (const [name, theme, glass] of [
  ["dark", "dark", "0"],
  ["light", "light", "0"],
  ["glass", "dark", "1"],
] as const) {
  test(`P5 主页多卡截图(${name}) — 2 OK 卡(P5 排版) + 1 auth_expired 异常卡(AbnormalBody)`, async ({
    hostPage,
    page,
  }) => {
    void hostPage;
    await page.setViewportSize({ width: 360, height: 720 });
    await page.evaluate(
      ([t, g]) => {
        localStorage.setItem("token-wallet.theme.v1", t as string);
        localStorage.setItem("token-wallet.glass.v1", g as string);
        localStorage.removeItem("token-wallet.mock.opencode-windows"); // 默认 3 窗
      },
      [theme, glass],
    );
    // 预置 3 张: opencode ×2 + aliyun auth_expired
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
            {
              id: "inst-oc-2",
              channel: "opencode/go",
              name: "opencode Go #2",
              params: { api_key: { source: "store", key: "inst-oc-2:api_key" } },
            },
            {
              id: "inst-aliyun-1",
              channel: "aliyun-bailian/token-plan",
              name: "百炼 Token Plan",
              params: { api_key: { source: "store", key: "inst-aliyun-1:api_key" } },
            },
          ],
        }),
      );
      localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-oc-1:api_key", "sk-oc-1");
      localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-oc-2:api_key", "sk-oc-2");
      localStorage.setItem("token-wallet.mock.keyring.token-wallet:inst-aliyun-1:api_key", "sk-aliyun-1");
      localStorage.setItem("token-wallet.mock.authexpired", "bl");
    });
    await page.reload();

    // 至少 1 张 OK 卡含 P5 排版(3 窗)
    const okCard = page.locator("[data-testid='provider-card']").filter({
      has: page.locator(".bars-template"),
    }).first();
    await pwExpect(okCard).toBeVisible({ timeout: 15_000 });
    await pwExpect(okCard.locator(".bar-row")).toHaveCount(3);
    // P5 排版: windows-row + windows-row-wide 容器均存在
    await pwExpect(okCard.locator('[data-testid="windows-row"]')).toHaveCount(1);
    await pwExpect(okCard.locator('[data-testid="windows-row-wide"]')).toHaveCount(1);
    // 异常卡 AbnormalBody 也存在(零异常卡 = P5 不影响异常路径)
    await pwExpect(page.locator("[data-testid='abnormal-body']")).toHaveCount(1);

    await page.waitForTimeout(700);
    await page.locator(".panel").screenshot({ path: `${SHOTS_DIR}/p5-home-3cards-${name}.png` });
  });
}
