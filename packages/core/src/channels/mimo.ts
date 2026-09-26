/**
 * mimo/token-plan 真实通道 — t_4ad1c22e, D-058(web_session 第三凭据范式首个落地)
 *
 * ⚠️ 契约来源声明(二手风险): 以下端点/字段契约来自 CodexBar Swift 实现
 * (`MiMoUsageFetcher.swift`)逐字段实证, 未经我们真 cookie 实测。
 * golden fixtures 按此构造; 真机验收字段不符时以真实响应修正映射并回写任务卡 comment。
 *
 * Base: `https://platform.xiaomimimo.com/api/v1`(统一域, 无 region)。凭据 =
 * 小米账号 SSO 会话 cookie(两必需: `api-platform_serviceToken` + `userId`),
 * 无 tp- key 查询端点(tp 网关 /v1/usage 等 404 实锤, 官方 issue #2495 未解决)。
 *
 * 三端点并发拉取(组合器 best-effort: balance 主端点, tokenPlan 两端点失败不阻塞):
 * ```
 * GET /balance          → {code:0, data:{balance:"25.51", currency:"CNY",
 *                                     cashBalance?, giftBalance?}}   金额是字符串
 * GET /tokenPlan/detail → {code:0, data:{planCode?, currentPeriodEnd?, expired}}
 *                          currentPeriodEnd = "yyyy-MM-dd HH:mm:ss"(UTC, 非 ISO T 分隔)
 * GET /tokenPlan/usage  → {code:0, data:{monthUsage:{percent, items:[{name, used,
 *                                     limit, percent(0-1!)}]}}}        items[0]
 * ```
 *
 * 错误语义(D-058): HTTP 3xx(被重定向去登录)/401/403/body code 401|403 → auth_expired;
 * code:0 才为 ok。metric 聚合(声明式 patches 字段直拷, 见 ../web-session.ts):
 * monthly_credits.used/limit ← usage 端点 items[0], reset_at ← detail 端点
 * currentPeriodEnd(iso_epoch 管道容忍空格分隔 UTC, 无需新时间管道)。
 * 公共请求头(Accept-Language/x-timeZone/Origin/Referer/UA)按契约写死。
 * 纯声明式(零 MiMo 专用解析代码): GenericHttpMapping 映射表 + WebSessionCompositeAdapter。
 */
import type { GenericHttpMapping } from "../generic-http.js";
import { WebSessionCompositeAdapter, type WebSessionChannelSpec } from "../web-session.js";
import { MIMO_TOKEN_PLAN } from "./presets.js";

/** 公共请求头(CodexBar 契约写死; Cookie 头由组合器注入, 不在此声明) */
const MIMO_BASE_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "x-timeZone": "UTC+01:00",
  Origin: "https://platform.xiaomimimo.com",
  Referer: "https://platform.xiaomimimo.com/#/console/balance",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
};

const MIMO_BASE = "https://platform.xiaomimimo.com/api/v1";

/** 通用端点判态: HTTP 3xx(登录重定向)/401/403 + body code 401|403 → auth_expired; code:0 才 ok */
function mimoEndpointMapping(url: string, metrics: GenericHttpMapping["metrics"]): GenericHttpMapping {
  return {
    url,
    method: "GET",
    headers: MIMO_BASE_HEADERS,
    // 3xx = 被重定向去登录(D-058 会话失效第三形态, 组合器 redirectAware 转判)
    auth_expired_status: [301, 302, 303, 307, 308, 401, 403],
    body_code: {
      path: "$.code",
      ok: [0],
      auth_expired: [401, 403],
    },
    setup_hint: "登录会话已失效 — 请重新登录 platform.xiaomimimo.com 并更新会话 Cookie",
    metrics,
  };
}

/** GET /balance — 主端点: 余额(字符串金额 → number 管道; cash/gift 可选) */
const MIMO_BALANCE_MAPPING = mimoEndpointMapping(`${MIMO_BASE}/balance`, [
  {
    key: "balance",
    kind: "balance",
    unit: "cny",
    // 金额是字符串("25.51")→ number 管道换算(契约 §三端点表)
    used: { path: "$.data.balance", pipes: ["number"] },
    remaining: { path: "$.data.balance", pipes: ["number"] },
    currency: { path: "$.data.currency", pipes: ["string"] },
    granted: { path: "$.data.giftBalance", pipes: ["number"] },
    topped_up: { path: "$.data.cashBalance", pipes: ["number"] },
  },
]);

/** GET /tokenPlan/detail — monthly_credits 骨架(reset_at 数据源: currentPeriodEnd UTC) */
const MIMO_TOKEN_PLAN_DETAIL_MAPPING = mimoEndpointMapping(`${MIMO_BASE}/tokenPlan/detail`, [
  {
    key: "monthly_credits",
    kind: "window",
    unit: "credits",
    // used/limit 骨架占位: 聚合时由 usage 端点 patches 覆写
    used: { const: 0 },
    limit: { const: 0 },
    // "yyyy-MM-dd HH:mm:ss"(UTC, 空格分隔)—— iso_epoch 管道正则容忍 `[T ]` 分隔
    reset_at: { path: "$.data.currentPeriodEnd", pipes: ["iso_epoch"] },
    // 套餐元信息(t_7672da28, 卡面③副行数据源): 取不到 = 缺席, 禁 const 假值兜底
    plan_code: { path: "$.data.planCode", pipes: ["string"] },
    // expired 无 boolean 管道: 直取原始值后在 GenericHttpAdapter 内按 boolean 收窄
    expired: { path: "$.data.expired" },
  },
]);

/** GET /tokenPlan/usage — monthly_credits 真值(items[0].used/limit, 卡面契约原样) */
const MIMO_TOKEN_PLAN_USAGE_MAPPING = mimoEndpointMapping(`${MIMO_BASE}/tokenPlan/usage`, [
  {
    key: "monthly_credits",
    kind: "window",
    unit: "credits",
    // 卡面契约: used=items[0].used / limit=items[0].limit(int 计数, 非百分比)
    // (round-1 P2-1: percent×100/const 100 形态偏离契约已废弃)
    used: { path: "$.data.monthUsage.items[0].used", pipes: ["number"] },
    limit: { path: "$.data.monthUsage.items[0].limit", pipes: ["number"] },
  },
]);

/**
 * mimo/token-plan 的 web_session 通道声明(D-058: 声明式注册, 零专用代码路径)。
 * 下一家 cookie 平台 = 照本 spec 换域/cookie/映射表。
 */
export const MIMO_WEB_SESSION_SPEC: WebSessionChannelSpec = {
  endpoints: [
    { name: "balance", mapping: MIMO_BALANCE_MAPPING },
    { name: "tokenPlan/detail", mapping: MIMO_TOKEN_PLAN_DETAIL_MAPPING },
    { name: "tokenPlan/usage", mapping: MIMO_TOKEN_PLAN_USAGE_MAPPING },
  ],
  primary: "balance",
  patches: [
    // monthly_credits.used/limit = usage 端点 items[0] 计数(卡面契约, int credits)
    { key: "monthly_credits", field: "used", endpoint: "tokenPlan/usage", sourceKey: "monthly_credits", sourceField: "used" },
    { key: "monthly_credits", field: "limit", endpoint: "tokenPlan/usage", sourceKey: "monthly_credits", sourceField: "limit" },
    // reset_at = detail 端点 currentPeriodEnd(UTC → unix 秒已在 iso_epoch 完成)
    { key: "monthly_credits", field: "reset_at", endpoint: "tokenPlan/detail", sourceKey: "monthly_credits", sourceField: "reset_at" },
    // 套餐元信息(t_7672da28): detail 端点 planCode/expired 同源直拷(单一 patches 机制)
    { key: "monthly_credits", field: "plan_code", endpoint: "tokenPlan/detail", sourceKey: "monthly_credits", sourceField: "plan_code" },
    { key: "monthly_credits", field: "expired", endpoint: "tokenPlan/detail", sourceKey: "monthly_credits", sourceField: "expired" },
  ],
  setup_hint: "登录会话已失效 — 请重新登录 platform.xiaomimimo.com 并更新会话 Cookie",
};

/** 便捷工厂: 从 spec 构造组合适配器(测试/引擎装配共用) */
export function mimoCompositeAdapter(fetchImpl: typeof fetch = fetch): WebSessionCompositeAdapter {
  return new WebSessionCompositeAdapter(MIMO_WEB_SESSION_SPEC, fetchImpl);
}

/**
 * CHANNEL_MAPPINGS 注册面: mimo 通道在映射表登记的 http 数据面声明 =
 * 主端点(balance)映射(注册完整性不变量消费: 该键存在即「通道已接」)。
 * 实际采集由 WebSessionCompositeAdapter 按 spec 三端点并发, 禁拿本映射单请求采集。
 */
export const MIMO_TOKEN_PLAN_MAPPING = MIMO_BALANCE_MAPPING;

export { MIMO_TOKEN_PLAN, MIMO_BASE as MIMO_API_BASE };
