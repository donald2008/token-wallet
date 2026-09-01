/**
 * 实例配置 schema + 双重唯一性校验 — DESIGN.md §5.0.1 (D-017/D-025/D-026)
 *
 * 三层分离:
 * - 内置通道目录(ChannelDescriptor, 见 core PRESET_CHANNELS): 实现类型 + params_schema
 * - 实例配置 instances.yaml(用户数据): 启用哪些通道实例 + 参数 + 轮询覆盖
 * - 全局设置 settings(用户数据)
 *
 * 表单校验与实例校验复用同一份 zod schema(§5.0): 本文件即唯一权威。
 * 实例名唯一性双重拒绝(D-026):
 *   1. 表单保存即时校验(validateFormName 对已有实例名)
 *   2. instances.yaml 加载 zod superRefine(InstancesFileSchema)
 *
 * 凭据纪律(D-029): secret 值只进钥匙串 store, 实例配置只存 CredentialRef 引用。
 * 本卡(P0-4)用内存 mock 撑住 store 接口, OS 钥匙串真实现 P0-5/P1。
 */
import { z } from "zod";
import { t } from "../i18n";
import type { ChannelDescriptor } from "@token-wallet/core/channels";

/** 凭据引用来源(§5.0.1 / D-029) */
export const CREDENTIAL_SOURCES = ["store", "env", "file", "command"] as const;
export type CredentialSourceKind = (typeof CREDENTIAL_SOURCES)[number];

export const CredentialRefSchema = z.object({
  source: z.enum(CREDENTIAL_SOURCES),
  /** 各源语义见 core credentials.ts; 本卡只落地 store */
  key: z.string().optional(),
});
export type CredentialRef = z.infer<typeof CredentialRefSchema>;

/** 实例配置单条(D-026): { id, channel, poll_interval?, params: {k: CredentialRef} } */
export const InstanceSchema = z.object({
  id: z.string().min(1),
  /** "platform/product" 全路径(§5.0) */
  channel: z.string().min(1),
  /** 必填, 全局唯一; 默认 "<平台>-<产品> #N" 自动编号(D-026) */
  name: z.string().min(1),
  /** 可选, 覆盖全局默认轮询(如 "3m") */
  poll_interval: z.string().optional(),
  /**
   * D-043 key 去重: key 明文(解密后)的 SHA-256 短摘要, 与 channel 共同判重。
   * - 判重维度 = key 明文 + channel: 同 channel 下 key 已存在于任一实例 → 重复; 同 key 接不同 channel 允许。
   * - 存的是短指纹(非明文 key), 比对不碰明文(D-029 凭据纪律)。
   * - ⚠️ 指纹不是安全机制(仅防重复用), 别当散列凭据/校验用 —— 前 32 位 hex(128bit)足够判重。
   * - 生命周期跟随实例: 删除实例即删指纹(字段随配置一起消失)。
   */
  key_fingerprint: z.string().optional(),
  /**
   * 参数: secret 字段存 CredentialRef(值进钥匙串 store, 配置只存引用);
   * 非 secret 字段(text/number/boolean)直接以字面值存配置。
   * mock 阶段允许 union, P0-5 收紧为纯 CredentialRef 语义。
   */
  params: z.record(z.union([CredentialRefSchema, z.boolean(), z.number(), z.string()])),
});
export type InstanceConfig = z.infer<typeof InstanceSchema>;

/** 表单参数原始输入(未转 CredentialRef 前) */
export type FormParamValue = string | number | boolean;

/** 表单输出: 参数 raw + 名称 + 轮询 */
export const InstanceFormSchema = z.object({
  channel: z.string().min(1),
  name: z.string().min(1),
  poll_interval: z.string().optional(),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])),
});
export type InstanceForm = z.infer<typeof InstanceFormSchema>;

/** instances.yaml 文件整体 + 加载时双重唯一校验(D-026 第 2 道) */
export const InstancesFileSchema = z
  .object({
    version: z.literal(1),
    instances: z.array(InstanceSchema),
  })
  .superRefine((file, ctx) => {
    const names = new Set<string>();
    const ids = new Set<string>();
    file.instances.forEach((inst, i) => {
      if (names.has(inst.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t("schema.nameDup", { name: inst.name }),
          path: ["instances", i, "name"],
        });
      }
      names.add(inst.name);
      if (ids.has(inst.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t("schema.idDup", { id: inst.id }),
          path: ["instances", i, "id"],
        });
      }
      ids.add(inst.id);
    });
  });

/** 表单保存即时校验(D-026 第 1 道): 名称非空 + 全局唯一(对既有实例) */
export function validateFormName(
  name: string,
  existingNames: Iterable<string>,
  ignoreId?: string,
): string | null {
  if (!name.trim()) return t("schema.nameEmpty");
  const others = new Set(existingNames);
  if (ignoreId) {
    // 编辑场景允许保留自身原名(本卡暂不支持编辑, 占位签名)
  }
  if (others.has(name.trim())) return t("schema.nameExists", { name: name.trim() });
  return null;
}

/** 由实例配置构造 CredentialRef(D-029): secret → store 源, key 为实例内唯一 */
export function makeCredentialRef(instanceId: string, paramKey: string): CredentialRef {
  return { source: "store", key: `${instanceId}:${paramKey}` };
}

/** 生成默认实例名 "<平台>-<产品> #N"(D-026 自动编号, 平台名前缀保证面板可辨识) */
export function defaultInstanceName(
  channel: ChannelDescriptor,
  existingNames: Iterable<string>,
): string {
  const used = new Set(existingNames);
  const base = `${channel.platform_display_name}-${channel.product_display_name}`;
  let n = 1;
  while (used.has(`${base} #${n}`)) n += 1;
  return `${base} #${n}`;
}

/**
 * 通道存在性 + params_schema 完整性校验(§5.0.1 加载连带检查)。
 * 返回 null 表示通过; 返回 string 为校验错误(纯校验, 不含凭据值)。
 */
export function validateChannelConfig(
  channelId: string,
  { params_schema }: Pick<ChannelDescriptor, "params_schema">,
): string | null {
  if (!channelId.includes("/")) return t("schema.badChannelPath", { channel: channelId });
  if (!params_schema) return t("schema.noSchema", { channel: channelId });
  return null;
}

/** 解析 instances.yaml → 校验通过返回配置列表, 失败返回 zod 错误 message(fail-fast D-026) */
export function parseInstances(input: unknown): {
  ok: boolean;
  instances?: InstanceConfig[];
  error?: string;
} {
  const parsed = InstancesFileSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? t("schema.unknownError") };
  }
  return { ok: true, instances: parsed.data.instances };
}

/**
 * D-043 key 去重: 对 key 明文做 SHA-256 短摘要(前 32 位 hex / 128bit)。
 *
 * ⚠️ 指纹不是安全机制(仅防重复用), 别当散列凭据/校验和用 —— 判重维度是「同 channel 下同 key」,
 * 浏览器/dev 环境都能复现, 不承担任何保密/验证职责。刻意只取前 32 位 hex:
 * 128bit 的碰撞概率在人工输入的 key 集合规模下可忽略, 又能让指纹字段足够短。
 *
 * 用 WebCrypto(globalThis.crypto.subtle): 浏览器(vite 前端)与 node(vitest)两宿主都可用,
 * 不引入 node:crypto 依赖(D-002 core 依赖纪律)+ 避免把 node 模块拖进 browser bundle。
 */
export async function keyFingerprint(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  // globalThis.crypto.subtle: 浏览器/Node≥15/webworker 全局可用; 测试环境见 schema.test keyFingerprint 探针
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < 16; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

/**
 * D-043 查重查询(同 channel 同 key → 返回已占用实例, 供表单内联报错)。
 *
 * - 判重维度 = key 明文 + channel: 只在同 channel 内比对指纹; 同 key 接不同 channel 放行(契约)。
 * - 纯函数, 输入既有实例列表即可复现(store/表单共用)。
 * - 返回命中实例 → 表单应阻止提交; 返回 null → 可提交。
 * - ignoreId: 编辑场景传自己 id, 改自己的 key 时不算命中自身(契约「仅 key 变更时比对」由调用方保证,
 *   见 DynamicForm 注释; 这里只负责排除自身, 避免编辑自指死锁)。
 */
export function findKeyDuplicate(
  instances: readonly InstanceConfig[],
  channel: string,
  fingerprint: string,
  ignoreId?: string,
): InstanceConfig | null {
  return (
    instances.find(
      (i) => i.channel === channel && i.key_fingerprint === fingerprint && i.id !== ignoreId,
    ) ?? null
  );
}