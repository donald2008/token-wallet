/**
 * StorageBackend 接口 — DESIGN.md §7, D-020
 *
 * 双宿主约束: app 走主进程 sqlite IPC(D-033 换壳 Electron, E2 接真), mcp-server 走 node:sqlite。
 * 同一 schema(见 sqlite.ts SCHEMA_SQL)。core 只定义接口 + node:sqlite 实现。
 */
import { z } from "zod";
import type { ProviderSnapshot } from "../schema.js";

/** 分模型分时段消耗记录(§7: 本地 agent 通道与云端窗口数据都落这张表) */
export const UsageRecordSchema = z.object({
  provider_id: z.string().min(1),
  /** 模型名; 云端窗口类数据可为 null */
  model: z.string().min(1).nullable().default(null),
  /** 时段起止(unix 秒) */
  window_start: z.number().int().nonnegative(),
  window_end: z.number().int().nonnegative(),
  tokens: z.number().finite().nonnegative().nullable().default(null),
  credits: z.number().finite().nonnegative().nullable().default(null),
  cost_cny: z.number().finite().nonnegative().nullable().default(null),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

export interface UsageQuery {
  providerId?: string;
  model?: string;
  /** window_end >= since */
  since?: number;
  /** window_start <= until */
  until?: number;
  limit?: number;
}

/** 快照历史查询选项 */
export interface SnapshotHistoryQuery {
  /** fetched_at >= since */
  since?: number;
  limit?: number;
}

/**
 * 存储后端(§3.1 cache-first: UI 永远只读这里, 永不直连 provider)。
 * 实现必须保证: 单次 save 内多行写入是原子的(事务)。
 */
export interface StorageBackend {
  /** 落一条快照(原始 JSON 整存, 读回时 zod 校验) */
  saveSnapshot(snapshot: ProviderSnapshot): Promise<void>;

  /** 某 provider 最新快照; 无记录返回 null */
  latestSnapshot(providerId: string): Promise<ProviderSnapshot | null>;

  /** 每个 provider 各一条最新快照(面板首屏用) */
  latestSnapshots(): Promise<ProviderSnapshot[]>;

  /** 历史快照(消耗速率/预计可用天数用), 时间倒序 */
  snapshotHistory(providerId: string, q?: SnapshotHistoryQuery): Promise<ProviderSnapshot[]>;

  /** 批量落用量记录(事务原子) */
  saveUsageRecords(records: UsageRecord[]): Promise<void>;

  /** 用量聚合查询 */
  queryUsage(q?: UsageQuery): Promise<UsageRecord[]>;

  /**
   * 删除一个 provider 的全部历史数据(快照 + 用量记录)。
   * 删除实例时调用(D-029 对称清理: keyring 已清, 余额历史不再残留)。
   * 必须原子: 要么全清, 要么不动。
   */
  purgeProvider(providerId: string): Promise<void>;

  /** 关闭底层连接 */
  close(): Promise<void>;
}
