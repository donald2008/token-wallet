import { useEffect, useState } from "react";
import type { ThemeMode } from "../theme";
import {
  getBootstrap,
  getStoragePaths,
  getLaunchAtLogin,
  setLaunchAtLogin,
  onUpdaterEvent,
  updaterCheck,
  updaterDownload,
  updaterInstall,
  setLangPersisted,
  type StoragePaths,
  type UpdaterState,
} from "../ipc";
import { t, tKey, type Lang } from "../i18n";
import { useLang } from "../i18nReact";
import { BrandLogo } from "./brand-logos";
import { McpServicePanel } from "./McpServicePanel";
import { AgentGuideModal } from "./AgentGuideModal";
import { GLASS_ALPHA_MIN, GLASS_ALPHA_MAX, persistGlassAlpha } from "../theme";

const THEME_OPTIONS: { id: ThemeMode; labelKey: string }[] = [
  { id: "system", labelKey: "theme.system" },
  { id: "light", labelKey: "theme.light" },
  { id: "dark", labelKey: "theme.dark" },
];

/** 语言选项: 用各语言自称(不经翻译, i18n 惯例); 顺序 = LANGS 声明序(zh 在前) */
const LANG_OPTIONS: { id: Lang; label: string }[] = [
  { id: "zh", label: "简体中文" },
  { id: "en", label: "English" },
];

interface Props {
  themeMode: ThemeMode;
  onThemeMode: (m: ThemeMode) => void;
  /** 玻璃特效开关(2026-09-03): 半透明面板 + 背景模糊, 正交于主题三态 */
  glass: boolean;
  onGlass: (g: boolean) => void;
  /** t_c20d4d11 9/7: 玻璃透明度滑槽(默认 1.0 不透明)。关闭玻璃时 alpha 保留, 切回恢复 */
  glassAlpha: number;
  /** 拖动即变(实时写 CSS, 不持久化); 停手落 localStorage 由 SettingsView onPointerUp 触发 */
  onGlassAlpha: (a: number) => void;
  onBack: () => void;
  /** theme-glass 实验入口: 打开进度条形态方案页(可选, 缺省不渲染入口) */
  onOpenQuota?: () => void;
  /** page = 页内导航(保留形态); modal = 设置弹窗(P0-6), 头部渲染 × 关闭 */
  variant?: "page" | "modal";
}

/**
 * 设置页 = 纯偏好页(D-038 瘦身; D-010/D-019/D-024/#829 R1/R3):
 * - 主题(D-010): 跟随系统/浅色/深色 —— 标题栏 ☀ 钮快切与此处三档同走一套 theme state
 * - 排序(t_d086543b 简化): 排序只留手动, 无选择控件 —— 仅提示「拖动卡片自定义顺序」
 * - 开机自启(D-024): 默认关
 * - 存储路径展示(D-019): 运行时解析
 * - 布局(#829 R3): .settings-head 固定不滚动, 滚动只发生在 .settings-body 内容区
 *
 * **不再承载 provider 管理**(D-038 操作分区): 添加 = 底边栏 ＋(AddProviderWizard),
 * 删除 = provider 卡内删除钮。此处不得再出现实例列表/增删按钮。
 */
export function SettingsView({
  themeMode,
  onThemeMode,
  glass,
  onGlass,
  glassAlpha,
  onGlassAlpha,
  onBack,
  variant = "page",
  onOpenQuota,
}: Props) {
  const { lang, setLang } = useLang();
  const [storagePaths, setStoragePaths] = useState<StoragePaths | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updater, setUpdater] = useState<UpdaterState | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

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
        <h3>{t("common.settings")}</h3>
        {variant === "modal" ? (
          <button
            type="button"
            className="btn btn-icon"
            data-testid="settings-close"
            aria-label={t("set.closeAria")}
            onClick={onBack}
          >
            ×
          </button>
        ) : (
          <button type="button" className="btn" data-testid="settings-back" onClick={onBack}>
            {t("common.back")}
          </button>
        )}
      </div>

      {/* #829 R3: 头部(.settings-head)固定不滚, 滚动只发生在头下方 .settings-body 内容区;
          modal/page 两 variant 同结构生效 */}
      <div className="settings-body" data-testid="settings-body">
        <section className="settings-section">
          <h4>{t("set.theme")}</h4>
          <div className="seg" data-testid="theme-seg">
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`btn${themeMode === o.id ? " active" : ""}`}
                data-testid={`theme-${o.id}`}
                onClick={() => onThemeMode(o.id)}
              >
                {tKey(o.labelKey)}
              </button>
            ))}
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              data-testid="glass-toggle"
              checked={glass}
              onChange={(e) => onGlass(e.target.checked)}
            />
            <span>{t("set.glass")}</span>
          </label>
          {/* t_c20d4d11 9/7: 玻璃透明度滑槽 — 范围 15%~100%, 默认 100% 不透明。
              拖动即变(onChange 实时写 CSS 变量, theme.css 用 color-mix 算实际背景色);
              停手即存(onPointerUp + onBlur 落 localStorage)。玻璃开关 off 时 alpha 控件仍显示
              (保留设置), 但视觉上不影响非玻璃主题面板 */}
          <div className="slider-row" data-testid="glass-alpha-row">
            <label htmlFor="glass-alpha-input" className="slider-label">
              {t("set.glassAlpha")}
              <span className="slider-value" data-testid="glass-alpha-value">
                {Math.round(glassAlpha * 100)}%
              </span>
            </label>
            <input
              id="glass-alpha-input"
              type="range"
              className="slider"
              data-testid="glass-alpha-input"
              min={GLASS_ALPHA_MIN}
              max={GLASS_ALPHA_MAX}
              step={0.05}
              value={glassAlpha}
              aria-label={t("set.glassAlpha")}
              onChange={(e) => onGlassAlpha(Number(e.currentTarget.value))}
              onPointerUp={(e) => persistGlassAlpha(Number(e.currentTarget.value))}
              onBlur={(e) => persistGlassAlpha(Number(e.currentTarget.value))}
              onKeyUp={(e) => {
                // 键盘可达性: 方向键 / Tab 失焦时落盘
                if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
                  persistGlassAlpha(Number(e.currentTarget.value));
                }
              }}
            />
            <p className="hint">{t("set.glassAlphaHint")}</p>
          </div>
          <p className="hint">{t("set.themeHint")}</p>
        </section>

        {/* Phase B(i18n, D-047): 界面语言 — 主题同款分段控件(zh/en), 切换即生效 + settings.json 持久化 */}
        <section className="settings-section" data-testid="lang-sec">
          <h4>{t("set.language")}</h4>
          <div className="seg" data-testid="lang-seg">
            {LANG_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`btn${lang === o.id ? " active" : ""}`}
                data-testid={`lang-${o.id}`}
                onClick={() => {
                  setLang(o.id); // 模块级 + localStorage + Provider 重渲染(即时生效)
                  void setLangPersisted(o.id); // 真壳 settings.json RMW(重启保持)
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="hint">{t("set.languageHint")}</p>
        </section>

        <section className="settings-section" data-testid="sort-sec">
          <h4>{t("set.sort")}</h4>
          {/* t_d086543b: 排序只留手动 —— 无选择控件; 提示性文案说明拖拽即排序
              (选择控件 sort-key-* / sort-dir-* 已全部移除) */}
          <p className="hint">{t("set.sortHint")}</p>
        </section>

        <section className="settings-section" data-testid="autostart-sec">
          <h4>{t("set.autostart")}</h4>
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
            <span>{t("set.autostartHint")}</span>
          </label>
        </section>

        {storagePaths && (
          <section className="settings-section" data-testid="storage-paths">
            <h4>{t("set.storage")}</h4>
            <dl className="paths">
              <div className="path-row">
                <dt>{t("set.config")}</dt>
                <dd data-testid="config-dir">{storagePaths.configDir}</dd>
              </div>
              <div className="path-row">
                <dt>{t("set.data")}</dt>
                <dd data-testid="data-dir">{storagePaths.dataDir}</dd>
              </div>
            </dl>
            <p className="hint">{t("set.storageHint")}</p>
          </section>
        )}

        {/* P1(t_696ec820): 关于区 — token-wallet 自身品牌 logo(内置 SVG 消费点) */}
        <section className="settings-section settings-about" data-testid="about-section">
          <div className="about-row">
            <BrandLogo platform="token-wallet" size={20} className="about-logo" />
            <span className="about-name">token-wallet</span>
            <span className="about-tag">{t("set.about")}</span>
          </div>
          <div className="about-update" data-testid="updater-area">
            <span className="about-version" data-testid="about-version">
              {appVersion ? `v${appVersion}` : "…"}
            </span>
            <UpdaterControl state={updater} />
          </div>
          <p className="hint">{t("set.aboutHint")}</p>
        </section>

        <section className="settings-section" data-testid="mcp-sec">
          <h4>{t("set.mcpTitle")}</h4>
          <McpServicePanel onGuideOpen={() => setGuideOpen(true)} />
        </section>

        {/* theme-glass 实验(t_37416b22): 进度条形态方案页入口 */}
        {onOpenQuota && (
          <section className="settings-section" data-testid="quota-entry">
            <h4>{t("set.quotaGallery")}</h4>
            <button type="button" className="btn" data-testid="quota-open" onClick={onOpenQuota}>
              {t("quota.open")}
            </button>
          </section>
        )}
      </div>
      <AgentGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
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
        {t("updater.unavailable")}
      </span>
    );
  }
  switch (state.status) {
    case "checking":
      return (
        <span className="updater-state" data-testid="updater-state" data-updater-status="checking">
          {t("updater.checking")}
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
          {t("updater.check")}
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
          {t("updater.toVersion", { version: state.version ?? "?" })}
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
          {t("updater.downloading", { percent: state.percent ?? 0 })}
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
          {t("updater.installTo", { version: state.version ?? "?" })}
        </button>
      );
    case "error":
      return (
        <span className="updater-state updater-error" data-testid="updater-state" data-updater-status="error">
          {t("updater.failed")}
        </span>
      );
  }
}
