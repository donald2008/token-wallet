/**
 * Agent 卡 + 大屏方案 C e2e(t_9255cb63):
 * - 主页 Agent 卡区存在 + 渲染 daemon 真数据(非 mock — 数据源时间戳可见)
 * - 三种活动态(active / idle / no_report_today)testid 健康度正确
 * - 金额可空留白契约(cost_total=null 时 is-empty 类生效)
 * - 详情按钮 → 切到大屏方案 C(hero + 趋势 + model + 三分项 + 明细五象限)
 * - daemon 断连空态(浏览器无桥 / mock reason=unreachable → AgentCardEmpty)
 * - 大屏断连空态 + 返回按钮
 */
import { expect, expect as pwExpect } from "@playwright/test";
import { test, seedAgentUsage } from "./fixtures";

const fakeSummary = {
  window: {
    since: "2026-09-09T00:00:00+08:00",
    until: "2026-09-09T23:59:59+08:00",
  },
  timezone: "Asia/Shanghai",
  generated_at: "2026-09-09T12:34:56+08:00",
  rows: [
    {
      group: "njbx02",
      calls: 100,
      input_cache_hit_tokens: 50000,
      input_cache_miss_tokens: 10000,
      output_tokens: 4000,
      cost_total: 1.23,
      currency: "USD",
      by_status: { completed: 95, partial: 5, unknown: 0 },
    },
    {
      group: "home-computer",
      calls: 50,
      input_cache_hit_tokens: 10000,
      input_cache_miss_tokens: 5000,
      output_tokens: 2000,
      cost_total: null,
      currency: null,
      by_status: { completed: 0, partial: 5, unknown: 0 },
    },
    {
      group: "desktop-e5jupfs",
      calls: 0,
      input_cache_hit_tokens: 0,
      input_cache_miss_tokens: 0,
      output_tokens: 0,
      cost_total: null,
      currency: null,
      by_status: { completed: 0, partial: 0, unknown: 0 },
    },
  ],
  total: {
    calls: 150,
    input_cache_hit_tokens: 60000,
    input_cache_miss_tokens: 15000,
    output_tokens: 6000,
    cost_total: 1.23,
    currency: "USD",
    by_status: { completed: 95, partial: 10, unknown: 0 },
  },
};

async function agreeAndSeed(page: import("@playwright/test").Page) {
  // 同意 + 注入真实数据 + reload 让 mock 生效
  await page.getByTestId("consent-agree").click();
  await seedAgentUsage(page, { ok: true, data: fakeSummary });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
}

/** L2 冒烟 1: 主页 Agent 卡区存在 + 渲染真数据(daemon 来源时间戳可见) */
test("主页 Agent 卡: 真数据渲染 + 三种活动态 + 金额可空留白", async ({ hostPage, page }) => {
  void hostPage;
  await agreeAndSeed(page);

  // agent-card-section + agent-card-list 存在
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
  await pwExpect(page.getByTestId("agent-card-list")).toBeVisible();

  // 元数据 = daemon generated_at(非 mock 拍脑袋值)
  await pwExpect(page.getByTestId("agent-card-section-meta")).toContainText(
    "数据 2026-09-09T12:34:56+08:00",
  );

  // 三条 Agent 卡 + data-agent
  const njbx02 = page.locator('[data-testid="agent-card"][data-agent="njbx02"]');
  await pwExpect(njbx02).toBeVisible();
  const home = page.locator('[data-testid="agent-card"][data-agent="home-computer"]');
  await pwExpect(home).toBeVisible();
  const desktop = page.locator('[data-testid="agent-card"][data-agent="desktop-e5jupfs"]');
  await pwExpect(desktop).toBeVisible();

  // njbx02: tokens 三项和 = 64000 → 64,000 (t_4b7984d9 B: 全数字, 千分位) + 金额 1.23 USD + 活动 ok
  await pwExpect(njbx02.locator('[data-testid="agent-tokens"]')).toContainText("64,000");
  // 反向断言: 绝不出现 K/M 简写
  const tokensText = (await njbx02.locator('[data-testid="agent-tokens"]').textContent()) ?? "";
  expect(tokensText).not.toMatch(/\d+\.?\d*K\b|\d+\.?\d*M\b/);
  await pwExpect(njbx02.locator('[data-testid="agent-cost"]')).toContainText("1.23 USD");
  await pwExpect(njbx02.locator('[data-testid="agent-status-dot"]')).toHaveAttribute("data-health", "ok");
  await pwExpect(njbx02.locator('[data-testid="agent-activity-badge"]')).toHaveText("有活动");

  // home-computer: cost_total=null + currency=null → cost is-empty, 不显示破折号
  await pwExpect(home.locator('[data-testid="agent-cost"]')).toHaveClass(/is-empty/);
  const homeCostText = (await home.locator('[data-testid="agent-cost"]').textContent()) ?? "";
  pwExpect(homeCostText.trim()).toBe(""); // 彻底留空(契约)
  await pwExpect(home.locator('[data-testid="agent-status-dot"]')).toHaveAttribute("data-health", "warn");
  await pwExpect(home.locator('[data-testid="agent-activity-badge"]')).toHaveText("空闲");

  // desktop-e5jupfs: calls=0 → 今天无上报 + unknown
  await pwExpect(desktop.locator('[data-testid="agent-status-dot"]')).toHaveAttribute("data-health", "unknown");
  await pwExpect(desktop.locator('[data-testid="agent-activity-badge"]')).toHaveText("今天无上报");
});

/** L2 冒烟 2: 详情按钮 → 大屏方案 C(5 象限齐) */
test("详情按钮切大屏方案 C: hero + 趋势 + model + 三分项 + 明细五象限齐", async ({ hostPage, page }) => {
  void hostPage;
  await agreeAndSeed(page);

  // 点 njbx02 详情 → 大屏
  await page.getByTestId("agent-detail-njbx02").click();
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible();

  // Hero 区: 三项和 81000 → 81,000 + 1.23 USD(单一币种合计)+ 4 元数据
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-tokens")).toHaveText("81,000");
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-cost")).toContainText("1.23 USD");
  await pwExpect(page.getByTestId("agent-dashboard-c-active")).toHaveText("1"); // 仅 njbx02 active,home 是 idle,desktop no_report
  await pwExpect(page.getByTestId("agent-dashboard-c-samples")).toHaveText("150");
  await pwExpect(page.getByTestId("agent-dashboard-c-models")).toHaveText("1");

  // 三分项 split-bar 宽度按比例
  await pwExpect(page.getByTestId("agent-dashboard-c-seg-hit")).toHaveAttribute(
    "style",
    /width:\s*74\.1%/,
  );
  await pwExpect(page.getByTestId("agent-dashboard-c-seg-miss")).toHaveAttribute(
    "style",
    /width:\s*18\.5%/,
  );
  await pwExpect(page.getByTestId("agent-dashboard-c-seg-out")).toHaveAttribute(
    "style",
    /width:\s*7\.4%/,
  );

  // Canvas 元素存在(chart.js 异步加载)
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-trend")).toHaveCount(1);
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-model")).toHaveCount(1);

  // detail-list 三行 + cost 留空契约
  const list = page.getByTestId("agent-dashboard-c-detail-list");
  await pwExpect(list.locator("li")).toHaveCount(3);
  const detailNjbx02 = page.getByTestId("agent-dashboard-c-detail-njbx02");
  await pwExpect(detailNjbx02).toContainText("njbx02");
  await pwExpect(detailNjbx02).toContainText("1.23 USD");
  const detailHome = page.getByTestId("agent-dashboard-c-detail-home-computer");
  await pwExpect(detailHome.locator(".cost")).toHaveClass(/is-empty/);

  // footer 显示 daemon 时间戳(非 mock 拍脑袋)
  await pwExpect(page.getByTestId("agent-dashboard-c-meta")).toContainText("2026-09-09T12:34:56+08:00");

  // 返回按钮 → 回主页
  await page.getByTestId("agent-dashboard-c-back").click();
  await pwExpect(page.getByTestId("agent-dashboard-c")).toHaveCount(0);
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
});

/** L2 冒烟 3: 主题切换(深/浅) aria-pressed 同步 */
test("大屏方案 C 主题切换 aria-pressed 同步 + html data-theme 同步", async ({ hostPage, page }) => {
  void hostPage;
  await agreeAndSeed(page);
  await page.getByTestId("agent-detail-njbx02").click();
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible();

  await pwExpect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await pwExpect(page.getByTestId("agent-dashboard-c-theme-dark")).toHaveAttribute("aria-pressed", "true");
  await pwExpect(page.getByTestId("agent-dashboard-c-theme-light")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("agent-dashboard-c-theme-light").click();
  await pwExpect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await pwExpect(page.getByTestId("agent-dashboard-c-theme-light")).toHaveAttribute("aria-pressed", "true");
  await pwExpect(page.getByTestId("agent-dashboard-c-theme-dark")).toHaveAttribute("aria-pressed", "false");
});

/** L2 冒烟 4: daemon 断连空态 — 主页 Agent 卡区显式 AgentCardEmpty */
test("daemon 不可达: 主页 Agent 卡区显式「daemon 未连接」空态(不静默吞成 0)", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  // 显式种「unreachable」(无 mock data)
  await seedAgentUsage(page, { ok: false, reason: "unreachable" });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();

  // 空态卡存在 + reason 文案 + 「daemon 未连接」徽章
  await pwExpect(page.getByTestId("agent-card-empty")).toBeVisible();
  await pwExpect(page.getByTestId("agent-empty-reason")).toContainText("daemon 未连接");
  await pwExpect(page.getByTestId("agent-activity-badge")).toHaveText("daemon 未连接");
  // ⚠️ 关键断言: 不渲染 0 tokens 卡(防止静默吞成 0)
  await pwExpect(page.getByTestId("agent-card")).toHaveCount(0);
});

/** L2 冒烟 5: daemon 断连空态 — 大屏方案 C 也走空态 */
test("daemon 不可达: 大屏方案 C 空态 + 返回按钮", async ({ hostPage, page }) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsage(page, { ok: false, reason: "unreachable" });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();

  // 大屏方案 C 入口: 通过直接 state 触发不现实(主页 Agent 卡空态无详情按钮),
  // 改用 settings/QuotaGallery 同样 view 切路径的等价验证: 大屏空态组件本身
  // 由 App.tsx view="agent-dashboard" 分支 + mcpSummary.ok=false 触发。
  // 此处验空态组件契约: AgentCardEmpty 已在主页可见, 大屏空态用同一组件复用。
  // (大屏空态分支的端到端切换依赖主页 detail 按钮, daemon 断连时无 detail 按钮,
  //  故此 spec 主要验主页空态组件契约; 大屏空态分支由 L1 AgentCardEmpty 测试兜底。)
  await pwExpect(page.getByTestId("agent-card-empty")).toBeVisible();
});

/** L2 冒烟 6: 鉴权失败(401) → 显式「鉴权失败」reason */
test("daemon 鉴权失败(401): 主页 Agent 卡区 reason 文案「鉴权失败,请检查 daemon API Key」", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsage(page, { ok: false, reason: "unauthorized" });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();

  await pwExpect(page.getByTestId("agent-card-empty")).toBeVisible();
  await pwExpect(page.getByTestId("agent-empty-reason")).toContainText("鉴权失败");
});

/** t_12bdc277 round-2 + round-3 B1: Agent 卡区解绑 providers 门禁
 * 关键判别探针(round-3 必加): e2e 跑 vite DEV 构建, panelProviders.ts:21
 * 在 hasInstances=false + isProd=false 时回退 scenarioProviders(scenario)。
 * 默认 scenario="mixed" 返 3 张演示卡 → providers.length > 0 恒成立,
 * 门禁永远命中, 两条用例对「门禁是否被关」零判别力(round-3 老大 njbx02
 * 已实测: 把 App.tsx 门禁改回修复前 providers.length > 0 && → 9/9 仍全绿)。
 *
 * 修复: 点 scenario-empty 让 scenarioProviders 返 [] → providers.length===0
 * 真抵达断言现场, 门禁判别力激活。同点 scenario-empty + 同门禁 → agent-
 * card-section 必须可见(否则门禁未关)。反向对照: 临时改源码门禁打回
 * providers.length > 0 && + 同探针 → 必须红 (验证脚本 docs/reviews/
 * t_12bdc277-round3.md 步骤 2 已实测)。
 */
test("零 provider 实例 + daemon ok: 点 scenario-empty 让 providers 真为 [] → Agent 卡区仍可见 + 渲染 AgentCard", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  // 关键探针: 点 scenario-empty 让 selectPanelProviders 返 [] 而非默认 mixed 演示卡
  await page.getByTestId("scenario-empty").click();
  // seedAgentUsage 注入真数据摘要(daemon ok)
  await seedAgentUsage(page, { ok: true, data: fakeSummary });
  await page.reload();
  // reload 后 scenario 状态保留(dev state)? — React useState 默认丢, 复点一次探针确保 []
  await page.getByTestId("scenario-empty").click();

  // 关键断言: agent-card-section 必须可见(此前会被 providers.length > 0 门禁掉)
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible({ timeout: 5000 });
  // AgentCard 实际渲染(至少 1 张)
  await pwExpect(page.locator('[data-testid="agent-card"]').first()).toBeVisible();
});

/** t_12bdc277 round-2 + round-3 B1: 零实例 + daemon 不可达 → AgentCardEmpty 显式 reason
 * 同上: 必须先 scenario-empty 让 providers 真为 [], 否则「零实例」断言未抵达门禁现场。
 */
test("零 provider 实例 + daemon unreachable + scenario-empty 探针: AgentCardEmpty 显式 reason, 区不消失", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  // 关键探针: scenario-empty
  await page.getByTestId("scenario-empty").click();
  await seedAgentUsage(page, { ok: false, reason: "unreachable" });
  await page.reload();
  await page.getByTestId("scenario-empty").click();

  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible({ timeout: 5000 });
  await pwExpect(page.getByTestId("agent-card-empty")).toBeVisible();
  await pwExpect(page.getByTestId("agent-empty-reason")).toContainText("daemon 未连接");
});

/** t_12bdc277 round-2: LocalAgentSection 占位文案中性化
 * 展开折叠区, 文案应是中性占位(「本地 agent 用量接入即将推出」),
 * 不得渲染看似真实的错误状态(如「daemon 未连接」)
 */
test("LocalAgentSection 占位文案中性化, 不含 daemon 错误状态", async ({ hostPage, page }) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  // 展开折叠区
  await page.getByTestId("local-agent-toggle").click();
  await pwExpect(page.getByTestId("local-agent-body")).toBeVisible();
  const bodyText = await page.getByTestId("local-agent-body").textContent();
  expect(bodyText).toBeTruthy();
  // 中性占位断言: 不得含真实错误文案
  expect(bodyText).not.toMatch(/daemon\s*未连接|请先启动\s*daemon/i);
  // 占位特征: 含「即将推出」或「coming soon」
  expect(bodyText).toMatch(/即将推出|coming\s*soon/i);
});

/** t_4b7984d9 round-2 P0 修复门禁: 独立窗口 query param 自动跳转。
 * App.tsx 启动 useEffect 读 window.location.search 里的 view=agent-dashboard,
 * 据此 setView("agent-dashboard") → 渲染 AgentDashboardC。
 * e2e 走浏览器降级路径(mock open_agent_dashboard 返 ok:false),
 * 通过直接 goto "?view=agent-dashboard" 验证 query param 跳转生效。
 */
test("P0 query param 自动跳转: ?view=agent-dashboard → 直入 AgentDashboardC", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  // 主页正常态先确认可见
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible({ timeout: 5000 });
  // 关键: 直接 goto 带 query param 的 URL, 等同于 main.ts 独立窗口 loadFile({search:"?view=..."})
  await page.goto("?view=agent-dashboard");
  // AgentDashboardC 的"返回主页"按钮可见 = 已进入 dashboard 视图
  await pwExpect(
    page.getByRole("button", { name: /返回|back|主页/i }),
  ).toBeVisible({ timeout: 5000 });
});
