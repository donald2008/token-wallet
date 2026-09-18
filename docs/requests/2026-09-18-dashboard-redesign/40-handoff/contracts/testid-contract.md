# testid 契约（22 项现状 → 处置待胜出 IA 定案）

规则：**禁裸删**。IA 重排后每项必须落到三态之一：保留 / 改名（映射表）/ 删除（附理由 + 引用它的断言同步删除）。SL-05 动手前本表必须填完并过老大评审。

| testid（现状） | 处置 | 备注 |
|---|---|---|
| agent-dashboard-c | 待定 | 根容器，大概率保留（组件名可换，testid 稳定优先） |
| agent-dashboard-c-back | 待定 | 返回主页 |
| agent-dashboard-c-window | 待定 | 时间窗切换 |
| agent-dashboard-c-theme-dark / -light | 待定 | 大屏内主题切换 |
| agent-dashboard-c-hero-tokens / -cost | 待定 | 大数字锚（S9） |
| agent-dashboard-c-calls / -hit-rate / -output / -active / -models | 待定 | meta 五格 |
| agent-dashboard-c-chart-trend / -chart-model | 待定 | 图表容器 |
| agent-dashboard-c-model-table | 待定 | model 迷你表 |
| agent-dashboard-c-split-bar / -seg-hit / -seg-miss / -seg-out | 待定 | 三分项分段条 |
| agent-dashboard-c-detail-list | 待定 | agent 明细 |
| agent-dashboard-c-meta | 待定 | footer 快照 |
| dash-agent-tabs / dash-agent-tab-* | 待定 | agent 切换 |

引用方（改结构必同步）：`e2e/agent-card.spec.ts`、`e2e/shell-visual.spec.ts`、`e2e/_t7665c497-shots.spec.ts`、`e2e/_t7665c497-verify.spec.ts` + 组件测试 AgentDashboardC.test.tsx。`_t7665c497-*` 为上轮临时验证 spec，随本周期收口合并或删除。
