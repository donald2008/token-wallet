import type { HealthLevel } from "../types";
import { StatusDot } from "./StatusDot";
import { winClose, winMinimize } from "../ipc";

interface Props {
  health: HealthLevel;
  tooltip: string;
  /** 窗口置顶态(P1): true=已置顶(图钉实心高亮) */
  pinned: boolean;
  onTogglePin: () => void;
}

/**
 * 标题栏(§6.5, D-038 瘦身): 全局状态点 / app-title / 图钉置顶 / 最小化 / 关闭。
 *
 * D-038 变更:
 * - 移除 刷新 / 设置 / 主题切换 三钮 —— 刷新与设置迁入左侧窄侧栏(全局动作分区),
 *   主题切换只留设置页(不新增控件)。
 * - **hover 显隐逻辑整体移除**: 三个控件(图钉/最小化/关闭)全部常显, 图钉不再有
 *   \"置顶时常显\"特判(常显即无需特判)。少而常显 > 多而隐藏。
 *
 * 无边框窗(D-033): 整栏拖拽由 CSS -webkit-app-region: drag 提供(app.css .titlebar),
 * 交互控件一律 no-drag; min/close 走 win_minimize / win_close IPC。
 * 图钉为手写 SVG(D-002 不引图标库), 置顶态填充 var(--accent)(D-016 既有 token)。
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
        className="btn btn-icon btn-pin"
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
