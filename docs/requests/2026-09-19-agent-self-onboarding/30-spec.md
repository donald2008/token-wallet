# 30 · Product Spec（P3，2026-09-19；GATE 2 裁定后）

范围：agent 自适配 onboarding（/guide 文档化 + 复制链接 + hook 并 master）。traceability：REQ-xx → SC-xx → SL-xx。

## 需求项

| ID | 需求 | risk_class | money_path | analytics_touch |
|---|---|---|---|---|
| REQ-01 | **/guide 文档页五段式重写**（S1-S6）：概述/认证/接口规格（工具面×3 + AgentUsageReport v1 全 schema）/真实示例（§5 fixture）/验证步骤；中文正文英文代码 | RED | false | false |
| REQ-02 | **schema 一致性断言**：文档中 schema 段与 docs/mcp-protocol.md 逐字一致（S2，测试层实现） | RED | false | false |
| REQ-03 | **复制引导链接钮**：MCP 面板 endpoint 行旁，复制局域网 /guide URL，含成功反馈（S7） | GREEN | false | false |
| REQ-04 | **AgentGuideModal 移除**：per-agent 条目删除（D3），弹窗组件+入口一并拆（GATE 2 S9 修订：不留静态兜底）；MCP 面板「引导」入口改指复制链接语义 | AMBER | false | false |
| REQ-05 | **hook 并 master**（S8）：merge feat/hook-usage-reporter；onboarding plugin_url 改指 master 真实路径；hook README 补「其他 agent 参考」段落 | AMBER | false | false |
| REQ-06 | onboarding 契约测试同步（guide dict 结构变化 + build_id 字段保留） | GREEN | false | false |
| REQ-07 | 文档页自包含验证：断网 daemon 外无外部资源依赖（无 CDN 字体/框架），离线局域网可渲染 | GREEN | false | false |

## 测试场景

| ID | 场景 | 关联 | 预期 |
|---|---|---|---|
| SC-01 | daemon 在线，浏览器开 /guide | REQ-01/07 | 五段式文档完整渲染，中文正文英文 schema |
| SC-02 | **陌生 agent 实测（北极星场景）**：老二机 opencode 拿 URL+key，LLM 依据文档自助接入并上报成功 | 北极星 | usage_summary 出数，判重/幂等无脏数据 |
| SC-03 | 复制引导链接钮 | REQ-03 | 剪贴板 = displayEndpoint 同源 /guide URL |
| SC-04 | schema 一致性断言 | REQ-02 | 与 mcp-protocol.md 逐字比对通过；篡改即红 |
| SC-05 | daemon 离线 | REQ-04 | /guide 不可达（预期，无兜底）；MCP 面板显状态错误，无死入口 |
| SC-06 | hook 参考实现链接 | REQ-05 | plugin_url 200（master tree 真实文件） |

## P3 硬验收 checklist（GATE 1 ④ 裁定）

- [ ] AgentUsageReport v1 schema 全文嵌入（含四分项/event_id/status 语义）
- [ ] ≥1 个真实可整段复制的 report_usage JSONRPC payload（源自 §5 fixture）
- [ ] 幂等/两级判重语义说明（event_id PK + fingerprint UNIQUE + 误杀语义）
- [ ] 验证步骤（report → usage_summary 回读 → 对账 echo）
- [ ] Bearer 鉴权说明 + key 来源指引（无 key 值出现）
- [ ] 参考实现链接（hook-usage-reporter master 路径）
