/**
 * kimi/coding 真实通道 — DESIGN.md §5.2 (2026-08-29 L3 实测)
 *
 * T3 `GET https://api.kimi.com/coding/v1/usages` 已实测(非官方接口, 可能变动,
 * golden sample 防变更)。
 *
 * ⚠️ kimi 响应三形态(全部真 key 实测, t_be136794 收口):
 * | 形态                  | usage/detail 字段            | used    | remaining |
 * |-----------------------|------------------------------|---------|-----------|
 * | 健康有用量(8/29)      | limit/used/remaining/resetTime | "71"   | "29"      |
 * | 限流态(8/31)          | detail 缺 used               | 缺失    | "0"       |
 * | 周期重置后(9/18 实测) | 只剩 limit/remaining/resetTime | 缺失  | "100"     |
 *
 * → `remaining` 是唯一三形态恒存在的字段, used 一律由 remaining 反推
 *   (`invert_percent`: used = clamp(100 - remaining))。勿再映射 $.usage.used /
 *   $.limits[0].detail.used —— 重置期(占比不小的常态)整字段消失会炸整卡。
 * usages.limit_*.used_ratio(如 1.6e-05) 与 remaining 推导差 <0.01%, 展示层无感,
 * 不采用; limit 恒 "100"(三形态实测), kimi 将来出非 100 limit 再议, 不过度设计。
 *
 * 9/18 实测形态(周期重置后, 真 key):
 * ```json
 * {"usage":{"limit":"100","remaining":"100","resetTime":"2026-09-25T01:21:10.687248Z"},
 *  "limits":[{"window":{...},"detail":{"limit":"100","remaining":"100",
 *             "resetTime":"2026-09-18T09:21:10.687248Z"}}],
 *  "usages":{"limit_5h":{"used_ratio":1.6e-05,"reset_time":"..."},
 *            "limit_7d":{"used_ratio":3e-06,"reset_time":"..."}}, ...}
 * ```
 * 其他特征: 双窗口(usage 主窗 resetTime≈7 天后 + limits[0] 5 小时窗)、数值是
 * 字符串需 number pipe、limited:true 表示当前受限、boosterWallet 是禁用状态的
 * 余额钱包(本卡不纳入, 记 P2)。主窗窗口周期文档未明确(实测 resetTime 距约 6 天,
 * 推断 7 天窗) —— fixture 注释记录该不确定性。
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
      used: { path: "$.limits[0].detail.remaining", pipes: ["number", "invert_percent"] },
      limit: { path: "$.limits[0].detail.limit", pipes: ["number"] },
      reset_at: { path: "$.limits[0].detail.resetTime", pipes: ["iso_epoch"] },
    },
    {
      key: "weekly",
      kind: "window",
      unit: "percent",
      used: { path: "$.usage.remaining", pipes: ["number", "invert_percent"] },
      limit: { path: "$.usage.limit", pipes: ["number"] },
      reset_at: { path: "$.usage.resetTime", pipes: ["iso_epoch"] },
    },
  ],
};

export { KIMI_CODING };
