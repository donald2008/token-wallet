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
  get_storage_paths: () => ({
    configDir: "/home/test/.config/token-wallet",
    dataDir: "/home/test/.local/share/token-wallet",
  }),
  get_launch_at_login: () => false,
  set_launch_at_login: () => null,
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
    // 401 路径(测试连接失败场景: "fail" 哨兵在 testConnection 已拦截, 这里兜底)
    const headers = (args?.headers ?? {}) as Record<string, string>;
    const auth = headers.Authorization ?? "";
    if (auth.includes("fail")) {
      return { status: 401, body: "{}" };
    }
    if (String(args?.url ?? "").includes("api.deepseek.com/user/balance")) {
      // ⚠️ golden 必须内联(handler.toString() 序列化, 自由变量会丢)
      return {
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
    }
    return { status: 404, body: "{}" };
  },
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
      window.tokenWallet = {
        invoke: (channel, payload) => {
          window.__capturedInvokes.push({ cmd: channel, args: payload });
          const h = handlers[channel];
          return Promise.resolve(h ? h(payload) : null);
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
