# 人工审核意见 — t_0ea1d8b6

reviewer: njbx02
verdict: approved
date: 2026-09-06
分支: feat/hook-usage-reporter @ 90f5769（base 7872a9c，远端一致）
交付物: packages/hook-usage-reporter/（plugin.yaml 36 行 / __init__.py 130 行 / src/reporter.py 207 行 / tests 123 行 / README 65 行）

## 审查方式

Round 1 Artifact lens：契约（docs/mcp-protocol.md 674 行）与交付物全量冷读 → pytest 复现 → hermes 0.21.0 源码逐键名核对 hook payload → git 证据链实核。

## 核验通过项（证据）

1. **event_id uuidv7**：本机实测 500/500 匹配 spec §1.1 pattern、零碰撞（f897adb 修复后）。
2. **hook payload 键名逐一对源码实锤**（卡上「以实测为准」纪律同样约束审查者）：
   - `post_api_request`：usage/ended_at/session_id/turn_id/model/provider/platform 全部存在 — `agent/turn_response_intake.py:54-100`（usage = `asdict(CanonicalUsage)`，`agent/api_request_hooks.py:35-47`）；
   - `on_stream_end` base payload：turn_id/iteration/session_id/model/provider/surface + finished — `agent/stream_delivery.py:269-283`；
   - `post_llm_call` 确无 usage — `agent/turn_finalizer.py:419+`。提取点改 post_api_request 的偏离成立，且已被上游 spec 卡闭环确认（t_586ae6ac 父卡结果）。
3. **§1.1 报文完备性**：10 个 required 字段全有、无多余键（additionalProperties:false 安全）；ts=ISO8601 带时区偏移；model/provider 空值口径合法。
4. **§2.1 语义 6**：`raise_if_envelope_error` 信封级 isError → 抛错 → `_requeue` 整批队首回队（FIFO），event_id 幂等；逐条 rejected 在成功响应内不触发重发。单测覆盖 ✓。
5. **终审硬性要求（t_586ae6ac #1086 / P2 #2）**：completed/partial + usage:null 本地即拒、不入 buffer 不上报 — `canonical_tokens` 返回 None 即 return，等效实现 ✓。
6. **buffer/flush**：50 ∨ 60s ∨ on_session_end；spawn 锁消除 timer/session_end 并发双线程；断线整批回队；>30min 不可达丢批 + log 计数 — 全合卡规 §5-7。
7. **配置通道**：env 优先 → `plugins.entries.<id>.settings`，enabled 缺省 false（先装不启）✓。
8. **执行复现**：pytest 10/10 passed（本机独立复跑）；HEAD == origin/feat/hook-usage-reporter == 90f5769，tracked tree clean。
9. **遗留挂起合规**：联调 echo 对账 + 零阻塞实测两项 na，系卡「注意」节明示等 daemon 卡 t_f9ed9235 done 后补，非私自降级。

## 警告项（放行但记录，均不阻塞）

1. **[src/reporter.py:150-161] WARNING — 批量无上限**：`_flush_once` 整段 buffer 一次 `_post`；若单批 >100 条会触发 spec §2.1 语义 5 信封级 tool error → 整批重发死循环，直至 30min 丢弃。v1 现实不可达（BUFFER_MAX=50，>100 需单次 post 往返内涌入 50+ 次 LLM 调用），按「无真实压力记档不修」处理；多 agent 共享 daemon 时再考虑 ≤100 分片。
2. **[tests/test_reporter.py] WARNING — 「mock MCP 端点」为 monkeypatch `_post`**：MCP client 层（streamable_http_client / Bearer headers / 信封解析）无端到端 mock server 覆盖。联调（挂起项）真 daemon 对账时补齐等效覆盖即可，不要求本轮回补。
3. **[src/reporter.py:71-80] WARNING — kind 粗分前提待联调核对**：webhook→coding 隐含「webhook 平台 = kanban worker」假设；若 njbx02 存在其它 webhook 来源会误标 coding。联调 daemon echo 时核对 platform 实际值分布（判不准缺省 other 的兜底已在）。
4. **OBSERVATION — [__init__.py:71-73]**：post_api_request 带 usage=None 时整条丢弃（无 unknown 占位）→ calls 少计。与「宁可缺省不猜错值」一致，记录不修。
5. **OBSERVATION — (session,turn) 护栏**：同 turn 首次 api call completed 后，同 turn 后续 call 被 cancel 时 unknown 占位被护栏吞掉 → 漏报。防双计优先方向正确，README 已声明 best-effort 允许漏报。

## 结论

实现忠实于契约，两处协议缺陷（uuidv7、isError）已在交付前修复并实测；验收项 1/4 通过，2/3 按卡规挂起待 daemon。无 BLOCKING，同意收口。

后续依赖：daemon 卡 t_f9ed9235 done 后，本卡补「真实对话 → echo 对账 + platform 值核对 + 零阻塞实测」联调验收（届时按 W2/W3 一并覆盖）。
