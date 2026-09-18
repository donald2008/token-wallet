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
import { test, seedAgentUsage, seedAgentUsageMulti, getCapturedInvokes } from "./fixtures";

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

/**
 * t_12c28686: 从单维 summary 派生多维 seed(agent|model 拆两模型 + 拆 2 天)。
 * 旧用例(单维 seed 时代)沿用: 保证五象限在多维数据面契约下仍然齐备。
 */
function deriveMultiFromSingle(base: typeof fakeSummary) {
  const agentRows = base.rows;
  const modelRows = agentRows.flatMap((r) => {
    const hit = Math.round(r.input_cache_hit_tokens / 2);
    const miss = Math.round(r.input_cache_miss_tokens / 2);
    const out = Math.round(r.output_tokens / 2);
    const mk = (model: string) => ({
      ...r,
      group: `${r.group}|${model}`,
      input_cache_hit_tokens: hit,
      input_cache_miss_tokens: miss,
      output_tokens: out,
    });
    return [mk("glm-5.3-flash"), mk("kimi-k2")];
  });
  const dayRows = agentRows.map((r, i) => ({
    ...r,
    group: i % 2 === 0 ? "2026-09-08" : "2026-09-09",
  }));
  return {
    agent: { ok: true, data: base },
    "agent,model": { ok: true, data: { ...base, rows: modelRows } },
    day: { ok: true, data: { ...base, rows: dayRows } },
  };
}

async function agreeAndSeedMultiFromSingle(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, deriveMultiFromSingle(fakeSummary));
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  // round-6: agent-card-section 迁入「本地 Agent」tab
  await page.getByTestId("main-tab-local-agent").click();
}

async function agreeAndSeed(page: import("@playwright/test").Page) {
  // 同意 + 注入真实数据 + reload 让 mock 生效
  await page.getByTestId("consent-agree").click();
  await seedAgentUsage(page, { ok: true, data: fakeSummary });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  // round-6: agent-card-section 迁入「本地 Agent」tab, 断言前先切换
  await page.getByTestId("main-tab-local-agent").click();
}

/** L2 冒烟 1: 主页 Agent 卡区存在 + 渲染真数据(daemon 来源时间戳可见) */
test("主页 Agent 卡: 真数据渲染 + 三种活动态 + 金额可空留白", async ({ hostPage, page }) => {
  void hostPage;
  await agreeAndSeed(page);

  // agent-card-section + agent-card-list 存在
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
  await pwExpect(page.getByTestId("agent-card-list")).toBeVisible();

  // 元数据 = daemon generated_at(非 mock 拍脑袋值)。
  // t_5cf22ba4: round-7(b166e1b) 把时间戳改短格式「MM-DD HH:mm」, 旧断言(全 ISO 串)漏改
  // 预存红 —— 对齐 round-7 契约断言短格式。
  await pwExpect(page.getByTestId("agent-card-section-meta")).toContainText(
    "数据 09-09 12:34",
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

/** L2 冒烟 2: 详情按钮 → 大屏 Ops Wall(t_15397c99 SL-01)
 * testid 映射见 40-handoff/contracts/testid-contract.md: hero-tokens/cost 保留为 KPI 大数字锚,
 * detail-list testid 保留(DOM ul 改 table), split-bar/seg/model-table/chart/meta/agent-tab 全保留。 */
test("详情按钮切大屏 Ops Wall: KPI + 趋势 + model + 三分项 + 明细全面板渲染", async ({ hostPage, page }) => {
  void hostPage;
  await agreeAndSeedMultiFromSingle(page);

  // 点 njbx02 详情 → 大屏
  await page.getByTestId("agent-detail-njbx02").click();
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible();

  // KPI 带: 全 4 卡合计 tokens + 13.57 USD(1.23 + 12.34, home/desktop cost 留空不计)
  // njbx02(64k) + njbx02-heavy(4,474k) + home(17k) + desktop(0) = 4,555,000
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-tokens")).toHaveText("4,555,000");
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-cost")).toContainText("13.57 USD");
  await pwExpect(page.getByTestId("agent-dashboard-c-active")).toHaveText("2"); // njbx02 + njbx02-heavy 都是 active
  // KPI tokens 副行: 调用 = total.calls(100 + 8000 + 50 + 0)
  await pwExpect(page.locator(".dash-kpi.t1 .dash-kpi-sub")).toContainText("8,150");
  // 命中率 = hit/(hit+miss) = 3,370,760 / 4,213,450 ≈ 80.0%
  await pwExpect(page.getByTestId("agent-dashboard-c-hit-rate")).toHaveText(/80\.0%/);
  await pwExpect(page.getByTestId("agent-dashboard-c-window")).toHaveText("09-09 ~ 09-09");
  await pwExpect(page.getByTestId("agent-dashboard-c-models")).toHaveText("2"); // 多维: njbx02 glm+kimi
  // Model 迷你数据表在场, njbx02 2 模型 → 2 行
  await pwExpect(page.getByTestId("agent-dashboard-c-model-table")).toBeVisible();
  await pwExpect(page.locator('[data-testid="agent-dashboard-c-model-table"] tbody tr')).toHaveCount(2);
  // glm 行命中率 = hit/(hit+miss) = 3,310,760 / 4,138,450 ≈ 80.0%(e2e mock 用单维原值)
  await pwExpect(page.getByTestId("agent-dashboard-c-model-row-glm-5.3-flash")).toContainText("80.0%");

  // 三分项 split-bar 宽度按比例(total 汇总成 4,555,000 后 hit/miss/out 各占
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

  // 明细表 = agent 维全量 4 行(t_15397c99: appendix 数据接线, 不再只渲染当前 agent 一行);
  // 当前 agent(tokens 最大的 njbx02-heavy)行 data-selected 高亮 = H4 联动语义保留
  const list = page.getByTestId("agent-dashboard-c-detail-list");
  await pwExpect(list.locator("tbody tr")).toHaveCount(4);
  const detailHeavy = page.getByTestId("agent-dashboard-c-detail-njbx02-heavy");
  await pwExpect(detailHeavy).toContainText("njbx02-heavy");
  await pwExpect(detailHeavy).toContainText("4,474,000");
  await pwExpect(detailHeavy).toHaveAttribute("data-selected", "true");
  // W1 裁定(SL-02): 明细第 7 列 = 成本(cost_total/currency 接线, 对齐锁定参考 ops-wall)
  await pwExpect(list.locator("thead th")).toHaveText([
    "Agent",
    "Tokens",
    "占比",
    "Cache hit",
    "Output",
    "调用",
    "成本",
  ]);
  await pwExpect(detailHeavy.locator("td:last-child")).toContainText("12.34 USD");
  // SC-06 H3: cost=null 行成本单元格留空(home-computer cost_total=null, 不显 0)
  await pwExpect(
    page.getByTestId("agent-dashboard-c-detail-home-computer").locator("td:last-child"),
  ).toHaveText("");
  // H4 agent tab 落 Model 面板头: 切 home-computer → 明细高亮切行(选中态 = is-selected 类)
  await page.getByTestId("dash-agent-tab-home-computer").click();
  await pwExpect(page.getByTestId("agent-dashboard-c-detail-home-computer")).toHaveClass(/is-selected/);
  await pwExpect(page.getByTestId("agent-dashboard-c-detail-njbx02-heavy")).not.toHaveClass(/is-selected/);

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
  // 初始主题断言需要确定性起点: prePaintTheme(D-010) 默认 system → e2e 浏览器
  // prefers-color-scheme 默认 light, 若不锚定则初始 data-theme=light(非 dark),
  // 与真实桌面壳(WebView2 跟随 OS, 用户深色系统默认 dark)形态不符。
  // emulate dark + 显式 seed theme.v1=dark, 与 spec 其他主题测试(round-6 等)同套路。
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("token-wallet.theme.v1", "dark");
  });
  await page.reload();
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
  // round-6: agent-card-section 迁入「本地 Agent」tab, 断言前先切换
  await page.getByTestId("main-tab-local-agent").click();

  // 空态卡存在 + reason 文案 + 徽章。
  // t_5cf22ba4: round-7(b166e1b) 把徽章改为按 reason 分类的短语(正文保留完整 reason,
  // 语义分层不重复), 旧断言(徽章=「daemon 未连接」全文)漏改预存红 —— 对齐 round-7 契约。
  await pwExpect(page.getByTestId("agent-card-empty")).toBeVisible();
  await pwExpect(page.getByTestId("agent-empty-reason")).toContainText("daemon 未连接");
  await pwExpect(page.getByTestId("agent-activity-badge")).toHaveText("连接失败");
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
  // round-6: agent-card-section 迁入「本地 Agent」tab, 断言前先切换
  await page.getByTestId("main-tab-local-agent").click();

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
  // round-6: agent-card-section 迁入「本地 Agent」tab, 断言前先切换
  await page.getByTestId("main-tab-local-agent").click();

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
  // round-6: agent-card-section 迁入「本地 Agent」tab, 断言前先切换
  await page.getByTestId("main-tab-local-agent").click();

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
  // round-6: agent-card-section 迁入「本地 Agent」tab, 断言前先切换
  await page.getByTestId("main-tab-local-agent").click();

  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible({ timeout: 5000 });
  await pwExpect(page.getByTestId("agent-card-empty")).toBeVisible();
  await pwExpect(page.getByTestId("agent-empty-reason")).toContainText("daemon 未连接");
});

/** t_4b7984d9 round-6(用户真机拍板): LocalAgentSection 占位组件已整体删除。
 * 本测试反转职责: 门禁「即将推出」占位零残留 —— 本地 Agent tab 下
 * agent-card-section 必须挂载, 任何「即将推出/coming soon」文案都是回归。
 */
test("本地 Agent tab: agent-card-section 挂载, 占位文案零残留", async ({ hostPage, page }) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await page.getByTestId("main-tab-local-agent").click();
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
  const panelText = await page.getByTestId("panel-main").textContent();
  expect(panelText).not.toMatch(/即将推出|coming\s*soon/i);
});

/** t_4b7984d9 round-6 回归门禁: tab 互斥(语义反转版)
 * 「用量」tab = provider 卡列表; 「本地 Agent」tab = agent-card-section。
 * 互斥状态机走通。
 */
test("主页 tab 分离: 用量(provider 卡) ↔ 本地 Agent(agent 卡) 互斥切换", async ({ hostPage, page }) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  // 默认: 用量 tab 激活, agent-card-section 不挂载(已迁走), card-list 可见
  await pwExpect(page.getByTestId("main-tab-usage")).toHaveAttribute("aria-pressed", "true");
  await pwExpect(page.getByTestId("agent-card-section")).toHaveCount(0);
  // 切到「本地 Agent」
  await page.getByTestId("main-tab-local-agent").click();
  await pwExpect(page.getByTestId("main-tab-local-agent")).toHaveAttribute("aria-pressed", "true");
  await pwExpect(page.getByTestId("main-tab-usage")).toHaveAttribute("aria-pressed", "false");
  await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
  // 切回「用量」
  await page.getByTestId("main-tab-usage").click();
  await pwExpect(page.getByTestId("main-tab-usage")).toHaveAttribute("aria-pressed", "true");
  await pwExpect(page.getByTestId("agent-card-section")).toHaveCount(0);
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
  // 主页正常态先确认可见(round-6: agent-card-section 在「本地 Agent」tab)
  await page.getByTestId("main-tab-local-agent").click();
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
  // round-6: 回主页落在「用量」tab, agent-card-section 在「本地 Agent」tab
  await page.getByTestId("main-tab-local-agent").click();
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
 *   2) 产品窗口内容尺寸: 容器零纵向滚动(scrollHeight ≤ clientHeight) 且页脚在视口内。
 *  t_e83ad982: 窗口壳 640→560(高度预算法 comment 1497), ② 改锁 900×560; ① 保留 600
 *  (>560 的宽松场景仍须不越界)。 */
test("t_04f75eae 集成: standalone 900×600 四象限全部在视口内 + 900×560 零滚动", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, deriveMultiFromSingle(fakeSummary));

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

  // ② 900×560(产品窗口内容尺寸, t_e83ad982 降高后): 容器零滚动 + 页脚可见
  await page.setViewportSize({ width: 900, height: 560 });
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

/** t_5cf22ba4 门禁扩展(用户 9/14 真机截图实证 5 项的回归锁):
 *  1) 趋势 X 轴日期连续 — 09-13 这类 0 上报日必须以 0 高度桶在场(chart.js labels 计数)。
 *  2) 三分项头部保留一位小数 — 不再 Math.round 舍入吞项(94/5/0 → 94.1%/5.4%/0.4%)。
 *  3) 页脚钉底不被窗缘水平切半 — footer top/bottom 落在视口内, 且无滚动中间态残行。 */
test("t_5cf22ba4: 趋势日期连续 + 三分项头部一位小数 + 页脚完整落视口", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  // day 维造「隔天缺口」: 09-08 有数据 / 09-10 有数据 / 09-09 无行 — 断言补 0 桶后 3 buckets
  const dayRows = fakeSummary.rows.map((r) => ({ ...r }));
  const multi = deriveMultiFromSingle(fakeSummary);
  const dayWithGap = {
    ...fakeSummary,
    rows: [
      { ...dayRows[0]!, group: "2026-09-08" },
      { ...dayRows[1]!, group: "2026-09-10" },
    ],
  };
  await seedAgentUsageMulti(page, {
    ...multi,
    day: { ok: true, data: dayWithGap },
  });
  await page.setViewportSize({ width: 900, height: 560 }); // t_e83ad982: 新窗口壳高度
  await page.goto("?view=agent-dashboard&standalone=1");
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible({ timeout: 5000 });
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-trend")).toBeVisible();
  await page.waitForTimeout(800); // chart.js 异步渲染

  // ① 趋势: phead note = 日粒度均值(S8 派生); 补 0 桶语义由 AgentDashboardC.test.tsx
  //  buildTrend 单测锁定(09-08/09-09/09-10 3 桶, 09-13 类 0 上报日以 0 桶在场)
  // 3 桶: 09-08=njbx02 64,000 + 09-10=njbx02-heavy 4,474,000 + 09-09 补 0 → 均值 1,512,667
  const trendNote = page.getByTestId("dash-trend-note");
  await pwExpect(trendNote).toContainText("均值 1,512,667");

  // ② 三分项头部: 一位小数, 不吞项(fake total = 74.0% / 18.5% / 7.5%)
  await pwExpect(page.locator(".dash-p-split .dash-pnote")).toHaveText("74.0% / 18.5% / 7.5%");

  // ③ 页脚: top 与 bottom 都在视口内(不被窗缘水平切半), 高度 ≥ 1 行(非裁切残行)
  const footerBox = await page.evaluate(() => {
    const f = document.querySelector(".agent-dashboard-c-footer") as HTMLElement | null;
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, vh: window.innerHeight };
  });
  expect(footerBox, "页脚必须渲染").toBeTruthy();
  expect(footerBox!.top).toBeGreaterThanOrEqual(0);
  expect(footerBox!.bottom).toBeLessThanOrEqual(footerBox!.vh + 0.5);
  expect(footerBox!.height, "页脚完整一行高(≥14px), 非被窗缘切成两半的残行").toBeGreaterThanOrEqual(14);
});

/** t_4b7984d9 round-6: LocalAgentSection 占位组件已整体删除(用户真机拍板),
 * round-5 A 的 local-agent-title/tag 颜色门禁随之失效 —— 该 DOM 已不存在。
 * 保留同精神断言: agent-card-section 标题仍走中性色(--fg-dim), 四主题不偏蓝。 */
for (const theme of ["dark", "light", "dark-glass", "light-glass"] as const) {
  test(`t_4b7984d9 round-6: agent-card-section 标题色 = --fg-dim (${theme})`, async ({
    hostPage,
    page,
  }) => {
    void hostPage;
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
    await page.getByTestId("main-tab-local-agent").click();
    await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();

    const colors = await page.evaluate(() => {
      const title = document.querySelector(".agent-card-section-title") as HTMLElement;
      return {
        title: getComputedStyle(title).color,
        dataTheme: document.documentElement.dataset.theme,
      };
    });
    expect(colors.dataTheme).toBe(theme);
    // 非蓝判定: --fg-dim 中性灰阶, B-G 差 < 24
    const m = colors.title.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(m, `computed color 必须可解析: ${colors.title}`).toBeTruthy();
    const [, , g, b] = m!.map(Number) as unknown as number[];
    expect(Math.abs(b - g), `theme=${theme} 不得偏蓝(B-G=${Math.abs(b - g)})`).toBeLessThan(24);
  });
}

/** t_4b7984d9 round-6 ⑤(语义反转版): tab 互斥必须覆盖 provider 主列表三态分支。
 *  round-6 信息架构 = 「用量」tab 显示 provider 主列表 + 「本地 Agent」tab 显示
 *  agent-card-section(AgentCard)。360×720 视口锁死(round-3 教训: browser-only
 *  默认 1280 视口下布局缺陷假绿)。 */
test.describe("t_4b7984d9 round-6 tab 互斥收口", () => {
  test.use({ viewport: { width: 360, height: 720 } });

  test("用量 tab 显示 provider 主列表, 本地 Agent tab 只见 agent 区", async ({
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
    // round-6: agent-card-section 已迁走, 用量 tab 不得渲染
    expect(await visible("agent-card-section"), "agent-card-section 不得在用量 tab 渲染").toBe(false);

    // 切「本地 Agent」: agent-card-section 可见, provider 三态全部不可见
    await page.getByTestId("main-tab-local-agent").click();
    await pwExpect(page.getByTestId("agent-card-section")).toBeVisible();
    expect(await visible("card-list"), "card-list 不得在本地 Agent tab 渲染").toBe(false);
    expect(await visible("empty-state"), "empty-state 不得在本地 Agent tab 渲染").toBe(false);
    expect(await visible("collecting-state"), "collecting-state 不得在本地 Agent tab 渲染").toBe(false);
    expect(await visible("loading-state"), "loading-state 不得在本地 Agent tab 渲染").toBe(false);

    // 切回「用量」: provider 主列表恢复, agent 区消失
    await page.getByTestId("main-tab-usage").click();
    const backVisible =
      (await visible("card-list")) ||
      (await visible("empty-state")) ||
      (await visible("collecting-state")) ||
      (await visible("loading-state"));
    expect(backVisible, "切回用量 tab 后 provider 主列表应恢复").toBe(true);
    expect(await visible("agent-card-section"), "切回用量后 agent-card-section 应消失").toBe(false);
  });
});
// ---- t_12c28686: 大屏数据面接真多维(group_by=["agent","model"] / ["day"]) ----
// fixtures 按 group_by 分流: 注入 2 agent × 2 model(agent|model) + 2 day。
// 断言: Model 分布 slice 数(≥2 真实多模型)、趋势桶数(≥2 天)、agent tab 切换联动。
const multiAgent = {
  window: {
    since: "2026-09-08T00:00:00+08:00",
    until: "2026-09-09T23:59:59+08:00",
  },
  timezone: "Asia/Shanghai",
  generated_at: "2026-09-09T18:00:00+08:00",
  rows: [
    {
      group: "njbx02",
      calls: 200,
      input_cache_hit_tokens: 100000,
      input_cache_miss_tokens: 20000,
      output_tokens: 8000,
      cost_total: 2.46,
      currency: "USD",
      by_status: { completed: 190, partial: 10, unknown: 0 },
    },
    {
      group: "home-computer",
      calls: 60,
      input_cache_hit_tokens: 12000,
      input_cache_miss_tokens: 6000,
      output_tokens: 2400,
      cost_total: 0.6,
      currency: "USD",
      by_status: { completed: 60, partial: 0, unknown: 0 },
    },
  ],
  total: {
    calls: 260,
    input_cache_hit_tokens: 112000,
    input_cache_miss_tokens: 26000,
    output_tokens: 10400,
    cost_total: 3.06,
    currency: "USD",
    by_status: { completed: 250, partial: 10, unknown: 0 },
  },
};
const multiModelRows = [
  // njbx02: glm(105k) + kimi(23k) — 多模型 ≥2 slice
  { ...multiAgent.rows[0], group: "njbx02|glm-5.3-flash",
    input_cache_hit_tokens: 88000, input_cache_miss_tokens: 14000, output_tokens: 3000 },
  { ...multiAgent.rows[0], group: "njbx02|kimi-k2",
    input_cache_hit_tokens: 12000, input_cache_miss_tokens: 6000, output_tokens: 5000 },
  // home-computer: glm + deepseek
  { ...multiAgent.rows[1], group: "home-computer|glm-5.3-flash",
    input_cache_hit_tokens: 7000, input_cache_miss_tokens: 3400, output_tokens: 1600 },
  { ...multiAgent.rows[1], group: "home-computer|deepseek-v3",
    input_cache_hit_tokens: 5000, input_cache_miss_tokens: 2600, output_tokens: 800 },
];
const multiModelAgent = {
  ...multiAgent,
  rows: multiModelRows,
};
const multiDay = {
  ...multiAgent,
  rows: [
    { ...multiAgent.rows[0], group: "2026-09-08" },
    { ...multiAgent.rows[0], group: "2026-09-09" },
  ],
};

async function agreeAndSeedMulti(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, {
    "agent": { ok: true, data: multiAgent },
    "agent,model": { ok: true, data: multiModelAgent },
    "day": { ok: true, data: multiDay },
  });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  // round-6: agent-card-section 迁入「本地 Agent」tab
  await page.getByTestId("main-tab-local-agent").click();
}

test("t_12c28686 多维数据面: agent tab 切换联动 Model 分布/明细 + 趋势多天桶", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await agreeAndSeedMulti(page);

  // 进大屏
  await page.getByTestId("agent-detail-njbx02").click();
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible();

  // agent tab 栏渲染(2 agent), 默认选中 tokens 最多的 njbx02
  await pwExpect(page.getByTestId("dash-agent-tabs")).toBeVisible();
  await pwExpect(page.getByTestId("dash-agent-tab-njbx02")).toHaveAttribute("aria-selected", "true");
  await pwExpect(page.getByTestId("dash-agent-tab-home-computer")).toHaveAttribute("aria-selected", "false");

  // hero = 全局 total(148,400), tab 只联动 Model 分布/明细
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-tokens")).toHaveText("148,400");
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-cost")).toContainText("3.06 USD");

  // Model 分布: njbx02 有 glm + kimi 两个模型 → 模型计数 2(真实多模型, 非单 slice 占位)
  await pwExpect(page.getByTestId("agent-dashboard-c-models")).toHaveText("2");
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-model")).toHaveCount(1);
  // 无占位 slice: 旧退路的 model:"tokens" 不得出现(canvas labels 无法直读,
  // 用「模块空态不出现 + 模型计数真实」双重锚定)
  await pwExpect(page.getByTestId("dash-model-empty")).toHaveCount(0);

  // 趋势: day 维 2 桶(2026-09-08 / 2026-09-09) → chart 渲染 + phead note 均值(S8)
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-trend")).toHaveCount(1);
  await pwExpect(page.getByTestId("dash-trend-empty")).toHaveCount(0);
  // 趋势 phead note: 「日粒度 · 均值 N」(t_15397c99: buckets 计数改均值派生口径)
  const trendNote = page.getByTestId("dash-trend-note");
  await pwExpect(trendNote).toContainText("日粒度");
  await pwExpect(trendNote).toContainText("均值 128,000"); // 2 桶各 128,000(100000+20000+8000) → 均值 128,000

  // 明细: agent 维全量 2 行(appendix 数据接线); 当前 agent njbx02 行 data-selected
  const list = page.getByTestId("agent-dashboard-c-detail-list");
  await pwExpect(list.locator("tbody tr")).toHaveCount(2);
  await pwExpect(page.getByTestId("agent-dashboard-c-detail-njbx02")).toHaveAttribute("data-selected", "true");
  await pwExpect(page.getByTestId("agent-dashboard-c-detail-njbx02")).toContainText("128,000");
  // W1 成本列: 各行带原币种原值, 不做跨行换汇(D-055 混币种语义)
  await pwExpect(page.getByTestId("agent-dashboard-c-detail-njbx02").locator("td:last-child")).toContainText("2.46 USD");
  await pwExpect(page.getByTestId("agent-dashboard-c-detail-home-computer").locator("td:last-child")).toContainText("0.60 USD");

  // 切 agent → KPI 保持全局口径, Model 分布/明细高亮联动(选中态 = is-selected 类)
  await page.getByTestId("dash-agent-tab-home-computer").click();
  await pwExpect(page.getByTestId("dash-agent-tab-home-computer")).toHaveAttribute("aria-selected", "true");
  await pwExpect(page.getByTestId("dash-agent-tab-njbx02")).toHaveAttribute("aria-selected", "false");
  // KPI 保持全局口径(148,400), Model 分布联动
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-tokens")).toHaveText("148,400");
  await pwExpect(page.getByTestId("agent-dashboard-c-models")).toHaveText("2"); // glm + deepseek
  await pwExpect(page.getByTestId("agent-dashboard-c-detail-home-computer")).toHaveClass(/is-selected/);
  await pwExpect(page.getByTestId("agent-dashboard-c-detail-njbx02")).not.toHaveClass(/is-selected/);
});

test("t_12c28686 多维失败域隔离: model/day 维度 unreachable → 各模块显式空态, 单维不拖累", async ({
  hostPage,
  page,
}) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, {
    "agent": { ok: true, data: multiAgent },
    "agent,model": { ok: false, reason: "unreachable" },
    "day": { ok: false, reason: "unreachable" },
  });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  // round-6: agent-card-section 迁入「本地 Agent」tab
  await page.getByTestId("main-tab-local-agent").click();

  await page.getByTestId("agent-detail-njbx02").click();
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible();

  // 单维数据仍活着: KPI/三分项/明细正常(失败域隔离, KPI=全局 148,400); 明细全量 2 行
  await pwExpect(page.getByTestId("agent-dashboard-c-hero-tokens")).toHaveText("148,400");
  await pwExpect(page.getByTestId("agent-dashboard-c-detail-list").locator("tbody tr")).toHaveCount(2);

  // Model 分布: 显式「数据拉取失败」+ 重试按钮, 不静默空白, 不画假环
  await pwExpect(page.getByTestId("dash-model-empty")).toContainText("数据拉取失败");
  await pwExpect(page.getByTestId("dash-model-empty-retry")).toBeVisible();
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-model")).toHaveCount(0);
  await pwExpect(page.getByTestId("agent-dashboard-c-models")).toHaveText("0");

  // 趋势: 显式「数据拉取失败」+ 重试, 不画假曲线
  await pwExpect(page.getByTestId("dash-trend-empty")).toContainText("数据拉取失败");
  await pwExpect(page.getByTestId("dash-trend-empty-retry")).toBeVisible();
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-trend")).toHaveCount(0);

  // 重试按钮触发 mcp_usage_summary 重查(captured invokes 计数增加)
  const before = (await getCapturedInvokes(page)).filter((c) => c.cmd === "mcp_usage_summary").length;
  await page.getByTestId("dash-model-empty-retry").click();
  await pwExpect(page.getByTestId("dash-model-empty")).toContainText("数据拉取失败"); // mock 仍 unreachable
  const after = (await getCapturedInvokes(page)).filter((c) => c.cmd === "mcp_usage_summary").length;
  expect(after, "重试必须重新发起 3 查(并行)").toBeGreaterThanOrEqual(before + 3);
});

test("t_12c28686 单模型如实 1 slice + 趋势不足 2 天显「数据积累中」", async ({ hostPage, page }) => {
  void hostPage;
  await page.getByTestId("consent-agree").click();
  await seedAgentUsageMulti(page, {
    "agent": { ok: true, data: multiAgent },
    // njbx02 只有 1 个模型
    "agent,model": {
      ok: true,
      data: { ...multiModelAgent, rows: multiModelRows.filter((r) => r.group !== "njbx02|kimi-k2") },
    },
    // daemon 刚启用: 只有 1 天数据
    "day": { ok: true, data: { ...multiDay, rows: [multiDay.rows[0]] } },
  });
  await page.reload();
  await pwExpect(page.getByTestId("card-list")).toBeVisible();
  // round-6: agent-card-section 迁入「本地 Agent」tab
  await page.getByTestId("main-tab-local-agent").click();

  await page.getByTestId("agent-detail-njbx02").click();
  await pwExpect(page.getByTestId("agent-dashboard-c")).toBeVisible();

  // Model 分布: 如实 1 slice(canvas 渲染, 计数=1, 不伪造多色环)
  await pwExpect(page.getByTestId("agent-dashboard-c-models")).toHaveText("1");
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-model")).toHaveCount(1);

  // 趋势: 1 天 → 「数据积累中（1 天）」占位, 不画假曲线, 无重试按钮
  await pwExpect(page.getByTestId("dash-trend-empty")).toContainText("数据积累中（1 天）");
  await pwExpect(page.getByTestId("dash-trend-empty-retry")).toHaveCount(0);
  await pwExpect(page.getByTestId("agent-dashboard-c-chart-trend")).toHaveCount(0);
});
