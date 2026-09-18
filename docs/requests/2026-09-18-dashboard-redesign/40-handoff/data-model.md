# Data Model — 大屏数据契约（P4；权威源 = packages/app/src/mcpQueryTypes.ts + AgentDashboardC.types.ts）

## 查询面（3 路并行，App 发起，组件收 props）

| 查询 | group_by | 用途 | 失败语义 |
|---|---|---|---|
| summary | ["agent"] | hero 总量/三分项/明细过滤 | 整屏降级（SC-02） |
| modelSummary | ["agent","model"] | Model 分布 + 迷你表 | 面板级失败+重试（SC-03） |
| trendSummary | ["day"] | 趋势 buckets | 面板级空态；<2 天显「数据积累中」 |

## UsageSummaryOutput 关键字段（现役，IA 重排的原料边界）

- total: `{ tokens, cost|null, currency|null, calls, completed }`
- 三分项：`input_cache_hit{tokens} / input_cache_miss{tokens} / output{tokens}`（total 无 tokens 分项由 hit+miss+out 派生合计）
- rows[]（agent 维）：`agent_id, tokens, cost|null, currency|null, calls, completed, idle, hit, miss, out, models`
- rows[]（model 维，按 agent 过滤）：`model, tokens, calls, hit, miss, out`
- rows[]（day 维）：`label(YYYY-MM-DD daemon 本地时区), tokens`
- meta：`generated_at`（footer 快照时间）

## 派生规则（继承既定口径，禁回退）

- 命中率 = hit/(hit+miss)，分母 0 显「—」不渲染「—%」
- cost=null 留空不显 0；混币种分行不换汇（D-055）
- 趋势均值线 = Σbuckets.tokens / buckets.length（纯前端派生，零新增查询）
- agent 三态：completed>0=active / calls>0&&completed=0=idle / calls=0=no_report_today

## 明确不新增

本周期禁新增 daemon 查询面/新维度（不做清单）。若胜出 IA 需要「现有字段的再聚合」（如 TopN 截断），在组件内派生，不动查询面。
