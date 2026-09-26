/**
 * web_session 通道组合器声明式注册 — t_7672da28(D-058 机制扩展)
 *
 * 单一事实源纪律: 本表与 CHANNEL_MAPPINGS 同层同约定(通道目录内声明式注册,
 * 禁与通道目录平行另建第二张表/禁 app 侧硬编码 channel → spec)。不变量由单测
 * 保证: `PRESET_CHANNELS 中 auth.kind=web_session 的通道 ⊆ Object.keys(本表)`
 * (镜像 CHANNEL_MAPPINGS ⊆ PRESET_CHANNELS 不变量)。
 *
 * 消费面 = compositeAdapterFor 工厂(同文件, 唯一入口): 引擎/测试连接按
 * channel 查本表构造组合器, 引擎侧零通道专用代码(web-session.ts:114 消费面契约)。
 * 非 web_session / 未知通道 → 显式抛错(不静默兜底 MiMo spec)。
 *
 * 浏览器安全: 本文件只含声明式数据 + 组合器构造(web-session.ts 无 Node 依赖),
 * app 经 subpath export(`@token-wallet/core/web-session`)接入。
 */
import { WebSessionCompositeAdapter, type WebSessionChannelSpec } from "../web-session.js";
import { MIMO_WEB_SESSION_SPEC } from "./mimo.js";

// app 浏览器安全接入: 组合器类与 spec 类型经本 subpath 一并可达
// (channels 桶含 registry/mappings 等亦为浏览器安全, 但 app 按需 import 更窄的面)
export { WebSessionCompositeAdapter };
export type { WebSessionChannelSpec };

/**
 * channel 全路径 → web_session 通道 spec 注册表。
 * 下一家 cookie 平台 = 描述符声明 auth 契约 + 通道文件落 spec + 本表登记(零引擎改动)。
 */
export const WEB_SESSION_CHANNEL_SPECS: Readonly<Record<string, WebSessionChannelSpec>> = {
  "mimo/token-plan": MIMO_WEB_SESSION_SPEC,
};

/** 工厂错误: 非法通道请求(未知通道/非 web_session 通道), 显式抛出不静默兜底 */
export class CompositeAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositeAdapterError";
  }
}

/**
 * 按 channel 从通道目录取 web_session spec 构造组合适配器(通用入口, t_7672da28 U2)。
 *
 * - 已知 web_session 通道 → WebSessionCompositeAdapter(同域校验在构造期生效)
 * - 未知 channel / 非 web_session 通道 → CompositeAdapterError 显式抛出
 * - fetchImpl 可注入(测试 mock / app 传主进程桥 runtimeFetch)
 */
export function compositeAdapterFor(
  channel: string,
  fetchImpl: typeof fetch = fetch,
): WebSessionCompositeAdapter {
  const spec = WEB_SESSION_CHANNEL_SPECS[channel];
  if (!spec) {
    throw new CompositeAdapterError(
      `通道 ${channel} 无 web_session spec(未知通道或非 web_session 凭据范式, 不构造组合器)`,
    );
  }
  return new WebSessionCompositeAdapter(spec, fetchImpl);
}
