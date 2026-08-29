import type { HealthLevel } from "../types";
import type { ThemeMode } from "../theme";
import { StatusDot } from "./StatusDot";
import { winClose, winMinimize } from "../ipc";

const THEME_LABEL: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

interface Props {
  health: HealthLevel;
  tooltip: string;
  themeMode: ThemeMode;
  refreshing: boolean;
  onCycleTheme: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

/**
 * 标题栏(§6.5): 全局状态点 / 手动刷新 / 主题 / 设置 / 窗口控制(min/close, E1)。
 * 无边框窗(D-033): 整栏拖拽由 CSS -webkit-app-region: drag 提供(app.css .titlebar),
 * 交互控件一律 no-drag; min/close 走 win_minimize / win_close IPC。
 */
export function TitleBar(props: Props) {
  return (
    <header className="titlebar">
      <span title={props.tooltip} style={{ display: "inline-flex" }} className="no-drag">
        <StatusDot health={props.health} size={10} />
      </span>
      <span className="app-title no-drag">token-wallet</span>
      <span className="spacer" />
      <button
        type="button"
        className={`btn btn-icon${props.refreshing ? " spinning" : ""}`}
        data-testid="refresh-btn"
        title="手动刷新(mock)"
        onClick={props.onRefresh}
      >
        <span className="icon-refresh">⟳</span>
      </button>
      <button
        type="button"
        className="btn"
        data-testid="theme-toggle"
        title={`主题: ${THEME_LABEL[props.themeMode]}(点击切换)`}
        onClick={props.onCycleTheme}
      >
        {THEME_LABEL[props.themeMode]}
      </button>
      <button
        type="button"
        className="btn btn-icon"
        data-testid="settings-btn"
        title="设置"
        onClick={props.onOpenSettings}
      >
        ⚙
      </button>
      <button
        type="button"
        className="btn btn-icon"
        data-testid="win-min-btn"
        title="最小化"
        onClick={() => void winMinimize()}
      >
        🗕
      </button>
      <button
        type="button"
        className="btn btn-icon"
        data-testid="win-close-btn"
        title="关闭(隐藏到托盘)"
        onClick={() => void winClose()}
      >
        ✕
      </button>
    </header>
  );
}
