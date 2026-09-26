/**
 * 通道 → 声明式映射 注册表(§5.1)
 *
 * 与 PRESET_CHANNELS 配套: 设置页列出的每个通道都必须有真实映射,
 * 否则又出现"选得到但暂未接入"(本卡根因, D-036)。不变量由单测保证:
 * `PRESET_CHANNELS ⊆ Object.keys(CHANNEL_MAPPINGS)`。
 *
 * ⚠️ 值语义(t_4ad1c22e D-058 起): 本表条目是 **http 数据面声明**(GenericHttpMapping),
 * 与"采集实现"解耦——adapter=http 且 descriptor.auth.kind=web_session 的通道
 * (如 mimo/token-plan)由 WebSessionCompositeAdapter 消费(通道内有端点列表),
 * 其余条目仍由 GenericHttpAdapter 单请求消费。引擎/测试连接按 auth.kind 分流。
 */
import type { GenericHttpMapping } from "../generic-http.js";
import { DEEPSEEK_BALANCE_MAPPING } from "./deepseek.js";
import { OPENCODE_GO_MAPPING } from "./opencode.js";
import { KIMI_CODING_MAPPING } from "./kimi.js";
import { MINIMAX_TOKEN_PLAN_MAPPING } from "./minimax.js";
import { ZAI_CODING_MAPPING } from "./zai-coding.js";
import { MIMO_TOKEN_PLAN_MAPPING } from "./mimo.js";

export const CHANNEL_MAPPINGS: Readonly<Record<string, GenericHttpMapping>> = {
  "deepseek/balance": DEEPSEEK_BALANCE_MAPPING,
  "opencode/go": OPENCODE_GO_MAPPING,
  "kimi/coding": KIMI_CODING_MAPPING,
  "minimax/token-plan": MINIMAX_TOKEN_PLAN_MAPPING,
  "zai/coding": ZAI_CODING_MAPPING,
  "mimo/token-plan": MIMO_TOKEN_PLAN_MAPPING,
};
