# hook-usage-reporter

token-wallet MCP daemon（:9131）的 Hermes gateway 上报插件 — 实现卡 t_0ea1d8b6。
协议权威源: [`docs/mcp-protocol.md`](../../docs/mcp-protocol.md)（D-048）。

## hook payload 实测结论（hermes-agent 0.21.0, 2026-09-06 源码侦察）

| 事实 | 源码证据 |
|---|---|
| usage 只在 `post_api_request` hook | `agent/turn_response_intake.py:63-105`，`usage` = `asdict(CanonicalUsage)` |
| `post_llm_call` 无 usage | `agent/turn_finalizer.py:420`（只有 session/model/文本）|
| usage dict 规范形 | `{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, request_count, prompt_tokens, total_tokens}` |
| cancel（InterruptedError）不发 post_api_request | `agent/turn_api_call.py:164` handle_api_interrupt 只保留部分文本；`conversation_loop.py:1378` |
| `api_request_error` 在可重试错误(429)也发射 | `agent/turn_api_error.py:120` → 直接报 unknown 会与后续成功记录**双计** |
| on_stream_end(finished=False) = cancel/异常 | `agent/stream_delivery.py:283`，ctx 带 turn_id/session_id/model/provider/surface |

**字段映射**（canonical → AgentUsageReport v1）:

| report 字段 | hermes 来源 | 说明 |
|---|---|---|
| `usage.input_cache_hit.tokens` | `cache_read_tokens` | canonical 已归一（anthropic/chat/codex 三 shape 统一）|
| `usage.input_cache_miss.tokens` | `input_tokens` | canonical 口径已剔除缓存 |
| `usage.output.tokens` | `output_tokens + reasoning_tokens` | reasoning 计费归 output |
| `usage.*.cost` / `currency` | `null` | daemon 价目表补算（spec §1.2）|
| `ts` | `ended_at`（epoch → ISO8601 +08:00）|
| `status` | 恒 `completed`（此路径）|

**status 偏差声明**: hermes 下 cancel 场景拿不到部分 usage（只有部分文本 chars），**v1 实际不产生 `partial`**；unknown 占位从 `on_stream_end(finished=False)` 补发（best-effort，以 `(session_id, turn_id)` 护栏防与 completed 双计），允许漏报。协议层保留 partial 给其他 harness，spec 不改。

**kanban_task 归因（v1 未接）**: post_api_request 的 task_id 是 hermes 内部 id 非 kanban `t_xxx`；归因需查 gateway session registry 的 chat_id=`kanban:<task_id>` 前缀，留 v1.1（字段协议已留位）。

## 部署

```bash
# 1. 拷插件到 gateway 插件目录（njbx02）
cp -r packages/hook-usage-reporter ~/.hermes/plugins/hook_usage_reporter

# 2. key 注入（Consul secrets_mapping 加映射 → env）
#    TOKEN_WALLET_MCP_KEY ← ai-hermes/security/providers/token-wallet-mcp-key

# 3. 启用（等 daemon 上线后）— 二选一:
#    a) 用户 ~/.hermes/config.yaml:
#       plugins:
#         entries:
#           hook-usage-reporter:
#             settings:
#               enabled: true
#    b) env: TOKEN_WALLET_REPORTER_ENABLED=true
#    注: 配置真实通道 = env 优先 → plugins.entries.<id>.settings（ctx.get_config）。
#    plugin.yaml 内的 config_schema 仅声明缺省与校验, 不是配置值本身。

# 4. 重启 gateway（用户手动, 铁律）
```

## 协议符合性要点（v0.1.1 修复记录）

- `event_id` = **uuidv7**（RFC 9562, spec §1.1 pattern 要求版本位 '7'——uuid4 会被 daemon 判 pattern 违例整条 rejected）
- MCP 信封级 tool error（`isError=True`）→ 抛异常走整批重发路径（spec §2.1 语义 6）；逐条 `rejected` 明细在成功响应内, 不触发重发

## 测试

```bash
cd packages/hook-usage-reporter
python -m pytest tests/ -v   # 10 passed（映射/护栏/flush/重发/超时丢弃/uuidv7 pattern/信封错误）
```

## 参考实现定位（其他 agent 如何自适配）

本包是 token-wallet 用量上报的 **Hermes 官方参考实现**（t_0ea1d8b6 交付，协议符合性经人工终审）。
其他 harness 的 agent（claude-code / opencode / 任意自定义 agent）**不需要也不应该直接移植本包代码**——
上报通道是开放的 MCP 工具 `report_usage`（AgentUsageReport v1，见
[`docs/mcp-protocol.md`](../../docs/mcp-protocol.md)），任何能发 MCP 请求的运行时都可自行实现上报。

参考路径 = 借鉴本包的 **hook 触发点设计**，用你所在 harness 的等价机制自行实现：

| 设计点 | 本包做法（Hermes gateway） | 自适配时你要找的等价物 |
|---|---|---|
| 提取点 | `post_api_request` hook（usage 只在此事件，`post_llm_call` 无 usage）| 你 harness 的「LLM 请求完成」事件/回调，取 canonical usage 字段 |
| 字段归一 | canonical 三 shape 统一 → `input_cache_hit/input_cache_miss/output` 三分项（reasoning 归 output）| 把平台原始 usage 归一成协议三分项 + `total` |
| buffer 策略 | 内存 buffer，50 条 ∨ 60s ∨ 会话结束 flush；断线排队，连续不可达 30min 丢 buffer 防 OOM | 任何本地攒批 + 定时/定量/退出时落盘或上报机制 |
| 批量上报 | MCP `report_usage` 批量信封（1-100 条），event_id=uuidv7 幂等，失败整批重发 | 同协议批量调用，`event_id` 逐条生成并保证重试不变 |
| 零阻塞 | 上报失败静默排队，绝不阻塞 agent 主流程 | 同样原则：计量永远不能拖慢业务 |

本包 README 上方的「hook payload 实测结论」「字段映射」「协议符合性要点」三节就是自适配时最常踩坑的
实证清单（usage 在哪个事件、cancel 不发事件、429 双计护栏、uuidv7 pattern、信封级 `is_error`）。
