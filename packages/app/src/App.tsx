import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bootstrap } from "./types";
import { globalHealth, sortProviders, tooltipSummary, type SortConfig } from "./health";
import { getBootstrap, getSortConfig, getStoragePaths, persistConsent, setSortConfig as persistSortConfig, updateTrayStatus, winGetAlwaysOnTop, winSetAlwaysOnTop } from "./ipc";
import { selectPanelProviders } from "./panelProviders";
import type { ScenarioId } from "./mockData";
import { useTheme, type ThemeMode } from "./theme";
import { TitleBar } from "./components/TitleBar";
import { ProviderCard } from "./components/ProviderCard";
import {
  ConsentPage,
  ConfigErrorState,
  EmptyState,
  LoadingState,
  CollectingState,
  PersistErrorBar,
} from "./components/States";
import { ScenarioBar } from "./components/ScenarioBar";
import { SettingsView } from "./components/SettingsView";
import { LocalAgentSection } from "./components/LocalAgentSection";
import { loadPersistedInstances, useInstances, usePersistError } from "./instances/store";
import { useDismissibleError } from "./instances/useDismissibleError";
import { RuntimeEngine, type EngineOutput } from "./runtime/engine";

const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"];

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
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
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
  // 页内导航仅留给首开向导(D-021 一次性引导); 设置入口 = 模态弹窗(P0-6)
  const [view, setView] = useState<"panel" | "settings">("panel");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsStep, setSettingsStep] = useState<"overview" | "add-channel" | "fill-form">("overview");

  const instances = useInstances();
  const { engine, output } = useRealEngine(instances);
  const hasInstances = instances.length > 0;

  // 首开判定(§10, P0-7 接真): Rust get_bootstrap 读 settings.json consent;
  // 并行加载 instances.yaml → 预填内存 store(面板重启后实例仍在)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [b, instErr, paths, sortCfg] = await Promise.all([
        getBootstrap(),
        loadPersistedInstances(),
        getStoragePaths(),
        getSortConfig(),
      ]);
      if (!alive) return;
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
        ? "token-wallet — 数据采集中"
        : providers === null
          ? "token-wallet — 加载中"
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

  const onCycleTheme = useCallback(() => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(themeMode) + 1) % THEME_CYCLE.length];
    setThemeMode(next);
  }, [themeMode, setThemeMode]);

  const onAgree = useCallback(() => {
    void persistConsent(); // P0-7: 落盘 settings.json(桌面壳) / localStorage(浏览器)
    setConsented(true);
    setScenario("empty"); // 初始零 provider 配置(§10)
  }, []);

  // D-021 首开引导: 空态"添加 Provider" → 页内导航进设置添加流程(一次性引导, 保持现状)
  const openAddProvider = useCallback(() => {
    setSettingsStep("add-channel");
    setView("settings");
  }, []);

  // 设置入口 = 模态弹窗(P0-6): 叠在面板上, × / 点遮罩 / ESC 关闭
  const openSettings = useCallback(() => {
    setSettingsStep("overview");
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  // ESC 关闭设置弹窗
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, closeSettings]);

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

  if (view === "settings") {
    // 首开向导(D-021): 一次性引导流程保持页内导航
    return (
      <div className="panel">
        <SettingsView
          variant="page"
          themeMode={themeMode}
          onThemeMode={setThemeMode}
          sortConfig={sortConfig}
          onSortConfig={onSortConfig}
          initialStep={settingsStep}
          onBack={() => setView("panel")}
        />
      </div>
    );
  }

  return (
    <div className="panel">
      {visiblePersistError && (
        // W3: 写盘失败顶部错误条(内存态仍可用, 可关闭; 恢复后同消息再失败会重弹)
        <PersistErrorBar error={visiblePersistError} onDismiss={dismissPersistError} />
      )}
      <TitleBar
        health={health}
        tooltip={tooltip}
        themeMode={themeMode}
        refreshing={refreshing}
        pinned={pinned}
        onTogglePin={onTogglePin}
        onCycleTheme={onCycleTheme}
        onRefresh={onRefresh}
        onOpenSettings={openSettings}
      />
      {providers === null ? (
        <LoadingState />
      ) : collecting ? (
        // P0-8: 已配置实例但快照未到 → "数据采集中", 不显示 EmptyState 误导
        <CollectingState />
      ) : providers.length === 0 ? (
        <EmptyState onAdd={openAddProvider} />
      ) : (
        <main className="card-list" data-testid="card-list">
          {sortProviders(providers, sortConfig).map((p) => (
            <ProviderCard key={p.provider_id} p={p} />
          ))}
        </main>
      )}
      <LocalAgentSection />
      {!hasInstances && <ScenarioBar scenario={scenario} onChange={setScenario} />}
      {settingsOpen && (
        // 设置模态弹窗(P0-6): 半透明遮罩叠在面板上方, 点遮罩关闭; 弹层自身圆角+阴影(D-031 无边框窗口)
        <div className="settings-overlay" data-testid="settings-overlay" onClick={closeSettings}>
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="设置"
            onClick={(e) => e.stopPropagation()}
          >
            <SettingsView
              variant="modal"
              themeMode={themeMode}
              onThemeMode={setThemeMode}
              sortConfig={sortConfig}
              onSortConfig={onSortConfig}
              initialStep={settingsStep}
              onBack={closeSettings}
            />
          </div>
        </div>
      )}
    </div>
  );
}
