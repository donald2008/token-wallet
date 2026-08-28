/**
 * @token-wallet/core — 采集核心桶导出
 *
 * 四个注册点(§4): ProviderAdapter / Template / CredentialSource / Notifier
 * 统一 schema(§2.1) / 通道注册表(§5.0, D-025) / 存储(§7, D-020) / 调度器(§3.2, D-027)
 */

// 统一快照 schema (§2.1, D-014)
export * from "./schema.js";

// 通道: 描述符 + 注册表 + 预置目录 (§5.0, D-025)
export * from "./channels/descriptor.js";
export * from "./channels/registry.js";
export * from "./channels/presets.js";

// 凭据: CredentialRef + 四源 + 注册表 (§5.0.1, D-013/D-029)
export * from "./credentials.js";

// 存储: 接口 + SqliteStore (§7, D-020)
export * from "./storage/backend.js";
export * from "./storage/sqlite.js";

// 调度器 (§3.2, D-027)
export * from "./scheduler.js";

// 适配器注册点 + 声明式/脚本骨架 (§4, §5.1)
export * from "./adapters.js";

// 安全 JSONPath 映射 (§5.1)
export * from "./mapping/jsonpath.js";

// 日志脱敏(D-029) + 余额速率计算(§2 ticker)
export * from "./redact.js";
export * from "./rate.js";

// 模板注册点 (§4, D-004)
export * from "./templates.js";

// 通知注册点 + 空实现 (§4, D-009)
export * from "./notifier.js";
