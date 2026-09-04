import { t } from "../i18n";
import { ClassicGearIcon } from "./icons";

interface Props {
  /** 打开添加向导(流程本体不变: 选平台 → 填 key) */
  onAdd: () => void;
  /** 打开设置弹窗(纯偏好页) */
  onOpenSettings: () => void;
}

/**
 * 底边栏(t_d086543b 新增, 用户拍板 2026-09-04): 侧栏取消后, 全局低频动作
 * 「添加 / 设置」落在窗口底部一条窄栏, 左右分布(icon + 文字标签, 一眼可辨)。
 *
 * 形态设计: 高 ~36px(icon 16 + 文字 12 + 上下 8px padding), **不做得像一条空栏** ——
 * 两个按钮各含 icon+label 有实际内容, 左右拉开(space-between), 上下留 4/8 网格节奏;
 * 底色 .bg-elev + 上缘 1px --border 与内容区分界。hover/active 走既有 --bg-hover/--accent token。
 *
 * 操作分区语义(D-038 延续): 标题栏 = 窗口/全局态(刷新/主题/图钉/最小化/关闭),
 * 底边栏 = 低频全局动作(添加/设置), 卡片 = 实例动作(删除), 设置弹窗 = 纯偏好。
 */
export function BottomBar({ onAdd, onOpenSettings }: Props) {
  return (
    <nav className="bottombar" data-testid="bottombar" aria-label={t("side.aria")}>
      <button
        type="button"
        className="btn bottombar-btn"
        data-testid="add-btn"
        title={t("common.add")}
        onClick={onAdd}
      >
        {/* 手绘加号(原侧栏 ＋ SVG 平移) */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M8 3.2v9.6M3.2 8h9.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        <span className="bottombar-label">{t("common.add")}</span>
      </button>
      <button
        type="button"
        className="btn bottombar-btn"
        data-testid="settings-btn"
        title={t("common.settings")}
        onClick={onOpenSettings}
      >
        {/* 经典齿轮剪影(t_66b67453 契约3 重画, 原侧栏 ⚙ SVG 平移) */}
        <ClassicGearIcon />
        <span className="bottombar-label">{t("common.settings")}</span>
      </button>
    </nav>
  );
}
