/**
 * L1 golden sample — zai/coding 真实通道(智谱 GLM Coding Plan, 2026-08-30 L3 实测)
 *
 * fixture = 2026-08-30 真实 API 响应(数值真实, 无 key; limits[0]=5h 窗, limits[1]=周窗)。
 * 断言:
 * - 双窗口绝对值制直接进 used/limit(不 ×100), 非 percent 单位 —— credits 计数制。
 * - nextResetTime 毫秒 epoch 经 ms_epoch 管道 → unix 秒。
 * - ⚠️ HTTP 恒 200, body.code 判态: 200=ok / 401=auth_expired+setup_hint / 1001=error。
 *   这是 GenericHttpMapping.body_code 扩展(GenericHttpAdapter 首例)的回归测试。
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GenericHttpAdapter } from "../src/generic-http.js";
import { ZAI_CODING } from "../src/channels/presets.js";
import { ZAI_CODING_MAPPING } from "../src/channels/zai-coding.js";
import { COMMAND_ADAPTERS } from "../src/channels/aliyun-bailian.js";
import { PRESET_CHANNELS } from "../src/channels/presets.js";
import { CHANNEL_MAPPINGS } from "../src/channels/mappings.js";
import type { AdapterContext, InstanceConfig } from "../src/generic-http.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "src", "channels", "__fixtures__");
const HEALTHY = JSON.parse(readFileSync(join(FIXTURES, "zai-usage-healthy.json"), "utf8"));
const AUTH_EXPIRED = JSON.parse(readFileSync(join(FIXTURES, "zai-usage-auth-expired.json"), "utf8"));
const ERROR_1001 = JSON.parse(readFileSync(join(FIXTURES, "zai-usage-error.json"), "utf8"));

const INSTANCE: InstanceConfig = {
  id: "zai",
  channel: "zai/coding",
  name: "智谱 Coding Plan #1",
  params: { api_key: { source: "store", key: "zai:api_key" } },
};

function makeCtx(): AdapterContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    fetchedAt: 1_788_000_000,
    resolveCredential: () => Promise.resolve("«redacted:zai-…»"),
  };
}

function mkAdapter(body: unknown, status = 200) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response),
  );
  return new GenericHttpAdapter(ZAI_CODING_MAPPING, fetchMock as unknown as typeof fetch);
}

describe("zai/coding golden sample(§5.2 双窗绝对值制)", () => {
  it("健康态 → ok 快照: 双窗 used/limit 绝对值直接映射(不 ×100), nextResetTime ms→秒", async () => {
    const snap = await mkAdapter(HEALTHY).fetchSnapshot(ZAI_CODING, INSTANCE, makeCtx());

    expect(snap.status).toBe("ok");
    expect(snap.plan_type).toBe("window");
    expect(snap.metrics).toHaveLength(2);

    const byKey = Object.fromEntries(snap.metrics.map((m) => [m.key, m]));
    // 5h 窗(limits[0]): usage=2000 limit, currentValue=377 used —— 绝对值直接进, 非 percent
    expect(byKey["rolling_5h"]).toMatchObject({
      kind: "window",
      unit: "credits",
      used: 377,
      limit: 2000,
      reset_at: 1_788_192_250, // 1788192250348 ms / 1000 = 1788192250.348 → floor
    });
    // 周窗(limits[1]): usage=10000 limit, currentValue=6837 used
    expect(byKey["weekly"]).toMatchObject({
      kind: "window",
      unit: "credits",
      used: 6837,
      limit: 10000,
      reset_at: 1_788_578_665, // 1788578665998 ms / 1000 = 1788578665.998 → floor
    });
  });

  it("HTTP 恒 200 + body.code=200 → 正常采集(不是 error)", async () => {
    // 状态全在 body.code, HTTP status 恒 200: 必须能走到指标映射而非 error
    const snap = await mkAdapter(HEALTHY, 200).fetchSnapshot(ZAI_CODING, INSTANCE, makeCtx());
    expect(snap.status).toBe("ok");
    expect(snap.metrics.length).toBe(2);
  });
});

describe("zai/coding body_code 判态(HTTP 恒 200, 状态在 body.code, D-0xx)", () => {
  it("body.code=401(坏 key) → auth_expired + setup_hint(复制钮语义), metrics 空", async () => {
    const snap = await mkAdapter(AUTH_EXPIRED).fetchSnapshot(ZAI_CODING, INSTANCE, makeCtx());

    expect(snap.status).toBe("auth_expired");
    expect(snap.setup_hint).toBeDefined();
    expect(snap.setup_hint).toContain("bigmodel.cn");
    expect(snap.metrics).toEqual([]);
  });

  it("body.code=1001(缺 Authorization 头) → error(其他业务码)", async () => {
    const snap = await mkAdapter(ERROR_1001).fetchSnapshot(ZAI_CODING, INSTANCE, makeCtx());

    expect(snap.status).toBe("error");
    expect(snap.error_message).toContain("1001");
    expect(snap.metrics).toEqual([]);
  });

  it("HTTP 200 但 body 不是 ok → 不误判 ok(HTTP status 无信息量)", async () => {
    // 核心陷阱: 判 auth_expired 不能看 HTTP 状态码, 必须解析 body.code
    expect(AUTH_EXPIRED.code).toBe(401);
    expect(ERROR_1001.code).toBe(1001);
  });
});

describe("zai/coding 通道目录不变量(D-036: 选得到即采得到)", () => {
  it("PRESET_CHANNELS 含 zai/coding 且每个通道都有真实映射", () => {
    const mappingKeys = Object.keys(CHANNEL_MAPPINGS);
    const commandKeys = Object.keys(COMMAND_ADAPTERS);
    for (const d of PRESET_CHANNELS) {
      if (d.adapter === "command") expect(commandKeys).toContain(d.channel);
      else expect(mappingKeys).toContain(d.channel);
    }
    // 反向: 映射注册的通道也都在目录里(无幽灵映射)
    for (const k of mappingKeys) {
      expect(PRESET_CHANNELS.some((d) => d.channel === k)).toBe(true);
    }
    for (const k of commandKeys) {
      expect(PRESET_CHANNELS.some((d) => d.channel === k)).toBe(true);
    }
    // zai 特定: http adapter, window 制, help 指向 bigmodel.cn API Keys
    const zai = PRESET_CHANNELS.find((c) => c.channel === "zai/coding")!;
    expect(zai.adapter).toBe("http");
    expect(zai.plan_type).toBe("window");
    const key = zai.params_schema.find((p) => p.key === "api_key")!;
    expect(key.help).toContain("bigmodel.cn");
    expect(key.help).toContain("API Keys");
  });
});