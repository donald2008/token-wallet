/**
 * 测试连接 — DESIGN.md §5.0 (D-017): 立即跑一次采集。
 *
 * 本卡 mock: 不真请求 provider。按通道类型返回确定性结果:
 *   - 必填 secret 缺失 → 失败(具体错误)
 *   - value === "fail" 哨兵 → 失败(模拟认证/网络错误)
 *   - 否则成功, 返回 mock ProviderSnapshot(余额/窗口快照)
 * 真实链路 P0-5/P2 spike 后接入(触发对应适配器立即同步)。
 */
import type { ProviderSnapshot } from "../types";
import type { MockChannelDescriptor } from "../channels/mockChannels";

export type TestConnectionResult =
  | { ok: true; snapshot: ProviderSnapshot }
  | { ok: false; error: string };

const NOW = Math.floor(Date.now() / 1000);

/** mock 余额快照(balance 通道) */
function balanceSnapshot(channel: MockChannelDescriptor): ProviderSnapshot {
  return {
    provider_id: channel.channel,
    display_name: channel.display_name,
    plan_type: "balance",
    fetched_at: NOW,
    status: "ok",
    metrics: [
      { key: "balance", kind: "balance", unit: "cny", used: 451.86, limit: 500 },
    ],
    alerts: [],
  };
}

/** mock 窗口快照(window 通道) */
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

/**
 * 模拟测试连接。params: 表单输入的参数值(key → raw value)。
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

  // 成功 → 返回对应原型快照
  if (channel.plan_type === "balance") {
    return { ok: true, snapshot: balanceSnapshot(channel) };
  }
  return { ok: true, snapshot: windowSnapshot(channel) };
}