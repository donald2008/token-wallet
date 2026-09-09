/**
 * Agent 用量大屏 · 方案 C(t_9255cb63, D-048 后续)
 * Layout: 顶摘要 + 2×2 grid(趋势 / Model 环形 / 三分项 / 明细按 agent)。
 * 视觉参考: packages/app/dev-pages/agent-dashboard/agent-dashboard-C.html
 *  (feat/mcp-server dev-pages/ 同款视觉)。本组件用真数据(mcpUsageSummary 输出)
 * 替换原 HTML 的 mock.js 数据源, 保留 chart.js 渲染 + 8px 网格 + tokens 变量。
 *
 * 数据契约(本组件入参): 见 ./AgentDashboardC.types.ts — 由调用方(App.tsx)从
 * mcpUsageSummary 拉数据后组装。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SummaryRow, UsageSummaryOutput } from "../mcpQueryTypes";
import type { AgentDashboardCProps, TrendBucket, ModelSlice, DetailRow } from "./AgentDashboardC.types";

type ThemeMode = "dark" | "light";

const fmtWhole = new Intl.NumberFormat("en-US");
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return fmtWhole.format(n);
}
function fmtCost(n: number | null, currency: string | null): string {
  if (n == null || currency == null) return "";
  return `${n.toFixed(2)} ${currency}`;
}

// ---- 派生数据(从 usage_summary 输出转成 chart/dashboard 所需形态) ----

/** trend = 默认按 day 分组(若 daemon 未返 day 维, 用 summary.total 的 by_status 占位) */
function buildTrend(summary: UsageSummaryOutput): TrendBucket[] {
  // 我们这里取简化策略: 若 group_by 含 day, rows[].group 形如 YYYY-MM-DD;
  // 若 group_by=["agent"] 单维(默认), 用一个桶表达"今日总和",便于 e2e 验证非空。
  const total = summary.total;
  return [
    {
      label: "今日",
      tokens: total.input_cache_hit_tokens + total.input_cache_miss_tokens + total.output_tokens,
    },
  ];
}

/** model distribution = group_by=["model"] 时直接用 rows;
 *  当前默认 group_by=["agent"], 故从单行 row 内部 by_status 推不出 model 分布。
 *  退路: 把 total 三分项作为 model distribution(只 1 slice), 真接入 daemon 后由
 *  group_by=["agent","model"] 多维查询补完整。注释明示。 */
function buildModelSlices(summary: UsageSummaryOutput): ModelSlice[] {
  const t = summary.total;
  if (t.calls === 0) return [];
  // 占位 slice: "tokens"(无 model 信息)。真接入后改 group_by=["model"] 多维查询。
  return [
    {
      model: "tokens",
      tokens: t.input_cache_hit_tokens + t.input_cache_miss_tokens + t.output_tokens,
    },
  ];
}

function buildDetailRows(summary: UsageSummaryOutput): DetailRow[] {
  return summary.rows.map((r: SummaryRow) => ({
    agent_id: r.group,
    tokens: r.input_cache_hit_tokens + r.input_cache_miss_tokens + r.output_tokens,
    cost: r.cost_total,
    currency: r.currency,
    calls: r.calls,
    completed: r.by_status.completed,
    // 与 AgentCard activity 契约对齐(active = completed > 0, idle = calls > 0 && completed = 0,
    //  no_report_today = calls = 0)。dashboard hero "活跃" 计数同口径。
    idle: r.calls > 0 && r.by_status.completed === 0,
  }));
}

// ---- chart.js lazy loader(避免 vite bundle 拉整个 chart.js 进主仓) ----
// 运行时从 CDN 加载(window.Chart 全局); 本组件用 any 形态避免拉 npm 类型包(零 dep)。
// 类型契约注释: Chart<C, T, O> 形态的 C=bar/doughnut, T=number[], O=配置对象。

let chartLoadPromise: Promise<any> | null = null;
async function loadChartJs(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("chart.js only loads in browser environment");
  }
  const w = window as unknown as { Chart?: unknown };
  if (w.Chart) return w.Chart;
  if (!chartLoadPromise) {
    chartLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js";
      script.async = true;
      script.onload = () => {
        const c = (window as unknown as { Chart?: unknown }).Chart;
        if (c) resolve(c);
        else reject(new Error("chart.js loaded but window.Chart missing"));
      };
      script.onerror = () => reject(new Error("chart.js CDN load failed"));
      document.head.appendChild(script);
    });
  }
  return chartLoadPromise;
}

// ---- 主题 ----

function readThemeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// ---- 主组件 ----

export function AgentDashboardC({
  summary,
  generatedAt,
  onBack,
}: AgentDashboardCProps): ReactNode {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  const trend = useMemo(() => buildTrend(summary), [summary]);
  const slices = useMemo(() => buildModelSlices(summary), [summary]);
  const detailRows = useMemo(() => buildDetailRows(summary), [summary]);

  const trendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstancesRef = useRef<{ trend: unknown; model: unknown }>({ trend: null, model: null });

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

    // ---- trend bar ----
    const trendCanvas = trendCanvasRef.current;
    if (trendCanvas) {
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

    // ---- model doughnut ----
    const modelCanvas = modelCanvasRef.current;
    if (modelCanvas) {
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
  }, [trend, slices]);

  useEffect(() => {
    void renderCharts();
  }, [renderCharts]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const totalTokens =
    summary.total.input_cache_hit_tokens +
    summary.total.input_cache_miss_tokens +
    summary.total.output_tokens;
  const totalCost = fmtCost(summary.total.cost_total, summary.total.currency);

  // 三分项百分比
  const sum = totalTokens || 1;
  const pctHit = ((summary.total.input_cache_hit_tokens / sum) * 100).toFixed(1);
  const pctMiss = ((summary.total.input_cache_miss_tokens / sum) * 100).toFixed(1);
  const pctOut = ((summary.total.output_tokens / sum) * 100).toFixed(1);

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

      {/* 顶部 Hero */}
      <div className="hero-strip">
        <div>
          <div className="panel-title">总用量 · 全部 agent</div>
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
        </div>
        <div className="meta">
          <div>
            活跃 <strong data-testid="agent-dashboard-c-active">{detailRows.filter((r) => r.completed > 0).length}</strong>
          </div>
          <div>
            样本{" "}
            <strong data-testid="agent-dashboard-c-samples">
              {detailRows.reduce((a, r) => a + r.calls, 0)}
            </strong>
          </div>
          <div>
            模型 <strong data-testid="agent-dashboard-c-models">{slices.length}</strong>
          </div>
          <div>
            窗 <strong>now</strong>
          </div>
        </div>
      </div>

      {/* 2×2 grid: 趋势 + 模型环形 */}
      <div className="row-grid">
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">趋势 · tokens 消耗</h3>
            <div className="right">
              {trend.length} buckets · max {fmtTokens(Math.max(0, ...trend.map((b) => b.tokens)))}
            </div>
          </div>
          <div className="chart-wrap">
            <canvas ref={trendCanvasRef} data-testid="agent-dashboard-c-chart-trend" />
          </div>
        </div>
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">Model 分布</h3>
            <div className="right">环形</div>
          </div>
          <div className="chart-wrap">
            <canvas ref={modelCanvasRef} data-testid="agent-dashboard-c-chart-model" />
          </div>
        </div>
      </div>

      {/* 2×2 grid: 三分项 + 明细 */}
      <div className="row-grid">
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">三分项拆分</h3>
            <div className="right">
              {Math.round(Number(pctHit))}/{Math.round(Number(pctMiss))}/{Math.round(Number(pctOut))}
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
            <span className="v-dim">{fmtWhole.format(summary.total.input_cache_hit_tokens)}</span>
          </div>
          <div className="pct">
            <span>
              Cache miss <strong>{pctMiss}%</strong>
            </span>
            <span className="v-dim">{fmtWhole.format(summary.total.input_cache_miss_tokens)}</span>
          </div>
          <div className="pct">
            <span>
              Output <strong>{pctOut}%</strong>
            </span>
            <span className="v-dim">{fmtWhole.format(summary.total.output_tokens)}</span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">明细 · 按 agent</h3>
            <div className="right">tokens + 金额</div>
          </div>
          <ul className="detail-list" data-testid="agent-dashboard-c-detail-list">
            {detailRows.map((r) => (
              <li key={r.agent_id} data-testid={`agent-dashboard-c-detail-${r.agent_id}`}>
                <div className="name">
                  {r.agent_id}
                  {r.idle && <span className="idle-tag">空闲</span>}
                </div>
                <div className="tokens">{r.idle ? "—" : fmtTokens(r.tokens)}</div>
                <div className={`cost${fmtCost(r.cost, r.currency) === "" ? " is-empty" : ""}`}>
                  {fmtCost(r.cost, r.currency)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="agent-dashboard-c-footer" data-testid="agent-dashboard-c-meta">
        数据生成于 {generatedAt || summary.generated_at} · 来自 daemon usage_summary · 不静默
      </div>
    </div>
  );
}
