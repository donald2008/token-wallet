/**
 * 预置通道目录 — DESIGN.md §5
 *
 * 本卡(P0-1)只预置 deepseek/balance 一个通道作样例; 其余平台随适配器落地逐版加入。
 */
import type { ChannelDescriptor } from "./descriptor.js";

/** DeepSeek 按量余额: http, GET /user/balance 已实测(§5.2) */
export const DEEPSEEK_BALANCE: ChannelDescriptor = {
  platform: "deepseek",
  product: "balance",
  channel: "deepseek/balance",
  display_name: "DeepSeek 按量",
  platform_display_name: "DeepSeek",
  plan_type: "balance",
  adapter: "http",
  logo: "deepseek",
  params_schema: [
    {
      key: "api_key",
      label: "API Key",
      type: "secret",
      required: true,
      help: "platform.deepseek.com → API Keys",
    },
  ],
};

export const PRESET_CHANNELS: readonly ChannelDescriptor[] = [DEEPSEEK_BALANCE];
