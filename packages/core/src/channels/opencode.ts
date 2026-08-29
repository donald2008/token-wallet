/**
 * opencode/go 真实通道 — DESIGN.md §5.2 (2026-08-29 L3 实测)
 *
 * T2 `GET https://opencode.ai/zen/go/v1/usage` 已实测:
 * ```json
 * {"usage":{
 *   "rolling": {"status":"ok",           "percent":0,   "resetsAt":"2026-08-29T13:26:59.879Z"},
 *   "weekly":  {"status":"rate-limited", "percent":100, "resetsAt":"2026-08-31T00:00:00.879Z"},
 *   "monthly": {"status":"ok",           "percent":48,  "resetsAt":"2026-09-25T06:07:28.879Z"}}}
 * ```
 * 特征: 三窗、只有 percent 没有绝对值(reset_at 由 resetsAt ISO 字符串 iso_epoch 转)、
 * 单窗口带自己的 status —— 注意**整卡不写 ok_assertions 断言单窗 status**:
 * weekly="rate-limited" 是单窗受限, 不是整卡故障; 由 metricHealth + bars"最紧窗口标红"
 * 自然判红(D-022 耗尽恒红), 若写成 `$.usage.weekly.status == 'ok'` 会丢掉另两窗健康信息。
 * 纯声明式(零代码): GenericHttpAdapter + GenericHttpMapping, 无 eval/无脚本。
 */
import type { GenericHttpMapping } from "../generic-http.js";
import { OPENCODE_GO } from "./presets.js";

/** opencode/go 的声明式 HTTP 映射(§5.1: 一次请求 + 静态映射) */
export const OPENCODE_GO_MAPPING: GenericHttpMapping = {
  url: "https://opencode.ai/zen/go/v1/usage",
  method: "GET",
  headers: {
    Authorization: "Bearer {{api_key}}",
    Accept: "application/json",
  },
  auth_expired_status: [401, 403],
  // ⚠️ 无 ok_assertions: 单窗 rate-limited 不污整卡(见文件头注释)
  metrics: [
    {
      key: "rolling_5h",
      kind: "window",
      unit: "percent",
      used: { path: "$.usage.rolling.percent" },
      // opencode 只给 percent 无绝对值 → limit 恒为 100 常量(FieldMapping.const)
      limit: { const: 100 },
      reset_at: { path: "$.usage.rolling.resetsAt", pipes: ["iso_epoch"] },
    },
    {
      key: "weekly",
      kind: "window",
      unit: "percent",
      used: { path: "$.usage.weekly.percent" },
      limit: { const: 100 },
      reset_at: { path: "$.usage.weekly.resetsAt", pipes: ["iso_epoch"] },
    },
    {
      key: "monthly",
      kind: "window",
      unit: "percent",
      used: { path: "$.usage.monthly.percent" },
      limit: { const: 100 },
      reset_at: { path: "$.usage.monthly.resetsAt", pipes: ["iso_epoch"] },
    },
  ],
};

export { OPENCODE_GO };
