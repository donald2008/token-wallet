# 50-design — 三 IA 立场 mock（阶段 4）

数据同源（本周窗 mock，字段形状=mcpQueryTypes 现役契约）；三 mock 同一 S1-S14 执行基线；每 mock 双态（常态 + 无 daemon 降级）。截图在 `_shots/`（Playwright 无头实测非手绘）。

## Head-to-head 对比

| 维度 | Ops Wall（dk-a3） | Terminal Ink（dk-a1） | Console（ed-d2） |
|---|---|---|---|
| IA 立场 | 一切皆面板的监控墙：KPI 带→趋势+环形→明细+三分项，2×2 变体 | 分屏不对称数据终端：左 KPI 纵列+agent 列表，右趋势+三列数据区 | 主从工作台：左 agent 卡片列表，右单 agent 详情（KPI/趋势/模型表/三分项） |
| 密度 | 高 | 最高 | 中（单 agent 视角） |
| 第一眼锚点 | 顶部 4 KPI 带 | 左栏大数字纵列 | 右侧详情 KPI 行 |
| agent 维度 | 明细表一行一 agent（全局对比强） | 左列表+右全局（切换感弱） | 主从切换（单 agent 深读强，全局对比弱） |
| 降级形态 | 横幅+全区降饱和快照 | 横幅+数据区降饱和 | 横幅+左快照+右离线面板（最有产品感） |
| 弱点 | 环形+趋势同排稍挤；明细表 24px 行高对 5+ agent 需滚动取舍 | 左右分工使「全局模型分布」要在右下小环看，分量被压 | 全局总量视角弱化（要靠左栏 mfoot 总计行兜底） |
| 最适合 | 「一眼看全集群」的演示 | 数据密集审美、同行极客观众 | 单 agent 深读+讲解节奏 |

## 自审记录（vision round-1 + DOM 取证 + 修复）

1. ✅ 已修：Terminal Ink 时间筛选选中态与数据窗错配（近5小时→本周）
2. ✅ 已修：Console 同款筛选错配
3. ✅ 已修：Terminal Ink / Console 辅助字对比度（--dim 提至 ≈4.5:1+，趋势柱值 #c9c9c9）
4. ⚠️ 误报存档：Ops Wall「明细表数字左对齐/laptop-old 错位」——DOM 取证 text-align 全部正确（首列 left、6 列 right），vision 亚像素误判，不修（先例：9/4 蓝底实案）
5. 观察项（GATE 2 后处理）：KPI「精确 X,XXX,XXX」副行被评「信息冗余」——设计意图是同行观众要精确数（S13 密度拉满），保留，GATE 2 老大裁决

## 选型方式

老大看 `_shots/` 三图（+可开 HTML 点降级态交互），GATE 2 定夺：
- 选一个 → 进入 P3 spec REQ-01 细化 + 工程交接
- 杂交（如 Ops Wall 骨架 + Console 降级面板）→ 指明部件，design-gate.json 记录组合
