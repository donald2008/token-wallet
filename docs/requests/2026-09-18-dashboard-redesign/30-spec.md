# 30 · Product Spec（P3，2026-09-18；GATE 1 已关闭，立场=v2 推倒重来）

范围：仅「本地Agent」大屏（AgentDashboardC）。上游：20-strategy v2（S1-S14）、10-research（R2-3 数据契约）。traceability：`REQ-xx → SC-xx → SL-xx`（SL 见 P4 slices.json）。

## 需求项（逐条分类）

| ID | 需求 | risk_class | money_path | analytics_touch |
|---|---|---|---|---|
| REQ-01 | **信息架构重排**：面板组成/分组/朝向/层级全部重新决定（推倒现 hero+2×2），由三 IA mock 竞争、GATE 2 选型定案；自由度边界=现役数据契约 R2-3 + 900×640 画布 + S1-S14 | AMBER | false | false |
| REQ-02 | **执行基线 S1-S14 全落地**：色层映射 tokens、系列色序、数字纪律、面板语法、密度、状态色克制、发丝线、术语直出 | RED | false | false |
| REQ-03 | **数字可读性**：所有数值 tabular-nums、明细右对齐成列、KPI 大数字 -0.02em；环形图（若采用）扇区带数值标注；趋势图带同窗均值虚线（buckets 派生，零新增查询） | RED | false | false |
| REQ-04 | **无 daemon 专业降级形态**：daemon 离线/查询失败时大屏保持专业壳+明确状态+恢复动作，与常态同一品质基线 | AMBER | false | false |
| REQ-05 | **工程命名不出街**：顶栏与任何可见文案禁现「Layout C · 2×2 grid」类内部名，用产品语言 | GREEN | false | false |
| REQ-06 | **三主题兼容**：dark/light/glass 全部可渲染且对比度达标（色值经 S1 映射 tokens.css，禁硬编码新色） | RED | false | false |
| REQ-07 | **行为层继承**：agent 维度切换语义、hitRate 口径（hit/(hit+miss)，零数据显「—」）、cost 可 null 留空、缓存优先空态文案等既有行为修复不回退 | AMBER | false | false |
| REQ-08 | **e2e 契约迁移**：现有 22 个 testid 依赖清单逐项映射（保留/改名/删除），断言同步更新，不裸删 | GREEN | false | false |
| REQ-09 | **3 秒三问验收场景**：首屏 3s 内可答「这是什么/量级多大/健康吗」（GATE 3 演示时人肉执行） | GREEN | false | false |

## 用户故事

- **US-1（演示者）**：作为向同行演示 token-wallet 的老大，我要大屏一打开就像专业监控产品，让 3 秒内建立「这工具很专业」的第一印象。
- **US-2（同行观众）**：作为技术同行，我要一眼读出 token 量级、成本、cache 命中率与活跃 agent 数，不用问「这个数是什么意思」。
- **US-3（演示者-故障预案）**：作为演示者，当现场 daemon 掉线时，我要大屏呈现专业的降级状态而不是残页，演示可以继续。

## 测试场景（成功 + 失败路径，每条用户可见规则一条）

| ID | 场景 | 关联 | 预期 |
|---|---|---|---|
| SC-01 | 常态渲染：daemon 在线、三维查询全 ok | REQ-01/02/03 | 全面板渲染，数字纪律逐项合规 |
| SC-02 | 无 daemon：连接失败 | REQ-04 | 专业降级形态：状态明确+恢复动作，版式不塌 |
| SC-03 | 模型维查询 ok=false（其余 ok） | REQ-04/07 | 对应面板显式「数据拉取失败+重试」，其余面板正常 |
| SC-04 | 空数据：新装无上报 | REQ-07 | 空态文案（缓存优先语义），非 0/— 误导 |
| SC-05 | hit+miss=0（零分母） | REQ-07 | 命中率显「—」，不渲染「—%」 |
| SC-06 | cost=null / 混币种 | REQ-07 | cost 留空不显 0；混币种分行不换算（D-055） |
| SC-07 | 三主题切换 | REQ-06 | dark/light/glass 全部合规，design-qa 截图三主题 |
| SC-08 | agent 切换 | REQ-07 | 切换联动 Model/三分项/明细，选中态清晰 |
| SC-09 | 900×640 视口不溢出 | REQ-01/02 | 无滚动溢出、无截断（e2e docOverflow 断言延续） |
| SC-10 | 3 秒三问 | REQ-09 | GATE 3 演示场景人肉执行，通过记录 |

## 选型契约（GATE 2 执行细则）

- 三 mock（Ops Wall / Terminal Ink / Console）同数据同 S 基线渲染，老大选型=IA 定案
- 选型后本 spec 的 REQ-01 由胜出 IA 的结构描述细化（appendix 形式，不改已批 REQ-02~09）
- design-gate.json 的 approved 仅由老大在 GATE 2 亲手翻

## 明确不做（继承 20-strategy 不做清单，验收时同样拒绝）

下钻交互/联动筛选/同环比大改/自定义布局/新数据维度/窗口尺寸大改。
