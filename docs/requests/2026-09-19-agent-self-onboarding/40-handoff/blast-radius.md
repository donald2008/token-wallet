# Blast Radius — 存量影响评估（P4）

## 1. 类型判定

**modify surface**——/guide 端点与 MCP 面板为存量，改内容与交互；AgentGuideModal 为删除对象。无 rework 级推倒。

## 2. 继承清单（worker 不可回退）

| # | 不可回退项 | 出处 |
|---|---|---|
| H1 | /guide 免鉴权（EXEMPT_PATHS）不动——自助接入前提 | auth.py:16-18 |
| R2 | build_id 字段与陈旧检测链路（t_1b396e2f）保留——guide dict 改版不得破坏 app 比对 | onboarding.py:17-39 + mcp-daemon.ts:441+ |
| H3 | displayEndpoint 局域网解析语义（U6）不动——复制钮复用同源 | McpServicePanel.tsx:187 |
| H4 | AgentUsageReport v1 协议冻结——文档抄 spec，不改协议 | D-055 + 不做清单 |
| H5 | MCP 面板四态状态机与启停/自启/Key 管理不动——本周期只加复制钮、拆弹窗 | R2-2 |
| H6 | JSON 视图保留（既有程序化消费方）——只重写 HTML 视图 | GATE 1 裁定③ |

## 3. 破坏清单（明确推翻）

| # | 推翻项 | 替代 |
|---|---|---|
| B1 | per-agent 条目模型（Hermes/claude-code/opencode 三条目表格） | 单条目「自适配标准」+ 参考实现链接 |
| B2 | AgentGuideModal 弹窗（app 内引导 UI） | 删除；引导能力 = 复制链接 + /guide 在线页 |
| B3 | app 内静态引导兜底（GATE 2 S9 原案） | 删除（daemon 离线 = 无引导语义） |
| B4 | plugin_url 指向 master tree 空路径（现 404） | 并 master 后指真实路径 |

## 4. 文档回写清单（→ 收口卡）

| 文档 | 回写内容 |
|---|---|
| docs/DECISIONS.md | 新增 D：onboarding 哲学转向（自适配标准替代 per-agent 适配器；删 AgentGuideModal；key 不进 URL） |
| docs/mcp-protocol.md | /guide 端点节更新（HTML 视图=文档页语义；agents 结构变化） |
| README.md / README.en.md | MCP 接入段落同步（引导链接 + 自适配说明，替换「适配器待补」类表述） |
| hook-usage-reporter README | 并 master 时补「其他 agent 参考实现」定位段 |
