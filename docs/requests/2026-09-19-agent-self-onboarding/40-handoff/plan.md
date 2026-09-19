# Plan — 工程交接计划（P4）

分支：从 master 新开 `feat/agent-self-onboarding`（守则 #25：卡体显式声明；发版后轻量修已恢复常规分支模式）。依赖：lite 卡 t_aeb0447b（daemon 分发）先收口——同文件域（onboarding.py/设置页）串行。

## 分卡

| SL | 卡 | 内容 | 依赖 | skills |
|---|---|---|---|---|
| OB-01 | /guide 文档页 + schema 断言 | REQ-01/02/06/07：五段式重写 onboarding.py 数据源 + _render_guide_html 模板 + 一致性测试；契约测试同步 | lite 收口 | kanban-worker |
| OB-02 | hook 并 master + 链接修正 | REQ-05：merge feat/hook-usage-reporter（无 rebase）+ plugin_url 更新 + hook README 参考实现段 | OB-01（同分支串行） | kanban-worker |
| OB-03 | app 复制链接钮 + AgentGuideModal 拆除 | REQ-03/04：MCP 面板复制钮 + 弹窗整链拆除 + e2e | OB-02 | kanban-worker + visual-test |
| OB-04 | GATE 3 验收执行 | SC-01/02（老二机 opencode 实测 = 北极星场景）/03/04/05/06 + checklist 勾稽 | OB-01~03 全绿 | 老大人肉（老二机配合） |

同仓单线程串行（同文件域）。文档内容类改动（onboarding.py 数据段）设计权威 = references 无外部锚（文档即产品），对稿对象 = docs/mcp-protocol.md 单一事实源。

## 每卡通用 DoD

1. typecheck 0 / vitest 全绿 / e2e 相关 spec 绿（app 侧卡）
2. 契约测试与 spec 漂移零容忍（S2 断言）
3. 报告含「对稿」节（文档卡对 mcp-protocol.md；app 卡对设计约束 S1-S9）
4. commit+push 显式授权（卡体声明）

## 风险

- R-1 文档「LLM 可执行」无程序化验证 → GATE 3 真实 agent 实测兜底（北极星场景），checklist 四项程序化前置
- R-2 hook 并 master 与其他在途线冲突 → merge 前查 git status/log；冲突按 DECISIONS 撞号惯例解
- R-3 opencode 实测环境不确定 → GATE 3 前老二机预检（opencode 在位 + MCP 客户端能力）
