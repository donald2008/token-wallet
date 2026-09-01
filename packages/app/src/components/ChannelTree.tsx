/**
 * 添加页通道选择器 — 方案 A 品牌卡片网格(P1, t_696ec820)。
 *
 * 弃树形, 改网格选择器(D-025 两层模型 platform → product 保持; 仅视觉/交互重设计):
 * - 网格: CSS grid auto-fit, 2~3 列(360px 弹窗 2 列, 800px 3 列)
 * - 每格 = BrandLogo(24px) + 平台名 + 产品数角标; 默认全展开(产品 chips 可见)
 * - 点平台头 → 收起为紧凑卡片(参与网格列); 再点 → 展开为整行(grid-column 1/-1)平铺 chips
 * - chip = 产品名 + 计费形态徽章「窗口/余额」, 点 chip → onSelect(descriptor)(对齐既有 onSelect 契约)
 * - 键盘可达(Tab + Enter)
 *
 * 数据源 = core PRESET_CHANNELS(D-036 单一真相源); 禁 app 侧 mock 通道树。
 * ⚠️ testid 兼容(e2e 60 条不破): channel-tree / tree-platform-* / tree-product-* 锚点 id 不变。
 */
import { useMemo, useState } from "react";
import { PRESET_CHANNELS, type ChannelDescriptor } from "@token-wallet/core/channels";
import { BrandLogo } from "./brand-logos";
import { t } from "../i18n";

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

/** 合同: 网格渲染平台 → 产品 chips。chip 点击 → onSelect(通道描述符)。 */
export function ChannelBrandGrid({ onSelect }: Props) {
  const platforms = useMemo(() => listPlatforms(), []);
  // 默认全展开(产品 chips 可见) —— e2e 直接点 tree-product-* 且设置页折叠用例断言默认可见
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
    <div className="channel-grid" data-testid="channel-tree">
      {platforms.map((p) => {
        const isCollapsed = collapsed.has(p.platform);
        return (
          <div
            key={p.platform}
            className={`brand-grid-card${isCollapsed ? " collapsed" : ""}`}
            data-platform={p.platform}
          >
            <button
              type="button"
              className="brand-grid-head"
              data-testid={`tree-platform-${p.platform}`}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(p.platform)}
            >
              <BrandLogo platform={p.logo} size={24} className="brand-grid-logo" />
              <span className="brand-grid-name">{p.platform_display_name}</span>
              <span className="brand-grid-count">{p.products.length}</span>
            </button>
            {!isCollapsed && (
              <div className="brand-grid-chips">
                {p.products.map((d) => (
                  <button
                    type="button"
                    key={d.channel}
                    className="brand-grid-chip"
                    data-testid={`tree-product-${d.channel.replace("/", "-")}`}
                    onClick={() => onSelect(d)}
                  >
                    <span className="chip-name">{d.product_display_name}</span>
                    <span className={`chip-type chip-${d.plan_type}`}>
                      {d.plan_type === "balance" ? t("plan.balance") : t("plan.window")}
                    </span>
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

/** 兼容导出名(AddProviderWizard 既有 import; 组件内改名可, 锚点 id 不变)。 */
export const ChannelTree = ChannelBrandGrid;
export default ChannelBrandGrid;