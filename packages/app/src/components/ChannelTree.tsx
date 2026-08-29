/**
 * 树形通道选择器 — DESIGN.md §5 (D-025): 平台→产品两层。
 * 数据源 = core PRESET_CHANNELS(单一真相源, D-036); 禁止 app 侧 mock 通道树。
 * 平台可折叠父节点 + 产品叶子, 默认全展开, 一点直达表单。
 */
import { useMemo, useState } from "react";
import { PRESET_CHANNELS, type ChannelDescriptor } from "@token-wallet/core/channels";

interface Props {
  onSelect: (channel: ChannelDescriptor) => void;
}

interface PlatformEntry {
  platform: string;
  platform_display_name: string;
  logo: string;
  products: ChannelDescriptor[];
}

/** 由 core 预置目录聚合平台列表(与 ChannelRegistry.listPlatforms 同语义) */
function listPlatforms(): PlatformEntry[] {
  const map = new Map<string, PlatformEntry>();
  for (const d of PRESET_CHANNELS) {
    let entry = map.get(d.platform);
    if (!entry) {
      entry = {
        platform: d.platform,
        platform_display_name: d.platform_display_name,
        logo: d.logo,
        products: [],
      };
      map.set(d.platform, entry);
    }
    entry.products.push(d);
  }
  return [...map.values()];
}

/** 合同: 渲染平台 → 产品 树。叶子点击 → onSelect(该通道描述符) */
export function ChannelTree({ onSelect }: Props) {
  const platforms = useMemo(() => listPlatforms(), []);
  // 默认全展开
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (platform: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  return (
    <div className="channel-tree" data-testid="channel-tree">
      {platforms.map((p) => {
        const isCollapsed = collapsed.has(p.platform);
        return (
          <div key={p.platform} className="tree-platform">
            <button
              type="button"
              className="tree-platform-btn"
              data-testid={`tree-platform-${p.platform}`}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(p.platform)}
            >
              <span className={`tree-caret${isCollapsed ? " collapsed" : ""}`}>▾</span>
              <span className="tree-platform-logo-dot" data-logo={p.logo} />
              <span className="tree-platform-name">{p.platform_display_name}</span>
            </button>
            {!isCollapsed && (
              <div className="tree-products">
                {p.products.map((d) => (
                  <button
                    type="button"
                    key={d.channel}
                    className="tree-product-leaf"
                    data-testid={`tree-product-${d.channel.replace("/", "-")}`}
                    onClick={() => onSelect(d)}
                  >
                    <span>{d.product_display_name}</span>
                    <span className="tree-product-type">{d.plan_type === "balance" ? "余额" : "窗口"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
