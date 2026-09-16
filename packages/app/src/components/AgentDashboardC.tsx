/**
 * Agent 用量大屏 · 方案 C(t_9255cb63, D-055 后续; t_12c28686 数据面接真多维)
 * Layout: 顶摘要 + 2×2 grid(趋势 / Model 环形 / 三分项 / 明细按 agent)。
 * 视觉参考: packages/app/dev-pages/agent-dashboard/agent-dashboard-C.html
 *  (feat/mcp-server dev-pages/ 同款视觉)。本组件用真数据(mcpUsageSummary 输出)
 *  替换原 HTML 的 mock.js 数据源, 保留 chart.js 渲染 + 8px 网格 + tokens 变量。
 *
 * t_12c28686(用户 9/11 验收反馈 ③) 数据面升级:
 * - Model 分布: 调用方另拉 group_by=["agent","model"], rows[].group = "agent|model"
 *   → 过滤当前 agent 后按 model 切片(真实多模型 ≥2 slice; 只有 1 个模型就如实 1 slice,
 *   不伪造多色环 — P0-8「不显示假数据」原则)
 * - 趋势: 调用方另拉 group_by=["day"], rows[].group = YYYY-MM-DD → 真多天桶;
 *   <2 天(daemon 刚启用)→「数据积累中(N 天)」占位, 不画假曲线
 * - 多 agent: hero 区 agent tab 栏, 切换联动 Model 分布/明细/三分项过滤
 * - 拉取失败 → 模块内显式「数据拉取失败 + 重试」, 不静默空白
 *
 * 数据契约(本组件入参): 见 ./AgentDashboardC.types.ts — 由调用方(App.tsx)从
 * mcpUsageSummary 并行拉 3 份(group_by 3 种)后组装。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SummaryRow, UsageSummaryOutput } from "../mcpQueryTypes";
import type { AgentDashboardCProps, TrendBucket, ModelSlice, DetailRow } from "./AgentDashboardC.types";

type ThemeMode = "dark" | "light";

// t_4b7984d9 B: 全数字 token 展示(与 AgentCard.tsx formatTokens 口径对齐), 删原 K/M 简写分支
const fmtWhole = new Intl.NumberFormat("en-US");
function fmtTokens(n: number): string {
  return fmtWhole.format(n);
}
function fmtCost(n: number | null, currency: string | null): string {
  if (n == null || currency == null) return "";
  return `${n.toFixed(2)} ${currency}`;
}

/** t_12c28686: 多维 group 字段解析 — 按维度名顺序拆 "a|b|c"。
 * 防御: 连续分隔符产生的空段一律丢弃; 段数不足(长度 < dims)视为脏行返回 null。 */
export function splitGroupDims(group: string, dims: string[]): string[] | null {
  const parts = group
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length !== dims.length) return null;
  return parts;
}

function rowTokens(r: SummaryRow): number {
  return r.input_cache_hit_tokens + r.input_cache_miss_tokens + r.output_tokens;
}

/** trend = group_by=["day"] rows → 按天升序桶; label 直接用 YYYY-MM-DD。
 * 单维兼容: 若 rows 里解析不出 day 维(如调用方仍传单维 summary), 退回「今日」单桶占位。
 * t_5cf22ba4 注意: 无上报日也会出现在 rows 里(daemon 按 window 全量出桶), 缺桶兜底仍保留。
 * 导出供 L1 单测(t_5cf22ba4 补 0 桶语义回归锁)。 */
export function buildTrend(summary: UsageSummaryOutput): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  for (const r of summary.rows) {
    const day = splitGroupDims(r.group, ["day"])?.[0];
    if (day) buckets.push({ label: day, tokens: rowTokens(r) });
  }
  if (buckets.length > 0) {
    buckets.sort((a, b) => a.label.localeCompare(b.label));
    // t_5cf22ba4(用户截图问题 4): 无上报日整列消失 → X 轴时间轴不连续。
    // 按首末日历日逐日补 tokens=0 桶, 保证日期连续(缺失窗口 ≤ 7 天, 防窗口错配时无限补桶)。
    const filled: TrendBucket[] = [];
    const DAY_MS = 86_400_000;
    const labelOf = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    for (let i = 0; i < buckets.length; i++) {
      const cur = buckets[i]!;
      if (i > 0) {
        const prev = buckets[i - 1]!;
        const prevMs = Date.parse(`${prev.label}T00:00:00Z`);
        const curMs = Date.parse(`${cur.label}T00:00:00Z`);
        if (
          Number.isFinite(prevMs) &&
          Number.isFinite(curMs) &&
          curMs > prevMs + DAY_MS &&
          curMs - prevMs <= 7 * DAY_MS
        ) {
          for (let t = prevMs + DAY_MS; t < curMs; t += DAY_MS) {
            filled.push({ label: labelOf(new Date(t)), tokens: 0 });
          }
        }
      }
      filled.push(cur);
    }
    return filled;
  }
  // 兼容退路: 单维单行时用一个「今日」桶表达今日总和(与旧口径一致, 便于 e2e 非空验证)
  const total = summary.total;
  return [
    {
      label: "今日",
      tokens: total.input_cache_hit_tokens + total.input_cache_miss_tokens + total.output_tokens,
    },
  ];
}

/** model distribution = group_by=["agent","model"] rows 过滤当前 agent。
 *  只 1 个模型 → 如实 1 slice(不伪造多色环); 0 模型 → 空数组(空态由调用方判)。
 *  t_e83ad982: slice 扩列 calls/hit/miss/out(迷你数据表列, 全部现有 summary 字段)。 */
function buildModelSlices(summary: UsageSummaryOutput, agentId: string): ModelSlice[] {
  const slices: ModelSlice[] = [];
  for (const r of summary.rows) {
    const dims = splitGroupDims(r.group, ["agent", "model"]);
    if (!dims || dims[0] !== agentId || !dims[1]) continue;
    slices.push({
      model: dims[1],
      tokens: rowTokens(r),
      calls: r.calls,
      hit: r.input_cache_hit_tokens,
      miss: r.input_cache_miss_tokens,
      out: r.output_tokens,
    });
  }
  slices.sort((a, b) => b.tokens - a.tokens);
  return slices;
}

function buildDetailRows(summary: UsageSummaryOutput): DetailRow[] {
  return summary.rows.map((r: SummaryRow) => ({
    agent_id: r.group,
    tokens: rowTokens(r),
    cost: r.cost_total,
    currency: r.currency,
    calls: r.calls,
    completed: r.by_status.completed,
    // 与 AgentCard activity 契约对齐(active = completed > 0, idle = calls > 0 && completed = 0,
    //  no_report_today = calls = 0)。dashboard hero "活跃" 计数同口径。
    idle: r.calls > 0 && r.by_status.completed === 0,
    // t_e83ad982: 明细扩列 — 三分项原值; 模型数从 modelSummary rows 数(group_by=["agent","model"])
    // 在组件主函数合并传入(此处先填 0 占位, buildDetailRows 只看单维 summary)。
    hit: r.input_cache_hit_tokens,
    miss: r.input_cache_miss_tokens,
    out: r.output_tokens,
    models: 0,
  }));
}

// ---- chart.js(本地依赖打包, 2026-09-14 round-9 用户真机实锤) ----
// 原实现: 运行时从 jsdelivr CDN 注入 <script>, CDN 不可达(国内常态)时静默 return
// → Model 分布卡片**完全空白**(JSX 空态只覆盖 empty/failed, ok 分支纯 canvas,
//   chart 加载失败时连空态文案都没有)。
// 修法: chart.js@4.4.4 落 package.json 依赖, 'chart.js/auto' 静态 import 由
// vite 打包 — 离线可用, 免 CDN。auto 入口等价 umd 全量注册(bar/doughnut 等)。
import ChartJs from "chart.js/auto";
async function loadChartJs(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("chart.js only loads in browser environment");
  }
  return ChartJs;
}

// ---- 主题 ----

function readThemeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 模块空态(拉取失败/无数据)共用小结构 — 显式文案, 不静默空白(P0-8 原则) */
function ModuleEmpty({
  text,
  onRetry,
  testid,
}: {
  text: string;
  onRetry?: () => void;
  testid: string;
}): ReactNode {
  return (
    <div className="dash-module-empty" data-testid={testid}>
      <span>{text}</span>
      {onRetry && (
        <button
          type="button"
          className="agent-dashboard-c-back"
          data-testid={`${testid}-retry`}
          onClick={onRetry}
        >
          重试
        </button>
      )}
    </div>
  );
}

// ---- 主组件 ----

export function AgentDashboardC({
  summary,
  modelSummary,
  trendSummary,
  generatedAt,
  onBack,
  onRetry,
}: AgentDashboardCProps): ReactNode {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  // t_12c28686: 多 agent 切换(交互从简, tab) — 默认选中 tokens 最多的 agent
  const detailRows = useMemo(() => buildDetailRows(summary), [summary]);
  const [selectedAgent, setSelectedAgent] = useState<string>(() => {
    if (detailRows.length === 0) return "";
    return [...detailRows].sort((a, b) => b.tokens - a.tokens)[0]!.agent_id;
  });
  // 数据刷新后选中 agent 可能已不在 rows 里(30s 轮询窗口变化) → 回退到最大 tokens 行
  const activeAgent = detailRows.some((r) => r.agent_id === selectedAgent)
    ? selectedAgent
    : detailRows.length > 0
      ? [...detailRows].sort((a, b) => b.tokens - a.tokens)[0]!.agent_id
      : "";

  const trend = useMemo(
    () => (trendSummary.ok ? buildTrend(trendSummary.data) : []),
    [trendSummary],
  );
  const slices = useMemo(
    () => (modelSummary.ok && activeAgent ? buildModelSlices(modelSummary.data, activeAgent) : []),
    [modelSummary, activeAgent],
  );
  const trendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstancesRef = useRef<{ trend: unknown; model: unknown }>({ trend: null, model: null });

  // 趋势空态语义: 拉取失败 → failed; day 桶不足 2 天(兼容退路的「今日」单桶也算 1 天) → 数据积累中
  const trendState: "ok" | "failed" | "accumulating" = !trendSummary.ok
    ? "failed"
    : trend.length < 2
      ? "accumulating"
      : "ok";
  // Model 分布空态语义: 拉取失败 → failed; ok 但 0 slice → 无数据
  const modelState: "ok" | "failed" | "empty" = !modelSummary.ok
    ? "failed"
    : slices.length === 0
      ? "empty"
      : "ok";

  const renderCharts = useCallback(async () => {
    let ChartMod: any;
    try {
      ChartMod = await loadChartJs();
    } catch {
      // CDN 不可用时静默 — chart 区域空白不阻断整页(用户仍看得到 hero/split/detail)
      return;
    }
    const c = {
      fg: readThemeColor("--fg", "#e5e9f0"),
      fgDim: readThemeColor("--fg-dim", "#9aa4b2"),
      border: readThemeColor("--border", "#2c3542"),
      bgElev: readThemeColor("--bg-elev", "#1c2129"),
      accent: readThemeColor("--accent", "#4f8cff"),
    };
    ChartMod.defaults.color = c.fgDim;
    ChartMod.defaults.font.family =
      '"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ChartMod.defaults.font.size = 10;

    // ---- trend bar(仅趋势数据 ok 且 ≥2 天才画 — 不画假曲线) ----
    const trendCanvas = trendCanvasRef.current;
    if (trendCanvas && trendState === "ok") {
      const prev = chartInstancesRef.current.trend as { destroy: () => void } | null;
      prev?.destroy?.();
      chartInstancesRef.current.trend = new ChartMod(trendCanvas, {
        type: "bar",
        data: {
          labels: trend.map((b) => b.label),
          datasets: [
            {
              label: "tokens",
              data: trend.map((b) => b.tokens),
              backgroundColor: c.accent + "aa",
              borderColor: c.accent,
              borderWidth: 1,
              borderRadius: 4,
              maxBarThickness: 20,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx: { parsed: { y: number } }) => `${fmtWhole.format(ctx.parsed.y)} tokens`,
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: c.fgDim, font: { size: 9 } } },
            y: {
              grid: { color: c.border + "55" },
              ticks: {
                color: c.fgDim,
                font: { size: 10 },
                callback: (v: string | number) => fmtTokens(Number(v)),
              },
              beginAtZero: true,
            },
          },
        },
      });
    }

    // ---- model doughnut(仅模型数据 ok 且 ≥1 slice 才画 — 单模型如实 1 slice) ----
    const modelCanvas = modelCanvasRef.current;
    if (modelCanvas && modelState === "ok") {
      const prev = chartInstancesRef.current.model as { destroy: () => void } | null;
      prev?.destroy?.();
      const palette = ["#4f8cff", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#0ea5e9", "#facc15"];
      chartInstancesRef.current.model = new ChartMod(modelCanvas, {
        type: "doughnut",
        data: {
          labels: slices.map((s) => s.model),
          datasets: [
            {
              data: slices.map((s) => s.tokens),
              backgroundColor: slices.map((_, i) => palette[i % palette.length]),
              borderColor: c.bgElev,
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "55%",
          plugins: {
            legend: {
              position: "right",
              labels: { boxWidth: 8, color: c.fg, padding: 4, font: { size: 10 } },
            },
          },
        },
      });
    }
  }, [trend, slices, trendState, modelState]);

  useEffect(() => {
    void renderCharts();
  }, [renderCharts]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // t_12c28686 口径裁决: hero 总用量/三分项 = 全局 total(任务卡「三分项维持现有调用」,
  // hero 大数是产品噱头), agent tab 只联动 Model 分布 + 明细过滤。
  const totalTokens =
    summary.total.input_cache_hit_tokens +
    summary.total.input_cache_miss_tokens +
    summary.total.output_tokens;
  const totalCost = fmtCost(summary.total.cost_total, summary.total.currency);

  // 三分项百分比(全局 total 口径)。
  // t_5cf22ba4(用户截图问题 3): 头部 Math.round 会舍入吞项(94.1+5.4+0.4 → "94/5/0",
  // 第三项变 0 但条形图里实际有色段, 数据展示不一致) — 改 toFixed(1) 保留一位小数。
  const sum = totalTokens || 1;
  const hitTokens = summary.total.input_cache_hit_tokens;
  const missTokens = summary.total.input_cache_miss_tokens;
  const outTokens = summary.total.output_tokens;
  const pctHit = ((hitTokens / sum) * 100).toFixed(1);
  const pctMiss = ((missTokens / sum) * 100).toFixed(1);
  const pctOut = ((outTokens / sum) * 100).toFixed(1);

  // 当前 agent 的明细行(明细随 agent tab 联动过滤)
  // t_e83ad982: 明细行的模型数 = modelSummary rows 过滤当前 agent 后的行数(该 agent 的模型数)。
  const modelCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    if (modelSummary.ok) {
      for (const r of modelSummary.data.rows) {
        const dims = splitGroupDims(r.group, ["agent", "model"]);
        if (!dims) continue;
        counts.set(dims[0]!, (counts.get(dims[0]!) ?? 0) + 1);
      }
    }
    return counts;
  }, [modelSummary]);
  const currentDetail = useMemo(() => {
    const base = detailRows.find((r) => r.agent_id === activeAgent) ?? null;
    if (!base) return null;
    return { ...base, models: modelCountByAgent.get(base.agent_id) ?? 0 };
  }, [detailRows, activeAgent, modelCountByAgent]);

  // t_e83ad982(窗口口径统一): 全部模块挂同一显式 7 天窗 — 窗口范围由 summary.window 显示
  // 在 hero「窗」指标 + 页脚, 消除「趋势 7 天 vs hero 今天」的视觉矛盾(comment 1495)。
  const windowLabel = useMemo(() => {
    const since = summary.window?.since ?? "";
    const until = summary.window?.until ?? "";
    if (!since || !until) return "now";
    const short = (iso: string) => {
      const m = /^\d{4}-(\d{2}-\d{2})/.exec(iso);
      return m ? m[1]! : iso.slice(0, 10);
    };
    return `${short(since)} ~ ${short(until)}`;
  }, [summary]);

  return (
    <div className="agent-dashboard-c" data-testid="agent-dashboard-c" data-theme={theme}>
      <header className="agent-dashboard-c-head">
        <div className="agent-dashboard-c-title">
          Agent 用量详情大屏 · <strong>Layout C · 2×2 grid</strong>
        </div>
        <div className="agent-dashboard-c-controls">
          <div className="theme-toggle" role="group" aria-label="主题切换">
            <button
              type="button"
              data-theme="dark"
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
              data-testid="agent-dashboard-c-theme-dark"
            >
              Dark
            </button>
            <button
              type="button"
              data-theme="light"
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
              data-testid="agent-dashboard-c-theme-light"
            >
              Light
            </button>
          </div>
          <button
            type="button"
            className="agent-dashboard-c-back"
            onClick={onBack}
            data-testid="agent-dashboard-c-back"
          >
            ← 返回
          </button>
        </div>
      </header>

      {/* 顶部 Hero — t_e83ad982: 加高扩列(老大 comment 1496: hero 稍大不拥挤),
       *  副指标从 1 行 4 项扩到 2 行 6 项(调用/命中率/output/活跃/模型/窗口), 全部现有字段 */}
      <div className="hero-strip">
        <div className="hero-main">
          <div className="panel-title">
            "总用量 · 全部 agent"
          </div>
          <div className="hero">
            <div className="hero-tokens" data-testid="agent-dashboard-c-hero-tokens">
              {fmtWhole.format(totalTokens)}
            </div>
            <div className="hero-unit">tokens</div>
            <div
              className={`hero-cost${totalCost === "" ? " is-empty" : ""}`}
              data-testid="agent-dashboard-c-hero-cost"
              aria-hidden={totalCost === "" ? "true" : undefined}
            >
              {totalCost ? `· ${totalCost}` : ""}
            </div>
          </div>
          {/* t_12c28686: agent 维度切换(tab, 交互从简) — 联动 Model 分布/三分项/明细 */}
          {detailRows.length > 1 && (
            <div className="dash-agent-tabs" role="tablist" aria-label="Agent 切换" data-testid="dash-agent-tabs">
              {detailRows.map((r) => (
                <button
                  key={r.agent_id}
                  type="button"
                  role="tab"
                  aria-selected={r.agent_id === activeAgent}
                  className={`dash-agent-tab${r.agent_id === activeAgent ? " active" : ""}`}
                  data-testid={`dash-agent-tab-${r.agent_id}`}
                  onClick={() => setSelectedAgent(r.agent_id)}
                >
                  {r.agent_id}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="hero-side">
          <div className="meta">
            <div>
              调用 <strong data-testid="agent-dashboard-c-calls">{fmtWhole.format(summary.total.calls)}</strong>
            </div>
            <div>
              命中率{" "}
              <strong data-testid="agent-dashboard-c-hit-rate">
                {/* t_e83ad982(P4 口径统一): 命中率 = hit/(hit+miss)(与 Model 表同口径);
                 *  pctHit 是三分项「hit 占总量比」, 两语义不同不可混用。
                 *  t_a76b2621: % 收进条件分支, 缺数据显干净 "—" 不渲染 "—%"。 */}
                {(hitTokens + missTokens) > 0
                  ? `${((hitTokens / (hitTokens + missTokens)) * 100).toFixed(1)}%`
                  : "—"}
              </strong>
            </div>
            <div>
              Output <strong data-testid="agent-dashboard-c-output">{fmtWhole.format(outTokens)}</strong>
            </div>
          </div>
          <div className="meta">
            <div>
              活跃 <strong data-testid="agent-dashboard-c-active">{detailRows.filter((r) => r.completed > 0).length}</strong>
            </div>
            <div>
              模型 <strong data-testid="agent-dashboard-c-models">{slices.length}</strong>
            </div>
            <div>
              窗 <strong data-testid="agent-dashboard-c-window">{windowLabel}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 2×2 grid: 趋势 + 模型环形 */}
      <div className="row-grid">
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">趋势 · tokens 消耗</h3>
            <div className="right">
              {trendState === "ok" ? `${trend.length} buckets · max ${fmtTokens(Math.max(0, ...trend.map((b) => b.tokens)))}` : "—"}
            </div>
          </div>
          {trendState === "ok" ? (
            <div className="chart-wrap">
              <canvas ref={trendCanvasRef} data-testid="agent-dashboard-c-chart-trend" />
            </div>
          ) : trendState === "accumulating" ? (
            <ModuleEmpty
              testid="dash-trend-empty"
              text={`数据积累中（${trend.length} 天）`}
            />
          ) : (
            <ModuleEmpty testid="dash-trend-empty" text="数据拉取失败" onRetry={onRetry} />
          )}
        </div>
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">Model 分布</h3>
            <div className="right">环形 + 按模型</div>
          </div>
          {modelState === "ok" ? (
            <div className="model-duo">
              <div className="chart-wrap chart-wrap-model">
                <canvas ref={modelCanvasRef} data-testid="agent-dashboard-c-chart-model" />
              </div>
              {/* t_e83ad982(问题 2): 消除环形卡 ~60-70% 留白 — 右侧迷你数据表
               *  (模型/调用/tokens/占比/命中率); 单模型也如实 1 行, 不伪造多行 */}
              <table className="model-table" data-testid="agent-dashboard-c-model-table">
                <thead>
                  <tr>
                    <th scope="col">模型</th>
                    <th scope="col" className="num">调用</th>
                    <th scope="col" className="num">tokens</th>
                    <th scope="col" className="num">占比</th>
                    <th scope="col" className="num">命中率</th>
                  </tr>
                </thead>
                <tbody>
                  {slices.map((s) => {
                    const modelTotal = slices.reduce((a, x) => a + x.tokens, 0) || 1;
                    const share = ((s.tokens / modelTotal) * 100).toFixed(1);
                    // t_a76b2621: 守卫真实分母(hit+miss)而非 tokens — 纯 output 行(tokens>0,
                    // hit+miss=0)曾渲染 NaN%; % 收进条件分支, 缺数据显干净 "—" 不带尾巴。
                    const hitRate =
                      s.hit + s.miss > 0 ? `${((s.hit / (s.hit + s.miss)) * 100).toFixed(1)}%` : "—";
                    return (
                      <tr key={s.model} data-testid={`agent-dashboard-c-model-row-${s.model}`}>
                        <td className="name">{s.model}</td>
                        <td className="num">{fmtWhole.format(s.calls)}</td>
                        <td className="num">{fmtTokens(s.tokens)}</td>
                        <td className="num">{share}%</td>
                        <td className="num">{hitRate}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : modelState === "empty" ? (
            <ModuleEmpty testid="dash-model-empty" text="暂无模型数据" />
          ) : (
            <ModuleEmpty testid="dash-model-empty" text="数据拉取失败" onRetry={onRetry} />
          )}
        </div>
      </div>

      {/* 2×2 grid: 三分项 + 明细 */}
      <div className="row-grid">
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">三分项拆分</h3>
            <div className="right">
              {`${pctHit}% / ${pctMiss}% / ${pctOut}%`}
            </div>
          </div>
          <div className="split-bar" data-testid="agent-dashboard-c-split-bar">
            <span
              className="seg-hit"
              data-testid="agent-dashboard-c-seg-hit"
              style={{ width: `${pctHit}%` }}
            />
            <span
              className="seg-miss"
              data-testid="agent-dashboard-c-seg-miss"
              style={{ width: `${pctMiss}%` }}
            />
            <span
              className="seg-out"
              data-testid="agent-dashboard-c-seg-out"
              style={{ width: `${pctOut}%` }}
            />
          </div>
          <div className="pct">
            <span>
              Cache hit <strong>{pctHit}%</strong>
            </span>
            <span className="v-dim">{fmtWhole.format(hitTokens)}</span>
          </div>
          <div className="pct">
            <span>
              Cache miss <strong>{pctMiss}%</strong>
            </span>
            <span className="v-dim">{fmtWhole.format(missTokens)}</span>
          </div>
          <div className="pct">
            <span>
              Output <strong>{pctOut}%</strong>
            </span>
            <span className="v-dim">{fmtWhole.format(outTokens)}</span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">明细 · 按 agent</h3>
            {/* t_5cf22ba4(用户截图问题 5): pricing 未接入, 金额恒空 → 标注只写 tokens,
             * 不展示空金额占位; pricing 接入后恢复「tokens + 金额」即可。 */}
            <div className="right">tokens</div>
          </div>
          <ul className="detail-list" data-testid="agent-dashboard-c-detail-list">
            {currentDetail && (
              <li
                key={currentDetail.agent_id}
                data-testid={`agent-dashboard-c-detail-${currentDetail.agent_id}`}
              >
                <div className="name">
                  {currentDetail.agent_id}
                  {currentDetail.idle && <span className="idle-tag">空闲</span>}
                </div>
                {/* t_e83ad982(问题 3): 明细扩列 — 调用/三分项/占比/模型数(全部现有字段) */}
                <div className="tokens">{currentDetail.idle ? "—" : fmtTokens(currentDetail.tokens)}</div>
                <div className="d-cell">
                  <span className="d-label">调用</span>
                  <span className="d-val">{fmtWhole.format(currentDetail.calls)}</span>
                </div>
                <div className="d-cell">
                  <span className="d-label">Hit</span>
                  <span className="d-val">{fmtTokens(currentDetail.hit)}</span>
                </div>
                <div className="d-cell">
                  <span className="d-label">Miss</span>
                  <span className="d-val">{fmtTokens(currentDetail.miss)}</span>
                </div>
                <div className="d-cell">
                  <span className="d-label">Output</span>
                  <span className="d-val">{fmtTokens(currentDetail.out)}</span>
                </div>
                <div className="d-cell">
                  <span className="d-label">占比</span>
                  <span className="d-val">
                    {totalTokens > 0 ? ((currentDetail.tokens / totalTokens) * 100).toFixed(1) : "0.0"}%
                  </span>
                </div>
                <div className="d-cell">
                  <span className="d-label">模型</span>
                  <span className="d-val">{currentDetail.models}</span>
                </div>
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="agent-dashboard-c-footer" data-testid="agent-dashboard-c-meta">
        窗口 {windowLabel} · 数据生成于 {generatedAt || summary.generated_at} · 来自 daemon
        usage_summary · 不静默
      </div>
    </div>
  );
}
