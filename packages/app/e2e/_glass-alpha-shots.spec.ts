import { expect as pwExpect, type Page } from "@playwright/test";
import { test } from "./fixtures";

/**
 * t_c20d4d11 9/7 round-2(B3): 玻璃透明度滑槽三主题 × 三档 截图(360×720 panel view).
 *
 * 输出: verification/glass-alpha-round2/{dark,light}-glass-{default,50pct,15pct}.png 共 6 张.
 * 跑法(单跑): pnpm exec playwright test e2e/_glass-alpha-shots.spec.ts
 */
const SHOTS: Array<["dark" | "light", number, string]> = [
  ["dark", 1.0, "default"],
  ["dark", 0.5, "50pct"],
  ["dark", 0.15, "15pct"],
  ["light", 1.0, "default"],
  ["light", 0.5, "50pct"],
  ["light", 0.15, "15pct"],
];

async function setupShot(
  page: Page,
  theme: "dark" | "light",
  alpha: number,
): Promise<void> {
  await page.setViewportSize({ width: 360, height: 720 });
  // 直接预置 localStorage 后首次 goto(避免 goto→reload 双跳 webServer 窗口关闭)
  await page.addInitScript(
    (params: { theme: string; alpha: number }) => {
      try {
        localStorage.setItem("token-wallet.consent.v1", "1");
        localStorage.setItem("token-wallet.theme.v1", params.theme);
        localStorage.setItem("token-wallet.glass.v1", "1");
        localStorage.setItem("token-wallet.glassAlpha.v1", String(params.alpha));
      } catch {
        /* ignore */
      }
    },
    { theme, alpha },
  );
  await page.goto("/");
  // 预置 consent.v1=1 跳过 consent 屏, scenario 直接进 ok 场景
  await page.waitForTimeout(200);
  await page.getByTestId("settings-btn").click({ timeout: 5000 });
  await pwExpect(page.getByTestId("settings-view")).toBeVisible({ timeout: 5000 });
  await pwExpect(page.getByTestId("glass-alpha-input")).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
}

for (const [theme, alpha, label] of SHOTS) {
  test(`glass alpha shot: ${theme}-glass @ ${label}`, async ({ page }) => {
    await setupShot(page, theme, alpha);
    await page.screenshot({
      path: `verification/glass-alpha-round2/${theme}-glass-${label}.png`,
      fullPage: false,
    });
  });
}