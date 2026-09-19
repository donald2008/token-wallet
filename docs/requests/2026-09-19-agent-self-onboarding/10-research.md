# 10 · Research — 证据台账（P1，2026-09-19）

现状核查在本周期 pm-start 前置完成（主会话逐文件实锤），本台账汇集为正式证据链。标签：FOUND [L0]=代码直读 / FOUND [L1]=文档与衍生 / INFERRED。

## R1. /guide 通道现状

| # | 断言 | 证据 | 标签 |
|---|---|---|---|
| R1-1 | /guide 端点存在且免鉴权（JSON+HTML 双视图，Accept 协商） | packages/mcp-server/src/mcp_server/auth.py:16-18 EXEMPT_PATHS；__main__.py:160+ _render_guide_html | FOUND [L0] |
| R1-2 | onboarding 数据结构：endpoint 根级 + server_version + build_id + agents[]（id/name/plugin_url/docs_url/configure/verify） | onboarding.py:80-91 onboarding_guide | FOUND [L0] |
| R1-3 | agents 三条目：Hermes 真实内容；claude-code/opencode 为「待适配器实现后补」占位 | onboarding.py:42-70 | FOUND [L0] |
| R1-4 | Hermes 条目 plugin_url/docs_url 指向 gitee master tree 的 packages/hook-usage-reporter——该路径 404（hook 只在 feat 分支） | onboarding.py:46-47 + git branch -a（hook-usage-reporter 仅 origin/feat/hook-usage-reporter） | FOUND [L0] |
| R1-5 | HTML 视图为简单表格页（system-ui，无框架，人读取向），非 LLM 优化的规格文档 | __main__.py:162-200 | FOUND [L0] |

## R2. app 侧现状

| # | 断言 | 证据 | 标签 |
|---|---|---|---|
| R2-1 | displayEndpoint 已解析局域网 IPv4（0.0.0.0 bind → 局域网 IP；否则原样） | t_da2fd1f1 U6，McpServicePanel.tsx:187-191 | FOUND [L0] |
| R2-2 | MCP 面板四态状态机 + 一键启停/自启/Key 管理/陈旧检测（build_id 比对）已完整 | McpServicePanel.tsx 状态机注释 + t_1b396e2f | FOUND [L0] |
| R2-3 | AgentGuideModal 调 daemon get_guide 渲染 per-agent 两步卡（configure/verify），portal 到 body | AgentGuideModal.tsx:11-27, 94-108 | FOUND [L0] |
| R2-4 | UI 无「复制引导链接」能力——引导只能人在 app 内看，无法递给 agent | R2-3 + grep 无 clipboard/guide url 复制 | FOUND [L0] |

## R3. 协议与 agent 侧资产

| # | 断言 | 证据 | 标签 |
|---|---|---|---|
| R3-1 | AgentUsageReport v1 完整：四分项 schema/event_id uuidv7 幂等/两级判重（event_id PK + fingerprint UNIQUE）/status 三态/cost 可 null daemon 补算/TTL 90 天 | docs/mcp-protocol.md（D-055 权威源）+ DECISIONS D-055 | FOUND [L1] |
| R3-2 | MCP 工具面 ×3：report_usage（批量写）/usage_summary（聚合读）/usage_report_echo（对账读） | mcp-protocol.md §2 | FOUND [L1] |
| R3-3 | hook-usage-reporter（Hermes 参考实现）：代码完整、t_0ea1d8b6 人工终审 APPROVE，仅存 origin/feat/hook-usage-reporter | git log 该分支 651df0a/11e82c4 + 终审记录 | FOUND [L0] |
| R3-4 | daemon Windows 打包脚本已有（build-exe.ps1：onefile+BUILD_ID 注入+冒烟）；extraResources 缺失由在途 lite 卡 t_aeb0447b 修复 | 1eabe07 + lite 卡卡体 | FOUND [L0] |

## R4. 战略依据（产品哲学转向，老大亲述）

| # | 断言 | 证据 | 标签 |
|---|---|---|---|
| R4-1 | per-agent 适配器路线 = 工作量黑洞：每 agent 一张适配卡+下载+真机测试；占位条目「待补」长期未补即实证 | 主会话老大原话（2026-09-19）+ R1-3 | FOUND [L0] |
| R4-2 | agent 自适配天然优势：MCP 即协议标准，我们的投入面 = 规格文档（稳定）而非适配代码（易腐）；LLM 读文档写插件覆盖一切长尾 agent | 同上 | FOUND [L0] |
| R4-3 | 文档读者主次：LLM 优先（自适配执行者），人类其次（围观/兜底）；中文为主符合用户群 | D4 裁定 | FOUND [L0] |

## R5. 竞品/先例快扫（musepool 精神：锚点先行）

- MCP 官方 server 目录（modelcontextprotocol.io servers 案例）：每个 server 一页 README 即接入文档，agent 生态已习惯「读 README 自接」——本周期的 /guide 升级与生态惯例同构，非发明。INFERRED [L1]
- 启示：规格文档的业界结构 = 概述 → 认证 → 接口 schema → 示例 → 验证；我们复用此结构 + 嵌 AgentUsageReport 细节。

## R6. 待确认（GATE 1 裁）

- Q1 陌生 agent 样本选择（GATE 3 实测用）
- Q2 旧 HTML 表格视图升级路径（倾向：HTML 视图直接变文档页，JSON 保留）
