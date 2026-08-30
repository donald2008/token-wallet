import { expect as pwExpect } from "@playwright/test";
import { test, getCapturedInvokes } from "./fixtures";

/**
 * L2 P1/D-038: 窗口置顶开关(图钉) + 标题栏控件常显(hover 显隐逻辑已整体移除)
 *
 * 覆盖:
 *   - 标题栏三控件(图钉/最小化/关闭)**常显**: 鼠标在面板外/内 opacity 均为 1
 *     (D-038 前是 hover 淡入; 低频全局动作迁侧栏后标题栏无需再靠隐藏减噪)
 *   - 图钉点击切换置顶 → win_set_always_on_top 回写被调用(getCapturedInvokes 断言),
 *     aria-pressed 反映置顶态; 通道注册齐全(win_get_always_on_top 启动读回被调用)
 *   - 置顶态跨"重启"保持(mock 桥 localStorage 持久化, 与真壳 settings.json 同语义)
 *   - 键盘可达: 图钉/关闭可聚焦可切换(常显后无 focus-within 兜底依赖)
 *
 * 注: 面板四周有 8px 透明边(.panel margin), 鼠标移到 (2,2) = 面板外;
 * Playwright 的 visible 判定不认 opacity, 显隐一律断 computed opacity。
 */

/** 同意首开隐私声明 → 面板(含标题栏) */
async function agree(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await pwExpect(page.getByTestId("empty-state")).toBeVisible();
}

test("标题栏控件常显(D-038): 鼠标在面板外/面板内 opacity 均为 1", async ({ hostPage }) => {
  const page = hostPage;
  await agree(page);
  const pinBtn = page.getByTestId("pin-btn");
  const minBtn = page.getByTestId("win-min-btn");
  const closeBtn = page.getByTestId("win-close-btn");

  // 鼠标在面板外(8px 透明边) → 三控件依然全显(旧版此时会淡出到 opacity 0)
  await page.mouse.move(2, 2);
  for (const btn of [pinBtn, minBtn, closeBtn]) {
    await pwExpect(btn).toHaveCSS("opacity", "1");
  }
  // 标题与状态点照常可见
  await pwExpect(page.locator(".app-title")).toBeVisible();

  // 鼠标进入面板 → 仍是 1(无淡入过渡语义)
  await page.mouse.move(640, 300);
  for (const btn of [pinBtn, minBtn, closeBtn]) {
    await pwExpect(btn).toHaveCSS("opacity", "1");
  }

  // 标题栏内不再有刷新/设置/主题三钮(迁侧栏 + 设置页)
  await pwExpect(page.locator('.titlebar [data-testid="refresh-btn"]')).toHaveCount(0);
  await pwExpect(page.locator('.titlebar [data-testid="settings-btn"]')).toHaveCount(0);
  await pwExpect(page.getByTestId("theme-toggle")).toHaveCount(0);
});

test("置顶切换: 回写 IPC + aria-pressed(常显, 无需 hover 露出)", async ({ hostPage }) => {
  const page = hostPage;
  await agree(page);
  const pinBtn = page.getByTestId("pin-btn");

  // 启动读回: win_get_always_on_top 通道已被调用(通道注册齐全)
  await pwExpect
    .poll(async () =>
      (await getCapturedInvokes(page)).some((i) => i.cmd === "win_get_always_on_top"),
    )
    .toBe(true);
  await pwExpect(pinBtn).toHaveAttribute("aria-pressed", "false");

  // 鼠标在面板外也能直接点(常显 = 无需先 hover 露出)
  await page.mouse.move(2, 2);
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

  // 置顶态: 图钉实心(--accent 填充) —— 常显下状态仍一眼可辨
  await pwExpect(pinBtn).toHaveAttribute("data-pinned", "true");

  // 再点一次关置顶: 回写 enabled=false, 图钉仍常显
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
  await pwExpect(pinBtn).toHaveCSS("opacity", "1");
});

test("置顶态跨重启保持: reload 后 aria-pressed=true 且实心常显", async ({ hostPage }) => {
  const page = hostPage;
  await agree(page);
  await page.getByTestId("pin-btn").click();
  await pwExpect(page.getByTestId("pin-btn")).toHaveAttribute("aria-pressed", "true");
  // reload 后无 hover 事件, 可见性只能来自"常显"规则
  await page.mouse.move(2, 2);

  await page.reload();
  const pinBtn = page.getByTestId("pin-btn");
  await pwExpect(pinBtn).toBeAttached();
  await pwExpect(pinBtn).toHaveAttribute("aria-pressed", "true");
  await pwExpect(pinBtn).toHaveCSS("opacity", "1");
  await pwExpect(pinBtn).toHaveAttribute("data-pinned", "true");
});

test("键盘可达: 标题栏控件可聚焦(常显后无 focus-within 兜底依赖)", async ({ hostPage }) => {
  const page = hostPage;
  await agree(page);
  await page.mouse.move(2, 2);

  const pinBtn = page.getByTestId("pin-btn");
  await pinBtn.focus();
  await pwExpect(pinBtn).toBeFocused();
  await pwExpect(pinBtn).toHaveCSS("opacity", "1");

  const closeBtn = page.getByTestId("win-close-btn");
  await closeBtn.focus();
  await pwExpect(closeBtn).toBeFocused();
  await pwExpect(closeBtn).toHaveCSS("opacity", "1");
  // 焦点在关闭钮时图钉不因失焦被隐藏(常显)
  await pwExpect(pinBtn).toHaveCSS("opacity", "1");
});
