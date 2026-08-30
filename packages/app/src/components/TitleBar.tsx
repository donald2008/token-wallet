import type { HealthLevel } from "../types";
import type { ThemeMode } from "../theme";
import { StatusDot } from "./StatusDot";
import { winClose, winMinimize } from "../ipc";

/** 按钮短文案(t_05271be0: system 缩为「自动」防 titlebar 换行撑高, 360px 宽度预算不足) */
const THEME_LABEL: Record<ThemeMode, string> = {
  system: "自动",
  light: "浅色",
  dark: "深色",
};

/** title 提示保留全语义(按钮文案缩短后, hover 仍见完整主题名) */
const THEME_TITLE: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

interface Props {
  health: HealthLevel;
  tooltip: string;
  themeMode: ThemeMode;
  refreshing: boolean;
  /** 窗口置顶态(P1): true=已置顶(图钉实心高亮且常显) */
  pinned: boolean;
  onTogglePin: () => void;
  onCycleTheme: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

/**
 * 标题栏(§6.5): 全局状态点 / 图钉置顶(P1) / 手动刷新 / 主题 / 设置 / 窗口控制(min/close, E1)。
 * 无边框窗(D-033): 整栏拖拽由 CSS -webkit-app-region: drag 提供(app.css .titlebar),
 * 交互控件一律 no-drag; min/close 走 win_minimize / win_close IPC。
 *
 * P1 工具区 hover 显隐: 工具按钮(.toolbar-btn)默认淡出, 鼠标进入面板淡入(纯 CSS,
 * app.css .panel:hover 联动); 置顶开启时图钉常显(状态必须可见); focus-within/
 * focus-visible 兜底键盘可达。图钉为手写 SVG(D-002 不引图标库), 置顶态填充
 * var(--accent)(D-016 既有 token, 不新增强调色)。
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
        className="btn btn-icon btn-pin toolbar-btn"
        data-testid="pin-btn"
        data-pinned={props.pinned}
        aria-pressed={props.pinned}
        title={props.pinned ? "取消置顶" : "置顶窗口"}
        onClick={props.onTogglePin}
      >
        {/* 手写图钉 SVG(推钉剪影); 描边/填充语义由 CSS 按 data-pinned 切换 */}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            className="pin-shape"
            d="M5.5 1.5h5L10 6.5 12.5 9v1H9v4.5L8 15l-1-.5V10H3.5V9L6 6.5z"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={`btn btn-icon toolbar-btn${props.refreshing ? " spinning" : ""}`}
        data-testid="refresh-btn"
        title="手动刷新(mock)"
        onClick={props.onRefresh}
      >
        <span className="icon-refresh">⟳</span>
      </button>
      <button
        type="button"
        className="btn toolbar-btn"
        data-testid="theme-toggle"
        title={`主题: ${THEME_TITLE[props.themeMode]}(点击切换)`}
        onClick={props.onCycleTheme}
      >
        {THEME_LABEL[props.themeMode]}
      </button>
      <button
        type="button"
        className="btn btn-icon toolbar-btn"
        data-testid="settings-btn"
        title="设置"
        onClick={props.onOpenSettings}
      >
        ⚙
      </button>
      <button
        type="button"
        className="btn btn-icon toolbar-btn"
        data-testid="win-min-btn"
        title="最小化"
        onClick={() => void winMinimize()}
      >
        🗕
      </button>
      <button
        type="button"
        className="btn btn-icon toolbar-btn"
        data-testid="win-close-btn"
        title="关闭(隐藏到托盘)"
        onClick={() => void winClose()}
      >
        ✕
      </button>
    </header>
  );
}
