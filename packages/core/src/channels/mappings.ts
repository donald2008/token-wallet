/**
 * 通道 → 声明式映射 注册表(§5.1)
 *
 * 与 PRESET_CHANNELS 配套: 设置页列出的每个通道都必须有真实映射,
 * 否则又出现"选得到但暂未接入"(本卡根因, D-036)。不变量由单测保证:
 * `PRESET_CHANNELS ⊆ Object.keys(CHANNEL_MAPPINGS)`。
 */
import type { GenericHttpMapping } from "../generic-http.js";
import { DEEPSEEK_BALANCE_MAPPING } from "./deepseek.js";
import { OPENCODE_GO_MAPPING } from "./opencode.js";
import { KIMI_CODING_MAPPING } from "./kimi.js";

export const CHANNEL_MAPPINGS: Readonly<Record<string, GenericHttpMapping>> = {
  "deepseek/balance": DEEPSEEK_BALANCE_MAPPING,
  "opencode/go": OPENCODE_GO_MAPPING,
  "kimi/coding": KIMI_CODING_MAPPING,
};
