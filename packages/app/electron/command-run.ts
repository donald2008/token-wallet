/**
 * command_run 桥 — command 类通道的主进程执行逻辑 (D-042, t_c561c8a8)
 *
 * renderer 是 vite bundle, 静态 import node:child_process 不可行(P0-4 同族)。
 * command 通道的真实 spawn 必须在主进程: 本模块提供 runCommandFetch 纯逻辑
 * (无 electron 依赖, 可 node vitest 直测), main.ts 用 ipcMain.handle 注册。
 * 内部用 core 的 COMMAND_ADAPTERS[channel]() 构造**缺省 runner(真实 spawn)** 的
 * 适配器执行 fetchSnapshot, 返回 ProviderSnapshot(JSON 可序列化, 直接回 renderer)。
 *
 * 语义:
 * - renderer 侧只负责「选通道 + 收快照」; spawn/解析/分类全在主进程 core 适配器内
 * - 与 http 通道的 http_get_json 桥同构: 主进程执行, renderer 零 Node 能力
 * - bl 未装(ENOENT/win32 cmd 非零退出) → 适配器产出 error 快照 + INSTALL_HINT,
 *   本模块原样透传, 不做二次分类(分类责任在 core, D-041)
 */
import { COMMAND_ADAPTERS } from "@token-wallet/core/channels/aliyun-bailian";
import type { ChannelDescriptor } from "@token-wallet/core/channels";
import type { AdapterContext, InstanceConfig } from "@token-wallet/core/generic-http";
import type { ProviderSnapshot } from "@token-wallet/core/schema";

/** command_run 载荷: renderer 传入通道 + 实例 + 采集上下文 */
export interface CommandRunPayload {
  channel?: string;
  descriptor?: ChannelDescriptor;
  instance?: InstanceConfig;
  fetchedAt?: number;
  timeoutMs?: number;
}

/** 适配器执行函数(供测试注入; 生产走 COMMAND_ADAPTERS 注册表) */
export type CommandExecutor = (
  channel: string,
  descriptor: ChannelDescriptor,
  instance: InstanceConfig,
  ctx: AdapterContext,
) => Promise<ProviderSnapshot>;

/** 默认执行器: COMMAND_ADAPTERS 注册表(缺省 runner = 真实 spawn) */
export function defaultCommandExecutor(
  channel: string,
  descriptor: ChannelDescriptor,
  instance: InstanceConfig,
  ctx: AdapterContext,
): Promise<ProviderSnapshot> {
  const factory = COMMAND_ADAPTERS[channel];
  if (!factory) throw new Error(`通道 ${channel} 未注册 command 适配器`);
  return factory().fetchSnapshot(descriptor, instance, ctx);
}

/**
 * 执行一次 command 通道采集(真实 spawn)。测试可注入 executor 替代真实 spawn。
 *
 * 超时: 主进程侧 AbortController + setTimeout 硬切断(与 scheduler 的 timeoutPromise
 * 双保险一致; command 默认 15s, DESIGN §3.2)。
 */
export async function runCommandFetch(
  payload: CommandRunPayload,
  executor: CommandExecutor = defaultCommandExecutor,
): Promise<ProviderSnapshot> {
  const channel = String(payload?.channel ?? "");
  if (!channel) throw new Error("command_run: channel 缺失");
  const descriptor = payload?.descriptor;
  if (!descriptor) throw new Error(`command_run: 通道 ${channel} 缺 descriptor`);

  const timeoutMs = payload?.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const instance: InstanceConfig = payload?.instance ?? {
      id: "cmd",
      channel,
      name: channel,
      params: {},
    };
    return await executor(channel, descriptor, instance, {
      signal: controller.signal,
      timeoutMs,
      // command 通道零凭据(D-041: console 会话由 CLI 自管, app 不碰凭据文件)
      resolveCredential: async () => "",
      fetchedAt: payload?.fetchedAt ?? Math.floor(Date.now() / 1000),
    });
  } finally {
    clearTimeout(timer);
  }
}
