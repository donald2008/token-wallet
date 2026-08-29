/**
 * kimi/coding 真实通道 — DESIGN.md §5.2 (2026-08-29 L3 实测)
 *
 * T3 `GET https://api.kimi.com/coding/v1/usages` 已实测(非官方接口, 可能变动,
 * golden sample 防变更):
 * ```json
 * {"user":{"userId":"<redacted>","region":"REGION_CN","membership":{"level":"LEVEL_INTERMEDIATE"}},
 *  "limited":true,
 *  "usage":{"limit":"100","used":"71","remaining":"29","resetTime":"2026-09-04T01:21:10.687248Z"},
 *  "limits":[{"window":{"duration":300,"timeUnit":"TIME_UNIT_MINUTE"},
 *             "detail":{"limit":"100","used":"100","resetTime":"2026-08-29T09:21:10.687248Z"}}],
 *  ...}
 * ```
 * 特征: 双窗口(usage 主窗 resetTime≈7 天后 + limits[0] 5 小时窗)、数值是字符串需 number pipe、
 * limited:true 表示当前受限、boosterWallet 是禁用状态的余额钱包(本卡不纳入, 记 P2)。
 * 主窗窗口周期文档未明确(实测 resetTime 距约 6 天, 推断 7 天窗) —— fixture 注释记录该不确定性。
 * 纯声明式(零代码): GenericHttpAdapter + GenericHttpMapping, 无 eval/无脚本。
 */
import type { GenericHttpMapping } from "../generic-http.js";
import { KIMI_CODING } from "./presets.js";

/** kimi/coding 的声明式 HTTP 映射(§5.1: 一次请求 + 静态映射) */
export const KIMI_CODING_MAPPING: GenericHttpMapping = {
  url: "https://api.kimi.com/coding/v1/usages",
  method: "GET",
  headers: {
    Authorization: "Bearer {{api_key}}",
    Accept: "application/json",
  },
  auth_expired_status: [401, 403],
  metrics: [
    {
      key: "rolling_5h",
      kind: "window",
      unit: "percent",
      used: { path: "$.limits[0].detail.used", pipes: ["number"] },
      limit: { path: "$.limits[0].detail.limit", pipes: ["number"] },
      reset_at: { path: "$.limits[0].detail.resetTime", pipes: ["iso_epoch"] },
    },
    {
      key: "weekly",
      kind: "window",
      unit: "percent",
      used: { path: "$.usage.used", pipes: ["number"] },
      limit: { path: "$.usage.limit", pipes: ["number"] },
      reset_at: { path: "$.usage.resetTime", pipes: ["iso_epoch"] },
    },
  ],
};

export { KIMI_CODING };
