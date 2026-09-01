import type { HealthLevel } from "../types";
import { t } from "../i18n";
import { healthLabel } from "../health";

/** 全局/条目状态点: 填充色走 --ok/--warn/--bad/--unknown(图形角色, D-016) */
export function StatusDot({ health, size = 10 }: { health: HealthLevel; size?: number }) {
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
