/**
 * 预置通道目录 — DESIGN.md §5 (D-025 两层模型 platform → product)
 *
 * 单一真相源: 设置页通道树(app)与引擎采集(app engine)都从本目录读,
 * 禁止 app 侧再维护 mock 通道树(双源不一致根因, 见 DECISIONS.md D-036)。
 * 新增通道 = 描述符进 PRESET_CHANNELS + 映射进 CHANNEL_MAPPINGS(见 mappings.ts)。
 */
import type { ChannelDescriptor } from "./descriptor.js";

/** DeepSeek 按量余额: http, GET /user/balance 已实测(§5.2) */
export const DEEPSEEK_BALANCE: ChannelDescriptor = {
  platform: "deepseek",
  product: "balance",
  channel: "deepseek/balance",
  display_name: "DeepSeek 按量",
  product_display_name: "按量",
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

/** opencode zen/go 窗口制: http, GET /zen/go/v1/usage 三窗已实测(2026-08-29 L3) */
export const OPENCODE_GO: ChannelDescriptor = {
  platform: "opencode",
  product: "go",
  channel: "opencode/go",
  display_name: "opencode Go",
  product_display_name: "Go Coding",
  platform_display_name: "opencode",
  plan_type: "window",
  adapter: "http",
  logo: "opencode",
  params_schema: [
    {
      key: "api_key",
      label: "API Key",
      type: "secret",
      required: true,
      help: "opencode.ai → 账户 Settings → API Keys(zen/go 套餐, 三窗: 5h/周/月)",
    },
  ],
};

/** kimi coding 窗口制: http, GET /coding/v1/usages 双窗已实测(2026-08-29 L3) */
export const KIMI_CODING: ChannelDescriptor = {
  platform: "kimi",
  product: "coding",
  channel: "kimi/coding",
  display_name: "Kimi Coding",
  product_display_name: "Coding",
  platform_display_name: "Kimi",
  plan_type: "window",
  adapter: "http",
  logo: "kimi",
  params_schema: [
    {
      key: "api_key",
      label: "API Key",
      type: "secret",
      required: true,
      help: "platform.moonshot.cn → 开放平台 → API Key(Coding 套餐)",
    },
  ],
};

export const PRESET_CHANNELS: readonly ChannelDescriptor[] = [
  DEEPSEEK_BALANCE,
  OPENCODE_GO,
  KIMI_CODING,
];

/** 按全路径 "platform/product" 查预置通道(通道树/引擎/测试连接共用) */
export function getPresetChannel(channel: string): ChannelDescriptor | undefined {
  return PRESET_CHANNELS.find((d) => d.channel === channel);
}
