/**
 * 树形通道选择器 — DESIGN.md §5 (D-025): 平台→产品两层。
 * 平台可折叠父节点 + 产品叶子, 默认全展开, 一点直达表单。
 */
import { useMemo, useState } from "react";
import { listPlatforms, type MockChannelDescriptor } from "../channels/mockChannels";

interface Props {
  onSelect: (channel: MockChannelDescriptor) => void;
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
              <span className="tree-platform-logo-dot" data-logo={p.products[0]?.logo ?? "generic"} />
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