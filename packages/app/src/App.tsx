import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Bootstrap } from "./types";
import { globalHealth, sortProviders, tooltipSummary, DEFAULT_SORT_CONFIG, type SortConfig } from "./health";
import {
  getBootstrap,
  getPersistedLang,
  getSortConfig,
  getStoragePaths,
  openAgentDashboard,
  persistConsent,
  setSortConfig as persistSortConfig,
  updateTrayStatus,
  winClose,
  winGetAlwaysOnTop,
  winSetAlwaysOnTop,
  winMinimize,
} from "./ipc";
import { selectPanelProviders } from "./panelProviders";
import type { ScenarioId } from "./mockData";
import { useTheme, THEME_CYCLE } from "./theme";
import { LangProvider, useLang } from "./i18nReact";
import { getLang, t } from "./i18n";
import { TitleBar } from "./components/TitleBar";
import { BottomBar } from "./components/BottomBar";
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
import { FilterIcons, DEFAULT_FILTER, matchesFilter, type FilterSel } from "./components/FilterChips";
import { AgentCard, AgentCardEmpty } from "./components/AgentCard";
import { AgentDashboardC } from "./components/AgentDashboardC";
import { mcpUsageSummary, type McpQueryResult } from "./mcpQuery";
import type { UsageSummaryOutput } from "./mcpQueryTypes";
import type { InstanceConfig } from "./instances/schema";
import { getSharedKeyring, getSharedStore, loadPersistedInstances, useInstances, usePersistError } from "./instances/store";
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
  const { mode: themeMode, setMode: setThemeMode, glass, setGlass, glassAlpha, setGlassAlpha } = useTheme();
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
  // t_d086543b: 排序只留手动(用户拍板 2026-09-04); 缺省 manual + 无 order(尾部名称正排,
  // 与旧缺省视觉一致); 启动读回旧配置经 normalize 归一为 manual(order 保留)
  const [sortConfig, setSortConfig] = useState<SortConfig>(DEFAULT_SORT_CONFIG);
  // P1(t_6484ecc6): 主页过滤 chips 选中态(单选, 默认「全部」= 现状零变化; 重启回「全部」)
  const [filter, setFilter] = useState<FilterSel>(DEFAULT_FILTER);
  // 页内导航仅留给首开向导 + 方案页(D-021 一次性引导 view="add"; theme-glass 实验 view="quota";
  // t_9255cb63: view="agent-dashboard" = 主页 Agent 卡详情(大屏方案 C))
  const [view, setView] = useState<"panel" | "add" | "quota" | "agent-dashboard">("panel");
  // t_4b7984d9 round-2 P0 fix: 独立窗口 query param 自动跳转。 main.ts createAgentDashboardWindow
  // 在 loadURL/loadFile 写入 ?view=agent-dashboard, 渲染层启动读 window.location.search 据此 setView。
  // 浏览器路径(主窗 / e2e)无此 param, view 保持初始 panel 不受影响。
  // t_185002af: standalone=1 = 主进程开的无边框独立窗(D-024 家族观感)。独立窗没有系统
  // 标题栏, 渲染层自绘窗口 chrome(dash-chrome: 拖拽条 + ◨/✕); 返回键语义=关窗(win_close
  // 主进程 sender-aware 按 sender 销毁 dashboard 窗)。主窗与 e2e/浏览器路径恒 false。
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const v = sp.get("view");
      if (v === "agent-dashboard" || v === "add" || v === "quota" || v === "panel") {
        setView(v);
      }
      if (sp.get("standalone") === "1") setStandalone(true);
    } catch {
      // 解析失败 fallback 初始 panel, 不阻塞渲染
    }
  }, []);
  // D-038: 设置弹窗(纯偏好) 与 添加向导弹窗(侧栏 ＋) 是两个独立模态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const instances = useInstances();
  const { engine, output } = useRealEngine(instances);
  const hasInstances = instances.length > 0;

  // t_9255cb63: 拉 daemon usage_summary(group_by=["agent"]) — 主页 Agent 卡 + 大屏方案 C 数据源。
  // 启动拉一次 + 每 30s 刷新;daemon 不可达时 mcpSummary.result.ok=false → 主页 Agent 卡区显式空态,
  // 不静默吞成 0(任务卡边界硬要求)。
  const [mcpSummary, setMcpSummary] = useState<McpQueryResult<UsageSummaryOutput>>({
    ok: false,
    reason: "unavailable",
  });
  // t_12c28686: 大屏多维数据面 — Model 分布(group_by=["agent","model"]) + 趋势(group_by=["day"])
  // 两个附加查询, 与单维查询同一 tick 并行发起(3 次 invoke 而非 4 次; 明细/三分项从单维 summary 取)。
  // 独立 state: 主页 Agent 卡区只消费单维结果, 大屏消费三维 — 失败域互不拖累(模块级空态+重试)。
  const [mcpModelSummary, setMcpModelSummary] = useState<McpQueryResult<UsageSummaryOutput>>({
    ok: false,
    reason: "unavailable",
  });
  const [mcpTrendSummary, setMcpTrendSummary] = useState<McpQueryResult<UsageSummaryOutput>>({
    ok: false,
    reason: "unavailable",
  });
  const tick = useCallback(async () => {
    // 并行 3 查: 单维(agent) / 二维(agent+model) / 单维(day); 每份独立落地, 单份失败不阻塞其余
    // t_4b7984d9 round-7(用户真机 9/14): 查询存在间歇性失败(成功 7ms / 失败 unreachable 交替),
    // 失败一拍 UI 就闪回「daemon 未连接」空态 — 抖动期间数据明明刚取到过。
    // 修复: 失败且已有上一次成功数据时, 保留旧数据继续展示(不覆盖为失败空态),
    // 仅在从未成功过时才落到空态。三份独立处理。
    const [r, rm, rt] = await Promise.all([
      mcpUsageSummary({ group_by: ["agent"] }),
      mcpUsageSummary({ group_by: ["agent", "model"] }),
      mcpUsageSummary({ group_by: ["day"] }),
    ]);
    setMcpSummary((prev) => (r.ok || !prev.ok ? r : prev));
    setMcpModelSummary((prev) => (rm.ok || !prev.ok ? rm : prev));
    setMcpTrendSummary((prev) => (rt.ok || !prev.ok ? rt : prev));
  }, []);
  useEffect(() => {
    let alive = true;
    const guardedTick = async () => {
      if (!alive) return;
      await tick();
    };
    void guardedTick();
    const timer = window.setInterval(() => void guardedTick(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [tick]);

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

  // P1(t_6484ecc6): 一层 filter(chips 选中态 → 命中子集), 排序仍走 sortProviders 原排序器。
  //   过滤在排序之前(先缩小视角再按配置排), 不改变排序器语义; 默认「全部」= 原 providers 全集。
  // t_4b7984d9 round-4 ④: 主页 tab 分离(「用量」vs「本地 Agent」), 默认 usage;
  //   t_4b7984d9 round-6: LocalAgentSection 占位已删除,「本地 Agent」tab 直接挂 agent-card-section
  const [mainTab, setMainTab] = useState<"usage" | "local-agent">("usage");
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

  // t_d086543b: 新 provider 置顶 —— 向导保存成功(携带新实例)后把新 id prepend 进
  // 持久化 order(其余按既有自定义顺序保持; order 交集语义保证已删/幽灵 id 被忽略)。
  // 双保险: 即便尚无 order, store.add 的 unshift 也让新卡在实例序第一位。
  const onProviderSaved = useCallback(
    (inst: InstanceConfig) => {
      const rest = (sortConfig.order ?? []).filter((id) => id !== inst.id);
      const next: SortConfig = { key: "manual", dir: "asc", order: [inst.id, ...rest] };
      setSortConfig(next);
      void persistSortConfig(next);
    },
    [sortConfig.order],
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

  // t_4b7984d9 C: 详情按钮回调 → 真壳路径调 openAgentDashboard() 开 900×600 独立窗口
  // (主进程 open_agent_dashboard IPC), 浏览器降级(e2e / 纯 dev)回到 setView 切页内视图,
  // 复用既有的 AgentDashboardC 渲染, e2e 兼容性不变。同一回调双分支 = 数据契约 + UI 一致。
  const onAgentCardDetail = useCallback(async () => {
    const r = await openAgentDashboard();
    if (!r.ok) {
      // 浏览器无桥降级: 切到页内 dashboard 视图(与原 view="agent-dashboard" 路径同形态)
      setView("agent-dashboard");
    }
    // 真壳 ok=true 时主进程已开窗, 此处 no-op(独立窗口自己 mcpUsageSummary)
  }, []);

  // 真实实例集合: 仅真实实例卡渲染删除钮(dev 场景 mock 预览卡不给无效按钮)
  const realInstanceIds = useMemo(() => new Set(instances.map((i) => i.id)), [instances]);

  // t_034a6e81 Bug1 修: 真实实例卡在 auth_expired 状态下, "已授权"按钮点击 = 该卡刷线(重新采集),
  // 不再误开授权页(原 onStart 走 commandAuthStart 又开浏览器)。
  // mock 预览卡不给 onRefresh → ProviderCard 内部 OneClickAuth done 态按钮 disabled。
  const onRefreshProvider = useCallback(
    (id: string) => {
      engine?.refresh(id);
    },
    [engine],
  );

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

  // t_185002af: 大屏返回键语义分流(standalone=关窗, 否则=切页视图)。
  // ⚠️ 必须挂在所有早退 return 之前(Rules of Hooks) — consent/向导/方案页分支
  // 都会提前 return, hook 若在其后首次渲染(未 consent)不会被调用, 下次渲染钩子数
  // 变化直接崩整个 App(e2e 全量红的第一现场)。
  const dashboardBack = useCallback(() => {
    if (standalone) {
      void winClose();
      return;
    }
    setView("panel");
  }, [standalone]);

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
        <AddProviderWizard
          variant="page"
          onBack={() => setView("panel")}
          onSavedProvider={onProviderSaved}
        />
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

  // t_9255cb63: 大屏方案 C — 主页 Agent 卡点 [详情→] 触发。需要 usage_summary 真数据,
  // daemon 未连时降级提示(不静默吞成 0, 任务卡边界)。
  // t_185002af: standalone=true 时本视图跑在主进程开的无边框独立窗里(900×640),
  // 返回键语义 = 关窗(win_close, main 进程 sender-aware 销毁本窗); 非 standalone
  // (主窗内嵌 / e2e / 浏览器)维持 setView 切页视图原语义(dashboardBack 定义在上方
  // 早退 return 之前, Rules of Hooks)。窗口 chrome 条只在 standalone 挂载。
  if (view === "agent-dashboard") {
    if (mcpSummary.ok) {
      return (
        <div className="panel">
          {standalone && (
            <div className="dash-chrome" data-testid="dash-chrome">
              <span className="dash-chrome-title">Agent 用量详情</span>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-icon"
                data-testid="dash-chrome-min"
                title="最小化"
                aria-label="最小化"
                onClick={() => void winMinimize()}
              >
                🗕
              </button>
              <button
                type="button"
                className="btn btn-icon"
                data-testid="dash-chrome-close"
                title="关闭"
                aria-label="关闭"
                onClick={() => void winClose()}
              >
                ✕
              </button>
            </div>
          )}
          <AgentDashboardC
            summary={mcpSummary.data}
            modelSummary={mcpModelSummary}
            trendSummary={mcpTrendSummary}
            generatedAt={mcpSummary.generatedAt}
            onBack={dashboardBack}
            onRetry={() => void tick()}
          />
        </div>
      );
    }
    // daemon 未连接空态: 用 AgentCardEmpty 复用样式保持视觉一致
    const reasonText =
      mcpSummary.reason === "unauthorized"
        ? "鉴权失败,请检查 daemon API Key"
        : mcpSummary.reason === "protocol_error"
          ? "daemon 协议错误"
          : "daemon 未连接,请先启动 daemon";
    return (
      <div className="panel">
        <div className="agent-dashboard-c-empty" data-testid="agent-dashboard-c-empty">
          <AgentCardEmpty reason={reasonText} />
          <button
            type="button"
            className="agent-dashboard-c-back"
            onClick={dashboardBack}
            data-testid="agent-dashboard-c-empty-back"
          >
            ← 返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      {/* 标题栏独占第一行(全宽, t_66b67453 契约1 语义保留) */}
      <TitleBar
        health={health}
        tooltip={tooltip}
        pinned={pinned}
        onTogglePin={onTogglePin}
        refreshing={refreshing}
        onRefresh={onRefresh}
        themeMode={themeMode}
        onCycleTheme={onCycleTheme}
      />
      <div className="panel-body">
        <div className="panel-main" data-testid="panel-main">
          {visiblePersistError && (
            // W3: 写盘失败顶部错误条(内存态仍可用, 可关闭; 恢复后同消息再失败会重弹)
            <PersistErrorBar error={visiblePersistError} onDismiss={dismissPersistError} />
          )}
          {/* t_4b7984d9 round-6: tab 分离 — 决定下方 agent-card-section(本地 Agent 用量)哪个挂载 */}
          <nav className="main-tabs" data-testid="main-tabs" aria-label="主页视图切换">
            <button
              type="button"
              className={`main-tab${mainTab === "usage" ? " active" : ""}`}
              data-testid="main-tab-usage"
              aria-pressed={mainTab === "usage"}
              onClick={() => setMainTab("usage")}
            >
              用量
            </button>
            <button
              type="button"
              className={`main-tab${mainTab === "local-agent" ? " active" : ""}`}
              data-testid="main-tab-local-agent"
              aria-pressed={mainTab === "local-agent"}
              onClick={() => setMainTab("local-agent")}
            >
              本地 Agent
            </button>
          </nav>
          {mainTab === "usage" && (
            <>
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
                // t_f7d1beeb 9/7 修订 E: 用户反馈「主页上层的筛选按钮先隐藏, 感觉比较占地方」——
                // 先隐藏(不删代码), filter state 管线(DEFAULT_FILTER/matchesFilter/filteredProviders)
                // 全部保留, 后续要恢复时把下方 false 改 true 即可。e2e filter-icons 不再断言可见。
                <main className="card-list" data-testid="card-list">
                  {false && <FilterIcons value={filter} onChange={setFilter} />}
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
                          onRefresh={realInstanceIds.has(p.provider_id) ? onRefreshProvider : undefined}
                          dragHandle={makeHandleProps(p.provider_id)}
                          dragging={drag?.id === p.provider_id}
                          dragDy={drag ? drag.dy : 0}
                        />
                      ))}
                    </>
                  )}
                </main>
              )}
            </>
          )}
          {/* t_9255cb63: 主页 Agent 卡区 — 来自 daemon usage_summary(group_by=["agent"]),
             与 ProviderCard 同构(.card/.card-head 共享), 数据源是 MCP daemon, 非 mock。
             daemon 不可达/401/协议错 → 显式 AgentCardEmpty(不静默吞成 0)。
             t_12bdc277 round-2 修复: 解绑 providers 门禁 — 零 provider 实例下, Agent 区也应可见
             (数据源是 daemon, 与 provider 实例数无因果)。仅 providers===null(引擎加载中)
             不渲染,避免半初始化闪态。其余一律渲染: mcpSummary.ok → AgentCard 列表;
             !ok → AgentCardEmpty 按 reason 显式提示。同 D-036「选得到即采得到」精神。
             t_4b7984d9 round-6(用户真机拍板): agent-card-section 迁入「本地 Agent」tab —
             信息架构 = 用量 tab 看 provider 卡(云 API 套餐), 本地 Agent tab 看 agent 卡
             (本地 worker 调用量)。LocalAgentSection 占位组件(「即将推出」)整体删除。*/}
          {mainTab === "local-agent" && providers !== null && (
            <section className="agent-card-section" data-testid="agent-card-section">
              <header className="agent-card-section-head">
                <span className="agent-card-section-title">Agent 用量</span>
                {mcpSummary.ok && (
                  <span className="agent-card-section-meta" data-testid="agent-card-section-meta">
                    数据 {mcpSummary.generatedAt}
                  </span>
                )}
              </header>
              <div className="agent-card-list" data-testid="agent-card-list">
                {mcpSummary.ok ? (
                  mcpSummary.data.rows.map((row) => {
                    const activity: "active" | "idle" | "no_report_today" =
                      row.calls === 0
                        ? "no_report_today"
                        : row.by_status.completed === 0
                          ? "idle"
                          : "active";
                    return (
                      <AgentCard
                        key={row.group}
                        agentId={row.group}
                        row={row}
                        activity={activity}
                        generatedAt={mcpSummary.generatedAt}
                        onOpenDetail={onAgentCardDetail}
                      />
                    );
                  })
                ) : (
                  <AgentCardEmpty
                    reason={
                      mcpSummary.reason === "unauthorized"
                        ? "鉴权失败,请检查 daemon API Key"
                        : mcpSummary.reason === "protocol_error"
                          ? "daemon 协议错误"
                          : "daemon 未连接,请先启动 daemon"
                    }
                  />
                )}
              </div>
            </section>
          )}
          {!hasInstances && <ScenarioBar scenario={scenario} onChange={setScenario} />}
        </div>
      </div>
      {/* t_d086543b: 底边栏(侧栏取消后全局动作落位) —— 添加 / 设置 左右分布 */}
      <BottomBar onAdd={openAddModal} onOpenSettings={openSettings} />
      {settingsOpen &&
        createPortal(
          // 设置模态弹窗(P0-6): 半透明遮罩叠在面板上方, 点遮罩关闭; 弹层自身圆角+阴影(D-031 无边框窗口)
          // t_c20d4d11 round-3 B3-2: portal 到 body 顶层 —— .panel 挂 backdrop-filter 成 backdrop root,
          // 弹窗留在 panel 内其 backdrop-filter 采样被截断(Chromium 嵌套限制, 实测 modal blur 无效);
          // portal 脱离后 modal backdrop-filter 正确模糊透出 dashboard 内容(色块化, 前景文字可读)。
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
                glassAlpha={glassAlpha}
                onGlassAlpha={setGlassAlpha}
                onBack={closeSettings}
                onOpenQuota={() => {
                  closeSettings();
                  setView("quota");
                }}
              />
            </div>
          </div>,
          document.body,
        )}
      {addOpen &&
        createPortal(
          // D-038: 添加向导弹窗(与设置弹窗同形态: 遮罩 + 圆角弹层, × / 遮罩 / ESC 关闭)
          // t_c20d4d11 round-3 B3-2: 与 settings 同因 portal 到 body(见上注释)
          <div className="settings-overlay" data-testid="add-overlay" onClick={closeAddModal}>
            <div
              className="settings-modal"
              role="dialog"
              aria-modal="true"
              aria-label={t("common.add")}
              onClick={(e) => e.stopPropagation()}
            >
              <AddProviderWizard
                variant="modal"
                onBack={closeAddModal}
                onSavedProvider={onProviderSaved}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
