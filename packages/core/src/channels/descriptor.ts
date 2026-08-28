/**
 * 通道描述符 — DESIGN.md §5.0, D-025(两层模型 platform → product)
 *
 * 通道是预制代码, 录入只是填参数(D-017)。ChannelDescriptor 是内置通道目录的
 * 单条记录: 实现类型 + 请求细节 + 映射规则 + params_schema(驱动设置页动态表单)。
 */
import { z } from "zod";
import { PlanArchetypeSchema } from "../schema.js";

/** 采集实现类型 (D-028 收敛为两类; local-agent 为 P3 预留) */
export const AdapterKindSchema = z.enum(["http", "command", "local-agent"]);
export type AdapterKind = z.infer<typeof AdapterKindSchema>;

/** params_schema 字段类型: secret 用密码框且不回显(§5.0) */
export const ParamFieldTypeSchema = z.enum(["secret", "text", "number", "boolean"]);
export type ParamFieldType = z.infer<typeof ParamFieldTypeSchema>;

export const ParamFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: ParamFieldTypeSchema,
  required: z.boolean(),
  help: z.string().optional(),
  /** 非 secret 字段的默认值 */
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ParamField = z.infer<typeof ParamFieldSchema>;

/** command 类通道的健康检查(§5.0): 会话失效 → auth_expired + setup_hint */
export const HealthCheckSchema = z.object({
  /** 如 `bl auth status` / `arkcli auth status` */
  command: z.string().min(1),
  /** 会话失效时卡片展示的修复指引 */
  setup_hint: z.string().min(1),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

/**
 * 通道描述符。channel 全路径 = "<platform>/<product>"(D-025),
 * 与 instances.yaml 的 channel 字段一致(§5.0.1)。
 */
export const ChannelDescriptorSchema = z
  .object({
    platform: z.string().min(1),
    product: z.string().min(1),
    /** 全路径, 必须等于 `${platform}/${product}` */
    channel: z.string().min(1),
    display_name: z.string().min(1),
    platform_display_name: z.string().min(1),
    plan_type: PlanArchetypeSchema,
    adapter: AdapterKindSchema,
    logo: z.string().min(1),
    params_schema: z.array(ParamFieldSchema),
    health_check: HealthCheckSchema.optional(),
  })
  .refine((d) => d.channel === `${d.platform}/${d.product}`, {
    message: "channel 必须等于 '<platform>/<product>'",
    path: ["channel"],
  });
export type ChannelDescriptor = z.infer<typeof ChannelDescriptorSchema>;

/** 通道全路径 */
export function channelId(platform: string, product: string): string {
  return `${platform}/${product}`;
}
