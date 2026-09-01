import { useEffect, useState } from "react";
import type { ThemeMode } from "../theme";
import type { SortConfig, SortDir, SortKey } from "../health";
import {
  getBootstrap,
  getStoragePaths,
  getLaunchAtLogin,
  setLaunchAtLogin,
  onUpdaterEvent,
  updaterCheck,
  updaterDownload,
  updaterInstall,
  type StoragePaths,
  type UpdaterState,
} from "../ipc";
import { BrandLogo } from "./brand-logos";

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
  { id: "manual", label: "手动" },
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
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updater, setUpdater] = useState<UpdaterState | null>(null);

  // 存储路径(D-019) + 开机自启(D-024), 默认关
  useEffect(() => {
    void getStoragePaths().then(setStoragePaths);
    void getLaunchAtLogin().then(setAutoStart);
  }, []);

  // D-046: 当前版本(get_bootstrap) + updater 状态初始化 + 主进程事件订阅
  useEffect(() => {
    let disposed = false;
    void getBootstrap().then((b) => {
      if (!disposed) setAppVersion(b.version);
    });
    void updaterCheck().then((state) => {
      if (!disposed) setUpdater(state);
    });
    const off = onUpdaterEvent((event) => {
      if (!disposed) setUpdater(event);
    });
    return () => {
      disposed = true;
      off();
    };
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
            默认追随系统(prefers-color-scheme), 可在此覆盖(D-010)。侧栏底部 ☀ 钮可快切循环
            (t_66b67453 契约2), 与此处三档同走一个主题状态。
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
            {/* D-039: 手动模式按拖拽顺序排列, dir 无意义 → 禁用方向控件(契约: manual 持久化 dir:"asc") */}
            <div className="seg" data-testid="sort-dir-seg">
              {SORT_DIR_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`btn${sortConfig.key !== "manual" && sortConfig.dir === o.id ? " active" : ""}`}
                  data-testid={`sort-dir-${o.id}`}
                  disabled={sortConfig.key === "manual"}
                  onClick={() => onSortConfig({ ...sortConfig, dir: o.id })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">
            缺省: 名称正排。紧要度 = 按卡内最紧窗口剩余比例(剩余越少越靠前), 方向独立生效(#829 R1)。
            手动 = 拖拽卡片顺序(D-039), 方向不适用。
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

        {/* P1(t_696ec820): 关于区 — token-wallet 自身品牌 logo(内置 SVG 消费点) */}
        <section className="settings-section settings-about" data-testid="about-section">
          <div className="about-row">
            <BrandLogo platform="token-wallet" size={20} className="about-logo" />
            <span className="about-name">token-wallet</span>
            <span className="about-tag">AI 套餐/额度桌面仪表盘</span>
          </div>
          <div className="about-update" data-testid="updater-area">
            <span className="about-version" data-testid="about-version">
              {appVersion ? `v${appVersion}` : "…"}
            </span>
            <UpdaterControl state={updater} />
          </div>
          <p className="hint">内置单色品牌图标, 离线可渲染(currentColor 随主题自适应)。</p>
        </section>
      </div>
    </div>
  );
}

/**
 * D-046: 更新控件 — 按钮文案由状态机驱动, 零内部状态;
 * 主进程默认 autoDownload=false, 下载与安装永远由这里的点击显式触发。
 */
function UpdaterControl({ state }: { state: UpdaterState | null }) {
  if (!state || state.status === "unavailable") {
    // dev / 更新源不可用: 低调展示, 不给不可用的按钮
    return (
      <span className="updater-state" data-testid="updater-state" data-updater-status={state?.status ?? "unavailable"}>
        更新功能仅安装版可用
      </span>
    );
  }
  switch (state.status) {
    case "checking":
      return (
        <span className="updater-state" data-testid="updater-state" data-updater-status="checking">
          正在检查更新…
        </span>
      );
    case "up-to-date":
      return (
        <button
          type="button"
          className="btn"
          data-testid="updater-check-btn"
          onClick={() => void updaterCheck()}
        >
          检查更新
        </button>
      );
    case "available":
      return (
        <button
          type="button"
          className="btn btn-primary"
          data-testid="updater-download-btn"
          onClick={() => void updaterDownload()}
        >
          更新到 v{state.version ?? "?"}
        </button>
      );
    case "downloading":
      return (
        <span
          className="updater-state"
          data-testid="updater-state"
          data-updater-status="downloading"
          aria-live="polite"
        >
          正在下载 {state.percent ?? 0}%
        </span>
      );
    case "ready":
      return (
        <button
          type="button"
          className="btn btn-primary"
          data-testid="updater-install-btn"
          onClick={() => void updaterInstall()}
        >
          重启安装 v{state.version ?? "?"}
        </button>
      );
    case "error":
      return (
        <span className="updater-state updater-error" data-testid="updater-state" data-updater-status="error">
          更新失败, 稍后重试
        </span>
      );
  }
}
