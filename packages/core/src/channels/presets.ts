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

/**
 * MiniMax Token Plan(2026-09-01 L3 实测): http 通道, Bearer Token Plan 订阅 key(`sk-cp-` 前缀)。
 * 国内区域端点 api.minimaxi.com(cn key 在 api.minimax.io 报 2049)。双模型(general/video)
 * 各自 5h 窗+周窗, 主卡取 general(首个); HTTP 恒 200 业务码在 body(zai 同款)。
 */
export const MINIMAX_TOKEN_PLAN: ChannelDescriptor = {
  platform: "minimax",
  product: "token-plan",
  channel: "minimax/token-plan",
  display_name: "MiniMax Token Plan",
  product_display_name: "Token Plan",
  platform_display_name: "MiniMax",
  plan_type: "window",
  adapter: "http",
  logo: "minimax",
  params_schema: [
    {
      key: "api_key",
      label: "Token Plan Key",
      type: "secret",
      required: true,
      help: "platform.minimaxi.com → 账户 → Token Plan 订阅(密钥 sk-cp- 前缀)",
    },
  ],
};

/**
 * 阿里云百炼 Token Plan(个人版): command 类首实例(D-041, 2026-08-30)
 * bl CLI 包装, 控制台会话由 CLI 自管(~/.bailian/config.json), app 零凭据。
 * health_check 只判"从未配置", 会话死活由采集失败信号(D-041 源码结论)。
 */
export const ALIYUN_BAILIAN_TOKEN_PLAN: ChannelDescriptor = {
  platform: "aliyun-bailian",
  product: "token-plan",
  channel: "aliyun-bailian/token-plan",
  display_name: "阿里云百炼 / Token Plan",
  product_display_name: "Token Plan",
  platform_display_name: "阿里云百炼",
  plan_type: "window",
  adapter: "command",
  logo: "aliyun-bailian",
  // 零录入(D-041 决策): console 会话由 CLI 自管, app 不碰凭据文件
  params_schema: [],
  health_check: {
    command: "bl auth status --output json",
    setup_hint: "运行 `bl auth login --console` 重新授权(控制台会话由 CLI 管理)",
  },
};

/**
 * 火山方舟 Coding Plan(个人版): command 类第二实例(D-041 之后的 D-044, 2026-08-31)
 * arkcli 官方 CLI(@volcengine/ark-cli)包装, SSO 会话由 CLI 自管(volc-sso),
 * app 零凭据 → params_schema=[]。health_check 只判"从未配置"(auth status logged_in),
 * 会话死活由采集失败信号判定(D-041 源码结论同款)。
 */
export const VOLCENGINE_ARK_CODING_PLAN: ChannelDescriptor = {
  platform: "volcengine-ark",
  product: "coding-plan",
  channel: "volcengine-ark/coding-plan",
  display_name: "火山方舟 / Coding Plan",
  product_display_name: "Coding Plan",
  platform_display_name: "火山方舟",
  plan_type: "window",
  adapter: "command",
  logo: "volcengine-ark",
  // 零录入(D-041 决策): SSO 会话由 CLI 自管, app 不碰凭据文件
  params_schema: [],
  health_check: {
    command: "arkcli auth status --format json",
    setup_hint: "运行 `arkcli auth login volc-sso --no-browser` 重新授权(SSO 会话由 CLI 管理)",
  },
};

/**
 * 智谱 zai Coding Plan 窗口制: http, GET /api/monitor/usage/quota/limit 双窗已实测(2026-08-30 L3)。
 * ⚠️ HTTP 恒 200, auth 状态在 body.code —— 走 body_code 判态, 非 HTTP 状态码。
 */
export const ZAI_CODING: ChannelDescriptor = {
  platform: "zai",
  product: "coding",
  channel: "zai/coding",
  display_name: "智谱 GLM Coding Plan",
  product_display_name: "Coding Plan",
  platform_display_name: "智谱 bigmodel",
  plan_type: "window",
  adapter: "http",
  logo: "zai",
  params_schema: [
    {
      key: "api_key",
      label: "API Key",
      type: "secret",
      required: true,
      help: "bigmodel.cn → API Keys(Coding Plan 套餐 key, 与 coding 推理 key 同一个)",
    },
  ],
};

/**
 * 小米 MiMo Token Plan: web_session 第三凭据范式首实例(t_4ad1c22e, D-058)。
 * 无 tp- key 查询端点(404 实锤), 用量在控制台域走小米账号 SSO 会话 cookie。
 * auth 契约(cookie_domain/required_cookies/login_url)与三端点映射见 ./mimo.ts +
 * ../web-session.ts。params_schema 只有凭据 ref(cookie 串落 store=safeStorage 与 key 同级)。
 */
export const MIMO_TOKEN_PLAN: ChannelDescriptor = {
  platform: "mimo",
  product: "token-plan",
  channel: "mimo/token-plan",
  display_name: "小米 MiMo Token Plan",
  product_display_name: "Token Plan",
  platform_display_name: "小米 MiMo",
  plan_type: "window",
  adapter: "http",
  logo: "mimo",
  // D-058: web_session 第三凭据范式声明(auth 契约在描述符上, 组合器消费)
  auth: {
    kind: "web_session",
    cookie_domain: "platform.xiaomimimo.com",
    required_cookies: ["api-platform_serviceToken", "userId"],
    login_url: "https://platform.xiaomimimo.com/api/v1/genLoginUrl?currentPath=%2F%23%2Fconsole%2Fbalance",
    // L4 缺陷#2(comment 2010, 用户 DevTools 实测): 四 cookie Domain 全 = .xiaomimimo.com
    // 父域 —— Electron cookies.get 的 domain 过滤器不匹配父域, 就绪检测必须双域扩查。
    // ⚠️ 查询域 ≠ 发送域: 数据面仍只发 cookie_domain 同域端点(D-058 护栏不变)。
    cookie_query_domains: ["platform.xiaomimimo.com", "xiaomimimo.com"],
    // CodexBar 实证: required 两项判就绪, known 四项全发(ph/slh 缺失大概率 401)。
    known_cookies: ["api-platform_serviceToken", "userId", "api-platform_ph", "api-platform_slh"],
    header_name: "Cookie",
  },
  params_schema: [
    {
      key: "web_session",
      label: "会话 Cookie",
      type: "secret",
      required: true,
      help: "platform.xiaomimimo.com 登录后复制 Cookie(需含 api-platform_serviceToken 与 userId)",
    },
  ],
};

export const PRESET_CHANNELS: readonly ChannelDescriptor[] = [
  DEEPSEEK_BALANCE,
  OPENCODE_GO,
  KIMI_CODING,
  MINIMAX_TOKEN_PLAN,
  ALIYUN_BAILIAN_TOKEN_PLAN,
  VOLCENGINE_ARK_CODING_PLAN,
  ZAI_CODING,
  MIMO_TOKEN_PLAN,
];

/** 按全路径 "platform/product" 查预置通道(通道树/引擎/测试连接共用) */
export function getPresetChannel(channel: string): ChannelDescriptor | undefined {
  return PRESET_CHANNELS.find((d) => d.channel === channel);
}
