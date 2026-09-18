# 10 · Research — 证据台账（P1，2026-09-18）

标签语法：FOUND（带定位锚）/ INFERRED（由证据推导）/ HYPOTHESIS（待验）。本文件只放证据，策略在 20-strategy.md。

## R1. 病根证据：展示不专业的第一现场

| # | 断言 | 证据 | 标签 |
|---|---|---|---|
| R1-1 | 大屏顶栏渲染内部方案名「Agent 用量详情大屏 · **Layout C · 2×2 grid**」——工程内部命名直接出街给观众看 | FOUND：AgentDashboardC.tsx:404 | FOUND [L0] |
| R1-2 | 九轮补丁全部为反应式修复（round-4~9→展示改版→密度 round-2→hitRate 守卫），无一轮信息架构/视觉锚点先行 | FOUND：git log 9f7efc3^..bd4b0f2（feat/t_7665c497-ring） | FOUND [L0] |
| R1-3 | 老大病根诊断 = 「大屏展示确实不够专业」（视觉观感：配色/图表形态/精致度差） | FOUND：00-context-lock.md（主会话原话 2026-09-18） | FOUND [L0] |
| R1-4 | CSS 硬编码**不是**主病因：dash 样式段基本全走 var(--) token 消费（app.css:2620 起，段内裸色值仅 1 处）；design-tokens 收敛（64f3ffa）在大屏代码里是生效的 | FOUND：grep 计数（本 run 实测） | FOUND [L0] |
| R1-5 | 「不专业」的病位在**版式品质与视觉锚点**，不在数据链路也不在 token 体系 | INFERRED：R1-3 + R1-4 + R2 图表形态观察 | INFERRED |

## R2. 现状形态证据（AgentDashboardC 实测）

| # | 断言 | 证据 | 标签 |
|---|---|---|---|
| R2-1 | 信息架构 = 顶栏（标题+时间筛选+主题）→ hero-strip（总用量大数字 + 调用/命中率/Output + 活跃数 + agent 切换 tab）→ 2×2 面板（趋势/Model 分布+迷你表/三分项/明细按 agent）→ footer（快照时间） | FOUND：AgentDashboardC.tsx:401-686 | FOUND [L0] |
| R2-2 | 数据契约 = App 并行拉 3 路 mcpUsageSummary（[agent] / [agent,model] / [day]）传 props，组件不直连 daemon | FOUND：AgentDashboardC.types.ts:41-54 | FOUND [L0] |
| R2-3 | 可用数据维度（现役）：tokens 总量、cost（可 null）、calls、completed、hit/miss/out 三分项、per-model 五列、per-agent 明细、day 趋势、generated_at、活跃/idle/无上报三态 | FOUND：mcpQueryTypes + types.ts | FOUND [L0] |
| R2-4 | 独立窗口 = 900 宽 × 640 高，屏幕居中 | FOUND：electron/main.ts:227 + bd4b0f2 | FOUND [L0] |
| R2-5 | Model 环形图无扇区数值标注、明细表为纯文本、无任何同环比/对比信息 | FOUND：vision 复核 9/9 三方案截图 + 现行代码（无对比类计算） | FOUND [L1] |

## R3. 设计史证据（9/9 三方案选型）

| # | 断言 | 证据 | 标签 |
|---|---|---|---|
| R3-1 | 三方案 A/B/C 于 9/9 完成 mock+HTML+9 截图 vision 复核，C（顶栏 hero + 2×2 grid）胜出；选型标准 = 信息逻辑清晰/深色适配/完成度，**无外部专业参考锚定** | FOUND：commit 37af7cf + verification/agent-dashboard/ 9 图 | FOUND [L0] |
| R3-2 | 三方案共同短板（vision 复核原话摘要）：信息密度偏低、无对比维度、环形图只看占比拿不到数、无异常标注、纯静态展示 | FOUND：本 run vision 复核 A/B/C dark 三图 | FOUND [L1] |
| R3-3 | C 骨架（总→分阅读流）本身无硬伤；短板集中在执行层（数字处理/密度/配色层级） | INFERRED：R3-1 + R3-2 | INFERRED |

## R4. 专业感外部锚（musepool recall 2026-09-18，两轮）

| # | 锚点 | 可复用参数 | 标签 |
|---|---|---|---|
| R4-1 | **dk-a1** 纯黑数据密集终端（supply-chain terminal）：bg #000000 / fg #fff / muted #8f8f8f / border #2e2e2e；语义色 emerald #00bb7f（正）红（负）；全数据等宽字 + 大写小标签 tracking 0.1 | FOUND：musepool seeds（recall round1/round2 均强命中） | FOUND [L1] |
| R4-2 | **dk-a3** Grafana 系监控墙：canvas #111217 / panel #181b1f / border #2c3238；系列色序 #5794f2 #b877d9 #73bf69 #f2cc0c #ff9830…；面板语法 = 12col gutter 16px + 8px 面板头（title 13px）+ 状态色顶缘 3px；图例=色点 chips | FOUND：同上 | FOUND [L1] |
| R4-3 | ed-d2 IDE 三栏（弱锚，仅配色参考：#1e1e24/#16161c/border #2a2a33/accent cyan #00aaff） | FOUND：recall round2 | FOUND [L1] |
| R4-4 | fetch 深取**未执行**——管线时序规定 fetch 在 P2 定稿时做，本阶段只 recall | 流程事实 | — |

## R5. 同类竞品拆解先期结论（token-monitor 借鉴清单，9/3）

| # | 断言 | 证据 | 标签 |
|---|---|---|---|
| R5-1 | 「额度展示和谐」七大来源：①hero 汇总大数字锚点 ②字阶体系（等宽 tabular+4 级字号+3 档弱化+大写小标签）③4-6px 细进度条 ④数字严格右对齐成列 ⑤状态色=品牌识别低饱和小面积 ⑥发丝分割线+亮外框 ⑦控件统一 token 化 | FOUND：references/token-monitor-borrowing.md L26 | FOUND [L1] |
| R5-2 | 当时根因诊断「无设计系统」——design-tokens 收敛（64f3ffa，feat/theme-glass）已落地补课，R1-4 实证 dash 已消费 token；但**七大来源②-⑥在 dash 上未执行** | INFERRED：R5-1 + R1-4 + R2 形态观察 | INFERRED |

## R6. 待确认（转 GATE 1）

- Q1 演示观众构成（技术同行 or 含非技术）→ P3 密度/术语规格
- Q2 演示时 daemon 在线性：大屏要不要设计「无 daemon 专业降级形态」
- Q3 9/9 C 胜出是否仍是今天的审美基线（决定 P2 立场：C 骨架重皮 vs 推倒重来）
