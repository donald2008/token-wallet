/**
 * 测试连接 — DESIGN.md §5.0 (D-017): 立即跑一次采集。
 *
 * http 通道走真实 GenericHttpAdapter(声明式映射, 零代码), 映射查 CHANNEL_MAPPINGS
 * (与 PRESET_CHANNELS 配套, D-036): 设置页能选到的通道必然有真实映射。
 * 用表单刚输入的值(未落钥匙串)直接构造请求 → 真实 API 校验。
 *
 * ⚠️ 内存纪律(D-029): 表单里的 key 只活本次请求构造, 不进 UI 状态/日志。
 */
import type { ProviderSnapshot } from "../types";
import type { ChannelDescriptor } from "@token-wallet/core/channels";
import { CHANNEL_MAPPINGS, getPresetChannel } from "@token-wallet/core/channels";
import { GenericHttpAdapter } from "@token-wallet/core/generic-http";
import { httpGetJson } from "../ipc";

export type TestConnectionResult =
  | { ok: true; snapshot: ProviderSnapshot }
  | { ok: false; error: string };

/** 桌面宿主经主进程 http; 纯浏览器 dev 直接 fetch */
async function testFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k] = String(v);
  const { status, body } = await httpGetJson(url, headers, 10_000);
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

const NOW = Math.floor(Date.now() / 1000);

/** mock 余额快照(command 通道引擎接线前兜底; D-041 起 aliyun-bailian 已有真实适配器, 引擎接线为后续卡) */
function balanceSnapshot(channel: ChannelDescriptor): ProviderSnapshot {
  return {
    provider_id: channel.channel,
    display_name: channel.display_name,
    plan_type: "balance",
    fetched_at: NOW,
    status: "ok",
    metrics: [
      { key: "balance", kind: "balance", unit: "cny", used: 451.86, remaining: 451.86, limit: 500, currency: "CNY" },
    ],
    alerts: [],
  };
}

/** mock 窗口快照(command 通道引擎接线前兜底; D-041 起 aliyun-bailian 已有真实适配器, 引擎接线为后续卡) */
function windowSnapshot(channel: ChannelDescriptor): ProviderSnapshot {
  return {
    provider_id: channel.channel,
    display_name: channel.display_name,
    plan_type: "window",
    fetched_at: NOW,
    status: "ok",
    metrics: [
      {
        key: "rolling_5h",
        kind: "window",
        unit: "percent",
        used: 84,
        limit: 100,
        reset_at: NOW + 14000,
      },
    ],
    alerts: [],
  };
}

/** 真实 http 通道测试连接: 声明式映射 + 表单 key 立即采集 */
async function realHttpTest(
  channel: ChannelDescriptor,
  params: Record<string, string | number | boolean>,
): Promise<TestConnectionResult> {
  // 目录内 http 通道必有映射(D-036 不变量); 缺失 = 配置 bug, 显式报错不兜底
  const mapping = CHANNEL_MAPPINGS[channel.channel];
  const descriptor = getPresetChannel(channel.channel);
  if (!mapping || !descriptor) {
    return { ok: false, error: `通道 ${channel.channel} 未接入真实采集(目录不变量破坏)` };
  }
  const adapter = new GenericHttpAdapter(mapping, testFetch);
  const instance = {
    id: "test-conn",
    channel: channel.channel,
    name: "测试连接",
    params: { api_key: String(params.api_key ?? "") },
  };
  const ctx = {
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    // 表单里的值直接当凭据用(未落钥匙串); key 只活请求构造瞬间
    resolveCredential: (ref: unknown) =>
      Promise.resolve(typeof ref === "string" ? ref : String((ref as { key?: string }).key ?? "")),
    fetchedAt: NOW,
  };
  const snap = await adapter.fetchSnapshot(descriptor, instance, ctx);
  if (snap.status === "ok") return { ok: true, snapshot: snap };
  const msg =
    snap.status === "auth_expired"
      ? "认证失败: API Key 无效 (401 Unauthorized)"
      : snap.error_message ?? `采集失败(${snap.status})`;
  return { ok: false, error: msg };
}

/**
 * 测试连接。params: 表单输入的参数值(key → raw value)。
 * secret 字段的值即用户输入(未落钥匙串前)。
 */
export async function testConnection(
  channel: ChannelDescriptor,
  params: Record<string, string | number | boolean>,
): Promise<TestConnectionResult> {
  await new Promise((r) => setTimeout(r, 120));

  // 必填字段缺失 → 校验失败(§5.0 录入即验证)
  for (const f of channel.params_schema) {
    if (!f.required) continue;
    const v = params[f.key];
    if (v === undefined || v === "" || v === null) {
      return { ok: false, error: `缺少必填参数: ${f.label}` };
    }
    if (typeof v === "string" && v.trim() === "") {
      return { ok: false, error: `缺少必填参数: ${f.label}` };
    }
  }

  // 任何 secret 值为 "fail" 哨兵 → 模拟失败(acceptance: 失败要给出具体错误)
  for (const f of channel.params_schema) {
    if (f.type === "secret" && params[f.key] === "fail") {
      return { ok: false, error: "认证失败: API Key 无效 (401 Unauthorized)" };
    }
  }

  // http 通道 → 真实采集; command 通道走 mock 兜底(引擎接线为后续卡, D-041 首实例已就绪)
  if (channel.adapter === "http") {
    return realHttpTest(channel, params);
  }

  // command 通道(未接真实)→ 成功快照兜底
  if (channel.plan_type === "balance") {
    return { ok: true, snapshot: balanceSnapshot(channel) };
  }
  return { ok: true, snapshot: windowSnapshot(channel) };
}
