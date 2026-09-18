# Blast Radius — 存量影响评估（P4 强制件，2026-09-18；管线 9/18 修订版首用）

## 1. 类型判定

**rework**——UI 骨架与视觉推倒重来（GATE 1 裁定②），但数据面、行为层、测试基建全部是存量遗产。rework ≠ 零遗产。

## 2. 继承清单（worker 不可回退项）

| # | 不可回退项 | 出处 |
|---|---|---|
| H1 | 数据契约：3 路 mcpUsageSummary（[agent]/[agent,model]/[day]）props 注入，组件不直连 daemon；禁新增查询面/新维度 | AgentDashboardC.types.ts + data-model.md |
| H2 | 命中率口径 = hit/(hit+miss)，分母 0 显「—」不渲染「—%」 | t_e83ad982 + t_a76b2621（hitRate 守卫） |
| H3 | cost=null 留空不显 0；混币种分行不换汇 | D-055 + b2ea122 |
| H4 | agent 切换 tab 语义：detailRows>1 出 tab，联动 Model/三分项/明细 | t_12c28686 |
| H5 | MCP 查询：JSON-RPC id 进程级唯一发号；SSE 流式读；查询失败不闪回未连接空态 | 6f2276e / 59f1c9e / ccc301a |
| H6 | 空态缓存优先文案；rows=[] 空态兜底 | round-7 b166e1b |
| H7 | 采集失败只读缓存语义（旧 ok 快照保留+时效标注）——大屏降级形态同源语义 | t_5d8c3c81 |
| H8 | 900×640 窗口 + 屏幕居中 + D-024 无边框透明家族观感 | bd4b0f2 + ae32d26 |
| H9 | design token 体系：tokens.css 唯一数值来源；新增 token 先更 design-tokens 三层再引用 | 64f3ffa 收敛纪律 |
| H10 | e2e 契约：22 个 testid（contracts/testid-contract.md 全列）禁裸删；docOverflow 溢出断言延续 | t_04f75eae 起 |

## 3. 破坏清单（本次明确推翻，禁「顺手恢复」）

| # | 推翻项 | 替代 |
|---|---|---|
| B1 | 「Agent 用量详情大屏 · Layout C · 2×2 grid」内部命名出街（AgentDashboardC.tsx:404） | 产品语言标题（S10） |
| B2 | hero-strip + 2×2 固定结构（9/9 C 方案骨架） | Ops Wall 12 列面板墙（GATE 2 选型） |
| B3 | hero-* testid 命名 | kpi-* 命名（appendix DOM 契约，映射表迁移） |
| B4 | 整卡红/黄底异常渲染（主面板范式） | 3px 状态色顶缘 + 小面积状态色（S5/S11） |

## 4. 文档回写清单（→ SL-07 文档收口卡，docs-only）

| 文档 | 回写内容 |
|---|---|
| docs/DECISIONS.md | 新增 D 条目：大屏 IA 重设计定案（Ops Wall/参考锚定/禁内部命名出街），查最大号续编；若有被推翻的旧大屏决策条目，按 DECISIONS 惯例标注被 D-xx 取代（不删史） |
| docs/frontend-AGENTS.md | 新增/修订「大屏面板语法」节：3px 状态顶缘、chips 图例、tabular 数字纪律、12 列 gutter 12px |
| docs/TESTING.md（如有 testid 节） | testid 映射表同步（22 项处置终态） |
| README.md / README.en.md | 大屏截图替换（双语同步，版本真实性纪律：不写版本号） |
| references-locked.md | 不回写（锁定参考恒定，回拆 seed 属验收后案例回流） |
