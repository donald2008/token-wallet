/**
 * minimax/token-plan 真实通道 — DESIGN.md §5.2 (2026-09-01 L3 实测)
 *
 * `GET https://api.minimaxi.com/v1/token_plan/remains`(国内区域; 国际 api.minimax.io 同
 * 路径但 key 不通用, cn key 报 2049) — Bearer Token Plan 订阅 key(`sk-cp-` 前缀):
 * ```json
 * {"model_remains":[
 *   {"model_name":"general","current_interval_total_count":0,"current_interval_usage_count":0,
 *    "current_interval_remaining_percent":99,"current_interval_status":1,
 *    "current_weekly_remaining_percent":98,"current_weekly_status":1,
 *    "weekly_start_time":1788105600000,"weekly_end_time":1788710400000,
 *    "remains_time":16044546,"weekly_remains_time":430044546},
 *   {"model_name":"video", ...}],
 *  "base_resp":{"status_code":0,"status_msg":"success"}}
 * ```
 * 特征:
 * - 双模型(general/video)各自 5h 窗 + 周窗; 主卡取 general(首个模型), video 不展开(记 P2)
 * - **percent 直给剩余**(`current_*_remaining_percent` 0-100, 不是已用) → used = 100 - remaining
 * - 时间戳毫秒(epoch-ms): remains_time/weekly_remains_time/start/end 全毫秒
 * - **HTTP 恒 200 业务码在 body**(zai 同款): base_resp.status_code 0=ok / 2049=invalid key
 *   判 auth_expired 必须用 body_code, 不能看 HTTP 状态码
 * 纯声明式(零代码): GenericHttpAdapter + GenericHttpMapping, 无 eval/无脚本。
 */
import type { GenericHttpMapping } from "../generic-http.js";
import { MINIMAX_TOKEN_PLAN } from "./presets.js";

/** minimax/token-plan 的声明式 HTTP 映射(§5.1: 一次请求 + 静态映射) */
export const MINIMAX_TOKEN_PLAN_MAPPING: GenericHttpMapping = {
  // 国内区域端点(cn key); 国际区 api.minimax.io 对 cn key 报 2049
  url: "https://api.minimaxi.com/v1/token_plan/remains",
  method: "GET",
  headers: {
    Authorization: "Bearer {{api_key}}",
    Accept: "application/json",
  },
  // HTTP 恒 200, auth 状态在 body.base_resp.status_code(zai 同款机制)
  body_code: {
    path: "$.base_resp.status_code",
    ok: [0],
    auth_expired: [2049],
  },
  setup_hint: "Token Plan Key 无效或已过期 — 请检查 platform.minimaxi.com 的订阅密钥并更新",
  metrics: [
    {
      // 5h 滚动窗: percent 直给剩余 → used=100-remaining; limit=100(percent 分母,
      // 2026-09-02 真机截图修: 缺 limit 时 ProgressBar 空条 + "4/—", 与 aliyun limit:100 同款)
      key: "rolling_5h",
      kind: "window",
      unit: "percent",
      // 取 general 模型(首个), video 记 P2
      used: { path: "$.model_remains[0].current_interval_remaining_percent", pipes: ["number", "invert_percent"] },
      remaining: { path: "$.model_remains[0].current_interval_remaining_percent", pipes: ["number"] },
      limit: { const: 100 },
      reset_at: { path: "$.model_remains[0].end_time", pipes: ["ms_epoch"] },
    },
    {
      // 周窗: 同上
      key: "weekly",
      kind: "window",
      unit: "percent",
      used: { path: "$.model_remains[0].current_weekly_remaining_percent", pipes: ["number", "invert_percent"] },
      remaining: { path: "$.model_remains[0].current_weekly_remaining_percent", pipes: ["number"] },
      limit: { const: 100 },
      reset_at: { path: "$.model_remains[0].weekly_end_time", pipes: ["ms_epoch"] },
    },
  ],
};

export { MINIMAX_TOKEN_PLAN };
