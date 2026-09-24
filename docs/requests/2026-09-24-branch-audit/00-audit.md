# 分支审计与打扫记录（2026-09-24）

## 触发
老大反馈「分支开启过多」。全景审计：远端 9 分支 / 本地 4 / worktree 3。

## 处置明细（逐分支 merge-base + 反向 diff 核验）

| 分支 | 判定 | 依据 |
|---|---|---|
| feat/theme-glass | 已删（已并 master） | merge-base 祖先核验 |
| fix/mcp-panel-info-layout | 已删（已并 test 040d6b7） | 同上 |
| fix/mcp-guide-hint | 已删（已并 test 663166e） | 同上 |
| docs/dw01-decisions | 已删（master d0bb51e 为其改号超集） | 反向 diff：master 版 D-059/D-060 终审改号全含 |
| chore/ob03-dead-guide-channel-cleanup | 已删（目标状态已被 OB-06 done 在 test 达成） | __main__.py 双侧 mcp_get_guide=0 实锤 |
| feat/frontend-contract | 已删（内容 100% 被 master 超越） | 8 commits +1449 行全部经 theme-glass 落地线进 master 且 master 演进（--space-48/chart-series/glass tokens）；反向 diff 零独有内容（仅 4 行旧版措辞） |
| feat/t_197d2676-top6 | 已删（主体被 DW-01 重写线超越） | R2 padding 4px 已在现行 app-dash.css；rowH≤21.5 锁由 DW-01 round-2 更强锁（压力 fixture+机制锁，agent-card.spec.ts）实质覆盖 |

## 遗产评估
- top6 的 rowH 回归锁：DW-01 现行锁（40-agent 压力 fixture + 零滚动机制锁）覆盖同一回归面且判别力更强，不抢救。
- frontend-contract 无独有遗产。

## 守则固化（memory 已记）
分支随卡生随卡死：并入主线即删（本地+远端）；完整管线工作分支由派卡方声明，worker 禁自建；lite/chore 直接 commit test 不开分支；收口逐分支 merge-base 核验后清；陈年未并（>7 天）走并/弃决策不挂起。

## 终态
远端 4（master/test + agent-ux 两 worker 将在 test 直提）、本地 2（master/test）、worktree 1（主树）。
