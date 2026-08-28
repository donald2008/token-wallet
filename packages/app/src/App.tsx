import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bootstrap } from "./types";
import { globalHealth, sortByHealth, tooltipSummary } from "./health";
import { getBootstrap, persistConsent, updateTrayStatus } from "./ipc";
import { scenarioProviders, type ScenarioId } from "./mockData";
import { useTheme, type ThemeMode } from "./theme";
import { TitleBar } from "./components/TitleBar";
import { ProviderCard } from "./components/ProviderCard";
import { ConsentPage, EmptyState, LoadingState } from "./components/States";
import { ScenarioBar } from "./components/ScenarioBar";
import { SettingsView } from "./components/SettingsView";
import { LocalAgentSection } from "./components/LocalAgentSection";

const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"];

export default function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [consented, setConsented] = useState(false);
  const [scenario, setScenario] = useState<ScenarioId>("mixed");
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"panel" | "settings">("panel");

  // 首开判定(§10 占位): Rust 侧 get_bootstrap; 纯浏览器 fallback 用 localStorage
  useEffect(() => {
    let alive = true;
    getBootstrap().then((b) => {
      if (!alive) return;
      setBootstrap(b);
      setConsented(!b.firstRun);
      if (b.theme !== "system") setThemeMode(b.theme);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providers = useMemo(() => scenarioProviders(scenario), [scenario]);
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
    // mock: 真实刷新 = 触发适配器立即同步(P0-5)
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 800);
  }, []);

  const onCycleTheme = useCallback(() => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(themeMode) + 1) % THEME_CYCLE.length];
    setThemeMode(next);
  }, [themeMode, setThemeMode]);

  const onAgree = useCallback(() => {
    persistConsent();
    setConsented(true);
    setScenario("empty"); // 初始零 provider 配置(§10)
  }, []);

  if (!bootstrap) {
    return (
      <div className="panel">
        <LoadingState />
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
    return (
      <div className="panel">
        <SettingsView
          themeMode={themeMode}
          onThemeMode={setThemeMode}
          onBack={() => setView("panel")}
        />
      </div>
    );
  }

  return (
    <div className="panel">
      <TitleBar
        health={health}
        tooltip={tooltip}
        themeMode={themeMode}
        refreshing={refreshing}
        onCycleTheme={onCycleTheme}
        onRefresh={onRefresh}
        onOpenSettings={() => setView("settings")}
      />
      {providers === null ? (
        <LoadingState />
      ) : providers.length === 0 ? (
        <EmptyState onAdd={() => setScenario("mixed")} />
      ) : (
        <main className="card-list" data-testid="card-list">
          {sortByHealth(providers).map((p) => (
            <ProviderCard key={p.provider_id} p={p} />
          ))}
        </main>
      )}
      <LocalAgentSection />
      <ScenarioBar scenario={scenario} onChange={setScenario} />
    </div>
  );
}
