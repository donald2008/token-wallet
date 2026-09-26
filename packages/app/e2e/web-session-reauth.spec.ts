/**
 * t_e371caca round-2 修复 e2e（review 1972/1976 P1-A/P1-B）
 *
 * P1-A: auth_expired 态 web_session 卡的「重新授权」按钮必须走 web_session_auth_start
 *       （修复前走 command_auth_start → 「未知 CLI」必错, 会话过期后无法从卡片恢复）。
 * P1-B: web_session 一键授权通道不参与 D-043 判重/指纹 —— 同通道连续加两个实例 = 卡片数 2
 *       （修复前占位常量 "authorized" 指纹恒等, 第二实例被「该 key 已存在」误拦）。
 */
import { test, expect } from "./fixtures";

/** 同意 → 添加 → MiMo → 授权(mock 成功) → 保存 → 面板出卡(mimo-card.spec 同流程) */
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

/** 全程记录 renderer 发出的 IPC 通道名(探针断言用) */
async function trackIpcChannels(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __PROBE_IPC__: string[];
      tokenWallet?: { invoke: (channel: string, payload?: Record<string, unknown>) => Promise<unknown> };
    };
    w.__PROBE_IPC__ = [];
    const orig = w.tokenWallet!.invoke.bind(w.tokenWallet);
    w.tokenWallet!.invoke = (channel: string, payload?: Record<string, unknown>) => {
      w.__PROBE_IPC__.push(channel);
      return orig(channel, payload) as Promise<unknown>;
    };
  });
}

test.describe("web_session 重授权分流(P1-A)", () => {
  test("auth_expired 卡点重新授权 → 发 web_session_auth_start, 零 command_auth_start", async ({ hostPage: page }) => {
    await trackIpcChannels(page);
    await addAuthorizedMimo(page);
    // 实例已保存 → 回主页后重开向导再授权保存第二实例前, 先让首卡呈 auth_expired:
    // 直接断言更本质的路径 —— 从设置页既有实例触发不如在卡面探针; 此处用 mock http_get_json
    // 让引擎采集出 auth_expired(401), 卡面出现重新授权钮。
    await page.evaluate(() => {
      const w = window as unknown as {
        tokenWallet?: { invoke: (channel: string, payload?: Record<string, unknown>) => Promise<unknown> };
      };
      const orig = w.tokenWallet!.invoke.bind(w.tokenWallet);
      w.tokenWallet!.invoke = (channel: string, payload?: Record<string, unknown>) => {
        if (channel === "http_get_json") {
          const url = String((payload as { url?: string })?.url ?? "");
          if (url.includes("platform.xiaomimimo.com")) {
            return Promise.resolve({ status: 401, body: JSON.stringify({ code: 401, message: "unauthorized" }) });
          }
        }
        return orig(channel, payload) as Promise<unknown>;
      };
    });
    // 触发重采(全局刷新) → auth_expired 卡 + setup_hint
    await page.getByTestId("refresh-btn").click();
    await expect(page.getByTestId("setup-hint").first()).toBeVisible({ timeout: 15_000 });
    // web_session 卡 = 重授权组件(非 command OneClickAuth 形态的误导报错路径)
    await expect(page.getByTestId("web-session-reauth").first()).toBeVisible();
    // 清空探针只看点击后的通道
    await page.evaluate(() => {
      (window as unknown as { __PROBE_IPC__: string[] }).__PROBE_IPC__ = [];
    });
    await page.getByTestId("oneclick-auth-btn").first().click();
    // mock 桥同步成功 → 直接落 done 态(「✓ 已授权」); working 态一闪而过不断言
    await expect(page.getByTestId("web-session-reauth").first()).toContainText("✓ 已授权");
    const channels = await page.evaluate(() => (window as unknown as { __PROBE_IPC__: string[] }).__PROBE_IPC__);
    const authChannels = channels.filter((c) => c.includes("_auth_"));
    expect(authChannels).toContain("web_session_auth_start");
    expect(authChannels).not.toContain("command_auth_start");
  });
});

test.describe("web_session 多实例(P1-B)", () => {
  test("同通道连续添加两个 MiMo 实例 → 卡片数 2(不被 D-043 误拦)", async ({ hostPage: page }) => {
    await addAuthorizedMimo(page);
    // 底栏 ＋ 再开向导, 添加第二个 MiMo 实例(add-provider 钮只在空态, 有卡后走底栏 add-btn)
    await page.getByTestId("add-btn").click();
    await page.getByTestId("add-channel-step").waitFor({ state: "visible" });
    await page.getByTestId("tree-product-mimo-token-plan").click();
    await page.getByTestId("web-session-auth-btn").click();
    await expect(page.getByTestId("web-session-auth-state")).toHaveAttribute("data-state", "authorized");
    await page.getByTestId("save-instance").click();
    // 修复前: 内联 key-error「该 key 已存在」阻断, 卡数停留 1
    await expect(page.getByTestId("key-error")).toHaveCount(0);
    await expect(page.getByTestId("provider-card")).toHaveCount(2);
  });
});
