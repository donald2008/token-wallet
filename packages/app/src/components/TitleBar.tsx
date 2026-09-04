import type { HealthLevel } from "../types";
import { StatusDot } from "./StatusDot";
import { winClose, winMinimize } from "../ipc";
import { t } from "../i18n";
import type { ThemeMode } from "../theme";
import { themeLabel } from "../theme";
import { ThemeQuickIcon } from "./icons";

interface Props {
  health: HealthLevel;
  tooltip: string;
  /** 窗口置顶态(P1): true=已置顶(图钉实心高亮) */
  pinned: boolean;
  onTogglePin: () => void;
  /** t_d086543b: 手动刷新(原侧栏 ⟳ 钮迁入标题栏) */
  refreshing: boolean;
  onRefresh: () => void;
  /** t_d086543b: 主题快切(原侧栏 ☀ 钮迁入标题栏); 图标反映当前 mode, 与设置弹窗三态同 state */
  themeMode: ThemeMode;
  onCycleTheme: () => void;
}

/**
 * 标题栏(§6.5, D-038 瘦身 + t_d086543b 重排): 全局状态点 / app-title / 弹性空隙 /
 * 刷新 + 主题快切 / 图钉置顶 / 最小化 / 关闭。
 *
 * t_d086543b 变更(用户拍板 2026-09-04, 侧栏整体取消):
 * - **刷新 / 主题快切**从左侧窄栏迁入标题栏(icon 小钮, 与图钉同宽 30px 命中区)。
 *   标题栏宽度预算: 360px 窗内 5 个 icon 钮 + 状态点 + 标题, 由 .spacer 收缩标题;
 *   按钮全部 .btn-icon(30px), 不额外加宽, 布局不发胖。
 * - 原 D-038 注释的「移除 刷新/设置/主题三钮」已随本次重排废止 —— 刷新/主题回归标题栏,
 *   添加/设置落在新增底边栏(BottomBar)。
 * - 所有控件常显(无 hover 显隐); 图钉 no-drag, min/close 走 win_minimize / win_close IPC。
 */
export function TitleBar(props: Props) {
  return (
    <header className="titlebar">
      <span title={props.tooltip} style={{ display: "inline-flex" }} className="no-drag">
        <StatusDot health={props.health} size={8} />
      </span>
      <span className="app-title no-drag">token-wallet</span>
      <span className="spacer" />
      <button
        type="button"
        className={`btn btn-icon${props.refreshing ? " spinning" : ""}`}
        data-testid="refresh-btn"
        title={t("side.refresh")}
        aria-label={t("side.refresh")}
        onClick={props.onRefresh}
      >
        {/* 手绘环形箭头(缺口圆弧 + 箭头, 原侧栏刷新 SVG 平移) */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M13 8a5 5 0 1 1-1.9-3.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M13.2 1.9v2.6h-2.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="btn btn-icon"
        data-testid="theme-cycle-btn"
        data-theme-mode={props.themeMode}
        title={t("side.themeTitle", { mode: themeLabel(props.themeMode) })}
        aria-label={t("side.themeTitle", { mode: themeLabel(props.themeMode) })}
        onClick={props.onCycleTheme}
      >
        {/* 手绘主题图标(随 mode 切换): system=半日半月 / light=太阳 / dark=月亮 */}
        <ThemeQuickIcon mode={props.themeMode} />
      </button>
      <button
        type="button"
        className="btn btn-icon btn-pin"
        data-testid="pin-btn"
        data-pinned={props.pinned}
        aria-pressed={props.pinned}
        title={props.pinned ? t("tb.unpin") : t("tb.pin")}
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
        className="btn btn-icon"
        data-testid="win-min-btn"
        title={t("tb.min")}
        onClick={() => void winMinimize()}
      >
        🗕
      </button>
      <button
        type="button"
        className="btn btn-icon"
        data-testid="win-close-btn"
        title={t("tb.close")}
        onClick={() => void winClose()}
      >
        ✕
      </button>
    </header>
  );
}
