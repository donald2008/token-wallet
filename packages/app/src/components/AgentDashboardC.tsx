/**
 * Agent 用量大屏 · Ops Wall(t_15397c99 SL-01, GATE 2 选型定案)
 * 信息架构: titlebar(40px) + [banner 降级态] + 12 列面板墙 grid(gutter 12px) + footer(24px)。
 * 结构基准: docs/requests/2026-09-18-dashboard-redesign/30-spec-appendix-req01.md
 * 视觉基准: docs/requests/2026-09-18-dashboard-redesign/50-design/ops-wall/index.html
 *  (对照实现, 禁发明色值/版式 — 色值一律走 tokens.css/theme.css 语义变量)。
 *
 * 继承清单(blast-radius H1-H10, 逐条不可回退):
 * - H1: 数据契约 3 路 mcpUsageSummary props 注入, 组件不直连 daemon, 零新增查询面
 * - H2: 命中率 = hit/(hit+miss), 分母 0 显「—」不渲染「—%」
 * - H3: cost=null 留空不显 0; 混币种分行不换汇
 * - H4: agent 切换 tab 语义(detailRows>1 出 tab) — Ops Wall 下落在 Model 面板头部,
 *   联动 Model 分布 + 明细表选中行高亮(明细表按 appendix 数据接线 = agent 维全量)
 * - H5: mcp-query 层(JSON-RPC id 发号/SSE/失败不闪空态) — 本组件不触碰
 * - H6: 空态显式文案; rows=[] 空态兜底
 * - H8: 900×640 窗口 + D-024 无边框透明家族(壳不变, 本卡不改窗口)
 * - H9: 数值唯一来源 tokens.css/theme.css; 组件禁硬编码色值(chart 系列色读 --chart-N)
 * - H10: testid 契约按 40-handoff/contracts/testid-contract.md 映射表处置, 禁裸删
 *
 * 破坏清单(明确推翻, 禁顺手恢复):
 * - B1: 「Agent 用量详情大屏 · Layout C · 2×2 grid」内部命名出街 → 产品语言标题(S10)
 * - B2: hero-strip + 2×2 固定结构 → Ops Wall 12 列面板墙
 * - B3: hero-* testid → kpi-* 命名(hero-tokens/cost 映射进 kpi-* 大数字锚)
 * - B4: 整卡红/黄底异常渲染 → 3px 状态色顶缘 + 小面积状态色(S5/S11)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SummaryRow, UsageSummaryOutput } from "../mcpQueryTypes";
import type { AgentDashboardCProps, TrendBucket, ModelSlice, DetailRow } from "./AgentDashboardC.types";

type ThemeMode = "dark" | "light";

// t_4b7984d9 B 继承(H): 全数字 token 展示(与 AgentCard.tsx formatTokens 口径对齐), 禁 K/M 简写
const fmtWhole = new Intl.NumberFormat("en-US");
function fmtTokens(n: number): string {
  return fmtWhole.format(n);
}
function fmtCost(n: number | null, currency: string | null): string {
  if (n == null || currency == null) return "";
  return `${n.toFixed(2)} ${currency}`;
}

/** chart 系列色序变量名(S3, 固定顺序取用; 值经 tokens.css --chart-N, 组件禁硬编码色值) */
export const SERIES_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"] as const;

/** seriesColor: 第 i 个系列的 CSS 变量名(H9: 色值走 tokens 语义层) */
export function seriesVar(i: number): string {
  return SERIES_VARS[i % SERIES_VARS.length]!;
}

/** 趋势 X 轴标签: YYYY-MM-DD → 中文星期(appendix 数据接线: label 中文星期, daemon 本地时区)。
 * 数据层 buildTrend 仍出 YYYY-MM-DD(排序/补桶稳定), 本函数仅渲染层映射。 */
export function weekdayLabel(day: string): string {
  const ms = Date.parse(`${day}T00:00:00`);
  if (!Number.isFinite(ms)) return day;
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(ms).getDay()]!;
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

/** trend = group_by=["day"] rows → 按天升序桶; label 用 YYYY-MM-DD(渲染层经 weekdayLabel 映射中文星期)。
 * 单维兼容: 若 rows 里解析不出 day 维(如调用方仍传单维 summary), 退回「今日」单桶占位。
 * t_5cf22ba4: 无上报日也会出现在 rows 里(daemon 按 window 全量出桶), 缺桶兜底仍保留。
 * 导出供 L1 单测(补 0 桶语义回归锁)。 */
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

/** 趋势同窗均值线(S8): Σbuckets.tokens / buckets.length — 纯前端派生, 零新增查询。 */
export function avgOf(buckets: TrendBucket[]): number {
  if (buckets.length === 0) return 0;
  return buckets.reduce((a, b) => a + b.tokens, 0) / buckets.length;
}

/** model distribution = group_by=["agent","model"] rows 过滤当前 agent。
 *  只 1 个模型 → 如实 1 slice(不伪造多色环); 0 模型 → 空数组(空态由调用方判)。
 *  slice 列 calls/hit/miss/out(迷你数据表列, 全部现有 summary 字段)。 */
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
    //  no_report_today = calls = 0)。dashboard KPI "活跃" 计数同口径。
    idle: r.calls > 0 && r.by_status.completed === 0,
    // 明细扩列 — 三分项原值; 模型数在组件主函数合并传入(此处填 0 占位)。
    hit: r.input_cache_hit_tokens,
    miss: r.input_cache_miss_tokens,
    out: r.output_tokens,
    models: 0,
  }));
}

// ---- chart.js(本地依赖打包, round-9 实锤: CDN 不可达时 Model 卡全空白 → vite 打包离线可用) ----
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

/** S8 均值虚线 chart.js plugin(dashed line + MEAN 标签, 同窗均值从 buckets 派生) */
const meanLinePlugin = {
  id: "meanLine",
  afterDatasetsDraw(chart: any, _args: unknown, opts: any) {
    const value = opts?.value as number | undefined;
    if (!value || !Number.isFinite(value)) return;
    const area = chart.chartArea;
    const y = chart.scales?.y;
    if (!area || !y) return;
    const yPos = y.getPixelForValue(value);
    if (yPos < area.top || yPos > area.bottom) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = opts.color as string;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(area.left, yPos);
    ctx.lineTo(area.right, yPos);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = opts.color as string;
    ctx.font = "9px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`MEAN ${fmtTokens(Math.round(value))}`, area.right - 2, yPos - 4);
    ctx.restore();
  },
};

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
          className="dash-btn"
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
  const [touchedTheme, setTouchedTheme] = useState(false);
  // 初始主题从全局 html data-theme 派生(尊重 dark-glass 等玻璃变体, t_15397c99 U5 字节互异前提);
  // 用户在大屏内切换后仍走 dark/light 二态(组件内独立主题, mock 契约)。
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "dark";
    return document.documentElement.dataset.theme === "light" || document.documentElement.dataset.theme === "light-glass" ? "light" : "dark";
  });
  // t_12c28686: 多 agent 切换(H4) — 默认选中 tokens 最多的 agent
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
      // chart 加载失败静默 — chart 区域空白不阻断整页(用户仍看得到 KPI/split/detail)
      return;
    }
    const c = {
      fg: readThemeColor("--fg", "#e5e9f0"),
      fgDim: readThemeColor("--fg-dim", "#9aa4b2"),
      border: readThemeColor("--border", "#2c3542"),
      bgElev: readThemeColor("--bg-elev", "#1c2129"),
      s1: readThemeColor("--chart-1", "#5794f2"),
    };
    ChartMod.defaults.color = c.fgDim;
    ChartMod.defaults.font.family =
      '"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ChartMod.defaults.font.size = 10;

    // ---- trend bar(仅趋势数据 ok 且 ≥2 天才画 — 不画假曲线); S8 均值虚线 ----
    const trendCanvas = trendCanvasRef.current;
    if (trendCanvas && trendState === "ok") {
      const prev = chartInstancesRef.current.trend as { destroy: () => void } | null;
      prev?.destroy?.();
      chartInstancesRef.current.trend = new ChartMod(trendCanvas, {
        type: "bar",
        data: {
          // X 轴标签 = 中文星期(appendix 数据接线); 同名周几并列时以桶序区分(tooltip 保留全 label)
          labels: trend.map((b) => weekdayLabel(b.label)),
          datasets: [
            {
              label: "tokens",
              data: trend.map((b) => b.tokens),
              backgroundColor: c.s1 + "aa",
              borderColor: c.s1,
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
            meanLine: { value: avgOf(trend), color: readThemeColor("--warn", "#facc15") },
            tooltip: {
              callbacks: {
                // tooltip 用完整日期(轴标签是中文星期, 消歧)
                title: (items: { dataIndex: number }[]) => trend[items[0]!.dataIndex]?.label ?? "",
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
        plugins: [meanLinePlugin],
      } as any);
    }

    // ---- model doughnut(仅模型数据 ok 且 ≥1 slice 才画 — 单模型如实 1 slice) ----
    // 系列色 = tokens.css --chart-N 固定色序(S3: 图内扇区/表行/图例同源同序)
    const modelCanvas = modelCanvasRef.current;
    if (modelCanvas && modelState === "ok") {
      const prev = chartInstancesRef.current.model as { destroy: () => void } | null;
      prev?.destroy?.();
      const palette = slices.map((_, i) => readThemeColor(seriesVar(i), "#5794f2"));
      chartInstancesRef.current.model = new ChartMod(modelCanvas, {
        type: "doughnut",
        data: {
          labels: slices.map((s) => s.model),
          datasets: [
            {
              data: slices.map((s) => s.tokens),
              backgroundColor: palette,
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
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx: { parsed: number; dataIndex: number }) => {
                  const s = slices[ctx.dataIndex];
                  if (!s) return "";
                  const sum = slices.reduce((a, x) => a + x.tokens, 0) || 1;
                  return `${s.model} · ${fmtWhole.format(s.tokens)} tokens · ${((s.tokens / sum) * 100).toFixed(1)}%`;
                },
              },
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
    // dark-first 演示立场(mock 契约, 既有 e2e 锁定): 挂载即落 dark。
    // 全局为玻璃变体时保留玻璃语义(落 <base>-glass, U5 三主题字节互异的前提);
    // 全局为对侧(light)或用户主动切换后落裸主题值。
    const global = typeof window !== "undefined" ? document.documentElement.dataset.theme : undefined;
    const keepGlassSuffix = touchedTheme
      ? false
      : global === "dark-glass" || global === "light-glass";
    document.documentElement.dataset.theme = keepGlassSuffix ? `${theme}-glass` : theme;
  }, [theme, touchedTheme]);

  // t_12c28686 口径裁决(继承): KPI 总用量/三分项 = 全局 total, agent tab 只联动 Model 分布 + 明细高亮。
  const totalTokens =
    summary.total.input_cache_hit_tokens +
    summary.total.input_cache_miss_tokens +
    summary.total.output_tokens;
  const totalCost = fmtCost(summary.total.cost_total, summary.total.currency);

  // 命中率 = hit/(hit+miss)(H2 口径); 分母 0 显「—」不渲染「—%」
  const hitTokens = summary.total.input_cache_hit_tokens;
  const missTokens = summary.total.input_cache_miss_tokens;
  const outTokens = summary.total.output_tokens;
  const hitRate =
    hitTokens + missTokens > 0 ? `${((hitTokens / (hitTokens + missTokens)) * 100).toFixed(1)}%` : "—";

  // 三分项百分比(全局 total 口径)。t_5cf22ba4: toFixed(1) 一位小数不吞项。
  const sum = totalTokens || 1;
  const pctHit = ((hitTokens / sum) * 100).toFixed(1);
  const pctMiss = ((missTokens / sum) * 100).toFixed(1);
  const pctOut = ((outTokens / sum) * 100).toFixed(1);

  // 明细表 = agent 维全量一行一 agent(appendix 数据接线); 当前 agent 行高亮(H4 联动语义保留)。
  // 模型数 = modelSummary rows 过滤各 agent 后的行数(全部现有字段派生)。
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
  const detailRowsWithModels = useMemo(
    () =>
      detailRows.map((r) => ({
        ...r,
        models: modelCountByAgent.get(r.agent_id) ?? 0,
        active: r.completed > 0,
      })),
    [detailRows, modelCountByAgent],
  );
  const activeCount = detailRows.filter((r) => r.completed > 0).length;

  // 窗口口径(继承 t_e83ad982): summary.window → MM-DD ~ MM-DD, 副题显示
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

  // 降级横幅时间(H7 缓存优先语义: 显示快照截至时间而非空白)
  const snapshotAt = useMemo(() => {
    const iso = generatedAt || summary.generated_at || "";
    const m = /(\d{2}:\d{2}(:\d{2})?)/.exec(iso);
    return m ? m[1]! : iso;
  }, [generatedAt, summary]);

  return (
    <div className="agent-dashboard-c" data-testid="agent-dashboard-c" data-theme={theme}>
      {/* titlebar 40px: 状态点 · 产品语言标题(S10) + 副题 · 时间窗 · 主题/返回 */}
      <header className="dash-titlebar">
        <i className="dash-titlebar-dot" aria-hidden="true" />
        <h1 className="dash-titlebar-title">
          Agent 用量
          <span className="dash-titlebar-sub">
            token 消耗 · 成本 · 缓存命中 ·{" "}
            {/* testid 契约保留项: agent-dashboard-c-window(原时间窗显示位, SL-01 维持显示语义) */}
            <span data-testid="agent-dashboard-c-window">{windowLabel}</span>
          </span>
        </h1>
        <div className="dash-titlebar-controls">
          <div className="theme-toggle" role="group" aria-label="主题切换">
            <button
              type="button"
              data-theme="dark"
              aria-pressed={theme === "dark"}
              onClick={() => { setTouchedTheme(true); setTheme("dark"); }}
              data-testid="agent-dashboard-c-theme-dark"
            >
              Dark
            </button>
            <button
              type="button"
              data-theme="light"
              aria-pressed={theme === "light"}
              onClick={() => { setTouchedTheme(true); setTheme("light"); }}
              data-testid="agent-dashboard-c-theme-light"
            >
              Light
            </button>
          </div>
          <button
            type="button"
            className="dash-btn"
            onClick={onBack}
            data-testid="agent-dashboard-c-back"
          >
            ← 返回
          </button>
        </div>
      </header>

      {/* 降级横幅(SC-02, S14): DAEMON 查询失败时显式状态 + 恢复动作, 同一品质壳。
       *  可见性代理: 三维查询同时失败 = daemon 会话内不可达(单维 summary 走 App 层
       *  既有降级空态, 不动数据边界); SL-03 降级形态卡在此基础上扩展全状态。 */}
      <div
        className={`dash-banner${trendState === "failed" && modelState === "failed" ? " is-visible" : ""}`}
        data-testid="agent-dashboard-c-banner-offline"
        role="alert"
      >
        <i className="dash-banner-dot" aria-hidden="true" />
        <b>DAEMON 未连接</b>
        <span className="dash-banner-sub">显示上次快照 · 数据截至 {snapshotAt || "—"}</span>
        <button type="button" className="dash-btn" onClick={onRetry}>
          重新连接
        </button>
      </div>

      {/* 12 列面板墙(S6: gutter 12px, padding 12px) */}
      <div className="dash-grid">
        {/* KPI 带 span3×4, 顶缘 3px 系列色(S5); 大数字锚 + 精确数(H: 全数字, 禁 K/M 简写) */}
        <section className="dash-panel dash-kpi t1">
          <div className="dash-kpi-body">
            <div className="dash-label">Tokens · {windowLabel}</div>
            <div className="dash-kpi-v" data-testid="agent-dashboard-c-kpi-tokens">
              <span data-testid="agent-dashboard-c-hero-tokens">{fmtTokens(totalTokens)}</span>
              <small>tokens</small>
            </div>
            <div className="dash-kpi-sub">
              调用 <b className="dash-num">{fmtWhole.format(summary.total.calls)}</b> 次
            </div>
          </div>
        </section>
        <section className="dash-panel dash-kpi t2">
          <div className="dash-kpi-body">
            <div className="dash-label">成本 · {windowLabel}</div>
            {/* H3: cost=null 留空不显 0(is-empty 隐藏大数字, 副行仍给调用数) */}
            <div
              className={`dash-kpi-v${totalCost === "" ? " is-empty" : ""}`}
              data-testid="agent-dashboard-c-kpi-cost"
              aria-hidden={totalCost === "" ? "true" : undefined}
            >
              <span data-testid="agent-dashboard-c-hero-cost">{totalCost}</span>
            </div>
            <div className="dash-kpi-sub">
              计价 <b>{summary.total.currency ?? "—"}</b>
            </div>
          </div>
        </section>
        <section className="dash-panel dash-kpi t3">
          <div className="dash-kpi-body">
            <div className="dash-label">Cache 命中率</div>
            <div className="dash-kpi-v" data-testid="agent-dashboard-c-kpi-hit">
              <span data-testid="agent-dashboard-c-hit-rate">{hitRate}</span>
            </div>
            <div className="dash-kpi-sub">
              hit <b className="dash-num">{fmtTokens(hitTokens)}</b> / miss{" "}
              <b className="dash-num">{fmtTokens(missTokens)}</b>
            </div>
          </div>
        </section>
        <section className="dash-panel dash-kpi t4">
          <div className="dash-kpi-body">
            <div className="dash-label">活跃 Agent</div>
            <div className="dash-kpi-v" data-testid="agent-dashboard-c-kpi-active">
              <span data-testid="agent-dashboard-c-active">{activeCount}</span>
              <small>/{detailRows.length}</small>
            </div>
            <div className="dash-kpi-sub">
              <span data-testid="agent-dashboard-c-models">{slices.length}</span> 个模型参与
            </div>
          </div>
        </section>

        {/* 趋势 span8: 柱状 + 均值虚线(S8); 桶计数/均值在 phead note */}
        <section className="dash-panel dash-span8 dash-p-trend">
          <header className="dash-phead">
            <h2>趋势 · tokens 消耗</h2>
            <span className="dash-pnote" data-testid="dash-trend-note">
              {trendState === "ok"
                ? `日粒度 · 均值 ${fmtTokens(Math.round(avgOf(trend)))}`
                : "—"}
            </span>
          </header>
          <div className="dash-pbody dash-pbody-trend">
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
        </section>

        {/* Model span4: 环形 + 中心总量 + chips 表(S5/S7); agent tab(H4) 落 phead */}
        <section className="dash-panel dash-span4 dash-p-model">
          <header className="dash-phead">
            <h2>Model 分布</h2>
            {detailRows.length > 1 ? (
              <div
                className="dash-agent-tabs"
                role="tablist"
                aria-label="Agent 切换"
                data-testid="dash-agent-tabs"
              >
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
            ) : (
              <span className="dash-pnote">tokens 占比</span>
            )}
          </header>
          <div className="dash-pbody dash-pbody-model">
            {modelState === "ok" ? (
              <>
                <div className="chart-wrap chart-wrap-model" data-testid="agent-dashboard-c-chart-model">
                  <canvas ref={modelCanvasRef} />
                  {/* appendix 数据接线: 环形+中心总量(当前 agent 全模型 tokens 合计) */}
                  <div className="dash-donut-center" data-testid="agent-dashboard-c-model-total">
                    <b className="dash-num">{fmtTokens(slices.reduce((a, x) => a + x.tokens, 0))}</b>
                    <span>TOTAL</span>
                  </div>
                </div>
                <table className="dash-model-table" data-testid="agent-dashboard-c-model-table">
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
                    {slices.map((s, i) => {
                      const modelTotal = slices.reduce((a, x) => a + x.tokens, 0) || 1;
                      const share = ((s.tokens / modelTotal) * 100).toFixed(1);
                      // H2 守卫真实分母(hit+miss)而非 tokens — 纯 output 行不渲染 NaN%
                      const sHitRate =
                        s.hit + s.miss > 0
                          ? `${((s.hit / (s.hit + s.miss)) * 100).toFixed(1)}%`
                          : "—";
                      return (
                        <tr key={s.model} data-testid={`agent-dashboard-c-model-row-${s.model}`}>
                          <td className="name">
                            {/* chips 图例色点(S5): 与环形扇区同源同序(--chart-N) */}
                            <i
                              className="dash-chip"
                              style={{ background: `var(${seriesVar(i)})` }}
                              aria-hidden="true"
                            />
                            {s.model}
                          </td>
                          <td className="num">{fmtWhole.format(s.calls)}</td>
                          <td className="num">{fmtTokens(s.tokens)}</td>
                          <td className="num">{share}%</td>
                          <td className="num">{sHitRate}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : modelState === "empty" ? (
              <ModuleEmpty testid="dash-model-empty" text="暂无模型数据" />
            ) : (
              <ModuleEmpty testid="dash-model-empty" text="数据拉取失败" onRetry={onRetry} />
            )}
          </div>
        </section>

        {/* 明细 span8: agent 维全量一行一 agent(appendix 数据接线), 24px 行高 + 右对齐成列(S4/S6);
         *  当前 agent 行高亮 = H4 联动语义保留; 状态点 active/idle/off(S11 小面积) */}
        <section className="dash-panel dash-span8 dash-p-detail">
          <header className="dash-phead">
            <h2>明细 · 按 agent</h2>
            {/* t_5cf22ba4(问题 5) 继承: pricing 未接入, 标注只写 tokens, 不展示空金额占位 */}
            <span className="dash-pnote">tokens</span>
          </header>
          <div className="dash-pbody dash-pbody-detail">
            <table className="dash-detail-table" data-testid="agent-dashboard-c-detail-list">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="num">Tokens</th>
                  <th className="num">占比</th>
                  <th className="num">Cache hit</th>
                  <th className="num">Output</th>
                  <th className="num">调用</th>
                  <th className="num">模型</th>
                </tr>
              </thead>
              <tbody>
                {detailRowsWithModels.map((r) => {
                  const share =
                    totalTokens > 0 ? ((r.tokens / totalTokens) * 100).toFixed(1) : "0.0";
                  const selected = r.agent_id === activeAgent;
                  return (
                    <tr
                      key={r.agent_id}
                      data-testid={`agent-dashboard-c-detail-${r.agent_id}`}
                      data-selected={selected ? "true" : undefined}
                      className={selected ? "is-selected" : undefined}
                    >
                      <td className="name">
                        <i
                          className={`dash-ast ${r.completed > 0 ? "on" : r.idle ? "idle" : "off"}`}
                          aria-hidden="true"
                        />
                        {r.agent_id}
                        {r.idle && <span className="dash-idle-tag">空闲</span>}
                      </td>
                      <td className="num">{r.idle ? "—" : fmtTokens(r.tokens)}</td>
                      <td className="num">{share}%</td>
                      <td className="num cell-dim">{fmtTokens(r.hit)}</td>
                      <td className="num cell-dim">{fmtTokens(r.out)}</td>
                      <td className="num cell-dim">{fmtWhole.format(r.calls)}</td>
                      <td className="num cell-dim">{r.models}</td>
                    </tr>
                  );
                })}
                {detailRowsWithModels.length === 0 && (
                  <tr>
                    <td className="name">—</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 三分项 span4: 堆叠条 + 行式三行(大写标签, S4) */}
        <section className="dash-panel dash-span4 dash-p-split">
          <header className="dash-phead">
            <h2>三分项拆分</h2>
            <span className="dash-pnote">{`${pctHit}% / ${pctMiss}% / ${pctOut}%`}</span>
          </header>
          <div className="dash-pbody dash-pbody-split">
            <div className="dash-stack" data-testid="agent-dashboard-c-split-bar">
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
            <div className="dash-splitrows">
              <div className="r">
                <i className="dash-chip seg-hit-chip" aria-hidden="true" />
                <span>CACHE HIT</span>
                <b className="dash-num">{fmtTokens(hitTokens)}</b>
                <span>{pctHit}%</span>
              </div>
              <div className="r">
                <i className="dash-chip seg-miss-chip" aria-hidden="true" />
                <span>CACHE MISS</span>
                <b className="dash-num">{fmtTokens(missTokens)}</b>
                <span>{pctMiss}%</span>
              </div>
              <div className="r">
                <i className="dash-chip seg-out-chip" aria-hidden="true" />
                <span>OUTPUT</span>
                <b className="dash-num">{fmtTokens(outTokens)}</b>
                <span>{pctOut}%</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* footer 24px: daemon 状态点 · 来源 · 快照时间(agent-dashboard-c-footer 兼容类保留, e2e 断言用) */}
      <footer className="dash-foot agent-dashboard-c-footer" data-testid="agent-dashboard-c-meta">
        <i className="dash-foot-live" aria-hidden="true" />
        <span>DAEMON usage_summary · {windowLabel}</span>
        <b className="dash-num">数据快照 {generatedAt || summary.generated_at} · generated_at</b>
      </footer>
    </div>
  );
}
