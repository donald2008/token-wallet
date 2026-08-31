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
    product_display_name: "Coding",
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

it("预置通道含 deepseek/balance + opencode/go + kimi/coding + aliyun-bailian/token-plan + volcengine-ark/coding-plan + zai/coding", () => {
    expect(PRESET_CHANNELS).toHaveLength(6);
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

  it("预置通道: aliyun-bailian/token-plan 是 command 类首实例, 零录入(D-041)", () => {
    const bailian = PRESET_CHANNELS.find((c) => c.channel === "aliyun-bailian/token-plan")!;
    expect(bailian).toBeDefined();
    expect(bailian.adapter).toBe("command");
    expect(bailian.plan_type).toBe("window");
    expect(bailian.platform_display_name).toBe("阿里云百炼");
    expect(bailian.product_display_name).toBe("Token Plan");
    // D-041 决策: console 会话由 CLI 自管, app 零凭据 → params_schema=[]
    expect(bailian.params_schema).toEqual([]);
    expect(bailian.health_check?.command).toContain("bl auth status");
    expect(ChannelDescriptorSchema.safeParse(bailian).success).toBe(true);
  });

  it("预置通道: volcengine-ark/coding-plan 是 command 类第二实例, 零录入(D-043)", () => {
    const ark = PRESET_CHANNELS.find((c) => c.channel === "volcengine-ark/coding-plan")!;
    expect(ark).toBeDefined();
    expect(ark.adapter).toBe("command");
    expect(ark.plan_type).toBe("window");
    expect(ark.platform_display_name).toBe("火山方舟");
    expect(ark.product_display_name).toBe("Coding Plan");
    // D-041/D-043 决策: SSO 会话由 CLI 自管, app 零凭据 → params_schema=[]
    expect(ark.params_schema).toEqual([]);
    expect(ark.health_check?.command).toContain("arkcli auth status");
    expect(ark.health_check?.setup_hint).toContain("arkcli auth login volc-sso");
    expect(ChannelDescriptorSchema.safeParse(ark).success).toBe(true);
  });

  it("预置通道: opencode/go 与 kimi/coding 是 window 制, 描述符自身通过 schema", () => {
    const opencode = PRESET_CHANNELS.find((c) => c.channel === "opencode/go")!;
    const kimi = PRESET_CHANNELS.find((c) => c.channel === "kimi/coding")!;
    expect(opencode.plan_type).toBe("window");
    expect(opencode.adapter).toBe("http");
    expect(opencode.platform_display_name).toBe("opencode");
    expect(opencode.product_display_name).toBe("Go Coding");
    expect(kimi.plan_type).toBe("window");
    expect(kimi.platform_display_name).toBe("Kimi");
    expect(kimi.product_display_name).toBe("Coding");
    for (const c of [opencode, kimi]) {
      expect(ChannelDescriptorSchema.safeParse(c).success).toBe(true);
      const key = c.params_schema.find((p) => p.key === "api_key");
      expect(key?.type).toBe("secret");
      expect(key?.required).toBe(true);
    }
  });
});
