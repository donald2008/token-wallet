import type { HealthLevel } from "../types";
import { t } from "../i18n";
import { healthLabel } from "../health";

/** 全局/条目状态点: 填充色走 --ok/--warn/--bad/--unknown(图形角色, D-016)
 * 尺寸 = --space-8(8px, audit §2.1 components) */
export function StatusDot({ health, size = 8 }: { health: HealthLevel; size?: number }) {
  return (
    <span
      className="status-dot"
      data-testid="status-dot"
      data-health={health}
      style={{ width: size, height: size }}
      title={t("card.statusDot", { label: healthLabel(health) })}
    />
  );
}
