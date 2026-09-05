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

# 3. 启用（等 daemon 上线后）
#    plugin.yaml config.enabled=true 或 env TOKEN_WALLET_REPORTER_ENABLED=true

# 4. 重启 gateway（用户手动, 铁律）
```

## 测试

```bash
cd packages/hook-usage-reporter
python -m pytest tests/ -v   # 8 passed（映射/护栏/flush/重发/超时丢弃）
```
