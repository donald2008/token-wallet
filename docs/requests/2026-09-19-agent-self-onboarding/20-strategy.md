# 20 · Strategy — 设计立场与约束（P2，2026-09-19；GATE 1 approve 同日）

## 战略赌注（一段话）

MCP onboarding 的产品哲学从「我们为每个 agent 造适配器」转向「我们出一份 LLM 可执行的接入标准，任何 agent 的 LLM 拿到 URL 自助对接」。本周期把 /guide 从表格页升级为规格文档、把引导 URL 做成可复制递送物、把 hook 参考实现转正进 master——适配器工作量的黑洞由此关闭，长尾 agent 覆盖天然打开。

## 设计立场

**文档即产品。** 本周期的核心交付物是一份文档（/guide HTML 页），其品质标准等同 UI：结构锚定 MCP 生态惯例（概述→认证→接口 schema→示例→验证，R5-1），读者优先级 = agent 的 LLM 第一、人类第二。视觉沿用现有面板风格（克制，不搞视觉大改——它终究是 daemon 伺服的说明页）。

## 设计约束表（带锚点）

| # | 约束 | 锚点 |
|---|---|---|
| S1 | 文档结构五段式：概述（这是什么/你要做什么）→ 认证（Bearer + key 来源说明）→ 接口规格（MCP 工具面 ×3 + AgentUsageReport v1 全 schema）→ 示例（真实 JSONRPC payload，可整段复制）→ 验证（step-by-step：report→summary 回读） | R5-1 MCP 生态惯例 |
| S2 | **schema 从 docs/mcp-protocol.md 抄写，禁止重写**——单一事实源，漂移即 bug；构建期/测试期加一致性断言（schema 段与 spec 逐字比对） | R3-1 D-055 权威源 |
| S3 | 示例 payload 必须真实可跑：取自 mcp-protocol.md §5 fixture（F1/F2 真实响应形态），禁止手编 JSON | R3-1 fixture 体系 |
| S4 | key 不出现在文档任何示例值中；key 来源只描述「app 设置页 MCP 区块复制」（D2 裁定） | D2 |
| S5 | 单条目结构：概述 + 参考实现链接（hook-usage-reporter，注明「Hermes 官方实现，其他 agent 可参考其 hook 触发点设计」）+ 规格正文；per-agent 条目删除 | D3 |
| S6 | HTML 文档页技术形态：无前端框架（沿用 _render_guide_html 纯 HTML+CSS 路线）、单文件伺服、中文正文 + 英文代码/schema | R1-5 + D4 |
| S7 | app 侧「复制引导链接」钮：位置在 MCP 面板 endpoint 行旁，复制 `http://<局域网IP>:9131/guide`（displayEndpoint 同源解析），含复制成功反馈；AgentGuideModal 改版为渲染新文档结构（或降级为跳转链接，P3 定） | R2-1/R2-4 |
| S8 | hook 并 master：merge feat/hook-usage-reporter（无 rebase，长活分支纪律）；/guide plugin_url 更新为 master tree 真实路径 + README 补接入指引 | R3-3 + D1 |
| S9 | 降级形态：daemon 未启动时引导页不可达 → app 设置页保留现有 AgentGuideModal 静态兜底内容（key/endpoint 展示），不因 daemon 离线而失去引导能力 | R2-2 状态机 + 大屏降级先例 |

## 不做清单（explicit drops）

| 不做 | 理由 |
|---|---|
| per-agent 适配器（claude-code/opencode 接入步骤） | 战略转向核心：agent 自适配，我们只出标准 |
| 英文版文档 | D4；LLM 读中文无障碍 |
| key 进 URL / 引导页嵌 key | D2 泄露面 |
| /guide 鉴权化 | 免鉴权是「自助接入」的前提（R1-1 设计意图），数据无密钥无风险 |
| 引导页视觉大改/前端框架 | daemon 伺服的说明页，克制；精力在内容不在皮 |
| MCP 新工具/新端点 | 接口面冻结，只做内容与呈现 |

## 交付结构（P3 前瞻）

- onboarding.py：数据结构改版（guide dict → 文档分段结构或直接模板化 HTML 生成）
- /guide HTML 模板重写（五段式 S1）
- app：MCP 面板复制钮 + AgentGuideModal 改版（S7/S9）
- hook 并 master + README（S8）
- 测试：onboarding 契约测试更新 + schema 一致性断言（S2）+ e2e（复制钮/文档页可达）

## 对上游无冲突声明

与 00-context-lock（范围/裁定）、05-north-star（北极星/GATE3 场景）、15-gate1-record（三裁定）逐项核对无矛盾；S 系约束全部溯源到 R1-R5 证据或 D1-D4 裁定。
