/**
 * web_session 一键授权单测(t_e371caca U4, node vitest)
 *
 * 覆盖卡面验收 3: cookie 捕获→拼装→落盘→关窗链路(mock session.cookies);
 * 出口三态: 成功 / 用户手动关窗=静默取消 / 窗口超时; 另补落盘失败 + 防多开。
 * 全部走注入式 shim(零 electron), fake timers 驱动轮询, cookie 值全 mock 占位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortAllWebSessionAuths,
  buildCookieString,
  cancelWebSessionAuth,
  startWebSessionAuth,
  webSessionAuthCount,
  type AuthWindowLike,
  type WebSessionAuthShims,
} from "./web-session-auth";

const MIMO_AUTH = {
  kind: "web_session" as const,
  cookie_domain: "platform.xiaomimimo.com",
  required_cookies: ["api-platform_serviceToken", "userId"],
  login_url: "https://platform.xiaomimimo.com",
};

/** L4 缺陷#2(comment 2010): mimo 真实契约形态——cookie 全在父域, known 四项全发 */
const MIMO_AUTH_L4 = {
  ...MIMO_AUTH,
  cookie_query_domains: ["platform.xiaomimimo.com", "xiaomimimo.com"],
  known_cookies: ["api-platform_serviceToken", "userId", "api-platform_ph", "api-platform_slh"],
};

/** 受控 stub 窗: closed 出口由测试手动触发 */
function makeStubWindow() {
  const listeners: Array<() => void> = [];
  const win: AuthWindowLike = {
    loadURL: vi.fn(),
    on: (_e, l) => {
      listeners.push(l);
      return win;
    },
    once: (_e, l) => {
      listeners.push(l);
      return win;
    },
    destroy: vi.fn(() => {
      for (const l of [...listeners]) l();
    }),
    isDestroyed: vi.fn(() => false),
  };
  return { win, fireClosed: () => { for (const l of [...listeners]) l(); } };
}

/** 受控 stub session: cookies 集合由测试逐 tick 演化 */
function makeStubSession(initial: Array<{ name: string; value: string; domain: string }> = []) {
  const cookies = [...initial];
  return {
    cookies: {
      get: (filter: { domain?: string }) =>
        cookies.filter((c) => !filter.domain || c.domain.endsWith(filter.domain)),
    },
    setCookie: (name: string, value: string) =>
      cookies.push({ name, value, domain: MIMO_AUTH.cookie_domain }),
  };
}

interface Harness {
  shims: WebSessionAuthShims;
  win: ReturnType<typeof makeStubWindow>;
  session: ReturnType<typeof makeStubSession>;
  saved: Map<string, string>;
  createdUrls: string[];
}

function makeHarness(): Harness {
  const win = makeStubWindow();
  const session = makeStubSession();
  const saved = new Map<string, string>();
  const createdUrls: string[] = [];
  const shims: WebSessionAuthShims = {
    createWindow: (url) => {
      createdUrls.push(url);
      return win.win;
    },
    getSession: () => session,
    showWindow: vi.fn(),
  };
  return { shims, win, session, saved, createdUrls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  abortAllWebSessionAuths();
  vi.useRealTimers();
});

describe("buildCookieString(拼装, 纯函数)", () => {
  it("全部必需 cookie 命中 → 按声明顺序拼装", () => {
    const out = buildCookieString(
      [
        { name: "userId", value: "<mock-user-id>" },
        { name: "api-platform_serviceToken", value: "<mock-token>" },
        { name: "other", value: "ignored" },
      ],
      MIMO_AUTH.required_cookies,
    );
    // 顺序 = required_cookies 声明顺序(契约确定性, 不依赖服务端 set-cookie 顺序)
    expect(out).toBe("api-platform_serviceToken=<mock-token>; userId=<mock-user-id>");
  });
  it("缺任一必需 cookie → null(未就绪)", () => {
    expect(buildCookieString([{ name: "userId", value: "<mock-user-id>" }], MIMO_AUTH.required_cookies)).toBeNull();
  });
  it("空值 cookie 视为缺失", () => {
    expect(
      buildCookieString(
        [
          { name: "api-platform_serviceToken", value: "" },
          { name: "userId", value: "<mock-user-id>" },
        ],
        MIMO_AUTH.required_cookies,
      ),
    ).toBeNull();
  });

  // L4 缺陷#2(comment 2010): known/required 分层拼装
  it("known 分层: required 两项 + known 已存在的附加令牌全带, known 缺失不阻断", () => {
    const out = buildCookieString(
      [
        { name: "api-platform_serviceToken", value: "<mock-token>" },
        { name: "userId", value: "<mock-user-id>" },
        { name: "api-platform_ph", value: "<mock-ph>" },
        // api-platform_slh 缺失: 不阻断就绪, 只是不带
      ],
      MIMO_AUTH_L4.required_cookies,
      MIMO_AUTH_L4.known_cookies,
    );
    expect(out).toBe(
      "api-platform_serviceToken=<mock-token>; userId=<mock-user-id>; api-platform_ph=<mock-ph>",
    );
  });

  it("known 分层: 四项全在 → 按 known 声明序全发(CodexBar 实证形态)", () => {
    const out = buildCookieString(
      [
        { name: "api-platform_slh", value: "<mock-slh>" },
        { name: "userId", value: "<mock-user-id>" },
        { name: "api-platform_ph", value: "<mock-ph>" },
        { name: "api-platform_serviceToken", value: "<mock-token>" },
        { name: "unrelated", value: "ignored" },
      ],
      MIMO_AUTH_L4.required_cookies,
      MIMO_AUTH_L4.known_cookies,
    );
    // 顺序 = required 声明序在前 + known 声明序补余, 与 set-cookie 顺序无关
    expect(out).toBe(
      "api-platform_serviceToken=<mock-token>; userId=<mock-user-id>; api-platform_ph=<mock-ph>; api-platform_slh=<mock-slh>",
    );
  });

  it("known 缺省(未声明) = 等价 required, 既有通道零回归", () => {
    const out = buildCookieString(
      [
        { name: "api-platform_serviceToken", value: "<mock-token>" },
        { name: "userId", value: "<mock-user-id>" },
        { name: "api-platform_ph", value: "<ignored-without-known>" },
      ],
      MIMO_AUTH.required_cookies,
    );
    expect(out).toBe("api-platform_serviceToken=<mock-token>; userId=<mock-user-id>");
  });
});

describe("startWebSessionAuth(授权流全链路)", () => {
  it("成功出口: 目标域两 cookie 就绪 → 拼装落盘 → 关窗 → ok+saved", async () => {
    const h = makeHarness();
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-1",
      auth: MIMO_AUTH,
      saveSecret: (svc, key, value) => {
        h.saved.set(`${svc}:${key}`, value);
        return Promise.resolve();
      },
      secretKey: "inst-1:web_session",
      pollMs: 10,
    });
    // 开窗加载 login_url
    expect(h.createdUrls).toEqual([MIMO_AUTH.login_url]);
    // 首轮轮询: 未就绪 → 继续等
    await vi.advanceTimersByTimeAsync(15);
    expect(h.saved.size).toBe(0);
    // SSO 落 cookie → 下一轮就绪
    h.session.setCookie("api-platform_serviceToken", "<mock-token>");
    h.session.setCookie("userId", "<mock-user-id>");
    await vi.advanceTimersByTimeAsync(15);
    const res = await p;
    expect(res).toEqual({ ok: true, saved: true });
    expect(h.saved.get("token-wallet:inst-1:web_session")).toBe(
      "api-platform_serviceToken=<mock-token>; userId=<mock-user-id>",
    );
    // 关窗: 成功出口自动 destroy
    expect(h.win.win.destroy).toHaveBeenCalled();
    expect(webSessionAuthCount()).toBe(0);
  });

  it("取消出口: 用户手动关窗(closed) → 静默取消(不落盘, cancelled=true, 无 error message)", async () => {
    const h = makeHarness();
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-2",
      auth: MIMO_AUTH,
      saveSecret: () => Promise.resolve(),
      secretKey: "inst-2:web_session",
      pollMs: 10,
    });
    await vi.advanceTimersByTimeAsync(15);
    h.win.fireClosed(); // 用户点 × 关窗
    const res = await p;
    expect(res).toEqual({ ok: false, saved: false, cancelled: true });
    expect(h.saved.size).toBe(0);
  });

  it("超时出口: 超时未就绪 → message=授权超时, 关窗, 不落盘", async () => {
    const h = makeHarness();
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-3",
      auth: MIMO_AUTH,
      saveSecret: () => Promise.resolve(),
      secretKey: "inst-3:web_session",
      timeoutMs: 50,
      pollMs: 10,
    });
    await vi.advanceTimersByTimeAsync(60);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.saved).toBe(false);
    expect(res.cancelled).toBeUndefined();
    expect(res.message).toContain("授权超时");
    expect(h.win.win.destroy).toHaveBeenCalled();
    expect(h.saved.size).toBe(0);
  });

  it("落盘失败 → 显式错误出口(message 不含 cookie 值), 关窗", async () => {
    const h = makeHarness();
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-4",
      auth: MIMO_AUTH,
      saveSecret: () => Promise.reject(new Error("safeStorage 不可用")),
      secretKey: "inst-4:web_session",
      pollMs: 10,
    });
    h.session.setCookie("api-platform_serviceToken", "<mock-token>");
    h.session.setCookie("userId", "<mock-user-id>");
    await vi.advanceTimersByTimeAsync(15);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.saved).toBe(false);
    expect(res.message).toContain("落盘失败");
    expect(res.message).not.toContain("<mock-token>"); // cookie 值禁进错误信息
  });

  it("防多开: 同实例重复 start 复用同一 promise(单例窗)", async () => {
    const h = makeHarness();
    let created = 0;
    h.shims.createWindow = (url) => {
      created += 1;
      h.createdUrls.push(url);
      return h.win.win;
    };
    const p1 = startWebSessionAuth(h.shims, {
      instanceId: "inst-5",
      auth: MIMO_AUTH,
      saveSecret: () => Promise.resolve(),
      secretKey: "inst-5:web_session",
      pollMs: 10,
    });
    const p2 = startWebSessionAuth(h.shims, {
      instanceId: "inst-5",
      auth: MIMO_AUTH,
      saveSecret: () => Promise.resolve(),
      secretKey: "inst-5:web_session",
      pollMs: 10,
    });
    expect(created).toBe(1); // 只开一扇窗
    expect(webSessionAuthCount()).toBe(1);
    h.session.setCookie("api-platform_serviceToken", "<mock-token>");
    h.session.setCookie("userId", "<mock-user-id>");
    await vi.advanceTimersByTimeAsync(15);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(r1.ok).toBe(true);
  });

  it("cancelWebSessionAuth: 在途会话经 cancel → 关窗走静默取消出口", async () => {
    const h = makeHarness();
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-6",
      auth: MIMO_AUTH,
      saveSecret: () => Promise.resolve(),
      secretKey: "inst-6:web_session",
      pollMs: 10,
    });
    await vi.advanceTimersByTimeAsync(5);
    cancelWebSessionAuth("inst-6");
    const res = await p;
    expect(res).toEqual({ ok: false, saved: false, cancelled: true });
    expect(h.win.win.destroy).toHaveBeenCalled();
  });

  it("域锁: 只读目标域 cookie(其它域 cookie 不参与拼装)", async () => {
    const h = makeHarness();
    // 预置一个「其它域」的同名 cookie(应被过滤)
    h.session.cookies.get = ((filter: { domain?: string }) => {
      const all = [
        { name: "api-platform_serviceToken", value: "<evil-third-party>", domain: "evil.example.com" },
      ];
      return all.filter((c) => (filter.domain ? c.domain.endsWith(filter.domain) : true));
    }) as Harness["session"]["cookies"]["get"];
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-7",
      auth: MIMO_AUTH,
      saveSecret: (svc, key, value) => {
        h.saved.set(`${svc}:${key}`, value);
        return Promise.resolve();
      },
      secretKey: "inst-7:web_session",
      timeoutMs: 60,
      pollMs: 10,
    });
    await vi.advanceTimersByTimeAsync(70);
    const res = await p;
    // 第三方域同名 cookie 不构成目标域就绪 → 走超时, 不落盘(域锁不外发)
    expect(res.ok).toBe(false);
    expect(h.saved.size).toBe(0);
  });

  // L4 缺陷#2(comment 2010): cookie 种在父域(.xiaomimimo.com) → 单查 platform 子域
  // 永不命中(L4 实锤卡点); 双域扩查 + known 分层后命中并全发。
  it("父域 cookie: 双域扩查命中 → known 四项全发落盘(L4 实锤回归)", async () => {
    const h = makeHarness();
    // stub get 用 endsWith 模拟 Electron domain 过滤语义:
    // .xiaomimimo.com 父域 cookie 不命中 platform.xiaomimimo.com 查询, 命中 xiaomimimo.com 查询
    h.session.cookies.get = ((filter: { domain?: string }) => {
      const all = [
        { name: "api-platform_serviceToken", value: "<mock-token>", domain: ".xiaomimimo.com" },
        { name: "userId", value: "<mock-user-id>", domain: ".xiaomimimo.com" },
        { name: "api-platform_ph", value: "<mock-ph>", domain: ".xiaomimimo.com" },
        { name: "api-platform_slh", value: "<mock-slh>", domain: ".xiaomimimo.com" },
      ];
      return all.filter((c) => (filter.domain ? c.domain.endsWith(filter.domain) : true));
    }) as Harness["session"]["cookies"]["get"];
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-8",
      auth: MIMO_AUTH_L4,
      saveSecret: (svc, key, value) => {
        h.saved.set(`${svc}:${key}`, value);
        return Promise.resolve();
      },
      secretKey: "inst-8:web_session",
      pollMs: 10,
    });
    await vi.advanceTimersByTimeAsync(15);
    const res = await p;
    expect(res).toEqual({ ok: true, saved: true });
    // known 四项全发(required 判就绪 + ph/slh 随发, CodexBar 实证形态)
    expect(h.saved.get("token-wallet:inst-8:web_session")).toBe(
      "api-platform_serviceToken=<mock-token>; userId=<mock-user-id>; api-platform_ph=<mock-ph>; api-platform_slh=<mock-slh>",
    );
  });
});

/**
 * t_bc344087 ①: 首探前置 —— 有现成 cookie 就不开窗。
 * 真机反馈(用户 9/27): defaultSession 持久化后已登录用户点「重新授权」必命中现成 cookie,
 * 原实现先 createWindow/showWindow 再同步首探 → 窗口必闪一次才被成功出口关掉。
 */
describe("t_bc344087 ① 首探前置(有现成 cookie 不开窗)", () => {
  it("现成 cookie 命中 → 零窗口 + 直接成功出口(createWindow/destroy 未调用)", async () => {
    const h = makeHarness();
    h.session.setCookie("api-platform_serviceToken", "<mock-token>");
    h.session.setCookie("userId", "<mock-user-id>");
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-pre-1",
      auth: MIMO_AUTH,
      saveSecret: (svc, key, value) => {
        h.saved.set(`${svc}:${key}`, value);
        return Promise.resolve();
      },
      secretKey: "inst-pre-1:web_session",
      pollMs: 10,
    });
    const res = await p;
    expect(res).toEqual({ ok: true, saved: true });
    expect(h.createdUrls).toEqual([]); // 不开授权窗
    expect(h.win.win.destroy).not.toHaveBeenCalled();
    expect(h.saved.get("token-wallet:inst-pre-1:web_session")).toBe(
      "api-platform_serviceToken=<mock-token>; userId=<mock-user-id>",
    );
    expect(webSessionAuthCount()).toBe(0);
  });

  it("现成 cookie 但落盘失败 → 显式错误出口(仍不开窗)", async () => {
    const h = makeHarness();
    h.session.setCookie("api-platform_serviceToken", "<mock-token>");
    h.session.setCookie("userId", "<mock-user-id>");
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-pre-2",
      auth: MIMO_AUTH,
      saveSecret: () => Promise.reject(new Error("safeStorage 不可用")),
      secretKey: "inst-pre-2:web_session",
      pollMs: 10,
    });
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.saved).toBe(false);
    expect(res.message).toContain("落盘失败");
    expect(h.createdUrls).toEqual([]);
  });

  it("未命中 → 照旧开窗轮询(既有路径), cookie 落地即成功出口", async () => {
    const h = makeHarness();
    const p = startWebSessionAuth(h.shims, {
      instanceId: "inst-pre-3",
      auth: MIMO_AUTH,
      saveSecret: (svc, key, value) => {
        h.saved.set(`${svc}:${key}`, value);
        return Promise.resolve();
      },
      secretKey: "inst-pre-3:web_session",
      pollMs: 10,
    });
    // 首探未命中 → 才开窗(既有行为)
    expect(h.createdUrls).toEqual([MIMO_AUTH.login_url]);
    await vi.advanceTimersByTimeAsync(15);
    expect(h.saved.size).toBe(0);
    h.session.setCookie("api-platform_serviceToken", "<mock-token>");
    h.session.setCookie("userId", "<mock-user-id>");
    await vi.advanceTimersByTimeAsync(15);
    const res = await p;
    expect(res).toEqual({ ok: true, saved: true });
    expect(h.win.win.destroy).toHaveBeenCalled();
  });
});
