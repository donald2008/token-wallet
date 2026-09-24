# Lite Brief v2 — 本地 Agent 页重设计（置顶组件 + 用量卡重构，老大 9/24 二轮反馈）

> 状态：**设计阶段（design-gate 待翻牌）** — 本文件为设计收敛产物，翻牌前禁派实现卡。

## 需求演进（覆盖 v1 brief 的 ②③ 项 UI 部分）

老大真机复验 agent-ux-lite 后二轮反馈：
1. 「大屏入口独立」真实语义 = **大屏按钮不再出现在卡片内**（v1 实现成每卡一个「大屏 →」钮，理解偏差）
2. 删除按钮与状态徽章重叠（t_433892c6 9/7 ProviderCard 已踩坑复发——复制模式未带历史修订）
3. 用量展示卡片需要**整体重新设计**（组件级独立设计）
4. 本地 Agent 页新增**置顶组件**：全局用量信息 + 近 5 小时用量折线图 + 大屏入口按钮
5. 本轮按产品管线设计先行，出 2-3 版方案选型

## 物理约束（P3 强制段，实测采集）

- 主窗内容区 **360×720**（titlebar 32 + tabs ~37 + padding），可视列表区 ~640px
- 卡宽 360−24(section padding)−32 = 全宽单列（现行 .agent-card-list 已是纵向 flex）
- 5h 折线数据面：daemon `GROUP_DIMS` 现无 `hour` 维 → **需 daemon 侧小增**（GROUP_DIMS + `_group_key` 加 hour，协议 §2.2 day 同款本地时区语义）→ 派单含 daemon 小改
- 折线图技术：chart.js 已在仓（AgentDashboardC 趋势同款，vite 打包离线可用），系列色走 `--chart-N` token
- 删除钮悬浮纪律：hover 时**状态徽章互斥让位**（方案 A/C）或**锚卡外缘**（方案 B），禁几何重叠；ProviderCard t_433892c6 修订为本卡基线（top 28px 教训）

## 三版设计（均已出 360×720 全景 mock + vision 自检零重叠零裁切）

| 方案 | 置顶形态 | 一屏可见卡数 | 适用判断 |
|---|---|---|---|
| **A · hero 横幅** | 大数字(30px) + 副标 + 大屏钮一行，下方 72px 折线带时间轴 | ~2 卡 | agent 少、要「震撼总量」展示 |
| **B · 双区条** | 左数字(24px)+右折线横排分栏，高度 ~120px | ~3 卡 | 折线与数字并重，均衡型 |
| **C · 迷你工具条** | 44px 细条：数字+sparkline+大屏钮一行，折线降为 sparkline | ~4 卡 | agent 数量增长期，密度优先 |

共同设计决策（三版一致）：
- 大屏入口**只在置顶组件**，卡片内不再出现（响应需求 1）
- 卡片重构：logo+名称+状态行 / tokens 数字行 / meta 行（calls+短时间戳 `HH:MM`，弃全量 ISO 串）
- 删除钮 hover 显隐 + 与状态徽章互斥（方案 A/C：hover 时 status opacity:0 删除钮 opacity:1；方案 B：钮锚卡右上外缘 -8px）
- 置顶数据 = 全部 agent 聚合（usage_summary 全局行 + 新 hour 维查询），**非单 agent**

## mock 产物（vision 自检记录）

- `plan-a/b/c.png`（360×720 全景）+ `plan-a/b/c.html`（可交互原稿）
- vision 三轮自检：零重叠 / 零裁切 / 层级清晰（A 的「tokens·全部 agent」折行已确认可接受）

## 待老大裁决

1. **方案选型**：A / B / C（或混搭指派，如「C 的置顶 + A 的卡片」）
2. GATE 2 翻牌（design-gate.json approved）→ 派实现卡

## 实现派单预告（翻牌后）

- 老二（daemon）：GROUP_DIMS + hour 维（协议 §2.2 语义扩展，v1.1 增补节一笔带过）
- 老三（app）：置顶组件（新） + AgentCard 重构 + App.tsx 区块装配 + e2e（booting/大屏入口位置变更回归）

## GATE 2 翻牌（2026-09-24）

- **选型：方案 A rev2**（老大原话：「plan-a的v2版不错」）
- design-gate.json：approved=true，翻牌人=老大（本 comment 为凭）
- 落选：B（双区条）/ C（迷你工具条）——保留 mock 归档备查
