/**
 * web_session 一键授权 — t_e371caca(2026-09-27, D-058 app 侧落地)
 *
 * 与 command_auth(auth-session.ts)同哲学: 用户零命令行、零抄串。
 * 交互流(卡面 ①):
 *   1. web_session_auth_start(instanceId, auth) → 主进程开**独立 BrowserWindow**
 *      加载 login_url(未登录会被小米 SSO 接管至 account.xiaomi.com)
 *   2. 轮询 session.cookies: cookie_query_domains(缺省=[cookie_domain])各域并集中
 *      required_cookies 全部出现 → known_cookies(缺省=required)分层拼装
 *      `name=value; …`(required 按声明序, known 有则带) → keyring blob 加密落盘
 *      (safeStorage 与 api_key 同级, D-058 安全纪律) → 关窗 → resolve({ok:true})
 *      → renderer 触发该实例立即重采
 *   3. 出口三态: 成功(ok:true) / 用户手动关窗=取消({ok:false, cancelled:true},
 *      **静默不报错**) / 窗口超时(默认 5min, {ok:false, message:"授权超时"})
 *   4. 防多开: 同实例已有授权窗时复用其 promise(单例窗); 全局窗注册表防泄漏
 *
 * 零 electron 依赖(纯逻辑可 node vitest 直测, 与 auth-session.ts 同纪律):
 * window/session/shell 全部注入式 shim; main.ts 注入真实现。
 *
 * 域锁(D-058): 截获 cookie 只随目标域请求外发(core 同域护栏已落, WebSessionDomainError);
 * 本模块补充: 只接受目标域的 cookie(扫描域锁定), cookie 串只在内存构造瞬间存在,
 * 不进日志/错误信息(错误 message 一律不含 cookie 值)。
 */

/** 主进程最小面(与 electron BrowserWindow 用到的子集同形, 测试注入 stub) */
export interface AuthWindowLike {
  loadURL(url: string): Promise<void> | void;
  on(event: "closed", listener: () => void): unknown;
  once(event: "closed", listener: () => void): unknown;
  destroy(): void;
  isDestroyed(): boolean;
  /** 前台聚焦(真窗有, stub 可空实现) */
  focus?(): void;
}

/** electron session 最小面(测试注入 stub) */
export interface AuthSessionLike {
  cookies: {
    get(filter: { domain?: string }): Array<{ name: string; value: string; domain: string }>;
  };
}

/** window/session 工厂(shim): main.ts 注入真实现, 测试注入可控 stub */
export interface WebSessionAuthShims {
  /** 创建授权窗; 返回的窗必须已挂 closed 事件出口 */
  createWindow(url: string): AuthWindowLike;
  /** 取 electron session(默认 session from partition) */
  getSession(): AuthSessionLike;
  /** 打开授权窗(正常 create 即显示, shim 可记录调用) */
  showWindow(win: AuthWindowLike): void;
}

/** auth 契约(与 core WebSessionAuth 同形, 避免 app 主进程 import core 专有类型) */
export interface WebSessionAuthContract {
  kind: "web_session";
  cookie_domain: string;
  required_cookies: string[];
  login_url: string;
  /** 就绪检测查询域(L4 缺陷#2: 父域 cookie 须扩查; 缺省 = [cookie_domain] 向后兼容) */
  cookie_query_domains?: string[];
  /** 拼装发送全集(known 有则带, required 判就绪; 缺省 = required_cookies) */
  known_cookies?: string[];
  header_name?: string;
}

/** 单次授权结果(cancelled=true = 用户手动关窗, 静默语义, 不算错误) */
export interface WebSessionAuthResult {
  ok: boolean;
  /** cookie 是否已落 keyring(成功才为 true; 取消/超时 false) */
  saved: boolean;
  cancelled?: boolean;
  message?: string;
}

/** 轮询间隔(ms): cookie 就绪检测(小米 SSO 落 cookie 是离散事件, 500ms 足够密) */
const POLL_INTERVAL_MS = 500;
/** 窗口超时(卡面 ①: 5min 保护; 超时 = 授权放弃, 提示重试) */
const AUTH_WINDOW_TIMEOUT_MS = 5 * 60_000;

/** 进行中的授权会话(instanceId → promise); 防多开: 同实例重复 start 复用同一 promise */
const pending = new Map<string, Promise<WebSessionAuthResult>>();

/** 供测试/重启清理: 全部 abort(main.ts will-quit 挂) */
const aborters = new Set<() => void>();

/**
 * 从目标域 cookie 列表拼装 Cookie 串(卡面 ①: required 按声明顺序, 全部命中才拼)。
 * known/required 分层(L4 缺陷#2, comment 2010): required 全命中 = 就绪; known 集合中
 * 已存在的 cookie 按 known 声明序全带上(required 之后)——平台随发的附加令牌
 * (如 MiMo ph/slh)缺失不阻断就绪, 存在则随发(CodexBar 四项全发实证)。
 * 值不进任何日志(调用方仅保存结果); 本函数纯函数可直测。
 */
export function buildCookieString(
  cookies: Array<{ name: string; value: string }>,
  required: readonly string[],
  known?: readonly string[],
): string | null {
  const byName = new Map(cookies.map((c) => [c.name, c.value]));
  const emit = (name: string): string | null => {
    const v = byName.get(name);
    if (v === undefined || v === "") return null;
    return `${name}=${v}`;
  };
  const parts: string[] = [];
  for (const name of required) {
    const part = emit(name);
    if (part === null) return null; // required 缺失 = 未就绪(不是错误)
    parts.push(part);
  }
  const knownSet = new Set(required);
  for (const name of known ?? []) {
    if (knownSet.has(name)) continue; // required 已拼, 不重复
    knownSet.add(name);
    const part = emit(name);
    if (part !== null) parts.push(part); // known 有则带, 缺失不阻断
  }
  return parts.join("; ");
}

export interface StartOptions {
  instanceId: string;
  auth: WebSessionAuthContract;
  /** keyring 写入(service/key 同 renderer keyringSet 契约; main.ts 注入真实现) */
  saveSecret: (service: string, key: string, value: string) => Promise<void>;
  /** keyring 条目 key(= renderer makeCredentialRef 形态 `${instanceId}:${paramKey}`) */
  secretKey: string;
  /** 超时 ms(缺省 5min; 测试注入小值) */
  timeoutMs?: number;
  /** 轮询 ms(缺省 500; 测试注入小值) */
  pollMs?: number;
}

/**
 * 启动 web_session 授权窗。防多开: 同 instanceId 已有授权流在途 → 直接返回其 promise。
 */
export function startWebSessionAuth(shims: WebSessionAuthShims, opts: StartOptions): Promise<WebSessionAuthResult> {
  const existing = pending.get(opts.instanceId);
  if (existing) return existing;
  const p = runAuthFlow(shims, opts).finally(() => pending.delete(opts.instanceId));
  pending.set(opts.instanceId, p);
  return p;
}

/** 取消在途授权(卡面 ①: cancel 语义 = 关窗, 走静默取消出口) */
export function cancelWebSessionAuth(instanceId: string): void {
  const p = pending.get(instanceId);
  if (!p) return;
  // 关窗由 flow 的 aborter 承担; promise 已在途, 结果由 closed 出口落 cancelled
  void p;
  const cancel = cancelHooks.get(instanceId);
  cancel?.();
}
const cancelHooks = new Map<string, () => void>();

/** 诊断: 在途会话数(测试断言防泄漏) */
export function webSessionAuthCount(): number {
  return pending.size;
}

/** 全部清理(will-quit): 关所有在途窗(测试 afterEach 挂) */
export function abortAllWebSessionAuths(): void {
  for (const fn of [...aborters]) fn();
  aborters.clear();
  cancelHooks.clear();
  pending.clear();
}

/** 单实例授权流(私有): 开窗 → 轮询 cookie → 落盘 → 关窗 */
async function runAuthFlow(shims: WebSessionAuthShims, opts: StartOptions): Promise<WebSessionAuthResult> {
  const timeoutMs = opts.timeoutMs ?? AUTH_WINDOW_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? POLL_INTERVAL_MS;
  const { auth } = opts;

  let settled = false;
  let win: AuthWindowLike | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<WebSessionAuthResult>((resolve) => {
    const finish = (result: WebSessionAuthResult) => {
      if (settled) return;
      settled = true;
      cancelHooks.delete(opts.instanceId);
      aborters.delete(abort);
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      // 关窗(幂等: isDestroyed 守卫; 关窗即取消出口/成功出口都走这里)
      if (win && !win.isDestroyed()) win.destroy();
      resolve(result);
    };
    const abort = () => {
      // closed 出口在 settled 后仍会触发(win.destroy 内联 closed): 需可重入
      if (settled) return;
      finish({ ok: false, saved: false, cancelled: true });
    };
    aborters.add(abort);
    cancelHooks.set(opts.instanceId, () => {
      if (win && !win.isDestroyed()) win.destroy();
    });

    // ---- 开授权窗(独立 BrowserWindow; closed = 用户手动关窗 = 静默取消) ----
    win = shims.createWindow(auth.login_url);
    win.on("closed", abort);
    shims.showWindow(win);

    const session = shims.getSession();
    // 就绪检测查询域(L4 缺陷#2): Electron domain 过滤器不匹配父域 cookie, 声明了
    // cookie_query_domains(如 mimo 父域 .xiaomimimo.com)时逐域取并集; 按声明序去重
    // (name 首见优先)。⚠️ 查询域 ≠ 发送域: 数据面仍只发 cookie_domain 同域端点。
    const queryDomains = auth.cookie_query_domains?.length
      ? auth.cookie_query_domains
      : [auth.cookie_domain];
    const readTargetCookies = (): Array<{ name: string; value: string }> => {
      try {
        // 只读声明域(域锁: 其它域 cookie 一律不看, 更不拼装)
        const merged = new Map<string, { name: string; value: string }>();
        for (const d of queryDomains) {
          for (const c of session.cookies.get({ domain: d })) {
            if (!merged.has(c.name)) merged.set(c.name, { name: c.name, value: c.value });
          }
        }
        return [...merged.values()];
      } catch {
        return [];
      }
    };

    const attempt = (): void => {
      if (settled) return;
      const cookie = buildCookieString(readTargetCookies(), auth.required_cookies, auth.known_cookies);
      if (cookie === null) return; // 未就绪(静默续轮询; 值不落日志)
      // 就绪 → 落 keyring(safeStorage 与 api_key 同级) → 关窗 → 成功出口
      void opts
        .saveSecret("token-wallet", opts.secretKey, cookie)
        .then(() => finish({ ok: true, saved: true }))
        .catch((err: unknown) => {
          // 落盘失败 = 授权未完成(cookie 已在内存但没存进去): 关窗 + 显式错误(不含 cookie 值)
          finish({
            ok: false,
            saved: false,
            message: `凭据落盘失败: ${err instanceof Error ? err.message : String(err)}`,
          });
        });
    };

    pollTimer = setInterval(attempt, pollMs);
    // 先同步探一次(授权窗打开前可能已有合法会话 cookie —— 理论上不该发生, 探测无害)
    attempt();
    timeoutTimer = setTimeout(() => {
      if (settled) return;
      finish({ ok: false, saved: false, message: "授权超时(5 分钟未完成登录), 请重试" });
    }, timeoutMs);
  });
}
