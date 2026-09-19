# 00 · Context Lock — agent 自适配 onboarding（pm-start 面试锁定，完整管线）

- 日期：2026-09-19
- 路由：**完整管线**（改 onboarding 产品哲学 + 协议文档组织 + app UI，非轻量档）
- 前序周期：大屏重设计（2026-09-18，v0.2.9 已发版）——本周期复用其管线产物结构
- 面试方式：现状核查打底（P1 大头前置完成）+ 四开放点结构化确认（「没什么问题」= 全按推荐）

## 锁定槽位

| 槽位 | 锁定值 |
|---|---|
| product | token-wallet |
| area | 产品功能改版（MCP onboarding：agent 自适配） |
| output | 完整需求/设计交接包（七段产物） |
| destination | handoff → token-wallet 工程链（kanban，UI 卡挂 visual-test） |

## 核心设计立场（老大亲述，本周期战略赌注）

**「我们出标准，agent 通过 LLM 自适配对接 MCP」**——替代 per-agent 适配器路线。理由：适配器工作量黑洞（每 agent 一张卡+下载+真机测试，Claude Code/OpenCode 占位至今未补即证据）；agent 自适配天然覆盖长尾（任何能读文档+写插件的 agent 零边际成本）；MCP 本身即协议标准，我们的核心投入应是**一份 LLM 可执行的高质量接入规格**而非易腐的适配代码。

## 四开放点裁定（2026-09-19，全按推荐）

| # | 裁定 |
|---|---|
| D1 | hook-usage-reporter 并 master 作参考实现，**进本周期** |
| D2 | key 不进 URL；用户复制 URL 给 agent，**key 手动粘贴** |
| D3 | 删 per-agent 占位条目（claude-code/opencode），只留「自适配标准」单条目 + Hermes 参考实现链接 |
| D4 | 引导文档**中文为主**，代码/schema 自然英文 |

## 现状事实底座（P1 前置核查，全部 [L0] 代码实锤）

- /guide 端点已存在：免鉴权（auth.py EXEMPT_PATHS）、JSON+HTML 双视图（__main__.py:160+）
- displayEndpoint 已解析局域网 IPv4（t_da2fd1f1 U6：0.0.0.0 bind → 局域网 IP 展示）
- AgentUsageReport v1 协议完整（docs/mcp-protocol.md 权威：schema/幂等/判重/TTL）
- daemon 打包脚本已有（build-exe.ps1，1eabe07）；**extraResources 缺失**由在途 lite 卡 t_aeb0447b 修复（本周期依赖其收口）
- hook-usage-reporter：feat 分支终审过（t_0ea1d8b6）未并 master；/guide plugin_url 现 404
- onboarding.py：Hermes 条目真实，claude-code/opencode 占位「待补」（D3 删除对象）

## 范围（in/out）

**in**：/guide 内容重写（LLM 可执行规格：鉴权/AgentUsageReport v1 全 schema/usage_summary 真实 payload 示例/hook 触发点建议/验证步骤）；app 设置页「复制引导链接」钮；onboarding.py 数据结构改版（单条目+参考实现链接）；hook 并 master；AgentGuideModal 相应改版
**out**：per-agent 适配器实现（本周期及可预见未来均不做）；key 进 URL；英文版文档；daemon 新接口（/guide 升级走既有端点）

## 交叠与串行约束（守则 #24）

- 依赖：lite 卡 t_aeb0447b（daemon 分发修复）先收口——同文件域（onboarding.py/设置页）
- 本周期工程卡等 lite done 后再派
- 产物目录：`docs/requests/2026-09-19-agent-self-onboarding/`；分支待派卡时定（守则 #25，倾向从 master 新开）

## 门禁预告

GATE 1（北极星+证据链）→ GATE 2（设计 approved 老大亲手翻）→ GATE 3（真机：拿 URL 给 agent 真连一次 = 唯一产品真理）。
