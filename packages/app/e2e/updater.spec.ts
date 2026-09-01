import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * D-046: 设置页关于区自动更新四态(browser-only, mock 桌面桥)。
 * 状态注入走 seedUpdaterState(localStorage) + reload(与「重启后语言保持」同族语义);
 * 主进程推送路径(__pushUpdaterEvent)单独验证下载进度事件流。
 */

async function openSettings(page: Page): Promise<void> {
  // 每测试全新 context(localStorage 空) → 首开向导在场则先同意(P0-7 mock 同语义)
  if ((await page.getByTestId("consent-agree").count()) > 0) {
    await page.getByTestId("consent-agree").click();
    await expect(page.getByTestId("empty-state")).toBeVisible();
  }
  await page.getByTestId("settings-btn").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

async function setLoaderAndReload(
  page: Page,
  state: Record<string, unknown>,
): Promise<void> {
  // 注入 updater 状态(localStorage 跨 reload 存活) → reload → mock 桥重注入 →
  // 挂载后 updaterCheck 读到注入态; consent 已同意则 reload 后不再弹向导
  await page.evaluate((s) => {
    localStorage.setItem("token-wallet.mock.updater", JSON.stringify(s));
  }, state);
  await page.reload();
  await page.waitForSelector('[data-testid="empty-state"], [data-testid="card-list"], [data-testid="consent-agree"]', {
    state: "visible",
  });
  await openSettings(page);
}

/** 模拟主进程 webContents.send(updater_event) 推送(真链路: 进度只走事件流) */
async function pushEvent(page: Page, event: Record<string, unknown>): Promise<void> {
  await page.evaluate((e) => {
    const w = window as unknown as { __pushUpdaterEvent?: (x: unknown) => void };
    w.__pushUpdaterEvent?.(e);
  }, event);
}

test.describe("自动更新四态渲染(D-046)", () => {
  test("默认 up-to-date: 版本号 + 检查更新钮", async ({ hostPage: page }) => {
    await openSettings(page);
    await expect(page.getByTestId("about-version")).toHaveText(/v0\.1\.0-test/);
    await expect(page.getByTestId("updater-check-btn")).toBeVisible();
  });

  test("available 态: 「更新到 vX」钮出现, 点击进入 downloading", async ({ hostPage: page }) => {
    await setLoaderAndReload(page, { status: "available", version: "0.2.1" });
    const btn = page.getByTestId("updater-download-btn");
    await expect(btn).toHaveText("更新到 v0.2.1");
    await btn.click();
    // 真链路语义: 下载发起后进度经 updater_event 事件推送(非 invoke 返回值)
    await pushEvent(page, { status: "downloading", percent: 10 });
    await expect(page.getByTestId("updater-state")).toHaveText(/正在下载/);
  });

  test("downloading 态: 进度百分比文案, 无更新按钮", async ({ hostPage: page }) => {
    await setLoaderAndReload(page, { status: "downloading", percent: 64 });
    const state = page.getByTestId("updater-state");
    await expect(state).toHaveAttribute("data-updater-status", "downloading");
    await expect(state).toHaveText(/64%/);
    await expect(page.getByTestId("updater-download-btn")).toHaveCount(0);
  });

  test("ready 态: 「重启安装 vX」钮出现", async ({ hostPage: page }) => {
    await setLoaderAndReload(page, { status: "ready", version: "0.2.1" });
    await expect(page.getByTestId("updater-install-btn")).toHaveText("重启安装 v0.2.1");
  });

  test("unavailable 态(dev): 显式文案, 零更新按钮(不假装能更新)", async ({ hostPage: page }) => {
    await setLoaderAndReload(page, { status: "unavailable" });
    const state = page.getByTestId("updater-state");
    await expect(state).toHaveAttribute("data-updater-status", "unavailable");
    await expect(page.getByTestId("updater-check-btn")).toHaveCount(0);
    await expect(page.getByTestId("updater-download-btn")).toHaveCount(0);
  });

  test("主进程事件推送驱动进度(real bridge path: onUpdaterEvent)", async ({ hostPage: page }) => {
    await setLoaderAndReload(page, { status: "available", version: "0.2.1" });
    // 模拟主进程 webContents.send(updater_event) 推下载进度
    await pushEvent(page, { status: "downloading", percent: 88 });
    await expect(page.getByTestId("updater-state")).toHaveText(/88%/);
  });
});
