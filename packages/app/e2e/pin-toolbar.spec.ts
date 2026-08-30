import { expect as pwExpect } from "@playwright/test";
import { test, getCapturedInvokes } from "./fixtures";

/**
 * L2 P1: 窗口置顶开关(图钉) + 顶部工具区 hover 显隐(browser-only mock 桥)
 *
 * 覆盖(任务 t_6143eac9 验收):
 *   - 工具按钮默认淡出; 鼠标进入面板淡入, 移出面板淡出
 *   - 图钉点击切换置顶 → win_set_always_on_top 回写被调用(getCapturedInvokes 断言),
 *     aria-pressed 反映置顶态; 通道注册齐全(win_get_always_on_top 启动读回被调用)
 *   - 置顶态图钉常显(鼠标移开面板仍 opacity 1), 其余按钮照常淡出
 *   - 置顶态跨"重启"保持(mock 桥 localStorage 持久化, 与真壳 settings.json 同语义)
 *   - 键盘 focus 时工具按钮可见可达(focus-within/focus-visible 兜底, Tab 导航不瞎)
 *
 * 注: 面板四周有 8px 透明边(.panel margin), 鼠标移到 (2,2) = 面板外;
 * Playwright 的 visible 判定不认 opacity, 显隐一律断 computed opacity。
 */

/** 同意首开隐私声明 → 面板(含标题栏) */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

test("工具区 hover 显隐: 默认淡出, 鼠标进面板淡入, 移出面板淡出", async ({ hostPage }) => {
  const page = hostPage;
  await agree(page);
  const refreshBtn = page.getByTestId("refresh-btn");
  const settingsBtn = page.getByTestId("settings-btn");
  const pinBtn = page.getByTestId("pin-btn");

  // 鼠标在面板外(8px 透明边) → 工具区淡出
  await page.mouse.move(2, 2);
  await pwExpect(refreshBtn).toHaveCSS("opacity", "0");
  await pwExpect(settingsBtn).toHaveCSS("opacity", "0");
  await pwExpect(pinBtn).toHaveCSS("opacity", "0"); // 未置顶时图钉同样 hover 显隐
  // 标题与状态点不受 hover 显隐影响(它们是数据, 不是工具按钮)
  await pwExpect(page.locator(".app-title")).toBeVisible();

  // 鼠标进入面板 → 工具区淡入
  await page.mouse.move(640, 300);
  await pwExpect(refreshBtn).toHaveCSS("opacity", "1");
  await pwExpect(settingsBtn).toHaveCSS("opacity", "1");
  await pwExpect(pinBtn).toHaveCSS("opacity", "1");

  // 移出面板 → 再淡出
  await page.mouse.move(2, 2);
  await pwExpect(refreshBtn).toHaveCSS("opacity", "0");
  await pwExpect(settingsBtn).toHaveCSS("opacity", "0");
});

test("置顶切换: 回写 IPC + aria-pressed + 置顶态图钉常显(其余按钮照常淡出)", async ({
  hostPage,
}) => {
  const page = hostPage;
  await agree(page);
  const pinBtn = page.getByTestId("pin-btn");
  const refreshBtn = page.getByTestId("refresh-btn");

  // 启动读回: win_get_always_on_top 通道已被调用(通道注册齐全)
  await pwExpect
    .poll(async () =>
      (await getCapturedInvokes(page)).some((i) => i.cmd === "win_get_always_on_top"),
    )
    .toBe(true);
  await pwExpect(pinBtn).toHaveAttribute("aria-pressed", "false");

  // hover 露出图钉 → 点击开置顶
  await page.mouse.move(640, 30);
  await pwExpect(pinBtn).toHaveCSS("opacity", "1");
  await pinBtn.click();
  await pwExpect(pinBtn).toHaveAttribute("aria-pressed", "true");
  await pwExpect
    .poll(async () =>
      (await getCapturedInvokes(page)).some(
        (i) => i.cmd === "win_set_always_on_top" && i.args?.enabled === true,
      ),
    )
    .toBe(true);

  // 鼠标移出面板: 置顶态图钉常显, 其余工具按钮照常淡出
  // (先 blur: 点击后图钉持焦, focus-within 会合法地保持工具区显示 — 键盘可达语义)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(2, 2);
  await pwExpect(pinBtn).toHaveCSS("opacity", "1");
  await pwExpect(refreshBtn).toHaveCSS("opacity", "0");

  // 再点一次关置顶: 回写 enabled=false, 图钉恢复 hover 显隐
  await pinBtn.click();
  await pwExpect(pinBtn).toHaveAttribute("aria-pressed", "false");
  await pwExpect
    .poll(async () =>
      (await getCapturedInvokes(page)).some(
        (i) => i.cmd === "win_set_always_on_top" && i.args?.enabled === false,
      ),
    )
    .toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(2, 2);
  await pwExpect(pinBtn).toHaveCSS("opacity", "0");
});

test("置顶态跨重启保持: reload 后图钉实心常显(无需 hover), 其余按钮仍淡出", async ({
  hostPage,
}) => {
  const page = hostPage;
  await agree(page);
  // 开置顶后先把鼠标移出面板再 reload —— reload 后无 hover 事件,
  // 图钉可见只能来自"置顶常显"规则, 排除鼠标停留造成的假阳性
  await page.mouse.move(640, 30);
  await page.getByTestId("pin-btn").click();
  await pwExpect(page.getByTestId("pin-btn")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(2, 2);

  await page.reload();
  const pinBtn = page.getByTestId("pin-btn");
  await pwExpect(pinBtn).toBeAttached();
  // 读回置顶态: aria-pressed=true 且常显(未 hover)
  await pwExpect(pinBtn).toHaveAttribute("aria-pressed", "true");
  await pwExpect(pinBtn).toHaveCSS("opacity", "1");
  await pwExpect(page.getByTestId("refresh-btn")).toHaveCSS("opacity", "0");
});

test("键盘可达: 工具按钮 focus 时显示(focus-within 兜底, hover 显隐不废键盘导航)", async ({
  hostPage,
}) => {
  const page = hostPage;
  await agree(page);
  // 鼠标在面板外, 工具区处于淡出态
  await page.mouse.move(2, 2);
  const settingsBtn = page.getByTestId("settings-btn");
  await pwExpect(settingsBtn).toHaveCSS("opacity", "0");

  // 键盘聚焦( Tab 导航等价路径) → 栏内控件聚焦触发 focus-within → 工具区显示
  await settingsBtn.focus();
  await pwExpect(settingsBtn).toBeFocused();
  await pwExpect(settingsBtn).toHaveCSS("opacity", "1");
  await pwExpect(page.getByTestId("refresh-btn")).toHaveCSS("opacity", "1");

  // 图钉按钮自身也可聚焦(键盘可切换置顶)
  const pinBtn = page.getByTestId("pin-btn");
  await pinBtn.focus();
  await pwExpect(pinBtn).toBeFocused();
  await pwExpect(pinBtn).toHaveCSS("opacity", "1");
});
