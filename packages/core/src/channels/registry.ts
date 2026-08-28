/**
 * 通道注册表 — DESIGN.md §5.0, D-025
 *
 * 两层模型 platform → product: 添加流程 = 选平台 → 选产品 → 填参数。
 * 注册即 zod 校验; 重复 channel 拒绝; 查找按全路径或 (platform, product)。
 */
import {
  ChannelDescriptorSchema,
  channelId,
  type ChannelDescriptor,
} from "./descriptor.js";

export class ChannelRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelRegistrationError";
  }
}

export interface PlatformEntry {
  platform: string;
  display_name: string;
  logo: string;
  products: ChannelDescriptor[];
}

export class ChannelRegistry {
  private readonly byChannel = new Map<string, ChannelDescriptor>();

  /** 注册通道(zod 校验 + channel 路径一致性 + 去重), 返回规范化后的描述符 */
  register(descriptor: unknown): ChannelDescriptor {
    const parsed = ChannelDescriptorSchema.parse(descriptor);
    if (this.byChannel.has(parsed.channel)) {
      throw new ChannelRegistrationError(`通道重复注册: ${parsed.channel}`);
    }
    this.byChannel.set(parsed.channel, Object.freeze({ ...parsed }) as ChannelDescriptor);
    return parsed;
  }

  has(channel: string): boolean {
    return this.byChannel.has(channel);
  }

  /** 按全路径 "platform/product" 查找 */
  get(channel: string): ChannelDescriptor | undefined {
    return this.byChannel.get(channel);
  }

  /** 按两层模型查找 */
  resolve(platform: string, product: string): ChannelDescriptor | undefined {
    return this.byChannel.get(channelId(platform, product));
  }

  /** 全部通道(注册序) */
  list(): ChannelDescriptor[] {
    return [...this.byChannel.values()];
  }

  /** 平台列表(去重, 供通道选择器第一层) */
  listPlatforms(): PlatformEntry[] {
    const platforms = new Map<string, PlatformEntry>();
    for (const d of this.byChannel.values()) {
      let entry = platforms.get(d.platform);
      if (!entry) {
        entry = {
          platform: d.platform,
          display_name: d.platform_display_name,
          logo: d.logo,
          products: [],
        };
        platforms.set(d.platform, entry);
      }
      entry.products.push(d);
    }
    return [...platforms.values()];
  }

  /** 某平台下的全部产品(第二层) */
  listProducts(platform: string): ChannelDescriptor[] {
    return this.list().filter((d) => d.platform === platform);
  }

  get size(): number {
    return this.byChannel.size;
  }
}
