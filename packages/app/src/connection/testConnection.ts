/**
 * 测试连接 — DESIGN.md §5.0 (D-017): 立即跑一次采集。
 *
 * P0-5 起: http 类通道走真实 GenericHttpAdapter(声明式映射, 零代码),
 * 用表单刚输入的值(未落钥匙串)直接构造请求 → 真实 API 校验。
 * - deepseek/balance: GET https://api.deepseek.com/user/balance + Bearer key
 * - 非 http 通道(尚未接真实适配器)→ 保留 mock 兜底
 *
 * ⚠️ 内存纪律(D-029): 表单里的 key 只活本次请求构造, 不进 UI 状态/日志。
 */
import type { ProviderSnapshot } from "../types";
import type { MockChannelDescriptor } from "../channels/mockChannels";
import { GenericHttpAdapter } from "@token-wallet/core/generic-http";
import { DEEPSEEK_BALANCE, DEEPSEEK_BALANCE_MAPPING } from "@token-wallet/core/channels/deepseek";
import { httpGetJson } from "../ipc";

export type TestConnectionResult =
  | { ok: true; snapshot: ProviderSnapshot }
  | { ok: false; error: string };

/** Tauri 运行时经 Rust reqwest; 纯浏览器 dev 直接 fetch */
async function testFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k] = String(v);
  const { status, body } = await httpGetJson(url, headers, 10_000);
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

const NOW = Math.floor(Date.now() / 1000);

/** mock 余额快照(balance 通道, 未接真实适配器时兜底) */
function balanceSnapshot(channel: MockChannelDescriptor): ProviderSnapshot {
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

/** mock 窗口快照(window 通道, 未接真实适配器时兜底) */
function windowSnapshot(channel: MockChannelDescriptor): ProviderSnapshot {
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
        unit: "requests",
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
  channel: MockChannelDescriptor,
  params: Record<string, string | number | boolean>,
): Promise<TestConnectionResult> {
  // deepseek/balance: 唯一已接真实链路的 http 通道
  if (channel.channel === "deepseek/balance") {
    const adapter = new GenericHttpAdapter(DEEPSEEK_BALANCE_MAPPING, testFetch);
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
    const snap = await adapter.fetchSnapshot(DEEPSEEK_BALANCE, instance, ctx);
    if (snap.status === "ok") return { ok: true, snapshot: snap };
    const msg =
      snap.status === "auth_expired"
        ? "认证失败: API Key 无效 (401 Unauthorized)"
        : snap.error_message ?? `采集失败(${snap.status})`;
    return { ok: false, error: msg };
  }
  // 其他 http 通道未接真实适配器 → mock 兜底(后续卡接真实链路后移除)
  if (channel.plan_type === "balance") {
    return { ok: true, snapshot: balanceSnapshot(channel) };
  }
  return { ok: true, snapshot: windowSnapshot(channel) };
}

/**
 * 测试连接。params: 表单输入的参数值(key → raw value)。
 * secret 字段的值即用户输入(未落钥匙串前)。
 */
export async function testConnection(
  channel: MockChannelDescriptor,
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

  // http 通道 → 真实采集; command 通道暂回退 mock(后续卡接)
  if (channel.adapter === "http") {
    return realHttpTest(channel, params);
  }

  // command 通道(未接真实)→ 成功快照兜底
  if (channel.plan_type === "balance") {
    return { ok: true, snapshot: balanceSnapshot(channel) };
  }
  return { ok: true, snapshot: windowSnapshot(channel) };
}
