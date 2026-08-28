/**
 * mock 通道目录 — DESIGN.md §5 预置通道(两层模型 platform → product, D-025)
 *
 * 本卡(P0-4)用 mock 通道数据渲染设置页树形通道选择器 + 动态表单。
 * 通道是预制代码, 录入只是填参数(D-017); 每种平台是一个预置通道。
 * 真实通道随适配器落地逐版加入(见 core presets.ts)。
 */

/** params_schema 字段类型(D-017 §5.0): secret 用密码框且不回显 */
export const PARAM_TYPES = ["secret", "text", "number", "boolean"] as const;
export type ParamFieldType = (typeof PARAM_TYPES)[number];

export interface MockParamField {
  key: string;
  label: string;
  type: ParamFieldType;
  required: boolean;
  /** 输入提示 */
  help?: string;
  /** 非 secret 字段默认值 */
  default?: string | number | boolean;
}

export interface MockChannelDescriptor {
  /** 平台标识(第一层) */
  platform: string;
  platform_display_name: string;
  /** 产品标识(第二层) */
  product: string;
  product_display_name: string;
  /** 全路径 "platform/product" */
  channel: string;
  /** 面板展示名 */
  display_name: string;
  plan_type: "balance" | "window" | "local";
  adapter: "http" | "command" | "local-agent";
  logo: string;
  params_schema: MockParamField[];
  /** command 类健康检查(§5.0) */
  health_check?: { command: string; setup_hint: string };
}

// ─────────────────────────────────────────────────────────────
// 预置目录(镜像 DESIGN.md §5 channel tree)
// ─────────────────────────────────────────────────────────────

export const MOCK_CHANNELS: readonly MockChannelDescriptor[] = [
  {
    platform: "deepseek",
    platform_display_name: "DeepSeek",
    product: "balance",
    product_display_name: "按量",
    channel: "deepseek/balance",
    display_name: "DeepSeek 按量",
    plan_type: "balance",
    adapter: "http",
    logo: "deepseek",
    params_schema: [
      { key: "api_key", label: "API Key", type: "secret", required: true, help: "platform.deepseek.com → API Keys" },
    ],
  },
  {
    platform: "kimi",
    platform_display_name: "Kimi",
    product: "kimi-code",
    product_display_name: "Coding",
    channel: "kimi/kimi-code",
    display_name: "Kimi Code",
    plan_type: "window",
    adapter: "http",
    logo: "kimi",
    params_schema: [
      { key: "api_key", label: "API Key", type: "secret", required: true, help: "platform.moonshot.cn → 开放平台" },
    ],
  },
  {
    platform: "kimi",
    platform_display_name: "Kimi",
    product: "kimi-platform",
    product_display_name: "开放平台",
    channel: "kimi/kimi-platform",
    display_name: "Kimi 开放平台",
    plan_type: "balance",
    adapter: "http",
    logo: "kimi",
    params_schema: [
      { key: "api_key", label: "API Key", type: "secret", required: true },
    ],
  },
  {
    platform: "aliyun",
    platform_display_name: "阿里云",
    product: "bailian",
    product_display_name: "百炼",
    channel: "aliyun/bailian",
    display_name: "百炼 Token Plan",
    plan_type: "window",
    adapter: "command",
    logo: "aliyun",
    params_schema: [
      { key: "api_key", label: "API Key", type: "secret", required: false, help: "可选, 探针模式用" },
      { key: "region", label: "Region", type: "text", required: false, default: "cn-beijing" },
    ],
    health_check: { command: "bl auth status", setup_hint: "bl auth login --console" },
  },
  {
    platform: "volcengine",
    platform_display_name: "火山方舟",
    product: "ark",
    product_display_name: "方舟 Coding",
    channel: "volcengine/ark",
    display_name: "方舟-Coding",
    plan_type: "window",
    adapter: "command",
    logo: "volcengine",
    params_schema: [],
    health_check: { command: "arkcli auth status", setup_hint: "arkcli auth login --no-browser" },
  },
  {
    platform: "opencode",
    platform_display_name: "OpenCode",
    product: "go",
    product_display_name: "Go Coding",
    channel: "opencode/go",
    display_name: "opencode-Go",
    plan_type: "window",
    adapter: "http",
    logo: "opencode",
    params_schema: [
      { key: "api_key", label: "API Key", type: "secret", required: true },
    ],
  },
];

/** 平台列表(去重, 供树形选择器第一层) */
export function listPlatforms(): {
  platform: string;
  platform_display_name: string;
  products: MockChannelDescriptor[];
}[] {
  const map = new Map<string, { platform: string; platform_display_name: string; products: MockChannelDescriptor[] }>();
  for (const d of MOCK_CHANNELS) {
    let entry = map.get(d.platform);
    if (!entry) {
      entry = { platform: d.platform, platform_display_name: d.platform_display_name, products: [] };
      map.set(d.platform, entry);
    }
    entry.products.push(d);
  }
  return [...map.values()];
}

/** 按全路径 "platform/product" 查找通道 */
export function findChannel(channel: string): MockChannelDescriptor | undefined {
  return MOCK_CHANNELS.find((d) => d.channel === channel);
}