# testid 契约（终态 · SL-01 后固话，2026-09-18 人工终审 W2 收口）

对照基准：`feat/dashboard-redesign` tip 920b0d1 代码真值（AgentDashboardC.tsx 27 个 data-testid + e2e 引用 grep）。
处置三态：**保留 / 改名映射 / 删除（附理由）**。禁裸删。SL-05 以本表为唯一依据。

## 旧 22 项终态

| testid（旧） | 处置 | 说明 |
|---|---|---|
| agent-dashboard-c | 保留 | 根容器 |
| agent-dashboard-c-back | 保留 | 返回主页 |
| agent-dashboard-c-window | 保留 | 时间窗切换（titlebar 副题补回） |
| agent-dashboard-c-theme-dark / -light | 保留 ×2 | 大屏内主题切换 |
| agent-dashboard-c-hero-tokens / -cost | 保留 ×2 | KPI 大数字锚（新 kpi-* 体系并存） |
| agent-dashboard-c-calls | **删除** | 数据保留：KPI 副行 + Model 表调用列（单测 L176 有断言） |
| agent-dashboard-c-output | **删除** | 数据保留：Model 表 output 列（单测 L494 有断言） |
| agent-dashboard-c-hit-rate | 保留 | KPI 锚位 |
| agent-dashboard-c-active | 保留 | KPI 锚位 |
| agent-dashboard-c-models | 保留 | 模型计数 |
| agent-dashboard-c-chart-trend / -chart-model | 保留 ×2 | 图表容器 |
| agent-dashboard-c-model-table | 保留 | Model 迷你表 |
| agent-dashboard-c-split-bar / -seg-hit / -seg-miss / -seg-out | 保留 ×4 | 三分项 |
| agent-dashboard-c-detail-list | **保留**（appendix `-detail-table` 改名**否决落地**） | DOM 已 ul→table，testid 名不变（e2e 4 处引用）；新增行级 `agent-dashboard-c-detail-{agent_id}` |
| agent-dashboard-c-meta | 保留 | footer（`.agent-dashboard-c-footer` 兼容类保留供 e2e） |
| dash-agent-tabs / dash-agent-tab-{agent_id} | 保留 | agent 切换（tab 联动语义 H4） |

## SL-01 新增项（已在代码，纳入契约）

| testid | 语义 |
|---|---|
| agent-dashboard-c-banner-offline | S14 降级横幅 |
| agent-dashboard-c-kpi-{tokens,cost,hit,active} | KPI 带 4 面板 |
| agent-dashboard-c-model-total | 环形中心总量（S7） |
| dash-trend-note | 趋势面板头注（均值等） |
| dash-model-empty | Model 面板空态/失败态 |

## SL-03 新增项（SC-02/SC-03 降级形态；已在代码，纳入契约）

| testid | 语义 |
|---|---|
| agent-dashboard-c-banner-retry | SC-02 整屏降级横幅的「重新连接」（恢复动作；横幅既有 testid 不变） |
| agent-dashboard-c-foot-degraded | 降级态时效标注（「上次刷新失败/部分面板拉取失败 · 显示快照 MM-DD HH:MM」） |
| agent-dashboard-c-retry | 降级态 footer 重试（局部降级时唯一恢复入口；整屏降级时与横幅同源动作） |

配套（非 testid，e2e/SL-05 可依赖）：根容器降级态 `data-snapshot="1"` + `.is-snapshot`（数据区降饱和快照语义）；
受影响面板 `.is-stale` + `data-stale="1"`（该维最近一次拉取失败但旧快照仍在，3px 状态色顶缘）。
既有 22 项 testid 本卡零改动（横幅 / 面板空态 / 明细表 testid 全部沿用）。

## 裁定记录（人工终审 W1，2026-09-18）

明细表第 7 列 = **「成本」**（对齐锁定参考 ops-wall 第 7 列），替换现「模型」列；渲染规则按继承清单 H3：cost=null 留空、混币种分行不换汇。实现归 SL-02（含 e2e/单测同步）。原「模型」数由 `agent-dashboard-c-models` 锚位承载（KPI 带），信息不丢。
