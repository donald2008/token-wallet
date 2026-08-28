import { describe, expect, it, vi } from "vitest";
import {
  applyPipe,
  evalAssertion,
  evalJsonPath,
  evalJsonPathFirst,
  MappingError,
  parseAssertion,
} from "../src/mapping/jsonpath.js";
import {
  GenericHttpAdapter,
  ProviderAdapterRegistry,
  ScriptedAdapter,
  type AdapterContext,
  type InstanceConfig,
} from "../src/adapters.js";
import { TemplateRegistry } from "../src/templates.js";
import { NoopNotifier, NotifierRegistry } from "../src/notifier.js";
import { DEEPSEEK_BALANCE } from "../src/channels/presets.js";
import type { ChannelDescriptor } from "../src/channels/descriptor.js";
import type { ProviderSnapshot } from "../src/schema.js";

describe("安全 JSONPath(§5.1)", () => {
  const json = { data: { balance: "42.5", items: [{ v: 1 }, { v: 2 }] } };

  it("纯求值取数", () => {
    expect(evalJsonPathFirst(json, "$.data.balance")).toBe("42.5");
    expect(evalJsonPath(json, "$.data.items[*].v")).toEqual([1, 2]);
  });

  it("非 $ 开头拒绝; 脚本表达式被拒绝执行(eval:false)", () => {
    expect(() => evalJsonPath(json, "data.balance")).toThrow(MappingError);
    // eval:false 下脚本表达式直接抛错, 绝不执行(§5.1 无 eval)
    expect(() => evalJsonPath({ a: 1 }, "$..[?(@.a)]")).toThrow(/prevented/i);
  });

  it("过滤器白名单: number/string/round/duration", () => {
    expect(applyPipe("42.5", ["number"])).toBe(42.5);
    expect(applyPipe(42.567, ["round"])).toBe(43);
    expect(applyPipe(42, ["string"])).toBe("42");
    expect(applyPipe("PT1H30M", ["duration"])).toBe(5400);
    expect(applyPipe(300, ["duration"])).toBe(300);
    expect(() => applyPipe("x", ["number"])).toThrow(MappingError);
    // 白名单外过滤器类型层面不存在, 运行时强转也被拦
    expect(() => applyPipe("x", ["eval" as never])).toThrow(/白名单/);
  });

  it("受限比较表达式: 解析 + 求值, 无 eval", () => {
    expect(parseAssertion("$.percent >= 90")).toEqual({
      path: "$.percent",
      op: ">=",
      literal: 90,
    });
    expect(evalAssertion({ percent: 95 }, "$.percent >= 90")).toBe(true);
    expect(evalAssertion({ percent: 50 }, "$.percent >= 90")).toBe(false);
    expect(evalAssertion({ status: "active" }, "$.status == 'active'")).toBe(true);
    expect(evalAssertion({ status: "x" }, "$.status != 'active'")).toBe(true);
    expect(evalAssertion({ on: true }, "$.on == true")).toBe(true);
    // 任意 JS 不合法
    expect(() => parseAssertion("process.exit(1)")).toThrow(MappingError);
    expect(() => parseAssertion("$.a == alert(1)")).toThrow(MappingError);
  });
});

describe("GenericHttpAdapter 骨架(声明式映射)", () => {
  const instance: InstanceConfig = {
    id: "deepseek",
    channel: "deepseek/balance",
    name: "DeepSeek-按量 #1",
    params: { api_key: { source: "env", key: "DS_KEY" } },
  };

  function makeCtx(_body: unknown, _status = 200): AdapterContext {
    return {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      fetchedAt: 1724900000,
      resolveCredential: (() => Promise.resolve("sk-test")) as AdapterContext["resolveCredential"],
    };
  }

  const mapping = {
    url: "https://api.deepseek.com/user/balance",
    headers: { Authorization: "Bearer {{api_key}}" },
    metrics: [
      {
        key: "remaining",
        kind: "balance" as const,
        unit: "cny" as const,
        used: { path: "$.data.balance", pipes: ["number" as const] },
      },
    ],
  };

  it("一次请求 + JSONPath 静态映射 → ok 快照", async () => {
    const fetchMock = vi.fn(
      (_url: string, _init?: { headers?: Record<string, string> }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { balance: "42.5" } }),
        } as Response),
    );
    const adapter = new GenericHttpAdapter(mapping, fetchMock as unknown as typeof fetch);
    const ctx = makeCtx({});
    const snap = await adapter.fetchSnapshot(DEEPSEEK_BALANCE, instance, ctx);
    expect(snap.status).toBe("ok");
    expect(snap.metrics[0]).toMatchObject({ key: "remaining", used: 42.5, unit: "cny" });
    // 凭据进了 Authorization 头(构造瞬间), 快照里没有
    const init = fetchMock.mock.calls[0][1];
    expect(init?.headers?.Authorization).toBe("Bearer sk-test");
    expect(JSON.stringify(snap)).not.toContain("sk-test");
  });

  it("401 → auth_expired 快照; 500 → error 快照", async () => {
    const ctx = makeCtx({});
    for (const [status, expected] of [
      [401, "auth_expired"],
      [500, "error"],
    ] as const) {
      const fetchMock = vi.fn(() =>
        Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response),
      );
      const adapter = new GenericHttpAdapter(mapping, fetchMock as unknown as typeof fetch);
      const snap = await adapter.fetchSnapshot(DEEPSEEK_BALANCE, instance, ctx);
      expect(snap.status).toBe(expected);
    }
  });

  it("网络异常 → error 快照(不抛出)", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    const adapter = new GenericHttpAdapter(mapping, fetchMock as unknown as typeof fetch);
    const snap = await adapter.fetchSnapshot(DEEPSEEK_BALANCE, instance, makeCtx({}));
    expect(snap.status).toBe("error");
    expect(snap.error_message).toContain("ECONNREFUSED");
  });
});

describe("四注册点(§4)", () => {
  it("ProviderAdapterRegistry 注册/查找/去重", () => {
    const reg = new ProviderAdapterRegistry();
    const adapter = new GenericHttpAdapter({ url: "https://x", metrics: [] });
    reg.register("deepseek/balance", adapter);
    expect(reg.get("deepseek/balance")).toBe(adapter);
    expect(reg.list()).toEqual(["deepseek/balance"]);
    expect(() => reg.register("deepseek/balance", adapter)).toThrow(/重复/);
  });

  it("ScriptedAdapter 抽象基类可继承, runCommand 可用", async () => {
    class EchoAdapter extends ScriptedAdapter {
      readonly kind = "command" as const;
      async fetchSnapshot(
        d: ChannelDescriptor,
        inst: InstanceConfig,
        ctx: AdapterContext,
      ): Promise<ProviderSnapshot> {
        const out = await this.runCommand("printf", ["hello"], ctx);
        return {
          provider_id: inst.id,
          display_name: inst.name,
          plan_type: d.plan_type,
          fetched_at: ctx.fetchedAt,
          status: "ok",
          metrics: [{ key: "out", kind: "usage", unit: "tokens", used: out.length }],
          alerts: [],
        };
      }
      expose(cmd: string, args: string[], ctx: AdapterContext) {
        return this.runCommand(cmd, args, ctx);
      }
    }
    const a = new EchoAdapter();
    const ctx = {
      signal: new AbortController().signal,
      timeoutMs: 15_000,
      fetchedAt: 1724900000,
      resolveCredential: (() => Promise.resolve("")) as AdapterContext["resolveCredential"],
    };
    await expect(a.expose("printf", ["abc"], ctx)).resolves.toBe("abc");
    await expect(a.expose("sh", ["-c", "exit 3"], ctx)).rejects.toThrow(/exit=3/);
  });

  it("TemplateRegistry 按原型过滤; NotifierRegistry 广播 + Noop 空实现", async () => {
    const tr = new TemplateRegistry();
    tr.register({ id: "bars", display_name: "进度条", archetypes: ["window"], component: {} });
    tr.register({ id: "ticker", display_name: "大数字", archetypes: ["balance"], component: {} });
    expect(tr.forArchetype("window").map((t) => t.id)).toEqual(["bars"]);
    expect(tr.forArchetype("balance").map((t) => t.id)).toEqual(["ticker"]);
    expect(() =>
      tr.register({ id: "bars", display_name: "x", archetypes: [], component: null }),
    ).toThrow(/重复/);

    const nr = new NotifierRegistry();
    const noop = new NoopNotifier();
    nr.register(noop);
    await nr.dispatch({ level: "warn", title: "t", message: "m", at: 1724900000 });
    expect(noop.received).toBe(1);
  });
});
