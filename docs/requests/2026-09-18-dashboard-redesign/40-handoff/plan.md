# Plan — 工程交接计划（P4）

分支：`feat/dashboard-redesign`（已存在，管线产物在此线）。tokens.css = 唯一数值来源；新增 token 先更 design-tokens 三层再引用（D 收敛纪律）。

## 分卡建议（GATE 2 选型后派发）

| SL | 卡 | 内容 | 依赖 | skills |
|---|---|---|---|---|
| SL-01 | 大屏 IA 骨架重构 | 胜出 mock 的信息架构落地（组件结构/DOM 契约） | GATE 2 | kanban-worker + visual-test |
| SL-02 | 执行基线 S1-S14 | tokens 映射/数字纪律/面板语法/密度/色序 CSS | SL-01 | kanban-worker + visual-test |
| SL-03 | 无 daemon 降级形态 | SC-02/03 全状态实现 | SL-01 | kanban-worker + visual-test |
| SL-04 | 文案与 i18n | 产品语言命名/空态文案/术语直出（zh+en 双语同步） | SL-01 | kanban-worker |
| SL-05 | e2e 契约迁移 | testid 映射落地 + 断言更新（contracts/testid-contract.md） | SL-01 | kanban-worker |
| SL-07 | 文档收口 | blast-radius 文档回写清单逐项执行（DECISIONS 新 D 条目/frontend-AGENTS 面板语法节/TESTING testid 节/README 双语截图） | SL-02~05 全绿 | kanban-worker（docs-only 惯例） |
| SL-06 | 真机验收执行 | GATE 3：Windows 真机 + SC-10 三秒三问 | SL-01~05 + SL-07 全绿 | 老大人肉 |

同仓严格单线程：SL-01→(02,03,04,05 可并行但共享 app.css 需圈地)→06。冲突热点预防：dash 样式段集中一个 commit range，禁跨卡散改 app.css 其他段。

## 每卡通用 DoD

1. typecheck 0 / vitest 全绿 / e2e 相关 spec 绿
2. L2.5 真壳视觉：900×640 三主题截图落 `packages/app/verification/`（继承 shell-visual spec 模式，视口参数改 900×640）
3. REQ 勾稽：本卡对应 REQ 逐条在卡评论勾稽（REQ-id → 实现位置）
4. commit 前缀 `p4:` 无关（工程卡用常规 fix(app)/feat(app) 前缀）；本目录只进管线产物

## 风险与缓解

- R-1 e2e 契约裸删假绿 → SL-05 映射表先行评审再动手
- R-2 三主题玻璃态对比度不达标 → design-qa 程序化 lint 前置， tokens 层解决不进组件
- R-3 IA 落地走样（mock 精度降级）→ 实现卡必须逐 panel 对照 mock 截图 + design-qa 复核
