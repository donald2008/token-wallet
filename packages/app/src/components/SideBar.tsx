interface Props {
  /** 打开添加向导(流程本体不变: 选平台 → 填 key) */
  onAdd: () => void;
  /** 手动刷新(§3.1 立即同步), 与原标题栏刷新钮同一回调 */
  onRefresh: () => void;
  /** 打开设置弹窗(纯偏好页) */
  onOpenSettings: () => void;
  /** 采集中 → 刷新图标旋转 */
  refreshing: boolean;
}

/**
 * 左侧窄功能侧栏(D-038 信息架构): 窗口左缘垂直常驻, 宽 44px, 与面板同高。
 *
 * 操作分区语义(D-038): **侧栏 = 全局动作**(添加 / 刷新 / 设置),
 * 卡片 = 实例动作(删除), 设置弹窗 = 偏好(主题/排序/自启/存储路径)。
 * provider 余额展示是主体, 低频全局动作收进侧栏, 不再占标题栏宽度预算。
 *
 * - 按钮顺序(上→下): ＋ 添加 / ⟳ 刷新 / 弹性空隙 / ⚙ 设置(底部)
 * - 图标全部手绘 SVG(D-002 不引组件库), 与标题栏图钉同风格(stroke currentColor, 1.2)
 * - hover 提示走 title 属性; hover/active 态用既有 --bg-hover / --accent token(不新增强调色)
 * - 侧栏整体 `-webkit-app-region: no-drag`(app.css): 无边框窗拖拽区不得吃掉按钮点击
 */
export function SideBar({ onAdd, onRefresh, onOpenSettings, refreshing }: Props) {
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
        data-testid="settings-btn"
        title="设置"
        aria-label="设置"
        onClick={onOpenSettings}
      >
        {/* 手绘齿轮(中心圆 + 八向齿) */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle
            cx="8"
            cy="8"
            r="2.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </nav>
  );
}
