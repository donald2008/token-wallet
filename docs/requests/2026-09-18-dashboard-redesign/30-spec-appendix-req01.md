# REQ-01 Appendix — 胜出 IA 细化（Ops Wall，GATE 2 选型 2026-09-18）

选型与「精确数保留」裁定见 design-gate.json selection。本附录把 Ops Wall 的信息架构落成工程可执行描述；REQ-02~09 不变。

## 信息架构（900×640 画布）

```
┌ titlebar 40px：状态点 · Agent 用量 + 副题 · 时间窗 seg（近5h/本周/本月）· 主题点 ┐
├ [降级时] banner：DAEMON 未连接 · 快照截至 · 重新连接钮 ────────────────────┤
├ grid 12 列 gutter 12px padding 12px ─────────────────────────────────┤
│ KPI 带 span3×4（顶缘 3px 系列色）：tokens/成本/命中率/活跃（大数字+精确数副行，保留）│
│ 趋势 span8（柱状+均值虚线 MEAN 标签）        │ Model span4（环形+中心总量+chips 图例）│
│ 明细 span8（表 24px 行高，7 列右对齐）       │ 三分项 span4（堆叠条+行式三行）        │
├ footer 24px：daemon 状态点 · 地址 · generated_at ────────────────────────┘
```

## DOM/testid 契约（实现基线，SL-05 映射表以此为准）

根容器保留 `agent-dashboard-c`；面板语义化命名：`agent-dashboard-c-kpi-{tokens,cost,hit,active}`、`-chart-trend`、`-chart-model`、`-model-table`、`-detail-table`（原 detail-list 改名映射）、`-split-bar`、`-seg-{hit,miss,out}`、`-banner-offline`（新增）、`-meta`。原 hero-* 五 testid 并入 kpi-* 命名（映射表逐条记录，禁裸删）。

## 数据接线（全部现役契约，零新查询）

- KPI 带：summary.total（tokens/cost/currency/calls）+ 派生命中率 hit/(hit+miss)
- 趋势：trendSummary rows day → buckets（label 中文星期，daemon 本地时区）+ 均值线 Σ/len
- 趋势柱顶数值标签（SL-08 D-2 补契约，对稿 ops-wall `.bv`）：每根非零柱顶 10px muted 数值
  （fmtTokens 千分位），0 高度桶不画；y 轴 grace 12% 为最高柱标签预留头部空间
- Model 环形+表：modelSummary rows 按 activeAgent 过滤，TopN 按 tokens 降序（N 由面板高约束，余量「其他」聚合）
- 明细表：summary rows（agent 维全量，一行一 agent，状态点 active/idle/无上报）
- 三分项：summary 三分项 tokens + 占比
- 降级：summary ok=false → banner + 快照语义（SC-02）；model/trend 面板级失败 → 面板内重试（SC-03）

## 主题落地（S1/S2 映射 tokens.css）

mock 三层（canvas/panel/border）与系列色序为**对比度比例关系**，实现取值经 tokens.css 语义层（--bg/--card/--border/--accent/--ok/--error + 新增 chart 系列色 token 6 枚，先更 design-tokens 三层再引用）。glass 态按现有 glassAlpha 机制继承。
