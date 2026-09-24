# Lite Brief — 多 Agent 用量体验三处迭代（老大 9/24 真机反馈合并需求）

## 背景
老大在老二机真机接入多 agent 测试后反馈三处体验问题。合并为一次轻量管线处理。

## 变更点（三项，含设计裁定）

### ① MCP 服务启动后，本地 Agent 页首次取数显示「启动中」
- **现状**：MCP daemon 启动后，主页本地 Agent 区首帧直接渲染「daemon 未连接」空态（mcpSummary 首拉未完成时 ok=false），误读为服务异常
- **设计裁定**：首拉未完成时显示「正在连接 MCP daemon…」瞬态空态；首拉完成（成功或失败）即解除，落回 列表/空态 二选一；daemon 启动成功事件触发立即重拉（不等 30s 轮询）
- **验收**：启动 daemon 后 Agent 区先出「启动中」提示，数据到达后平滑过渡为列表

### ② Agent 卡「详情」入口独立于大屏（大屏是整体，不是单 agent 的）
- **老大裁定**：大屏 = 整体大屏（全体 agent 聚合视图），不是单 agent 详情页 → **详情按钮不该绑在大屏入口语义上**
- **设计裁定**：Agent 卡的「详情 →」按钮语义改为「打开用量大屏」（整体大屏），按钮文案与图标同步调整；不引入单 agent 详情视图（轻量档内不做新页面，单 agent 明细由大屏内 agent 切换器覆盖）
- **验收**：按钮文案不再让用户以为「这是这张卡的详情」；点击行为 = 打开整体大屏

### ③ Agent 卡删除按钮（悬浮显示）+ daemon delete_usage 工具
- **现状**：测试上报的 agent 用量数据无法删除（daemon 工具面 v1 冻结 3+1 个，零删除能力）
- **设计裁定**：
  - daemon 侧：新增 MCP 工具 `delete_usage`（按 agent_id 清除该 agent 全部数据；v1 工具面 3→4，协议文档 v1.1 增补节 + 版式沿用既有工具节）
  - app 侧：Agent 卡头部悬浮「删除」钮（hover opacity 显隐，遵守悬浮纪律：单条 hover、勿叠多层）
  - 二次确认：确认框列出 agent_id 与将删除的行数，明确「不可逆」；确认后调 delete_usage → 本地列表重拉
  - 安全边界：Bearer key 即授权边界（管理面语义）；不做时间范围/单条删除（本轮收敛最小面）
- **验收**：悬浮出删除钮 → 二次确认 → 数据删除 → 列表平滑更新；协议文档有 v1.1 增补节

## 继承约束
- test 分支 @ 663166e（本次实现基于它，轻量档不新开分支，commit 直接落 test）——覆盖/清理我此前误起的 feat/agent-card-ux 草稿分支
- AgentCard 与 ProviderCard 视觉同构契约（D-055 系）
- MCP 协议 docs/mcp-protocol.md 为权威源，SCHEMA/文档一致性测试守护（test_doc_consistency）
- usage_summary 判重/幂等语义不动
- UI 纪律：8px 网格 / hover opacity 显隐 / 按钮 min-width 对齐（663166e 刚落的 mcp-info 对齐模式）

## 验收标准（GATE = 老大真机）
1. 启动 MCP 服务 → 本地 Agent 页先「正在连接…」后列表
2. 详情按钮文案/行为 = 打开整体大屏
3. agent 卡悬浮出删除钮 → 二次确认（含 agent_id+行数）→ 删除 → 列表更新
4. mcp-protocol.md v1.1 增补节在仓，doc_consistency 测试绿
5. 全量门禁绿：pytest 84+ / vitest / e2e

## 派单
- daemon（Python）：老二 home-computer —— delete_usage 工具 + 协议文档 + 测试
- app（TS/React）：老三 desktop-e5jupfs —— 三处 UI + 事件联动 + 测试
