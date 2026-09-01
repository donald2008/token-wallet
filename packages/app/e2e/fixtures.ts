import { test as base, expect, type Page } from "@playwright/test";

/**
 * browser 模式(D-030 L2, D-033 起走自家轻量 harness): headless Chromium +
 * mock 桌面桥 —— 与 Electron preload 同形态注入 window.tokenWallet.invoke。
 *
 * get_bootstrap 读 localStorage 的 consent 标记(P0-7: 与真实 settings.json 同语义),
 * 新增 IPC(D-019 存储路径 / D-024 开机自启)mock 为确定性值, 便于断言。
 *
 * P0-5 真实链路 mock(D-030 L2: mock 桌面桥 IPC, 前端逻辑全部真跑):
 * - keyring_*: 有状态内存钥匙串(设置页保存 → 引擎读取构造 Authorization 头)
 * - http_get_json: 返回 golden deepseek 响应(真实 API 脱敏 fixture)
 * - sqlite_*: 有状态内存 SQLite(snapshots 表模拟, 支持建表/插入/最新/历史查询)
 *
 * P0-7 持久化 mock:
 * - instances_load/instances_save: localStorage 持久化(JSON 形态; YAML 转换在主进程,
 *   browser 模式覆盖不到, 主进程侧由 node vitest 原子写/RMW 单测兜底)。
 *   localStorage 跨 page.reload() 存活 → 可测"重启后实例仍在"。
 * - record_consent/get_bootstrap: consent 标记存 localStorage → 可测"重启不再弹隐私声明"。
 *
 * ⚠️ mock handler 会经 toString() 序列化进浏览器执行, 闭包不能引用 Node 侧变量 ——
 * 状态一律放 window.__MOCK_SQLITE__ 全局(惰性初始化)或 localStorage,
 * 测试用 seedSqliteHistory() 注入。
 */

type IpcHandler = (args?: Record<string, unknown>) => unknown;

const ipcMocks: Record<string, IpcHandler> = {
  get_bootstrap: () => {
    let agreed = false;
    try {
      agreed = localStorage.getItem("token-wallet.mock.consent.v1") === "1";
    } catch {
      /* ignore */
    }
    return { firstRun: !agreed, theme: "system", version: "0.1.0-test" };
  },
  record_consent: () => {
    try {
      localStorage.setItem("token-wallet.mock.consent.v1", "1");
    } catch {
      /* ignore */
    }
    return null;
  },
  instances_load: () => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem("token-wallet.mock.instances.v1");
    } catch {
      /* ignore */
    }
    if (!raw) return null;
    return JSON.parse(raw); // 损坏即抛错 = fail-fast 语义
  },
  instances_save: (args) => {
    try {
      localStorage.setItem(
        "token-wallet.mock.instances.v1",
        JSON.stringify((args as { file?: unknown } | undefined)?.file ?? null),
      );
    } catch {
      /* ignore */
    }
    return null;
  },
  update_tray_status: () => null,
  win_minimize: () => null,
  win_close: () => null,
  // P1 置顶开关: localStorage 持久化(真壳 settings.json 跨重启存活, mock 同语义,
  // 可测"开置顶 → reload → 图钉仍实心常显")
  win_get_always_on_top: () => {
    try {
      return localStorage.getItem("token-wallet.mock.always-on-top.v1") === "1";
    } catch {
      return false;
    }
  },
  win_set_always_on_top: (args) => {
    try {
      if (args?.enabled) localStorage.setItem("token-wallet.mock.always-on-top.v1", "1");
      else localStorage.removeItem("token-wallet.mock.always-on-top.v1");
    } catch {
      /* ignore */
    }
    return null;
  },
  get_storage_paths: () => ({
    configDir: "/home/test/.config/token-wallet",
    dataDir: "/home/test/.local/share/token-wallet",
  }),
  // P1 #829 R1 排序配置: localStorage 持久化(真壳 settings.json 跨重启存活, mock 同语义,
  // 可测"切紧要度 → reload → 排序仍保持")
  get_sort_config: () => {
    try {
      const raw = localStorage.getItem("token-wallet.mock.sort-config.v1");
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return { key: "name", dir: "asc" };
  },
  set_sort_config: (args) => {
    try {
      localStorage.setItem(
        "token-wallet.mock.sort-config.v1",
        JSON.stringify((args as { config?: unknown } | undefined)?.config ?? null),
      );
    } catch {
      /* ignore */
    }
    return null;
  },
  get_launch_at_login: () => false,
  // Phase B 界面语言: localStorage 持久化(真壳 settings.json 跨重启存活, mock 同语义,
  // 可测"切语言 → reload → 语言保持")
  get_lang: () => {
    try {
      return localStorage.getItem("token-wallet.mock.lang.v1") ?? "zh";
    } catch {
      return "zh";
    }
  },
  set_lang: (args) => {
    try {
      const lang = (args as { lang?: unknown } | undefined)?.lang;
      if (lang === "en" || lang === "zh") localStorage.setItem("token-wallet.mock.lang.v1", lang);
    } catch {
      /* ignore */
    }
    return null;
  },
  set_launch_at_login: () => null,
  // ---- D-046: updater 三通道 + 事件桥(localStorage token-wallet.mock.updater 存状态;
  // 测试用 seedUpdaterState() 注入目标态, 覆盖四态渲染断言) ----
  updater_check: () => {
    try {
      const raw = localStorage.getItem("token-wallet.mock.updater");
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return { status: "up-to-date" };
  },
  updater_download: () => {
    try {
      localStorage.setItem("token-wallet.mock.updater", JSON.stringify({ status: "downloading", percent: 10 }));
    } catch {
      /* ignore */
    }
    return { status: "downloading", percent: 10 };
  },
  updater_install: () => null,
  // ---- P0-5 真实链路(状态存浏览器全局, 见文件头警告) ----
  // ⚠️ keyring 用 localStorage(P0-7 起): 真 OS 钥匙串跨重启存活, reload 后实例
  //    resolveCredential 仍要能拿到 secret, 才能验证"重启后实例仍在且出数"。
  keyring_get: (args) => {
    const k = `token-wallet.mock.keyring.${args?.service}:${args?.key}`;
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  keyring_set: (args) => {
    try {
      localStorage.setItem(
        `token-wallet.mock.keyring.${args?.service}:${args?.key}`,
        String(args?.value ?? ""),
      );
    } catch {
      /* ignore */
    }
    return null;
  },
  keyring_delete: (args) => {
    try {
      localStorage.removeItem(`token-wallet.mock.keyring.${args?.service}:${args?.key}`);
    } catch {
      /* ignore */
    }
    return null;
  },
  http_get_json: (args) => {
    // P0-8: 可注入延迟(localStorage token-wallet.mock.httpdelayms) → 测"采集进行中"空态语义
    let delayMs = 0;
    try {
      delayMs = Number(localStorage.getItem("token-wallet.mock.httpdelayms") ?? 0) || 0;
    } catch {
      /* ignore */
    }
    let result: { status: number; body: string };
    // 401 路径(测试连接失败场景: "fail" 哨兵在 testConnection 已拦截, 这里兜底)
    const headers = (args?.headers ?? {}) as Record<string, string>;
    const auth = headers.Authorization ?? "";
    if (auth.includes("fail")) {
      result = { status: 401, body: "{}" };
    } else if (String(args?.url ?? "").includes("api.deepseek.com/user/balance")) {
      // ⚠️ golden 必须内联(handler.toString() 序列化, 自由变量会丢)
      result = {
        status: 200,
        body: JSON.stringify({
          is_available: true,
          balance_infos: [
            {
              currency: "CNY",
              total_balance: "448.45",
              granted_balance: "0.00",
              topped_up_balance: "448.45",
            },
          ],
        }),
      };
    } else if (String(args?.url ?? "").includes("opencode.ai/zen/go/v1/usage")) {
      if (auth.includes("low")) {
        // 即将耗尽变体(t_05271be0): weekly 95%(remaining 5%, 0<r≤10%)→ 徽章「即将耗尽」仍红(bad)
        result = {
          status: 200,
          body: JSON.stringify({
            usage: {
              rolling: { status: "ok", percent: 0, resetsAt: "2026-09-04T13:26:59.879Z" },
              weekly: { status: "ok", percent: 95, resetsAt: "2026-09-06T00:00:00.879Z" },
              monthly: { status: "ok", percent: 48, resetsAt: "2026-09-25T06:07:28.879Z" },
            },
          }),
        };
      } else {
        // opencode/go golden(2026-08-29 L3 实测脱敏): weekly 单窗 rate-limited 100%
        result = {
          status: 200,
          body: JSON.stringify({
            usage: {
              rolling: { status: "ok", percent: 0, resetsAt: "2026-08-29T13:26:59.879Z" },
              weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-31T00:00:00.879Z" },
              monthly: { status: "ok", percent: 48, resetsAt: "2026-09-25T06:07:28.879Z" },
            },
          }),
        };
      }
    } else if (String(args?.url ?? "").includes("api.kimi.com/coding/v1/usages")) {
      // kimi/coding golden(2026-08-29 L3 实测脱敏): 主窗 71/100, 5h 窗 100/100
      result = {
        status: 200,
        body: JSON.stringify({
          user: { userId: "<redacted>", region: "REGION_CN", membership: { level: "LEVEL_INTERMEDIATE" } },
          limited: true,
          usage: { limit: "100", used: "71", remaining: "29", resetTime: "2026-09-04T01:21:10.687248Z" },
          limits: [
            {
              window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
              detail: { limit: "100", used: "100", resetTime: "2026-08-29T09:21:10.687248Z" },
            },
          ],
          parallel: { limit: "20" },
          authentication: { method: "METHOD_API_KEY", scope: "FEATURE_CODING" },
          subType: "TYPE_PURCHASE",
          boosterWallet: {
            id: "<redacted>",
            balance: { feature: "FEATURE_OMNI", type: "BOOSTER", unit: "UNIT_CURRENCY" },
            status: "STATUS_DISABLED",
            allowTopup: true,
          },
        }),
      };
    } else {
      result = { status: 404, body: "{}" };
    }
    if (delayMs > 0) {
      return new Promise((res) => setTimeout(() => res(result), delayMs));
    }
    return result;
  },
  // ---- D-042: command 类通道执行桥(browser mock, 语义与主进程真实适配器产出一致) ----
  // ⚠️ 契约 5: browser 模式 mock IPC 不经主进程, 对主进程接线零信息量——本 mock 只
  //    驱动 renderer 侧逻辑(引擎 command 分支解析/面板出卡), 不许改 mock 语义凑绿;
  //    真实 spawn 接线由 electron/command-run.test.ts 真实取证。
  // 默认返回健康快照(bl 已装 + 会话有效); localStorage token-wallet.mock.commandfail=1
  // 时返回 error + 安装 hint(bl 未装语义)——与 core BailianTokenPlanAdapter 产出同形态。
  command_run: (args) => {
    const inst = (args?.instance ?? {}) as { id?: string; name?: string };
    const id = inst.id ?? "inst-cmd";
    const name = inst.name ?? "百炼 Token Plan #1";
    const fetched_at = Math.floor(Date.now() / 1000);
    // t_fb8c44d8: auth_expired 态注入(授权按钮流 e2e) —— localStorage
    // token-wallet.mock.authexpired = "arkcli" | "bl"; 命中返回 auth_expired + 对应 setup_hint
    // (与 core 适配器产出同形态: bl/arkcli 会话失效 → warn 卡 + OneClickAuth 按钮)
    let authexpired = "";
    try {
      authexpired = localStorage.getItem("token-wallet.mock.authexpired") ?? "";
    } catch {
      /* ignore */
    }
    if (authexpired === "arkcli" || authexpired === "bl") {
      const hint =
        authexpired === "arkcli"
          ? "运行 `arkcli auth login volc-sso --no-browser` 重新授权(SSO 会话由 CLI 管理)"
          : "运行 `bl auth login --console` 重新授权(控制台会话由 CLI 管理)";
      return {
        provider_id: id,
        display_name: name,
        plan_type: "window",
        fetched_at,
        status: "auth_expired",
        metrics: [],
        alerts: [{ level: "warn", message: "控制台会话已失效, 请重新授权", code: "auth_expired" }],
        setup_hint: hint,
      };
    }
    let fail = false;
    try {
      fail = localStorage.getItem("token-wallet.mock.commandfail") === "1";
    } catch {
      /* ignore */
    }
    if (fail) {
      return {
        provider_id: id,
        display_name: name,
        plan_type: "window",
        fetched_at,
        status: "error",
        metrics: [],
        alerts: [{ level: "critical", message: "bl CLI 不在 PATH, 请安装后重启应用", code: "cli_missing" }],
        error_message: "bl CLI 不在 PATH, 请安装后重启应用",
        setup_hint: "未检测到 bl CLI: 请安装(见 DESIGN.md D-023 一键安装)后重启应用",
      };
    }
    return {
      provider_id: id,
      display_name: name,
      plan_type: "window",
      fetched_at,
      status: "ok",
      metrics: [
        { key: "weekly", kind: "window", unit: "percent", used: 37.9, limit: 100, reset_at: fetched_at + 86_400 },
      ],
      alerts: [],
    };
  },
  // ---- t_fb8c44d8: 一键授权两通道(renderer 按钮流 e2e) ----
  // mock 语义与主进程 auth-defs.ts 对齐: bl → finishMode="callback" 免回喂 / arkcli → "code" 两段
  // 失败路径: authfail=1 → start ok:false; authfinishfail=1 → finish ok:false
  // 延迟: authfinishdelay=<ms> → finish 延迟 resolve(测 bl 自闭环 waiting 态可见性)
  command_auth_start: (args) => {
    const cli = String(args?.cli ?? "");
    let fail = false;
    try {
      fail = localStorage.getItem("token-wallet.mock.authfail") === "1";
    } catch {
      /* ignore */
    }
    if (fail) return { ok: false, message: `授权启动失败: ${cli} CLI 不在 PATH` };
    if (cli === "bl") {
      return {
        ok: true,
        sessionId: "auth-bl-mock",
        url: "https://bailian.console.aliyun.com/console-login?notice=127.0.0.1:9876?state=e2e",
        finishMode: "callback",
      };
    }
    if (cli === "arkcli") {
      return {
        ok: true,
        sessionId: "auth-ark-mock",
        url: "https://signin.volcengine.com/authorize/oauth/authorize?client_id=e2e&state=mock",
        finishMode: "code",
      };
    }
    return { ok: false, message: `未知 CLI: ${cli}` };
  },
  command_auth_finish: () => {
    let fail = false;
    let delayMs = 0;
    try {
      fail = localStorage.getItem("token-wallet.mock.authfinishfail") === "1";
      delayMs = Number(localStorage.getItem("token-wallet.mock.authfinishdelay") ?? 0) || 0;
    } catch {
      /* ignore */
    }
    const result = fail ? { ok: false, message: "授权失败: invalid code (mock)" } : { ok: true, message: "授权成功" };
    if (delayMs > 0) return new Promise((res) => setTimeout(() => res(result), delayMs));
    return result;
  },
  command_auth_cancel: () => ({ ok: true }),
  sqlite_batch: () => null,
  sqlite_exec: (args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w.__MOCK_SQLITE__) w.__MOCK_SQLITE__ = { rows: [] };
    const sql = String(args?.sql ?? "");
    if (/^INSERT INTO snapshots/i.test(sql.trim())) {
      const [provider_id, fetched_at, status, raw_json] = (args?.params ?? []) as [
        string,
        number,
        string,
        string,
      ];
      w.__MOCK_SQLITE__.rows.push({ provider_id, fetched_at, status, raw_json });
      return 1;
    }
    // t_2ac39613: 删除实例 → purgeProvider → DELETE FROM snapshots/usage_records
    if (/^DELETE FROM snapshots/i.test(sql.trim())) {
      const [provider_id] = (args?.params ?? []) as [string];
      const before = w.__MOCK_SQLITE__.rows.length;
      w.__MOCK_SQLITE__.rows = w.__MOCK_SQLITE__.rows.filter(
        (r: { provider_id: string }) => r.provider_id !== provider_id,
      );
      return before - w.__MOCK_SQLITE__.rows.length;
    }
    if (/^DELETE FROM usage_records/i.test(sql.trim())) {
      // 浏览器 mock 不维护 usage_records 行, 视为成功(主进程侧真实执行)
      return 0;
    }
    return 0;
  },
  sqlite_query: (args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w.__MOCK_SQLITE__) w.__MOCK_SQLITE__ = { rows: [] };
    const rows: { provider_id: string; fetched_at: number; status: string; raw_json: string }[] =
      w.__MOCK_SQLITE__.rows;
    const sql = String(args?.sql ?? "").trim();
    const params = (args?.params ?? []) as unknown[];
    // 历史查询: WHERE provider_id = ? AND fetched_at >= ? ORDER BY fetched_at DESC ... LIMIT ?
    if (/SELECT raw_json FROM snapshots WHERE provider_id/.test(sql)) {
      const [providerId, since] = params as [string, number];
      const own = rows.filter((r) => r.provider_id === providerId && r.fetched_at >= since);
      // 该 provider 历史跨度不足 3 天 → 合成一条 3 天前快照(模拟已用 3 天):
      // 数值 = 最新余额 + 10(即 448.45 → 458.45), 让速率/预计天数可算
      const has3DayOld = own.some((r) => r.fetched_at <= Math.floor(Date.now() / 1000) - 2 * 86_400);
      if (!has3DayOld && rows.some((r) => r.provider_id === providerId)) {
        const latest = [...rows]
          .filter((r) => r.provider_id === providerId)
          .sort((a, b) => b.fetched_at - a.fetched_at)[0];
        try {
          const obj = JSON.parse(latest.raw_json);
          const m = (obj.metrics ?? []).find((x: { kind?: string }) => x.kind === "balance");
          if (m) {
            const base = m.remaining ?? m.used;
            const synthAt = Math.floor(Date.now() / 1000) - 3 * 86_400;
            own.push({
              provider_id: providerId,
              fetched_at: synthAt,
              status: "ok",
              raw_json: JSON.stringify({
                provider_id: providerId,
                display_name: obj.display_name ?? "DeepSeek-按量 #1",
                plan_type: "balance",
                fetched_at: synthAt,
                status: "ok",
                metrics: [
                  {
                    key: "balance",
                    kind: "balance",
                    unit: "cny",
                    used: base + 10,
                    remaining: base + 10,
                    currency: m.currency ?? "CNY",
                  },
                ],
                alerts: [],
              }),
            });
          }
        } catch {
          /* 合成失败则无历史 */
        }
      }
      return own
        .sort((a, b) => b.fetched_at - a.fetched_at)
        .slice(0, Number(params[2] ?? 1000))
        .map((r) => [r.raw_json]);
    }
    // 最新快照: JOIN 每 provider MAX(fetched_at)
    if (/JOIN \(SELECT provider_id, MAX\(fetched_at\)/.test(sql)) {
      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const prev = latest.get(r.provider_id);
        if (!prev || r.fetched_at > prev.fetched_at) latest.set(r.provider_id, r);
      }
      return [...latest.values()].map((r) => [r.raw_json]);
    }
    return [];
  },
};

/**
 * hostPage fixture: 安装 mock 桌面桥(window.tokenWallet.invoke, 与 Electron preload
 * 同形态) + 捕获全部 IPC 调用 + 自动导航 dev server。与 page 是同一个 Page 对象。
 */
export const test = base.extend<{ hostPage: Page }>({
  hostPage: async ({ page }, use) => {
    const entries = Object.entries(ipcMocks)
      .map(([channel, fn]) => `${JSON.stringify(channel)}: (${fn.toString()})`)
      .join(",\n");
    await page.addInitScript(`(() => {
      const handlers = {\n${entries}\n};
      window.__capturedInvokes = [];
      window.__updaterListeners = [];
      window.__pushUpdaterEvent = (event) => {
        for (const cb of window.__updaterListeners) cb(event);
      };
      window.tokenWallet = {
        invoke: (channel, payload) => {
          window.__capturedInvokes.push({ cmd: channel, args: payload });
          const h = handlers[channel];
          return Promise.resolve(h ? h(payload) : null);
        },
        onUpdaterEvent: (callback) => {
          window.__updaterListeners.push(callback);
        },
      };
    })()`);
    await page.goto("http://localhost:1420");
    // 等 React 挂载+effect 落定(matchMedia 监听等挂好后才放行测试体,
    // 防 emulateMedia 等操作抢在 effect 挂载前 → 事件丢失型 flake)
    await page.waitForSelector(
      '[data-testid="consent-agree"], [data-testid="card-list"], [data-testid="config-error"]',
      { state: "visible" },
    );
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await use(page);
  },
});

export { expect };

/** 已捕获的 IPC 调用(断言 keyring_set 等副作用用) */
export async function getCapturedInvokes(
  page: Page,
): Promise<{ cmd: string; args?: Record<string, unknown> }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __capturedInvokes?: { cmd: string; args?: Record<string, unknown> }[] })
        .__capturedInvokes ?? [],
  );
}

/**
 * D-046: 注入 updater 状态(渲染层走 ipc.ts updaterCheck 读 mock)。
 * state = UpdaterState 子集({status, version?, percent?}); 用 page.reload() 后重新挂载生效。
 */
export async function seedUpdaterState(
  page: import("@playwright/test").Page,
  state: Record<string, unknown>,
): Promise<void> {
  await page.evaluate((s) => {
    localStorage.setItem("token-wallet.mock.updater", JSON.stringify(s));
  }, state);
}

/**
 * 预置历史快照(速率计算用): 往浏览器 sqlite mock 全局插入一条 N 天前的余额快照。
 * 例: 3 天前 458.45 → 今天 golden 448.45 → 速率 ≈ 3.33/天 → 预计 ~134 天
 */
export async function seedSqliteHistory(
  page: import("@playwright/test").Page,
  providerId: string,
  daysAgo: number,
  remaining: number,
): Promise<void> {
  await page.evaluate(
    ([pid, days, rem]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (!w.__MOCK_SQLITE__) w.__MOCK_SQLITE__ = { rows: [] };
      const fetched_at = Math.floor(Date.now() / 1000) - (days as number) * 86_400;
      w.__MOCK_SQLITE__.rows.push({
        provider_id: pid,
        fetched_at,
        status: "ok",
        raw_json: JSON.stringify({
          provider_id: pid,
          display_name: "DeepSeek-按量 #1",
          plan_type: "balance",
          fetched_at,
          status: "ok",
          metrics: [
            { key: "balance", kind: "balance", unit: "cny", used: rem, remaining: rem, currency: "CNY" },
          ],
          alerts: [],
        }),
      });
    },
    [providerId, daysAgo, remaining],
  );
}
