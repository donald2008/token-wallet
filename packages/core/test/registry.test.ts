import { describe, expect, it } from "vitest";
import {
  ChannelDescriptorSchema,
  channelId,
} from "../src/channels/descriptor.js";
import { ChannelRegistry } from "../src/channels/registry.js";
import { DEEPSEEK_BALANCE, PRESET_CHANNELS } from "../src/channels/presets.js";

function makeDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    platform: "kimi",
    product: "kimi-code",
    channel: "kimi/kimi-code",
    display_name: "Kimi Code",
    platform_display_name: "Kimi",
    plan_type: "window",
    adapter: "http",
    logo: "kimi",
    params_schema: [
      { key: "api_key", label: "API Key", type: "secret", required: true },
    ],
    ...overrides,
  };
}

describe("ChannelDescriptorSchema", () => {
  it("接受合法描述符; channel 必须等于 platform/product", () => {
    expect(ChannelDescriptorSchema.safeParse(makeDescriptor()).success).toBe(true);
    expect(
      ChannelDescriptorSchema.safeParse(makeDescriptor({ channel: "kimi/other" })).success,
    ).toBe(false);
  });

  it("command 通道可带 health_check + setup_hint", () => {
    const d = makeDescriptor({
      platform: "volcengine-ark",
      product: "coding-plan",
      channel: "volcengine-ark/coding-plan",
      adapter: "command",
      params_schema: [],
      health_check: {
        command: "arkcli auth status",
        setup_hint: "arkcli auth login --no-browser",
      },
    });
    expect(ChannelDescriptorSchema.safeParse(d).success).toBe(true);
  });
});

describe("ChannelRegistry", () => {
  it("注册/按全路径与两层模型查找", () => {
    const reg = new ChannelRegistry();
    reg.register(makeDescriptor());
    expect(reg.has("kimi/kimi-code")).toBe(true);
    expect(reg.get("kimi/kimi-code")?.display_name).toBe("Kimi Code");
    expect(reg.resolve("kimi", "kimi-code")?.plan_type).toBe("window");
    expect(reg.resolve("kimi", "kimi-platform")).toBeUndefined();
    expect(channelId("a", "b")).toBe("a/b");
  });

  it("重复注册拒绝", () => {
    const reg = new ChannelRegistry();
    reg.register(makeDescriptor());
    expect(() => reg.register(makeDescriptor())).toThrow(/重复注册/);
  });

  it("非法描述符在注册时被 zod 拒", () => {
    const reg = new ChannelRegistry();
    expect(() => reg.register({ platform: "x" })).toThrow();
  });

  it("两层模型: listPlatforms 聚合同平台多产品, listProducts 过滤", () => {
    const reg = new ChannelRegistry();
    reg.register(makeDescriptor());
    reg.register(
      makeDescriptor({
        product: "kimi-platform",
        channel: "kimi/kimi-platform",
        display_name: "Kimi 开放平台",
        plan_type: "balance",
      }),
    );
    reg.register(DEEPSEEK_BALANCE);

    const platforms = reg.listPlatforms();
    expect(platforms.map((p) => p.platform).sort()).toEqual(["deepseek", "kimi"]);
    const kimi = platforms.find((p) => p.platform === "kimi")!;
    expect(kimi.products).toHaveLength(2);
    expect(reg.listProducts("kimi").map((d) => d.product).sort()).toEqual([
      "kimi-code",
      "kimi-platform",
    ]);
    expect(reg.listProducts("deepseek")).toHaveLength(1);
    expect(reg.size).toBe(3);
  });

  it("预置通道含 deepseek/balance 且参数含 secret api_key", () => {
    expect(PRESET_CHANNELS).toHaveLength(1);
    const d = DEEPSEEK_BALANCE;
    expect(d.channel).toBe("deepseek/balance");
    expect(d.plan_type).toBe("balance");
    expect(d.adapter).toBe("http");
    const key = d.params_schema.find((p) => p.key === "api_key");
    expect(key?.type).toBe("secret");
    expect(key?.required).toBe(true);
    // 预置描述符自身必须通过 schema 校验
    expect(ChannelDescriptorSchema.safeParse(d).success).toBe(true);
  });
});
