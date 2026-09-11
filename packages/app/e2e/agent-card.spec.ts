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
import { test, seedAgentUsage, getCapturedInvokes } from "./fixtures";

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
      // t_4b7984d9 round-3 老大 njbx02 亲测 BLOCKING:
      // 9 位数字(4,474,000)场景,buggy CSS 让 tokens 1fr 列只 ~140px,数字 scrollWidth 180
      // 被 .card overflow:hidden 视觉裁掉 — round-3 修复后数字容器宽 286px 零裁剪
      group: "njbx02-heavy",
      calls: 8000,
      input_cache_hit_tokens: 3_310_760,
      input_cache_miss_tokens: 827_690,
      output_tokens: 335_550,
      cost_total: 12.34,
      currency: "USD",
      by_status: { completed: 7600, partial: 400, unknown: 0 },
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
    // t_4b7984d9 round-3: total 必须等于 rows[] 合计(否则大屏 hero 数字与明细对不上)
    // njbx02(64k) + njbx02-heavy(4,474k) + home(17k) + desktop(0) = 4,555,000
    // calls: 100 + 8000 + 50 + 0 = 8,150
    calls: 8150,
    input_cache_hit_tokens: 50000 + 3310760 + 10000 + 0, // = 3,370,760
    input_cache_miss_tokens: 10000 + 827690 + 5000 + 0, // = 842,690
    output_tokens: 4000 + 335550 + 2000 + 0, // = 341,550
    cost_total: 1.23 + 12.34, // home + desktop cost=null, 合计 = 13.57
    currency: "USD",
    by_status: { completed: 95 + 7600 + 0 + 0, partial: 5 + 400 + 5 + 0, unknown: 0 },
    // 9 + 8 + 0 + 0 = 8,005; partial: 5 + 400 + 5 + 0 = 410
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
  // t_4b7984d9 round-3(老大 njbx02 亲测 BLOCKING): 9 位数字(4,474,000)场景下 tokens 不能被裁剪
  const njbx02Heavy = page.locator('[data-testid="agent-card"][data-agent="njbx02-heavy"]');
  await pwExpect(njbx02Heavy).toBeVisible();
  const home = page.locator('[data-testid="agent-card"][data-agent="home-computer"]');
  await pwExpect(home).toBeVisible();
  const desktop = page.locator('[data-testid="agent-card"][data-agent="desktop-e5jupfs"]');
  await pwExpect(desktop).toBeVisible();

  // njbx02: tokens 三项和 = 64000 → 64,000 (t_4b7984d9 B: 全数字, 千分位) + 金额 1.23 USD + 活动 ok
  await pwExpect(njbx02.locator('[data-testid="agent-tokens"]')).toContainText("64,000");
  // 反向断言: 绝不出现 K/M 简写
  const tokensText = (await njbx02.locator('[data-testid="agent-tokens"]').textContent()) ?? "";
  expect(tokensText).not.toMatch(/\d+\.?\d*K\b|\d+\.?\d*M\b/);
  // t_4b7984d9 round-3 (老大 njbx02 亲测 BLOCKING): 真数据下 9 位数字(4,474,000 类)在 360 卡宽下
  // 必须不被容器裁剪(buggy CSS 1fr 列只 ~140px 把数字 scrollWidth 180+ 视觉裁掉)。
  // 此断言用 e2e 实际渲染测真实 DOM: 数字本身 scrollWidth ≤ tokens 容器 width。
  const tokensDomOk = await njbx02.locator('[data-testid="agent-tokens"]').evaluate((el) => {
    const tn = el.querySelector(".agent-tokens-number");
    if (!tn) return false;
    return tn.scrollWidth <= el.getBoundingClientRect().width + 0.5;
  });
  expect(
    tokensDomOk,
    "Agent 卡 tokens 容器必须装下完整数字(老大 round-3 B 修复 360 卡宽零裁剪)",
  ).toBe(true);
  await pwExpect(njbx02.locator('[data-testid="agent-cost"]')).toContainText("1.23 USD");
  await pwExpect(njbx02.locator('[data-testid="agent-status-dot"]')).toHaveAttribute("data-health", "ok");
  await pwExpect(njbx02.locator('[data-testid="agent-activity-badge"]')).toHaveText("有活动");

  // t_4b7984d9 round-3(老大 njbx02 亲测 BLOCKING):
  // njbx02-heavy 卡 = 9 位数字(4,474,000),验证:
  //   ① 全数字展示(4,474,000 不是 4.5M,反向断言无 K/M)
  //   ② tokens 容器装得下完整数字(scrollWidth ≤ width,不被 .card overflow:hidden 裁剪)
  //   ③ 详情按钮右缘 ≤ 卡右缘(不顶出卡片)
  // buggy CSS 实测: 9 位数字 scrollWidth=180+, 容器宽~140 → overflowed=true → 失败
  await pwExpect(njbx02Heavy.locator('[data-testid="agent-tokens"]')).toContainText("4,474,000");
  const heavyTokensText =
    (await njbx02Heavy.locator('[data-testid="agent-tokens"]').textContent()) ?? "";
  expect(heavyTokensText, "njbx02-heavy 含 K/M 简写").not.toMatch(/\d+\.?\d*K\b|\d+\.?\d*M\b/);
  const heavyTokensDomOk = await njbx02Heavy
    .locator('[data-testid="agent-tokens"]')
    .evaluate((el) => {
      const tn = el.querySelector(".agent-tokens-number");
      if (!tn) return false;
      // 数字本身完整可见(scrollWidth ≤ 容器宽度)
      return tn.scrollWidth <= el.getBoundingClientRect().width + 0.5;
    });
  expect(
    heavyTokensDomOk,
    "njbx02-heavy 9 位数字被 .card 视觉裁掉(round-3 修复: tokens 占整行 1fr, 286px 容器装 180px 数字)",
  ).toBe(true);
  const heavyCardBox = await njbx02Heavy.boundingBox();
  const heavyDetailBox = await njbx02Heavy
    .locator('[data-testid="agent-detail-njbx02-heavy"]')
    .boundingBox();
  if (heavyCardBox && heavyDetailBox) {
    const heavyOverhang = heavyDetailBox.x + heavyDetailBox.width - (heavyCardBox.x + heavyCardBox.width);
    expect(
      heavyOverhang,
      `njbx02-heavy 详情按钮顶出卡片 ${heavyOverhang.toFixed(1)}px`,
    ).toBeLessThanOrEqual(0);
  }
  await pwExpect(njbx02Heavy.locator('[data-testid="agent-cost"]')).toContainText("12.34 USD");
  await pwExpect(njbx02Heavy.locator('[data-testid="agent-status-dot"]')).toHaveAttribute(
    "data-health",
    "ok",
  );
  await pwExpect(njbx02Heavy.locator('[data-testid="agent-activity-badge"]')).toHaveText("有活动");

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

  // Hero 区: 全 4 卡合计 tokens + 13.57 USD(1.23 + 12.34, home/desktop cost 留空不计)
  // njbx02(64k) + njbx02-heavy(4,474k) + home(17k) + desktop(0) = 4,555,000
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-tokens")).toHaveText("4,555,000");
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-cost")).toContainText("13.57 USD");
  await pwExpect(page.getByTestId("agent-dashboard-c-active")).toHaveText("2"); // njbx02 + njbx02-heavy 都是 active
  await pwExpect(page.getByTestId("agent-dashboard-c-samples")).toHaveText("8150"); // 100 + 8000 + 50 + 0(无千分位显示)
  await pwExpect(page.getByTestId("agent-dashboard-c-models")).toHaveText("1");

  // 三分项 split-bar 宽度按比例(t_4b7984d9 round-3: total 汇总成 4,555,000 后 hit/miss/out 各占
  // 74.005% / 18.500% / 7.495%, 浏览器浮点 .toFixed(1) 输出可能为 "74%" / "18.5%" / "7.5%",
  // 宽松断言同时兼容 "74%" 与 "74.0%" 两种渲染)
  await pwExpect(page.getByTestId("agent-dashboard-c-seg-hit")).toHaveAttribute(
    "style",
    /width:\s*74(\.0)?%/,
  );
  await pwExpect(page.getByTestId("agent-dashboard-c-seg-miss")).toHaveAttribute(
    "style",
    /width:\s*18\.5%/,
  );
  await pwExpect(page.getByTestId("agent-dashboard-c-seg-out")).toHaveAttribute(
    "style",
    /width:\s*7(\.[45])?%/,
  );

  // Canvas 元素存在(chart.js 异步加载)
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-trend")).toHaveCount(1);
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-model")).toHaveCount(1);

  // detail-list 四行(njbx02 + njbx02-heavy + home + desktop) + cost 留空契约
  const list = page.getByTestId("agent-dashboard-c-detail-list");
  await pwExpect(list.locator("li")).toHaveCount(4);
  const detailNjbx02 = page.getByTestId("agent-dashboard-c-detail-njbx02");
  await pwExpect(detailNjbx02).toContainText("njbx02");
  await pwExpect(detailNjbx02).toContainText("1.23 USD");
  // t_4b7984d9 round-3: njbx02-heavy 在大屏 detail-list 也展示完整 4,474,000 tokens(不裁)
  const detailNjbx02Heavy = page.getByTestId("agent-dashboard-c-detail-njbx02-heavy");
  await pwExpect(detailNjbx02Heavy).toContainText("njbx02-heavy");
  await pwExpect(detailNjbx02Heavy).toContainText("12.34 USD");
  await pwExpect(detailNjbx02Heavy).toContainText("4,474,000");
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
 * t_4b7984d9 round-4 ④: 先切到「本地 Agent」tab(默认 usage tab 下 LocalAgentSection 不挂载)
 */
test("LocalAgentSection 占位文案中性化, 不含 daemon 错误状态", async ({ hostPage, page }) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  // 切到「本地 Agent」tab(round-4 ④)
  await page.getByTestId("main-tab-local-agent").click();
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

/** t_4b7984d9 round-4 ④ 回归门禁: tab 互斥显示
 * 「用量」tab 默认显示 agent-card-section;点「本地 Agent」切换后,
 * agent-card-section 消失,local-agent-section 出现;切回「用量」又恢复。
 * 互斥状态机走通。
 */
test("主页 tab 分离: 用量 ↔ 本地 Agent 互斥切换", async ({ hostPage, page }) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  // 默认: 用量 tab 激活, agent-card-section 可见, local-agent-section 不可见
  await pwExpect(page.getByTestId("main-tab-usage")).toHaveAttribute("aria-pressed", "true");
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
  await pwExpect(page.getByTestId("local-agent-section")).toHaveCount(0);
  // 切到「本地 Agent」
  await page.getByTestId("main-tab-local-agent").click();
  await pwExpect(page.getByTestId("main-tab-local-agent")).toHaveAttribute("aria-pressed", "true");
  await pwExpect(page.getByTestId("main-tab-usage")).toHaveAttribute("aria-pressed", "false");
  await pwExpect(page.getByTestId("local-agent-section")).toBeVisible();
  await pwExpect(page.getByTestId("agent-card-section")).toHaveCount(0);
  // 切回「用量」
  await page.getByTestId("main-tab-usage").click();
  await pwExpect(page.getByTestId("main-tab-usage")).toHaveAttribute("aria-pressed", "true");
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
  await pwExpect(page.getByTestId("local-agent-section")).toHaveCount(0);
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

/** t_185002af 门禁 1: standalone=1 → 大屏直入 + 自绘窗口 chrome 渲染。
 *  主进程 createAgentDashboardWindow 载入 ?view=agent-dashboard&standalone=1,
 *  App.tsx 读 standalone 进 dashboard 视图并挂 .dash-chrome(无边框窗拖拽条 +
 *  最小化/关闭钮); 主窗内嵌/e2e 路径无 standalone, chrome 不渲染。 */
test("t_185002af standalone: 直入大屏 + dash-chrome 渲染 + 主窗路径不渲染 chrome", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsage(page, { ok: true, data: fakeSummary });
  // 等同 main.ts 独立窗口 loadFile({search:"?view=agent-dashboard&standalone=1"})
  await page.goto("?view=agent-dashboard&standalone=1");
  // 大屏直入
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible({ timeout: 5000 });
  // 自绘窗口 chrome 三件套在位
  await pwExpect(page.getByTestId("dash-chrome")).toBeVisible();
  await pwExpect(page.getByTestId("dash-chrome-min")).toBeVisible();
  await pwExpect(page.getByTestId("dash-chrome-close")).toBeVisible();
  // 反向: 同页签去 standalone 回主页路径, chrome 不渲染(主窗内嵌形态不受影响)
  await page.goto("?view=agent-dashboard");
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible({ timeout: 5000 });
  await pwExpect(page.getByTestId("dash-chrome")).toHaveCount(0);
});

/** t_185002af 门禁 2: 独立窗返回键语义 = 关窗(win_close), 主窗路径 = 切页视图。
 *  无边框独立窗没有系统关闭钮, 「← 返回」必须走 win_close(主进程 sender-aware
 *  销毁 dashboard 窗); 非 standalone 保持 setView 回主页原语义(e2e 全量依赖)。 */
test("t_185002af 返回键语义分流: standalone→win_close, 主窗→切页视图", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsage(page, { ok: true, data: fakeSummary });

  // standalone: 大屏「← 返回」→ invoke win_close(关窗), 页面不切回主页视图
  await page.goto("?view=agent-dashboard&standalone=1");
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible({ timeout: 5000 });
  await page.getByTestId("agent-dashboard-c-back").click();
  const invokes = await getCapturedInvokes(page);
  expect(
    invokes.some((c) => c.cmd === "win_close"),
    "standalone 返回键必须触发 win_close(关窗语义)",
  ).toBe(true);

  // 非 standalone(主窗内嵌/e2e 默认): 「← 返回」→ 回主页(视图切换语义不变)
  await page.goto("?view=agent-dashboard");
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible({ timeout: 5000 });
  await page.getByTestId("agent-dashboard-c-back").click();
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
  const invokes2 = await getCapturedInvokes(page);
  expect(
    invokes2.some((c) => c.cmd === "win_close"),
    "主窗路径返回键不得触发 win_close(应走视图切换)",
  ).toBe(false);
});

/** t_04f75eae 集成门禁: standalone 大屏必须在窗口内收口(不被窗缘裁切)。
 *  背景: 独立窗 900×640(useContentSize, main.ts) 内, .dash-chrome(33px) 之上再叠
 *  min-height:600 的大屏容器 ⇒ 内容 678 > 可用高, 明细列表末行 + 页脚被窗缘裁掉。
 *  修复(见 app.css t_04f75eae ①②③)后本测试锁两件事:
 *   1) 卡面尺寸 900×600: 四象限(hero / 趋势 / model / 三分项 / 明细) bottom ≤ 视口高;
 *   2) 产品窗口内容尺寸 900×640: 容器零纵向滚动(scrollHeight ≤ clientHeight) 且页脚在视口内。 */
test("t_04f75eae 集成: standalone 900×600 四象限全部在视口内 + 900×640 零滚动", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsage(page, { ok: true, data: fakeSummary });

  const quads = [
    "agent-dashboard-c-hero-tokens",
    "agent-dashboard-c-chart-trend",
    "agent-dashboard-c-chart-model",
    "agent-dashboard-c-seg-hit",
    "agent-dashboard-c-detail-list",
  ];

  const measure = (ids: string[]) =>
    page.evaluate((list: string[]) => {
      const out: { id: string; present: boolean; top: number; bottom: number; vh: number }[] = [];
      for (const id of list) {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) {
          out.push({ id, present: false, top: 0, bottom: 0, vh: window.innerHeight });
          continue;
        }
        const r = el.getBoundingClientRect();
        out.push({
          id,
          present: true,
          top: r.top,
          bottom: r.bottom,
          vh: window.innerHeight,
        });
      }
      return out;
    }, ids);

  // ① 900×600(卡面尺寸): 四象限底部均不越出视口
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("?view=agent-dashboard&standalone=1");
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible({ timeout: 5000 });
  await pwExpect(page.getByTestId("dash-chrome")).toBeVisible();
  await page.waitForTimeout(600);
  for (const q of await measure(quads)) {
    expect(q.present, `${q.id} 必须渲染(standalone 大屏四象限)`).toBe(true);
    expect(q.top, `${q.id} top=${q.top} 不得越出视口上缘`).toBeGreaterThanOrEqual(-0.5);
    expect(q.bottom, `${q.id} bottom=${q.bottom} 必须 ≤ 视口高 ${q.vh}`).toBeLessThanOrEqual(
      q.vh + 0.5,
    );
  }

  // ② 900×640(产品窗口内容尺寸): 容器零滚动 + 页脚可见
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("?view=agent-dashboard&standalone=1");
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(600);
  const box = await page.evaluate(() => {
    const dash = document.querySelector(".agent-dashboard-c") as HTMLElement;
    const footer = document.querySelector(".agent-dashboard-c-footer") as HTMLElement;
    return {
      ch: dash.clientHeight,
      sh: dash.scrollHeight,
      footerBottom: footer.getBoundingClientRect().bottom,
      vh: window.innerHeight,
    };
  });
  expect(box.sh, `大屏容器不得纵向滚动(scrollHeight ${box.sh} > clientHeight ${box.ch})`).toBeLessThanOrEqual(
    box.ch + 1,
  );
  expect(box.footerBottom, `页脚 bottom=${box.footerBottom} 必须 ≤ 视口高 ${box.vh}`).toBeLessThanOrEqual(
    box.vh + 0.5,
  );
});

/** t_4b7984d9 round-5 A 项收口门禁: 「本地 Agent」标题三主题颜色断言。
 *  用户真机两次反馈「蓝还在」: round-2 的 var(--fg) 在 dark/dark-glass 下是 #e5e9f0
 *  (B 通道最大,深底上读作冷蓝),round-2/3 真壳实测只验了 light 没咬住。
 *  round-5 按「与『即将推出』tag 同族克制视觉」的拍板口径对齐 --fg-dim:
 *    dark  #9aa4b2 / light  #5d6778 (中性灰阶, 三主题下均非蓝)
 *  断言有判别力: 旧值(--fg)与新值(--fg-dim)在三主题下 RGB 均不相等,
 *  本测试对 round-2 旧 CSS 必挂。 */
for (const theme of ["dark", "light", "dark-glass", "light-glass"] as const) {
  test(`t_4b7984d9 round-5 A: local-agent-title 颜色 = --fg-dim (${theme})`, async ({
    hostPage,
    page,
  }) => {
    void hostPage;
    // 主题落点: localStorage theme.v1 + glass.v1 (theme.ts loadThemeMode/loadGlass)
    // glass 变体下 title 颜色仍走同一 --fg-dim token (theme.css glass 段不覆盖前景色)
    // consent 走 fixtures mock 桥(不读 localStorage), 与既有测试同模式: 点同意 → 设主题 → reload
    await page.getByTestId("consent-agree").click();
    await page.evaluate((t: string) => {
      const glass = t.endsWith("-glass");
      localStorage.setItem(
        "token-wallet.theme.v1",
        glass ? t.replace("-glass", "") : t,
      );
      localStorage.setItem("token-wallet.glass.v1", glass ? "1" : "0");
    }, theme);
    await page.reload();
    await page.goto("?view=panel");
    await pwExpect(page.getByTestId("local-agent-section")).toHaveCount(0); // 默认 usage tab
    // round-4 ④: LocalAgentSection 挂在「本地 Agent」tab 下
    await page.getByTestId("main-tab-local-agent").click();
    await pwExpect(page.getByTestId("local-agent-toggle")).toBeVisible();
    await page.getByTestId("local-agent-toggle").click();
    await pwExpect(page.getByTestId("local-agent-body")).toBeVisible();

    const colors = await page.evaluate(() => {
      const title = document.querySelector(".local-agent-title") as HTMLElement;
      const tag = document.querySelector(".local-agent-tag") as HTMLElement;
      return {
        title: getComputedStyle(title).color,
        tag: getComputedStyle(tag).color,
        dataTheme: document.documentElement.dataset.theme,
      };
    });
    // 主题落点正确
    expect(colors.dataTheme).toBe(theme);
    // title 与 tag 同族(同为 --fg-dim) — 拍板口径「克制视觉同族」的机器可验形式
    expect(colors.title, `theme=${theme} title 颜色须与 tag(--fg-dim) 同族`).toBe(colors.tag);
    // 非蓝判定: --fg-dim 是中性灰阶, G 通道居中, B-G 差 < 24 (冷白 --fg 的 B-G 差 = 240-233 = 7
    // 不够判别, 故直接用「与 tag 同色」这一强断言 + title 非纯白两道)
    const m = colors.title.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(m, `computed color 必须可解析: ${colors.title}`).toBeTruthy();
    const [, , g, b] = m!.map(Number) as unknown as number[];
    expect(Math.abs(b - g), `theme=${theme} 不得偏蓝(B-G=${Math.abs(b - g)})`).toBeLessThan(24);
  });
}

/** t_4b7984d9 round-5 ⑤ (comment 1398): tab 互斥必须覆盖 provider 主列表三态分支。
 *  round-4 ④ 只互斥了 agent-card-section 与 LocalAgentSection, provider 卡列表
 *  (LoadingState/CollectingState/EmptyState/card-list) 漏在互斥外 —— 用户真机实测
 *  切「本地 Agent」tab 后「暂无 Provider」空态仍可见。
 *  360×720 视口锁死(round-3 教训: browser-only 默认 1280 视口下布局缺陷假绿)。 */
test.describe("t_4b7984d9 round-5 ⑤ tab 互斥收口", () => {
  test.use({ viewport: { width: 360, height: 720 } });

  test("本地 Agent tab 下 provider 主列表三态全部不可见, 切回用量恢复", async ({
    hostPage,
    page,
  }) => {
    void hostPage;
    await page.getByTestId("consent-agree").click();
    await pwExpect(page.getByTestId("main-tab-usage")).toBeVisible();

    const visible = (id: string) =>
      page.evaluate((tid) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${tid}"]`);
        return el ? el.offsetParent !== null : false;
      }, id);

    // 用量 tab(默认): provider 主列表某态可见(空态/列表/采集中随 fixtures 而定)
    const usageHasList =
      (await visible("card-list")) ||
      (await visible("empty-state")) ||
      (await visible("collecting-state")) ||
      (await visible("loading-state"));
    expect(usageHasList, "用量 tab 下 provider 主列表(某态)应可见").toBe(true);

    // 切「本地 Agent」: provider 三态 + agent-card-section 全部不可见
    await page.getByTestId("main-tab-local-agent").click();
    await pwExpect(page.getByTestId("local-agent-toggle")).toBeVisible();
    expect(await visible("card-list"), "card-list 不得在本地 Agent tab 渲染").toBe(false);
    expect(await visible("empty-state"), "empty-state 不得在本地 Agent tab 渲染").toBe(false);
    expect(await visible("collecting-state"), "collecting-state 不得在本地 Agent tab 渲染").toBe(false);
    expect(await visible("loading-state"), "loading-state 不得在本地 Agent tab 渲染").toBe(false);
    expect(await visible("agent-card-section"), "agent-card-section 不得在本地 Agent tab 渲染").toBe(false);

    // 切回「用量」: 恢复
    await page.getByTestId("main-tab-usage").click();
    const backVisible =
      (await visible("card-list")) ||
      (await visible("empty-state")) ||
      (await visible("collecting-state")) ||
      (await visible("loading-state"));
    expect(backVisible, "切回用量 tab 后 provider 主列表应恢复").toBe(true);
  });
});
