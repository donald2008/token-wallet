# 00 · Context Lock — 大屏重设计（pm-start 面试锁定）

- 日期：2026-09-18
- 触发：保险词「走产品管线」，产品管线首跑（此前九轮补丁均未进管线）
- 面试方式：四问结构化选择 + 老大补充

## 锁定的四问

| 槽位 | 锁定值 |
|---|---|
| company/pack | token-wallet（generic 模式，产品上下文 = devops/token-wallet skill + docs/DECISIONS.md） |
| area | 产品功能重设计（shipped feature redesign） |
| output | 完整需求/设计交接包（管线七段全产物） |
| destination | handoff → token-wallet 工程链（kanban 前端 lane，UI 卡必挂 visual-test） |

## 范围（out of bounds 明确）

- **只重设计「本地Agent」大屏**（AgentDashboardC 独立无边框窗口，D-024 家族观感）
- 主面板「用量」tab **不动**；托盘/设置页/弹窗**不动**

## 病根诊断（老大亲答 + 补充原话）

- **主病根 = 「大屏展示确实不够专业」**（老大补充原话，2026-09-18）：视觉观感不像专业驾驶舱——配色/图表形态/精致度差
- 与管线起源诊断（「产品层缺席」）的关系：九轮补丁每轮加料，但从未有过「专业驾驶舱」的目标画面；病根在视觉锚点缺失，信息架构问题（下）是它的伴随结果

## 使用场景（决定信息优先级）

- **演示 / 给别人看为主** → 信息优先级按「观众 3 秒看懂」排，不按挂机扫读排
- 观感权重拉满；MCP daemon 数据面（D-055：agent 上报多维用量）是数据底座

## 落地路径

- 分支：`feat/dashboard-redesign`（**从 feat/t_7665c497-ring HEAD 9f7efc3 拉出，不从 master**）
- 基线理由：master 顶部 c6aea8f 把 feat/mcp-server 合并整条 revert（发版卫生动作，见 master log），**master 树上 AgentDashboardC 已被删除**；九轮补丁+数据面接真多维全在 ring 线
- 产物目录：`docs/requests/2026-09-18-dashboard-redesign/`，每阶段一 commit（p0:/p1:/p2:/p3:/p4:/design:/qa:/gate:）
- GATE 3 真机验收通过才合 master

## 九轮补丁史（证据，禁止再走「真机截图→补丁」老路）

round-4~9（窗口高度/视口截断/空态/标题对齐/tab 语义/SSE 超时/JSON-RPC id 冲突）→ 大屏展示改版 → 信息密度 round-2（hero 扩列/环形卡消空/明细扩列）→ hitRate 守卫。全部为反应式修复，无一次「信息架构与视觉锚点先行」。

## 现状视觉观察（视觉模型初判，待 P1 实证与老大确认，非结论）

- 月窗空白格（Go #2 卡片）；「即将重置」双渲染；月窗剩余天数与百分比视觉关联弱
- Agent 分区标题重复；异常态占比过高时红色铺满（灾难片观感）
- 环形卡与明细表、hero 区的层级关系未定义——每轮在挪，从未定过

## 门禁预告（人工，代码翻不动）

- GATE 1 规格过审：P0 北极星候选表 + 反代理测试 + P1/P2 证据链
- GATE 2 设计门禁：design-qa 三层全过 + design-gate.json 老大亲手翻 approved
- GATE 3 真机验收：老大 Windows 真机

## 分工（管线定案）

老大 = PM+设计师（阶段 1-5）；工程实现 = kanban 前端 lane（阶段 6）；审核 = Consul review_model_pool 异模型（阶段 7）；验收 = 老大真机。
