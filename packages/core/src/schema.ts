/**
 * 统一快照 schema — DESIGN.md §2.1, D-014
 *
 * 适配器唯一输出契约。三原型: balance(余额制) / window(窗口制) / local(本地用量)。
 * status 是一等公民: 异常状态用整卡文字替代图表, 不显示假数据。
 */
import { z } from "zod";

/** 套餐原型 (D-014) */
export const PlanArchetypeSchema = z.enum(["balance", "window", "local"]);
export type PlanArchetype = z.infer<typeof PlanArchetypeSchema>;

/** 快照状态 (§2.1): ok / stale / auth_expired / unsupported / error */
export const SnapshotStatusSchema = z.enum([
  "ok",
  "stale",
  "auth_expired",
  "unsupported",
  "error",
]);
export type SnapshotStatus = z.infer<typeof SnapshotStatusSchema>;

/** 指标类别: balance=余额, window=窗口用量, usage=本地/时段用量 */
export const MetricKindSchema = z.enum(["balance", "window", "usage"]);
export type MetricKind = z.infer<typeof MetricKindSchema>;

/** 计量单位 (§2.1) */
export const MetricUnitSchema = z.enum(["requests", "credits", "cny", "tokens"]);
export type MetricUnit = z.infer<typeof MetricUnitSchema>;

/** 单条指标: 每窗口一条(window) / 余额一行(balance) / 时段用量(local) */
export const MetricSchema = z.object({
  /** 指标键, 如 "rolling_5h" / "weekly" / "remaining" */
  key: z.string().min(1),
  kind: MetricKindSchema,
  unit: MetricUnitSchema,
  /** 已用量(窗口/用量) 或 已消耗(balance) */
  used: z.number().finite().nonnegative(),
  /** 上限/总额度; 无上限(纯余额剩余)时缺省 */
  limit: z.number().finite().positive().optional(),
  /** 窗口重置时间(unix 秒); 仅 window 类有意义 */
  reset_at: z.number().int().positive().optional(),
});
export type Metric = z.infer<typeof MetricSchema>;

export const AlertLevelSchema = z.enum(["info", "warn", "critical"]);
export type AlertLevel = z.infer<typeof AlertLevelSchema>;

export const AlertSchema = z.object({
  level: AlertLevelSchema,
  message: z.string().min(1),
  /** 机器可读码, 如 "quota_low" / "rate_limited" */
  code: z.string().optional(),
});
export type Alert = z.infer<typeof AlertSchema>;

/**
 * 统一快照 (§2.1)。适配器只能输出这个形状。
 *
 * 扩展字段(不改变 §2.1 契约骨架):
 * - setup_hint: auth_expired/unsupported 时给用户的修复指引(§5.0, 如 `bl auth login --console`)
 * - error_message: status=error 时的可读原因(已脱敏, 不含凭据)
 */
export const ProviderSnapshotSchema = z.object({
  provider_id: z.string().min(1),
  display_name: z.string().min(1),
  plan_type: PlanArchetypeSchema,
  /** 采集时间(unix 秒) */
  fetched_at: z.number().int().positive(),
  status: SnapshotStatusSchema,
  metrics: z.array(MetricSchema),
  alerts: z.array(AlertSchema),
  setup_hint: z.string().optional(),
  error_message: z.string().optional(),
});
export type ProviderSnapshot = z.infer<typeof ProviderSnapshotSchema>;

/** 解析快照, 非法输入抛 zod 错误(fail-fast) */
export function parseSnapshot(input: unknown): ProviderSnapshot {
  return ProviderSnapshotSchema.parse(input);
}

/** 安全解析: 不抛异常, 返回 success 标记 */
export function safeParseSnapshot(input: unknown) {
  return ProviderSnapshotSchema.safeParse(input);
}
