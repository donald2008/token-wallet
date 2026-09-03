import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bootstrap } from "./types";
import { globalHealth, sortProviders, tooltipSummary, type SortConfig } from "./health";
import {
  getBootstrap,
  getPersistedLang,
  getSortConfig,
  getStoragePaths,
  persistConsent,
  setSortConfig as persistSortConfig,
  updateTrayStatus,
  winGetAlwaysOnTop,
  winSetAlwaysOnTop,
} from "./ipc";
import { selectPanelProviders } from "./panelProviders";
import type { ScenarioId } from "./mockData";
import { useTheme, THEME_CYCLE } from "./theme";
import { LangProvider, useLang } from "./i18nReact";
import { getLang, t } from "./i18n";
import { TitleBar } from "./components/TitleBar";
import { SideBar } from "./components/SideBar";
import { ProviderCard } from "./components/ProviderCard";
import { useCardDragSort } from "./useCardDragSort";
import {
  ConsentPage,
  ConfigErrorState,
  EmptyState,
  LoadingState,
  CollectingState,
  NoMatchState,
  PersistErrorBar,
} from "./components/States";
import { ScenarioBar } from "./components/ScenarioBar";
import { SettingsView } from "./components/SettingsView";
import { AddProviderWizard } from "./components/AddProviderWizard";
import { QuotaGallery } from "./components/QuotaGallery";
import { LocalAgentSection } from "./components/LocalAgentSection";
import { FilterIcons, DEFAULT_FILTER, matchesFilter, type FilterSel } from "./components/FilterChips";
import {
  getSharedKeyring,
  getSharedStore,
  loadPersistedInstances,
  useInstances,
  usePersistError,
} from "./instances/store";
import { useDismissibleError } from "./instances/useDismissibleError";
import { RuntimeEngine, type EngineOutput } from "./runtime/engine";

/**
 * 真实引擎绑定: 实例变更 → 重建引擎 → 订阅快照(面板只读内存 latest, 启动从库恢复)。
 * 导出供 L1 测试直接驱动删除流程(B-3「删除后 UI 无旧帧」React act 断言)。
 */
export function useRealEngine(instances: ReturnType<typeof useInstances>): {
  engine: RuntimeEngine | null;
  output: EngineOutput;
} {
  const [output, setOutput] = useState<EngineOutput>({ snapshots: [], stats: {} });
  const engineRef = useRef<RuntimeEngine | null>(null);
  const instancesKey = useMemo(() => instances.map((i) => i.id).join(","), [instances]);

  useEffect(() => {
    // 实例集合变化(增/删) → 重建引擎
    engineRef.current?.stop();
    if (instances.length === 0) {
      engineRef.current = null;
      setOutput({ snapshots: [], stats: {} });
      return;
    }
    const engine = new RuntimeEngine(instances);
    engineRef.current = engine;
    const unsub = engine.subscribe(setOutput);
    engine.start();
    return () => {
      unsub();
      engineRef.current?.stop();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instancesKey]);

  return { engine: engineRef.current, output };
}

export default function App() {
  return (
    <LangProvider>
      <AppShell />
    </LangProvider>
  );
}

function AppShell() {
  const { mode: themeMode, setMode: setThemeMode, glass, setGlass } = useTheme();
  // Phase B: 启动读回持久化语言(真壳 settings.json → setLang 对齐模块级+重渲染; 浏览器=/mock 同语义)
  const { setLang: applyPersistedLang } = useLang();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [consented, setConsented] = useState(false);
  // instances.yaml 损坏/校验失败 → fail-fast 错误页(§5.0.1, 不静默丢配置)
  const [configError, setConfigError] = useState<string | null>(null);
  // O1: 配置错误页显示 instances.yaml 完整路径(get_storage_paths 运行时解析, 不硬编码)
  const [instancesPath, setInstancesPath] = useState<string | null>(null);
  // W3: 持久化写盘失败 → 顶部错误条(可关闭; 错误清除时 dismiss 标记自动复位,
  // 故恢复后同消息再失败仍会重弹 — 见 useDismissibleError 注释)
  const persistError = usePersistError();
  const { visible: visiblePersistError, dismiss: dismissPersistError } = useDismissibleError(persistError);
  const [scenario, setScenario] = useState<ScenarioId>("mixed");
  const [refreshing, setRefreshing] = useState(false);
  // P1 窗口置顶态: 启动时读回(真壳=settings.json, 浏览器=localStorage 降级)
  const [pinned, setPinned] = useState(false);
  // P1(#829 R1): 卡间排序配置(key×dir, 缺省名称正排); 启动读回, 切换即持久化
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: "name", dir: "asc" });
  // P1(t_6484ecc6): 主页过滤 chips 选中态(单选, 默认「全部」= 现状零变化; 重启回「全部」)
  const [filter, setFilter] = useState<FilterSel>(DEFAULT_FILTER);
  // 页内导航仅留给首开向导 + 方案页(D-021 一次性引导 view="add"; theme-glass 实验 view="quota")
  const [view, setView] = useState<"panel" | "add" | "quota">("panel");
  // D-038: 设置弹窗(纯偏好) 与 添加向导弹窗(侧栏 ＋) 是两个独立模态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const instances = useInstances();
  const { engine, output } = useRealEngine(instances);
  const hasInstances = instances.length > 0;

  // 首开判定(§10, P0-7 接真): Rust get_bootstrap 读 settings.json consent;
  // 并行加载 instances.yaml → 预填内存 store(面板重启后实例仍在)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [b, instErr, paths, sortCfg, persistedLang] = await Promise.all([
        getBootstrap(),
        loadPersistedInstances(),
        getStoragePaths(),
        getSortConfig(),
        getPersistedLang(),
      ]);
      if (!alive) return;
      // Phase B: 持久化语言(settings.json/localStorage)与模块级初值不一致时对齐(localStorage 同 key 幂等)
      if (persistedLang !== getLang()) applyPersistedLang(persistedLang);
      setSortConfig(sortCfg);
      // O1: configDir + 平台分隔符拼 instances.yaml 完整路径, 供配置错误页展示
      setInstancesPath(
        `${paths.configDir}${paths.configDir.includes("\\") ? "\\" : "/"}instances.yaml`,
      );
      if (instErr) {
        // fail-fast: 配置损坏时停在错误页, 不用空配置覆盖/继续
        setConfigError(instErr);
        setBootstrap(b);
        return;
      }
      setBootstrap(b);
      setConsented(!b.firstRun);
      if (b.theme !== "system") setThemeMode(b.theme);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 数据源裁决(P0-8): 真实实例 → 引擎快照; 零实例 → dev 场景预览(生产构建绝不走 mock,
  // 直接 EmptyState —— DESIGN "不显示假数据"原则, scenarioProviders 门禁见 panelProviders.ts)
  const providers = useMemo(
    () =>
      selectPanelProviders({
        hasInstances,
        snapshots: output.snapshots,
        scenario,
        isProd: import.meta.env.PROD,
      }),
    [hasInstances, output.snapshots, scenario],
  );
  // P0-8 空态语义: 已配置实例但快照未到(引擎启动中/采集中) → "数据采集中",
  // 不再渲染 EmptyState"添加 Provider"(用户已添加过, 那是误导)
  const collecting = hasInstances && output.snapshots.length === 0;
  const health = providers === null || providers.length === 0 ? "unknown" : globalHealth(providers);
  const tooltip = useMemo(
    () =>
      collecting
        ? t("tray.collecting")
        : providers === null
          ? t("tray.loading")
          : tooltipSummary(providers),
    [collecting, providers],
  );

  // P1: 置顶态启动读回(win_get_always_on_top → settings.json)
  useEffect(() => {
    let alive = true;
    void winGetAlwaysOnTop().then((v) => {
      if (alive) setPinned(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onTogglePin = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    void winSetAlwaysOnTop(next); // 回写持久化(settings.json / localStorage 降级)
  }, [pinned]);

  // 排序配置切换(#829 R1): 内存态即生效 + 回写持久化(真壳 settings.json / 浏览器 localStorage)
  const onSortConfig = useCallback((next: SortConfig) => {
    setSortConfig(next);
    void persistSortConfig(next);
  }, []);

  // P1(t_6484ecc6): 一层 filter(chips 选中态 → 命中子集), 排序仍走 sortProviders 原排序器。
  //   过滤在排序之前(先缩小视角再按配置排), 不改变排序器语义; 默认「全部」= 原 providers 全集。
  const filteredProviders = useMemo(
    () => (providers ?? []).filter((p) => matchesFilter(p, filter)),
    [providers, filter],
  );
  // D-039 拖动排序: 渲染顺序 = sortProviders 输出; drop 才切 manual + 持久化一次
  const sortedCards = useMemo(() => sortProviders(filteredProviders, sortConfig), [filteredProviders, sortConfig]);
  const { drag, indicatorY, makeHandleProps } = useCardDragSort({
    ids: sortedCards.map((p) => p.provider_id),
    onDrop: useCallback(
      (order: string[]) => {
        // 拖动即切 manual(契约 §1): 用户接管排序, 按拖动结果生效; order 持久化一次
        const next: SortConfig = { key: "manual", dir: "asc", order };
        setSortConfig(next);
        void persistSortConfig(next);
      },
      [],
    ),
  });

  // 托盘联动: 全局最差状态 → 托盘色点 + tooltip(D-003)
  useEffect(() => {
    void updateTrayStatus(health, tooltip);
  }, [health, tooltip]);

  const onRefresh = useCallback(() => {
    // 真实刷新: 触发适配器立即同步(§3.1); 无实例时 mock 空转
    setRefreshing(true);
    if (engine) {
      void engine.refreshAll().finally(() => setRefreshing(false));
    } else {
      window.setTimeout(() => setRefreshing(false), 800);
    }
  }, [engine]);

  const onAgree = useCallback(() => {
    void persistConsent(); // P0-7: 落盘 settings.json(桌面壳) / localStorage(浏览器)
    setConsented(true);
    setScenario("empty"); // 初始零 provider 配置(§10)
  }, []);

  // D-021 首开引导: 空态"添加 Provider" → 页内导航进添加向导(一次性引导, 保持现状)
  const openAddProvider = useCallback(() => {
    setView("add");
  }, []);

  // D-038: 侧栏 ＋ 添加 → 添加向导弹窗(叠面板, 流程本体不变)
  const openAddModal = useCallback(() => {
    setAddOpen(true);
  }, []);

  const closeAddModal = useCallback(() => {
    setAddOpen(false);
  }, []);

  // 设置入口 = 模态弹窗(P0-6, D-038 起入口在侧栏底部): 叠在面板上, × / 点遮罩 / ESC 关闭
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  // t_66b67453 契约2: 侧栏主题快切 = 沿 THEME_CYCLE 循环(system→light→dark→system);
  // 与设置弹窗三态分段控件走同一 themeMode state(一处切换两处同步)
  const onCycleTheme = useCallback(() => {
    const idx = THEME_CYCLE.indexOf(themeMode);
    setThemeMode(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]!);
  }, [themeMode, setThemeMode]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  // D-038: 卡内删除 → 既有 store.remove(五步删除事务: 停源→purge DB→清钥匙串→摘卡→落盘)
  const onDeleteProvider = useCallback((id: string) => {
    getSharedStore().remove(id, getSharedKeyring());
  }, []);

  // 真实实例集合: 仅真实实例卡渲染删除钮(dev 场景 mock 预览卡不给无效按钮)
  const realInstanceIds = useMemo(() => new Set(instances.map((i) => i.id)), [instances]);

  // ESC 关闭模态(设置 / 添加向导)
  useEffect(() => {
    if (!settingsOpen && !addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (addOpen) closeAddModal();
      else closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, addOpen, closeSettings, closeAddModal]);

  if (!bootstrap) {
    return (
      <div className="panel">
        <LoadingState />
      </div>
    );
  }

  if (configError) {
    return (
      <div className="panel">
        <ConfigErrorState error={configError} instancesPath={instancesPath ?? undefined} />
      </div>
    );
  }

  if (!consented) {
    return (
      <div className="panel">
        <ConsentPage onAgree={onAgree} />
      </div>
    );
  }

  if (view === "add") {
    // 首开向导(D-021): 一次性引导流程保持页内导航(不弹模态)
    return (
      <div className="panel">
        <AddProviderWizard variant="page" onBack={() => setView("panel")} />
      </div>
    );
  }

  if (view === "quota") {
    // theme-glass 实验: 进度条形态方案页(设置页入口打开, 页内导航回面板)
    return (
      <div className="panel">
        <QuotaGallery onBack={() => setView("panel")} />
      </div>
    );
  }

  return (
    <div className="panel">
      {/* t_66b67453 契约1: 标题栏独占第一行(全宽) —— 用户原始诉求「侧栏从窗口最上沿
          开始, 观感=侧栏把标题栏切短了」; 重排后侧栏从第二行左缘开始 */}
      <TitleBar health={health} tooltip={tooltip} pinned={pinned} onTogglePin={onTogglePin} />
      <div className="panel-body">
        {/* D-038 左侧窄功能侧栏(全局动作), t_66b67453 契约2 增主题快切钮 */}
        <SideBar
          onAdd={openAddModal}
          onRefresh={onRefresh}
          onOpenSettings={openSettings}
          refreshing={refreshing}
          themeMode={themeMode}
          onCycleTheme={onCycleTheme}
        />
        <div className="panel-main" data-testid="panel-main">
          {visiblePersistError && (
            // W3: 写盘失败顶部错误条(内存态仍可用, 可关闭; 恢复后同消息再失败会重弹)
            <PersistErrorBar error={visiblePersistError} onDismiss={dismissPersistError} />
          )}
          {providers === null ? (
            <LoadingState />
          ) : collecting ? (
            // P0-8: 已配置实例但快照未到 → "数据采集中", 不显示 EmptyState 误导
            <CollectingState />
          ) : providers.length === 0 ? (
            <EmptyState onAdd={openAddProvider} />
          ) : (
            // P1(t_9639078b): 过滤三枚 icon 钮浮在卡片列表右上角 —— 与卡片列表同容器(绝对定位),
            // 随内容滚动运动(不吸顶), 因此滚动内容不会与钮组重叠(修 v0.1.2 平台 chips 被卡片盖住)。
            // 过滤后命中为空(如仅剩异常) → 居中「无匹配实例」(钮组仍在, 可点回其他视角)。
            <main className="card-list" data-testid="card-list">
              <FilterIcons value={filter} onChange={setFilter} />
              {filteredProviders.length === 0 ? (
                <NoMatchState />
              ) : (
                <>
                  {/* D-039 落点指示线(拖动中显示): 绝对定位在插入边界 */}
                  {drag && indicatorY !== null && (
                    <div className="drop-line" data-testid="drop-line" style={{ top: indicatorY }} />
                  )}
                  {sortedCards.map((p) => (
                    <ProviderCard
                      key={p.provider_id}
                      p={p}
                      onDelete={realInstanceIds.has(p.provider_id) ? onDeleteProvider : undefined}
                      dragHandle={makeHandleProps(p.provider_id)}
                      dragging={drag?.id === p.provider_id}
                      dragDy={drag ? drag.dy : 0}
                    />
                  ))}
                </>
              )}
            </main>
          )}
          <LocalAgentSection />
          {!hasInstances && <ScenarioBar scenario={scenario} onChange={setScenario} />}
        </div>
      </div>
      {settingsOpen && (
        // 设置模态弹窗(P0-6): 半透明遮罩叠在面板上方, 点遮罩关闭; 弹层自身圆角+阴影(D-031 无边框窗口)
        <div className="settings-overlay" data-testid="settings-overlay" onClick={closeSettings}>
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("common.settings")}
            onClick={(e) => e.stopPropagation()}
          >
            <SettingsView
              variant="modal"
              themeMode={themeMode}
              onThemeMode={setThemeMode}
              glass={glass}
              onGlass={setGlass}
              sortConfig={sortConfig}
              onSortConfig={onSortConfig}
              onBack={closeSettings}
              onOpenQuota={() => {
                closeSettings();
                setView("quota");
              }}
            />
          </div>
        </div>
      )}
      {addOpen && (
        // D-038: 添加向导弹窗(与设置弹窗同形态: 遮罩 + 圆角弹层, × / 遮罩 / ESC 关闭)
        <div className="settings-overlay" data-testid="add-overlay" onClick={closeAddModal}>
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("common.add")}
            onClick={(e) => e.stopPropagation()}
          >
            <AddProviderWizard variant="modal" onBack={closeAddModal} />
          </div>
        </div>
      )}
    </div>
  );
}
