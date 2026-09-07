import { test, expect } from "./fixtures";

// B-2 regression: 删钮 hover 浮出后与 status badge 零重叠(老大 #1184 裁决)
test("B-2: card-del-btn 与 card-status-badge 零几何重叠(三主题)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.setViewportSize({ width: 360, height: 720 });
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
  await page.reload();
  const card = page.getByTestId("provider-card").first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  const btn = card.locator(".card-del-btn");
  // hover 浮出
  await btn.hover();
  await expect(btn).toHaveCSS("opacity", "1");

  for (const theme of ["dark", "light", "glass"] as const) {
    const btnBox = await btn.boundingBox();
    const badgeBox = await card
      .locator('[data-testid="card-status-badge"]')
      .boundingBox();
    if (!btnBox || !badgeBox) throw new Error(`no box @ ${theme}`);
    const overlapX = Math.max(
      0,
      Math.min(btnBox.x + btnBox.width, badgeBox.x + badgeBox.width) -
        Math.max(btnBox.x, badgeBox.x),
    );
    const overlapY = Math.max(
      0,
      Math.min(btnBox.y + btnBox.height, badgeBox.y + badgeBox.height) -
        Math.max(btnBox.y, badgeBox.y),
    );
    // 2D 零重叠硬断言(overlapX 与 overlapY 任一为 0 即零重叠)
    const overlapArea = overlapX * overlapY;
    expect(
      overlapArea,
      `overlapArea @${theme} btn=${JSON.stringify(btnBox)} badge=${JSON.stringify(badgeBox)} (x=${overlapX} y=${overlapY})`,
    ).toBe(0);
    // 截 hover 态三主题证据
    await page.screenshot({
      path: `/tmp/verify-b2-${theme}-hover.png`,
      fullPage: false,
    });
  }
});
