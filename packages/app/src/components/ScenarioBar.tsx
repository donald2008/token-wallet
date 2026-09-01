import { SCENARIOS, type ScenarioId } from "../mockData";
import { t, tKey } from "../i18n";

/**
 * dev 场景切换器: 仅开发环境渲染, 用于演示/验收四色托盘联动与各面板状态。
 * 生产构建(tree-shake + import.meta.env.DEV=false)不包含。
 */
export function ScenarioBar({
  scenario,
  onChange,
}: {
  scenario: ScenarioId;
  onChange: (s: ScenarioId) => void;
}) {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="scenario-bar" data-testid="scenario-bar">
      {SCENARIOS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`btn${scenario === s.id ? " active" : ""}`}
          data-testid={`scenario-${s.id}`}
          title={s.expectHealth !== "-" ? t("scenario.expectHealth", { health: s.expectHealth }) : undefined}
          onClick={() => onChange(s.id)}
        >
          {tKey(s.label)}
        </button>
      ))}
    </div>
  );
}
