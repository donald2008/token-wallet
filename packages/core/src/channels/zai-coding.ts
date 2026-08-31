/**
 * zai/coding 真实通道 — 智谱 GLM Coding Plan(D-045, 2026-08-30 L3 实测)
 *
 * T `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` 已实测,
 * Bearer 套餐 key(与 coding 推理 key 同一个, Consul ai-hermes/security/providers/zai-key):
 * ```json
 * {"code":200,"msg":"操作成功",
 *  "data":{"limits":[
 *    {"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":2000,"currentValue":377,
 *     "remaining":1622,"percentage":18,"nextResetTime":1788192250348},
 *    {"type":"CREDIT_LIMIT","unit":6,"number":1,"usage":10000,"currentValue":6837,
 *     "remaining":3162,"percentage":68,"nextResetTime":1788578665998}],
 *  "level":"lite"},"success":true}
 * ```
 * 特征:
 * - **双窗口绝对值制**: `limits[]` 按 unit+number 区分窗 —— unit:3,number:5 = 5h 窗,
 *   unit:6,number:1 = 周窗; **used/limit 绝对值直接给**(currentValue/usage), 不是 0-1 小数,
 *   不需要 ×100(区别于 aliyun per1WeekPercentage); remaining/percentage 服务端已算好, 不取。
 * - **nextResetTime 是毫秒 epoch**(1788192250348), 不是 ISO —— 走新 `ms_epoch` 管道 /1000。
 * - **⚠️ HTTP 恒 200, auth 状态在 body.code**: 401=key 坏/过期 / 1001=缺头 / 200=成功。
 *   判 auth_expired **不能看 HTTP 状态码**, 走 GenericHttpMapping.body_code(本通道新扩展)。
 * - `level: lite` = 套餐等级(当前不展示, 记 P2)。
 * 纯声明式(零代码): GenericHttpAdapter + GenericHttpMapping, 无 eval/无脚本。
 */
import type { GenericHttpMapping } from "../generic-http.js";
import { ZAI_CODING } from "./presets.js";

/** zai/coding 的声明式 HTTP 映射(§5.1: 一次请求 + 静态映射) */
export const ZAI_CODING_MAPPING: GenericHttpMapping = {
  url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
  method: "GET",
  headers: {
    Authorization: "Bearer {{api_key}}",
    Accept: "application/json",
  },
  // ⚠️ HTTP 恒 200, 不设 auth_expired_status(HTTP 判不了); auth 状态在 body.code
  // body_code 判态: 200=ok / 401=auth_expired(带 setup_hint) / 其他(如1001缺头)=error
  body_code: {
    path: "$.code",
    ok: [200],
    auth_expired: [401],
  },
  // auth_expired 卡片的修复指引(复制钮语义, §5.0)
  setup_hint: "运行 `curl -s https://open.bigmodel.cn/api/monitor/usage/quota/limit -H \"Authorization: Bearer <key>\"` 验证 key, 失效则到 bigmodel.cn → API Keys 重新生成",
  metrics: [
    {
      // unit:3,number:5 = 5h 滚动窗(黄金 sample 顺序 limits[0])
      key: "rolling_5h",
      kind: "window",
      unit: "credits",
      used: { path: "$.data.limits[0].currentValue" },
      limit: { path: "$.data.limits[0].usage" },
      reset_at: { path: "$.data.limits[0].nextResetTime", pipes: ["ms_epoch"] },
    },
    {
      // unit:6,number:1 = 周窗(黄金 sample 顺序 limits[1])
      key: "weekly",
      kind: "window",
      unit: "credits",
      used: { path: "$.data.limits[1].currentValue" },
      limit: { path: "$.data.limits[1].usage" },
      reset_at: { path: "$.data.limits[1].nextResetTime", pipes: ["ms_epoch"] },
    },
  ],
};

export { ZAI_CODING };