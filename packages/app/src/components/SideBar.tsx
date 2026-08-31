import type { ThemeMode } from "../theme";
import { THEME_LABEL } from "../theme";
import { ClassicGearIcon, ThemeQuickIcon } from "./icons";

interface Props {
  /** 打开添加向导(流程本体不变: 选平台 → 填 key) */
  onAdd: () => void;
  /** 手动刷新(§3.1 立即同步), 与原标题栏刷新钮同一回调 */
  onRefresh: () => void;
  /** 打开设置弹窗(纯偏好页) */
  onOpenSettings: () => void;
  /** 采集中 → 刷新图标旋转 */
  refreshing: boolean;
  /** t_66b67453 契约2: 当前主题 mode(图标反映它; 与设置弹窗三态同源同 state) */
  themeMode: ThemeMode;
  /** 主题快切: 沿 THEME_CYCLE 循环(自动→浅色→深色), App 持有同一 themeMode state */
  onCycleTheme: () => void;
}

/**
 * 左侧窄功能侧栏(D-038 信息架构): 窗口左缘垂直常驻, 宽 44px, 与面板同高。
 *
 * 操作分区语义(D-038): **侧栏 = 全局动作**(添加 / 刷新 / 设置),
 * 卡片 = 实例动作(删除), 设置弹窗 = 偏好(主题/排序/自启/存储路径)。
 * provider 余额展示是主体, 低频全局动作收进侧栏, 不再占标题栏宽度预算。
 *
 * - 按钮顺序(上→下): ＋ 添加 / ⟳ 刷新 / 弹性空隙 / ☀ 主题快切 / ⚙ 设置(底部)
 *   (t_66b67453 契约2: 主题快切钮落 spacer 之下、设置钮之上 —— 真机复验恢复,
 *    设置弹窗内三档显式选择保留不动, 两入口同走一个 themeMode state)
 * - 图标全部手绘 SVG(D-002 不引组件库), 与标题栏图钉同风格
 * - hover 提示走 title 属性; hover/active 态用既有 --bg-hover / --accent token(不新增强调色)
 * - 侧栏整体 `-webkit-app-region: no-drag`(app.css): 无边框窗拖拽区不得吃掉按钮点击
 */
export function SideBar({
  onAdd,
  onRefresh,
  onOpenSettings,
  refreshing,
  themeMode,
  onCycleTheme,
}: Props) {
  return (
    <nav className="sidebar" data-testid="sidebar" aria-label="功能侧栏">
      <button
        type="button"
        className="btn btn-icon sidebar-btn"
        data-testid="sidebar-add"
        title="添加 Provider"
        aria-label="添加 Provider"
        onClick={onAdd}
      >
        {/* 手绘加号 */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M8 3.2v9.6M3.2 8h9.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={`btn btn-icon sidebar-btn${refreshing ? " spinning" : ""}`}
        data-testid="refresh-btn"
        title="刷新"
        aria-label="刷新"
        onClick={onRefresh}
      >
        {/* 手绘环形箭头(缺口圆弧 + 箭头) */}
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
      <span className="sidebar-spacer" />
      <button
        type="button"
        className="btn btn-icon sidebar-btn"
        data-testid="theme-cycle-btn"
        data-theme-mode={themeMode}
        title={`主题: ${THEME_LABEL[themeMode]}(点击切换)`}
        aria-label={`主题: ${THEME_LABEL[themeMode]}(点击切换)`}
        onClick={onCycleTheme}
      >
        {/* 手绘主题图标(随 mode 切换): system=半日半月 / light=太阳 / dark=月亮 */}
        <ThemeQuickIcon mode={themeMode} />
      </button>
      <button
        type="button"
        className="btn btn-icon sidebar-btn"
        data-testid="settings-btn"
        title="设置"
        aria-label="设置"
        onClick={onOpenSettings}
      >
        {/* 经典齿轮剪影(齿环 + 中心孔): t_66b67453 契约3 重画 ——
            旧「中心圆+八向长齿」16px 下观感=小太阳, 新剪影与太阳一眼可辨 */}
        <ClassicGearIcon />
      </button>
    </nav>
  );
}
