import type { ThemeMode } from "../theme";

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];

/** 设置抽屉占位 — 本卡只交付主题覆盖(D-010), 其余为后续卡占位展示 */
export function SettingsView({
  themeMode,
  onThemeMode,
  onBack,
}: {
  themeMode: ThemeMode;
  onThemeMode: (m: ThemeMode) => void;
  onBack: () => void;
}) {
  return (
    <div className="settings-view" data-testid="settings-view">
      <div className="settings-section">
        <h3>主题</h3>
        <div className="seg" data-testid="theme-seg">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`btn${themeMode === o.id ? " active" : ""}`}
              data-testid={`theme-${o.id}`}
              onClick={() => onThemeMode(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="hint">默认追随系统(prefers-color-scheme), 可在此覆盖(D-010)。</p>
      </div>
      <div className="settings-section">
        <h3>状态阈值(占位)</h3>
        <p className="hint">
          黄线 30% / 红线 10%(剩余百分比), 全局可配置(D-022) — 后续卡片接入。
        </p>
      </div>
      <div className="settings-section">
        <h3>通知(占位)</h3>
        <p className="hint">P3 实现, 默认关(D-009)。</p>
      </div>
      <div className="settings-section">
        <h3>开机自启(占位)</h3>
        <p className="hint">默认关(D-024) — 后续卡片接入。</p>
      </div>
      <button type="button" className="btn" data-testid="settings-back" onClick={onBack}>
        ← 返回面板
      </button>
    </div>
  );
}
