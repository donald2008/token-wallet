import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bootstrap } from "./types";
import { globalHealth, sortByHealth, tooltipSummary } from "./health";
import { getBootstrap, getStoragePaths, persistConsent, updateTrayStatus } from "./ipc";
import { scenarioProviders, type ScenarioId } from "./mockData";
import { useTheme, type ThemeMode } from "./theme";
import { TitleBar } from "./components/TitleBar";
import { ProviderCard } from "./components/ProviderCard";
import { ConsentPage, ConfigErrorState, EmptyState, LoadingState, PersistErrorBar } from "./components/States";
import { ScenarioBar } from "./components/ScenarioBar";
import { SettingsView } from "./components/SettingsView";
import { LocalAgentSection } from "./components/LocalAgentSection";
import { loadPersistedInstances, useInstances, usePersistError } from "./instances/store";
import { RuntimeEngine, type EngineOutput } from "./runtime/engine";

const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"];

/** 真实引擎绑定: 实例变更 → 重建引擎 → 订阅快照(面板只读内存 latest, 启动从库恢复) */
function useRealEngine(instances: ReturnType<typeof useInstances>): {
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
  // W3: 持久化写盘失败 → 顶部错误条(可关闭; 新错误出现时重新弹出)
  const persistError = usePersistError();
  const [dismissedPersistError, setDismissedPersistError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioId>("mixed");
  const [refreshing, setRefreshing] = useState(false);
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
      const [b, instErr, paths] = await Promise.all([
        getBootstrap(),
        loadPersistedInstances(),
        getStoragePaths(),
      ]);
      if (!alive) return;
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

  // 真实实例存在 → 引擎快照; 否则 dev 场景(仅 dev 渲染)
  const providers = useMemo(
    () => (hasInstances ? output.snapshots : scenarioProviders(scenario)),
    [hasInstances, output.snapshots, scenario],
  );
  const health = providers === null || providers.length === 0 ? "unknown" : globalHealth(providers);
  const tooltip = useMemo(
    () => (providers === null ? "token-wallet — 加载中" : tooltipSummary(providers)),
    [providers],
  );

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
    void persistConsent(); // P0-7: 落盘 settings.json(Tauri) / localStorage(浏览器)
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
          initialStep={settingsStep}
          onBack={() => setView("panel")}
        />
      </div>
    );
  }

  return (
    <div className="panel">
      {persistError && persistError !== dismissedPersistError && (
        // W3: 写盘失败顶部错误条(内存态仍可用, 可关闭; 出现新错误时重新弹出)
        <PersistErrorBar error={persistError} onDismiss={() => setDismissedPersistError(persistError)} />
      )}
      <TitleBar
        health={health}
        tooltip={tooltip}
        themeMode={themeMode}
        refreshing={refreshing}
        onCycleTheme={onCycleTheme}
        onRefresh={onRefresh}
        onOpenSettings={openSettings}
      />
      {providers === null ? (
        <LoadingState />
      ) : providers.length === 0 ? (
        <EmptyState onAdd={openAddProvider} />
      ) : (
        <main className="card-list" data-testid="card-list">
          {sortByHealth(providers).map((p) => (
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
              initialStep={settingsStep}
              onBack={closeSettings}
            />
          </div>
        </div>
      )}
    </div>
  );
}
