import { useEffect, useState } from "react";
import type { ThemeMode } from "../theme";
import type { SortConfig, SortDir, SortKey } from "../health";
import { getStoragePaths, getLaunchAtLogin, setLaunchAtLogin, type StoragePaths } from "../ipc";

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];

interface Props {
  themeMode: ThemeMode;
  onThemeMode: (m: ThemeMode) => void;
  /** 卡间排序配置(#829 R1): key(名称|紧要度)×dir(正排|倒排), 由 App 持有并持久化 */
  sortConfig: SortConfig;
  onSortConfig: (c: SortConfig) => void;
  onBack: () => void;
  /** page = 页内导航(保留形态); modal = 设置弹窗(P0-6), 头部渲染 × 关闭 */
  variant?: "page" | "modal";
}

const SORT_KEY_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "name", label: "名称" },
  { id: "urgency", label: "紧要度" },
];

const SORT_DIR_OPTIONS: { id: SortDir; label: string }[] = [
  { id: "asc", label: "正排" },
  { id: "desc", label: "倒排" },
];

/**
 * 设置页 = 纯偏好页(D-038 瘦身; D-010/D-019/D-024/#829 R1/R3):
 * - 主题(D-010): 跟随系统/浅色/深色 —— 标题栏主题切换钮已移除, 此处是唯一入口
 * - 排序(#829 R1): 键(名称/紧要度)×方向(正排/倒排)两正交控件, 缺省名称正排
 * - 开机自启(D-024): 默认关
 * - 存储路径展示(D-019): 运行时解析
 * - 布局(#829 R3): .settings-head 固定不滚动, 滚动只发生在 .settings-body 内容区
 *
 * **不再承载 provider 管理**(D-038 操作分区): 添加 = 侧栏 ＋(AddProviderWizard),
 * 删除 = provider 卡内删除钮。此处不得再出现实例列表/增删按钮。
 */
export function SettingsView({
  themeMode,
  onThemeMode,
  sortConfig,
  onSortConfig,
  onBack,
  variant = "page",
}: Props) {
  const [storagePaths, setStoragePaths] = useState<StoragePaths | null>(null);
  const [autoStart, setAutoStart] = useState(false);

  // 存储路径(D-019) + 开机自启(D-024), 默认关
  useEffect(() => {
    void getStoragePaths().then(setStoragePaths);
    void getLaunchAtLogin().then(setAutoStart);
  }, []);

  return (
    <div className="settings-view" data-testid="settings-view">
      <div className="settings-head">
        <h3>设置</h3>
        {variant === "modal" ? (
          <button
            type="button"
            className="btn btn-icon"
            data-testid="settings-close"
            aria-label="关闭设置"
            onClick={onBack}
          >
            ×
          </button>
        ) : (
          <button type="button" className="btn" data-testid="settings-back" onClick={onBack}>
            ← 返回
          </button>
        )}
      </div>

      {/* #829 R3: 头部(.settings-head)固定不滚, 滚动只发生在头下方 .settings-body 内容区;
          modal/page 两 variant 同结构生效 */}
      <div className="settings-body" data-testid="settings-body">
        <section className="settings-section">
          <h4>主题</h4>
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
          <p className="hint">
            默认追随系统(prefers-color-scheme), 可在此覆盖(D-010)。标题栏不再放主题入口(D-038)。
          </p>
        </section>

        <section className="settings-section" data-testid="sort-sec">
          <h4>排序</h4>
          <div className="sort-controls">
            <div className="seg" data-testid="sort-key-seg">
              {SORT_KEY_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`btn${sortConfig.key === o.id ? " active" : ""}`}
                  data-testid={`sort-key-${o.id}`}
                  onClick={() => onSortConfig({ ...sortConfig, key: o.id })}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="seg" data-testid="sort-dir-seg">
              {SORT_DIR_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`btn${sortConfig.dir === o.id ? " active" : ""}`}
                  data-testid={`sort-dir-${o.id}`}
                  onClick={() => onSortConfig({ ...sortConfig, dir: o.id })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">
            缺省: 名称正排。紧要度 = 按卡内最紧窗口剩余比例(剩余越少越靠前), 方向独立生效(#829 R1)。
          </p>
        </section>

        <section className="settings-section" data-testid="autostart-sec">
          <h4>开机自启</h4>
          <label className="check-row">
            <input
              type="checkbox"
              data-testid="autostart-toggle"
              checked={autoStart}
              onChange={(e) => {
                const next = e.target.checked;
                setAutoStart(next);
                void setLaunchAtLogin(next);
              }}
            />
            <span>登录时自动启动(默认关,D-024)</span>
          </label>
        </section>

        {storagePaths && (
          <section className="settings-section" data-testid="storage-paths">
            <h4>存储路径</h4>
            <dl className="paths">
              <div className="path-row">
                <dt>配置</dt>
                <dd data-testid="config-dir">{storagePaths.configDir}</dd>
              </div>
              <div className="path-row">
                <dt>数据</dt>
                <dd data-testid="data-dir">{storagePaths.dataDir}</dd>
              </div>
            </dl>
            <p className="hint">配置与数据分家(D-019), 运行时解析的真实路径。</p>
          </section>
        )}
      </div>
    </div>
  );
}
