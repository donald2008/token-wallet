/**
 * agent-ux-lite 三场景 e2e(t_6eb3e728, 老大 9/24 真机反馈):
 * ① MCP 启动后 Agent 区「启动中」态 — 首拉未完成显「正在连接 MCP daemon…」(agent-rows-booting),
 *    首拉完成解除落回列表/空态; daemon 不可达旧数据不存在时不闪「未连接」。
 *  ② 置顶组件大屏入口语义(t_56c66972 上收): 文案「用量大屏 →」+ aria-label「打开用量大屏」;
 *     **卡内不再有入口**(agent-detail-* testid 已随重构移除) — 全局唯一入口 = 置顶组件。
 *  ③ Agent 卡悬浮删除钮 — hover 显出 → 二次确认(含 agent_id+行数+不可逆) → 确认删除触发
 *    mcp_delete_usage + 重拉; daemon 未就绪(seedDeleteUsage ok:false)显式报错不静默。
 */
import { expect, expect as pwExpect } from "@playwright/test";
import { test, seedAgentUsage, seedAgentUsageMulti, seedDeleteUsage, getCapturedInvokes } from "./fixtures";
import { fakeSummary, deriveMultiFromSingle } from "./agent-fixture";

/** 空窗(unreachable)seed + 进主页本地 Agent tab — booting 态与错误态场景前置 */
async function agreeNoDaemon(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await seedAgentUsage(page, { ok: false, reason: "unreachable" });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();
}

test("① booting 态: 无快照首拉期间显「正在连接」, 首拉完成解除", async ({ hostPage, page }) => {
  void hostPage;
  await agreeNoDaemon(page);
  // 首拉已完成(初始 tick 已跑): 无 ok 快照 + 非首拉 pending → 显式错误空态, 不是 booting
  await pwExpect(page.getByTestId("agent-card-empty")).toBeVisible();
  await pwExpect(page.getByTestId("agent-rows-booting")).toHaveCount(0);

  // P1-1(评论 1771)确定性捕获: 注入 3000ms mock 延迟 → tw-mcp-started 重拉落地前
  // booting 态必现在场(无容忍分支, booting 不出现 = 用例直接红)
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.mcp.usagedelayms", "3000");
  });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("tw-mcp-started")));
  const booting = page.getByTestId("agent-rows-booting");
  await pwExpect(booting).toBeVisible();
  await pwExpect(booting).toContainText("正在连接 MCP daemon");
  // 对稿证据(验收 5): 真 booting 态截图, 独立于 hover/确认态(文件内容互异)
  await page.screenshot({ path: "verification/agent-ux2/01-booting.png", fullPage: false });
  await pwExpect(booting).not.toBeAttached(); // sanity: 后续断言前元素已随首拉完成卸载

  // 清延迟 → 首拉完成解除 → 落回错误空态(booting 不残留, 不闪「未连接」形态)
  await page.evaluate(() => {
    localStorage.setItem("token-wallet.mock.mcp.usagedelayms", "0");
  });
  await pwExpect(page.getByTestId("agent-rows-booting")).toHaveCount(0);
  await pwExpect(page.getByTestId("agent-card-empty")).toBeVisible();
});

test("② 大屏入口语义: 置顶组件「用量大屏 →」+ aria-label + 点击开整体大屏, 卡内入口零残留", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, deriveMultiFromSingle(fakeSummary));
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();

  // t_56c66972: 大屏入口全局唯一 — 置顶组件按钮(卡内 agent-detail-* 已移除)
  const btn = page.getByTestId("hero-dashboard-btn");
  await pwExpect(btn).toHaveText("用量大屏 →");
  await pwExpect(btn).toHaveAttribute("aria-label", "打开用量大屏");
  await pwExpect(btn).toHaveAttribute("title", "打开用量大屏");
  await pwExpect(page.locator('[data-testid^="agent-detail-"]')).toHaveCount(0);
  // 点击 → 打开整体大屏(浏览器降级 = 页内 agent-dashboard 视图)
  await btn.click();
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible();
});

test("③ 删除流: hover 显钮 → 确认(agent_id+行数+不可逆) → 确认删除触发 mcp_delete_usage + 重拉", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, deriveMultiFromSingle(fakeSummary));
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();

  // 删除钮常在 DOM(opacity:0), hover 卡片后可见 — 悬浮显隐纪律(单条 hover)
  const card = page.locator('[data-testid="agent-card"][data-agent="njbx02"]');
  const delBtn = page.getByTestId("agent-delete-njbx02");
  await pwExpect(delBtn).toHaveCount(1);
  await card.hover();
  await pwExpect(delBtn).toBeVisible();

  // hover 前后双截图(交互类修复前后双截图纪律): 删除钮显出证明内容真变
  await page.screenshot({ path: "verification/agent-ux2/03-delete-hover.png", fullPage: false });

  await delBtn.click();
  const confirmRow = page.getByTestId("agent-confirm-row-njbx02");
  await pwExpect(confirmRow).toContainText("njbx02");
  await pwExpect(confirmRow).toContainText("100"); // fakeSummary njbx02 calls=100
  await pwExpect(confirmRow).toContainText("不可逆");
  // 互斥: 确认气泡在场时删除钮卸载
  await pwExpect(delBtn).toHaveCount(0);

  // 取消 → 气泡收起, 无 IPC
  await page.getByTestId("agent-confirm-cancel-njbx02").click();
  await pwExpect(confirmRow).toHaveCount(0);
  const inv1 = (await getCapturedInvokes(page)).filter((c) => c.cmd === "mcp_delete_usage");
  expect(inv1.length).toBe(0);

  // 再进确认 → 确认删除 → mcp_delete_usage 恰一次 + 触发重拉(mcp_usage_summary 计数增加)
  const sumBefore = (await getCapturedInvokes(page)).filter((c) => c.cmd === "mcp_usage_summary").length;
  await delBtn.click();
  await page.getByTestId("agent-confirm-del-njbx02").click();
  await pwExpect(confirmRow).toHaveCount(0);
  const inv2 = (await getCapturedInvokes(page)).filter((c) => c.cmd === "mcp_delete_usage");
  expect(inv2.length).toBe(1);
  expect((inv2[0]?.args as { agent_id?: string } | undefined)?.agent_id).toBe("njbx02");
  const sumAfter = (await getCapturedInvokes(page)).filter((c) => c.cmd === "mcp_usage_summary").length;
  expect(sumAfter, "删除成功必须触发 usage_summary 重拉").toBeGreaterThanOrEqual(sumBefore + 3);
});

test("③ 删除错误态: daemon 未就绪 → 显式报错, 不静默", async ({ hostPage, page }) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, deriveMultiFromSingle(fakeSummary));
  await seedDeleteUsage(page, { ok: false, reason: "unreachable" });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  await page.getByTestId("main-tab-local-agent").click();

  const card = page.locator('[data-testid="agent-card"][data-agent="njbx02"]');
  const delBtn = page.getByTestId("agent-delete-njbx02");
  await card.hover();
  await delBtn.click();
  await page.getByTestId("agent-confirm-del-njbx02").click();
  // 错误态显式呈现: 卡 data-del-error=true + 错误文案(agent_id + daemon 未连接提示), 静默即失败
  const err = page
    .locator('[data-testid="agent-card"][data-agent="njbx02"] [data-testid="agent-delete-error-njbx02"]');
  await pwExpect(err).toBeVisible();
  const errText = (await err.textContent()) ?? "";
  expect(errText).toContain("njbx02");
  expect(errText).toContain("删除失败");
  // 气泡收起, 卡保留(数据未被误删形态)
  await pwExpect(page.getByTestId("agent-confirm-row-njbx02")).toHaveCount(0);
});
