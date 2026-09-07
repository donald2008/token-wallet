import { test, expect } from "./fixtures";

// B-2 regression: 删钮 hover 浮出后与 status badge 零重叠(老大 #1184 裁决)
// B-3 fix (老大 #1188): 真三主题循环 — 每主题写 token-wallet.theme.v1 + glass.v1
// → page.reload() → 重新 hover → boundingBox overlapArea=0 断言(参照 p5-home.spec.ts:84-100)
test("B-2/B-3: card-del-btn 与 card-status-badge 零几何重叠 — 真三主题循环", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });

  // 一次 seed(instance 数据), localStorage 跨 reload 持久, 循环内只换主题
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
    localStorage.setItem(
      "token-wallet.mock.keyring.token-wallet:inst-oc-1:api_key",
      "sk-oc-1",
    );
  });

  const card = page.getByTestId("provider-card").first();
  const btn = card.locator(".card-del-btn");
  const badge = card.locator('[data-testid="card-status-badge"]');

  // 真三主题: [name, theme.v1, glass.v1] — dark=0 / light=0 / glass=dark+1
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
    await page.reload();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500); // 主题切换动画落定

    // ① hover badge 中心 → 删钮必须保持 opacity:0(修订 H: hover 徽章不误触)
    const badgeBox = await badge.boundingBox();
    if (!badgeBox) throw new Error(`no badge box @ ${name}`);
    await page.mouse.move(
      badgeBox.x + badgeBox.width / 2,
      badgeBox.y + badgeBox.height / 2,
    );
    await page.waitForTimeout(150);
    await expect(btn, `hover badge 不误触 @${name}`).toHaveCSS(
      "opacity",
      "0",
    );

    // ② hover 按钮 → opacity:1 浮出
    await btn.hover();
    await expect(btn).toHaveCSS("opacity", "1");

    // ③ boundingBox 2D 零重叠硬断言
    const btnBox = await btn.boundingBox();
    const badgeBox2 = await badge.boundingBox();
    if (!btnBox || !badgeBox2) throw new Error(`no box @ ${name}`);
    const overlapX = Math.max(
      0,
      Math.min(btnBox.x + btnBox.width, badgeBox2.x + badgeBox2.width) -
        Math.max(btnBox.x, badgeBox2.x),
    );
    const overlapY = Math.max(
      0,
      Math.min(btnBox.y + btnBox.height, badgeBox2.y + badgeBox2.height) -
        Math.max(btnBox.y, badgeBox2.y),
    );
    // 2D 零重叠硬断言(overlapX 与 overlapY 任一为 0 即零重叠)
    const overlapArea = overlapX * overlapY;
    expect(
      overlapArea,
      `overlapArea @${name} btn=${JSON.stringify(btnBox)} badge=${JSON.stringify(badgeBox2)} (x=${overlapX} y=${overlapY})`,
    ).toBe(0);

    // ④ hover 态真 distinct 截图(主题已真实切换) — 绝对路径直落仓根 tracked 目录
    const ROOT_VERIFICATION = "/root/work/token-wallet/verification/b2-hover";
    await page.screenshot({
      path: `${ROOT_VERIFICATION}/${name}-hover.png`,
      fullPage: false,
    });
  }
});
