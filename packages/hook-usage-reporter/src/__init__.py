"""usage-reporter: token-wallet MCP daemon 上报插件.

提取点实测结论（hermes-agent 0.21.0, 2026-09-06 源码侦察）:
- usage 只在 ``post_api_request`` hook 提供（turn_response_intake.py:63-105）,
  payload ``usage`` = asdict(CanonicalUsage) 规范形:
  {input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
   reasoning_tokens, request_count, prompt_tokens, total_tokens}
- ``post_llm_call`` 无 usage（turn_finalizer.py:420）, 不订阅
- 取消路径（InterruptedError → handle_api_interrupt）post_api_request 不发射;
  ``api_request_error`` 在可重试错误(429)时也发射, 直接报 unknown 会与后续
  成功记录双计 → unknown 占位从 ``on_stream_end(finished=False)`` 取,
  以 (session_id, turn_id) 内存去重护栏防与 completed 双计（best-effort,
  v1 允许漏报 cancel — spec 的 partial 对其他 harness 仍有意义）

字段映射（AgentUsageReport v1, docs/mcp-protocol.md 权威）:
  usage.input_cache_hit.tokens  <- cache_read_tokens   (canonical 已归一)
  usage.input_cache_miss.tokens <- input_tokens         (canonical 已剔除缓存)
  usage.output.tokens           <- output_tokens + reasoning_tokens
                                   (reasoning 计费归 output)
  usage.total.cost/currency    <- null (daemon 价目表补算)
  ts                            <- ended_at (epoch → ISO8601 +08:00)
"""
