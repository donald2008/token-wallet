/**
 * deepseek/balance 真实通道 — DESIGN.md §5.2
 *
 * T1 官方 `GET https://api.deepseek.com/user/balance` 已实测(2026-08-28 L3):
 * ```json
 * {
 *   "is_available": true,
 *   "balance_infos": [
 *     { "currency": "CNY", "total_balance": "448.45",
 *       "granted_balance": "0.00", "topped_up_balance": "448.45" }
 *   ]
 * }
 * ```
 * 映射为 balance 原型快照: remaining=total_balance, granted/topped_up 拆分, currency。
 * 纯声明式(零代码): GenericHttpAdapter + GenericHttpMapping, 无 eval/无脚本。
 */
import type { GenericHttpMapping } from "../generic-http.js";
import { DEEPSEEK_BALANCE } from "./presets.js";

/** deepseek/balance 的声明式 HTTP 映射(§5.1: 一次请求 + 静态映射) */
export const DEEPSEEK_BALANCE_MAPPING: GenericHttpMapping = {
  url: "https://api.deepseek.com/user/balance",
  method: "GET",
  headers: {
    Authorization: "Bearer {{api_key}}",
    Accept: "application/json",
  },
  auth_expired_status: [401, 403],
  // 官方响应带 is_available 标记; false 说明余额不可用(如欠费), 断言拦截
  ok_assertions: ["$.is_available == true"],
  metrics: [
    {
      key: "balance",
      kind: "balance",
      unit: "cny",
      // used 语义兼容旧面板(limit-used 推导缺省路径用不上, remaining 优先)
      used: { path: "$.balance_infos[0].total_balance", pipes: ["number"] },
      remaining: { path: "$.balance_infos[0].total_balance", pipes: ["number"] },
      granted: { path: "$.balance_infos[0].granted_balance", pipes: ["number"] },
      topped_up: { path: "$.balance_infos[0].topped_up_balance", pipes: ["number"] },
      currency: { path: "$.balance_infos[0].currency", pipes: ["string"] },
    },
  ],
};

export { DEEPSEEK_BALANCE };
