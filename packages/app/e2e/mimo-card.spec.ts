/**
 * t_e371caca U3 e2e — web_session 卡副行(卡面 ③)
 *
 * 走真实引擎链路: mock 桥 http_get_json 返回 mimo 三端点 golden
 * (与 core/test/mimo.test.ts fixture 同形态, 数值脱敏占位), 保存授权后的实例 →
 * 卡片出 monthly_credits + balance → 断言副行(千分位 Credits/余额/重置)。
 * 骨架态: usage 端点 404(best-effort) → 0/0 骨架 → 「—」降级(comment 1965 裁定)。
 */
import { test, expect } from "./fixtures";

/** 注入 mimo 三端点 mock(usage 可选 404 → 骨架态; expired 可选 true → 过期标记);
 * body 数值 = mock 占位非真值 */
async function seedMimoEndpoints(page: import("@playwright/test").Page, usageFail = false, expired = false) {
  // ⚠️ hostPage fixture 已在 setup 中 goto → addInitScript 对当前页无效; 直接页内 patch
  // (实例是测试体里后添加的, 引擎重建引擎时才发请求 → patch 在此之前已就位)
  await page.evaluate(({ fail, expired }) => {
    const w = window as unknown as {
      tokenWallet?: { invoke: (channel: string, payload?: Record<string, unknown>) => Promise<unknown> };
    };
    const orig = w.tokenWallet!.invoke.bind(w.tokenWallet);
    w.tokenWallet!.invoke = (channel: string, payload?: Record<string, unknown>) => {
      if (channel === "http_get_json") {
        const url = String((payload as { url?: string })?.url ?? "");
        if (url.includes("platform.xiaomimimo.com/api/v1/tokenPlan/usage")) {
          if (fail) return Promise.resolve({ status: 404, body: "<html>404</html>" });
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              code: 0,
              data: { monthUsage: { percent: 0.32, items: [{ name: "credits", used: 3200000, limit: 10000000, percent: 0.32 }] } },
            }),
          });
        }
        if (url.includes("platform.xiaomimimo.com/api/v1/tokenPlan/detail")) {
          return Promise.resolve({
            status: 200,
            // currentPeriodEnd = UTC 2026-10-31 23:59:59 → 本机(UTC+8)渲染 2026-11-01
            body: JSON.stringify({ code: 0, data: { planCode: "Standard", currentPeriodEnd: "2026-10-31 23:59:59", expired } }),
          });
        }
        if (url.includes("platform.xiaomimimo.com/api/v1/balance")) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({ code: 0, data: { balance: "25.51", currency: "CNY", giftBalance: "5.00", cashBalance: "20.51" } }),
          });
        }
      }
      return orig(channel, payload) as Promise<unknown>;
    };
  }, { fail: usageFail, expired });
}

/** 同意 → 添加 → MiMo → 授权(mock 成功) → 保存 → 面板出卡 */
async function addAuthorizedMimo(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await page.getByTestId("empty-state").waitFor({ state: "visible" });
  await page.getByTestId("add-provider").click();
  await page.getByTestId("add-channel-step").waitFor({ state: "visible" });
  await page.getByTestId("tree-product-mimo-token-plan").click();
  await page.getByTestId("web-session-auth-btn").click();
  await expect(page.getByTestId("web-session-auth-state")).toHaveAttribute("data-state", "authorized");
  await page.getByTestId("save-instance").click();
  await expect(page.getByTestId("card-list")).toBeVisible();
}

test.describe("web_session 卡副行(t_e371caca U3)", () => {
  test("真实数据态: 千分位 Credits 窗 + 余额 + 重置时间", async ({ hostPage: page }) => {
    await seedMimoEndpoints(page, false);
    await addAuthorizedMimo(page);
    const card = page.getByTestId("provider-card").first();
    await expect(page.getByTestId("ws-card-footer")).toBeVisible();
    await expect(page.getByTestId("ws-window-usage")).toContainText("3,200,000 / 10,000,000");
    await expect(page.getByTestId("ws-balance")).toContainText("¥25.51");
    await expect(page.getByTestId("ws-period")).toContainText("2026-11-01");
    // t_7672da28 round-3: 套餐名随快照下发(core patches plan_code)
    await expect(page.getByTestId("ws-plan")).toContainText("Standard");
    // expired=false 合法下发值, 不得判成过期标记(comment 1995: 禁 falsy 判断)
    await expect(page.getByTestId("ws-expired")).toHaveCount(0);
    // 窗进度条仍在(bars 模板主 metric)
    await expect(card.getByTestId("bars-template")).toBeVisible();
  });

  test("骨架态(usage 404): 「—」降级 + 余额照常(best-effort 不阻塞)", async ({ hostPage: page }) => {
    await seedMimoEndpoints(page, true);
    await addAuthorizedMimo(page);
    await expect(page.getByTestId("ws-card-footer")).toBeVisible();
    // 0/0 骨架 → 显式「—」灰字, 无假 0% 进度数据(1965 裁定)
    await expect(page.getByTestId("ws-window-skeleton")).toBeVisible();
    await expect(page.getByTestId("ws-window-usage")).toHaveCount(0);
    await expect(page.getByTestId("ws-balance")).toContainText("¥25.51");
  });

  test("过期态(expired=true): 套餐已到期标记(text-warn, 禁新状态色)", async ({ hostPage: page }) => {
    await seedMimoEndpoints(page, false, true);
    await addAuthorizedMimo(page);
    await expect(page.getByTestId("ws-card-footer")).toBeVisible();
    await expect(page.getByTestId("ws-expired")).toBeVisible();
    await expect(page.getByTestId("ws-expired")).toContainText("套餐已到期");
    // 套餐名照常渲染; 标记复用既有 warn 语义类
    await expect(page.getByTestId("ws-plan")).toContainText("Standard");
    await expect(page.getByTestId("ws-expired")).toHaveClass(/text-warn/);
  });
});
