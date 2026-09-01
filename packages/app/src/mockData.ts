import type { ProviderSnapshot } from "./types";

/**
 * P0-2 壳用 mock 场景 — 渲染面板空态/加载态/四色状态切换。
 * 真实数据链路等 P0-5; 场景切换器仅 dev 环境渲染(import.meta.env.DEV)。
 */

export type ScenarioId =
  | "loading"
  | "empty"
  | "all-ok"
  | "warn"
  | "expired"
  | "stale"
  | "error"
  | "mixed";

export const SCENARIOS: { id: ScenarioId; label: string; expectHealth: string }[] = [
  { id: "loading", label: "scenario.loading", expectHealth: "-" }, // i18n 键(ScenarioBar 渲染时 t())
  { id: "empty", label: "scenario.empty", expectHealth: "-" },
  { id: "all-ok", label: "scenario.allOk", expectHealth: "ok" },
  { id: "warn", label: "scenario.warn", expectHealth: "warn" },
  { id: "expired", label: "scenario.auth", expectHealth: "warn" },
  { id: "stale", label: "scenario.stale", expectHealth: "unknown" },
  { id: "error", label: "scenario.error", expectHealth: "bad" },
  { id: "mixed", label: "scenario.mixed", expectHealth: "warn" },
];

const NOW = Math.floor(Date.now() / 1000);

const MOCK: Record<Exclude<ScenarioId, "loading" | "empty">, ProviderSnapshot[]> = {
  "all-ok": [
    {
      provider_id: "deepseek",
      display_name: "DeepSeek-按量 #1",
      plan_type: "balance",
      fetched_at: NOW - 60,
      status: "ok",
      metrics: [{ key: "balance", kind: "balance", unit: "cny", used: 48.14, limit: 500, daily_rate: 8.2 }],
      alerts: [],
    },
    {
      provider_id: "kimi-code",
      display_name: "Kimi-Code #1",
      plan_type: "window",
      fetched_at: NOW - 90,
      status: "ok",
      metrics: [
        { key: "rolling_5h", kind: "window", unit: "requests", used: 120, limit: 1200, reset_at: NOW + 14000 },
        { key: "weekly", kind: "window", unit: "requests", used: 900, limit: 6000, reset_at: NOW + 400000 },
      ],
      alerts: [],
    },
  ],
  warn: [
    {
      provider_id: "kimi-code",
      display_name: "Kimi-Code #1",
      plan_type: "window",
      fetched_at: NOW - 90,
      status: "ok",
      metrics: [
        { key: "rolling_5h", kind: "window", unit: "requests", used: 960, limit: 1200, reset_at: NOW + 14000 },
        { key: "weekly", kind: "window", unit: "requests", used: 1200, limit: 6000, reset_at: NOW + 400000 },
      ],
      alerts: [],
    },
    {
      provider_id: "deepseek",
      display_name: "DeepSeek-按量 #1",
      plan_type: "balance",
      fetched_at: NOW - 60,
      status: "ok",
      metrics: [{ key: "balance", kind: "balance", unit: "cny", used: 48.14, limit: 500, daily_rate: 8.2 }],
      alerts: [],
    },
  ],
  expired: [
    {
      provider_id: "aliyun",
      display_name: "百炼 Token Plan",
      plan_type: "window",
      fetched_at: NOW - 7200,
      status: "auth_expired",
      metrics: [],
      alerts: [{ level: "warn", message: "bl 会话已失效" }],
      setup_hint: "请运行 `bl auth login --console` 重新授权",
    },
  ],
  stale: [
    {
      provider_id: "opencode-go",
      display_name: "opencode-Go #1",
      plan_type: "window",
      fetched_at: NOW - 3600,
      status: "stale",
      metrics: [],
      alerts: [],
    },
  ],
  error: [
    {
      provider_id: "deepseek",
      display_name: "DeepSeek-按量 #1",
      plan_type: "balance",
      fetched_at: NOW - 240,
      status: "error",
      metrics: [],
      alerts: [{ level: "critical", message: "429 quota exceeded: 今日按量已超限" }],
    },
  ],
  mixed: [
    {
      provider_id: "deepseek",
      display_name: "DeepSeek-按量 #1",
      plan_type: "balance",
      fetched_at: NOW - 60,
      status: "ok",
      metrics: [{ key: "balance", kind: "balance", unit: "cny", used: 48.14, limit: 500, daily_rate: 8.2 }],
      alerts: [],
    },
    {
      provider_id: "kimi-code",
      display_name: "Kimi-Code #1",
      plan_type: "window",
      fetched_at: NOW - 90,
      status: "ok",
      metrics: [
        { key: "rolling_5h", kind: "window", unit: "requests", used: 980, limit: 1200, reset_at: NOW + 14000 },
        { key: "weekly", kind: "window", unit: "requests", used: 1000, limit: 6000, reset_at: NOW + 400000 },
      ],
      alerts: [],
    },
    {
      provider_id: "aliyun",
      display_name: "百炼 Token Plan",
      plan_type: "window",
      fetched_at: NOW - 7200,
      status: "auth_expired",
      metrics: [],
      alerts: [{ level: "warn", message: "bl 会话已失效, 请重新授权" }],
      setup_hint: "请运行 `bl auth login --console` 重新授权",
    },
    {
      provider_id: "ark",
      display_name: "方舟-Coding #1",
      plan_type: "window",
      fetched_at: NOW - 120,
      status: "ok",
      metrics: [
        { key: "rolling_5h", kind: "window", unit: "requests", used: 45, limit: 300, reset_at: NOW + 9000 },
      ],
      alerts: [],
    },
  ],
};

/** 返回 null 表示加载态 */
export function scenarioProviders(id: ScenarioId): ProviderSnapshot[] | null {
  if (id === "loading") return null;
  if (id === "empty") return [];
  // 深拷贝, 避免 UI 层意外改动共享 mock
  return JSON.parse(JSON.stringify(MOCK[id])) as ProviderSnapshot[];
}
