# t_eece584f 人工终审 — APPROVE（P0 self-heal 协议路径亲验打通）

reviewer: njbx02（default, execution lens）
date: 2026-09-11
range: 308f93f → 482f825 → ec68f28 → cbe87af → **bcdcdd7**
remote: origin/feat/mcp-server ls-remote == bcdcdd797d4f98d93fb17ad5540d6542895293b2 ✓
worker: desktop-e5jupfs（round-1 被打回 P0，round-2 修复）

## 复审方法（execution lens：全部亲跑，不采信 worker / 前轮 reviewer 自报）

干净仓库 `/root/work/tw-review-t_eece584f`（ext4 本地 clone，非 /mnt 9p 挂载 — 挂载盘构建不可信）
`git clone -b feat/mcp-server gitee` @ bcdcdd7 → `pnpm install --frozen-lockfile --offline`（415 包，离线 store）
→ `pnpm -C packages/core build` → 逐项复跑。

## 0. 唯一的实质卡点：handoff 时分支根本没推远端（已在本轮内解决）

进场第一次 `git ls-remote origin feat/mcp-server` == **308f93f**（零前进）；github 镜像 e36d1dd 亦不含；
`git cat-file` 逐个查 160b2a3 / 94b4e3e / 5eac907 / 482f825 / ec68f28 / cbe87af / bcdcdd7 → 全部
`could not get object info`。即 **task body 的「commit+push 硬验收」在交接时并未成立**，
round-1/round-2 两轮 reviewer 都没咬住这一点（round-2 还写了「push 由 reviewer 触发」，实际也没推）。

处置：A2A 直连 desktop-e5jupfs 要求 push 并回报 ls-remote。worker 已快进推送
（`308f93f..bcdcdd7 feat/mcp-server`，非 force 非 squash），我**独立 ls-remote 复核 == bcdcdd7** ✓
并逐个 `git cat-file -t` 确认 4 个终态 sha 真实存在。
（worker 解释：160b2a3/94b4e3e/5eac907 是 `pull --rebase` 前的旧轨迹，已被重写成 482f825/ec68f28，
patch-id 相同 —— 与我在远端观测到的事实一致。）

## 1. 反向对照（本轮最关键的一步：证明新门禁真咬）

把 **round-1 源码**（482f825 的 `mcp-query.ts`，即 `resp.status !== 200 → throw` 那版）
与 **round-2 测试**（bcdcdd7 的 integration test）组合，只跑协议层自愈 case：

```
× 自愈(协议层): 杀 daemon 重启 → app 不显式 invalidateSession → 下次 query 经 status=404 + body=-32600 自动重握手恢复
  McpCallError: mcp http status 404
   ❯ attempt electron/mcp-query.ts:317  → throw new McpCallError("unreachable", msg)
Test Files  1 failed (1) | Tests  1 failed | 4 skipped
```

→ round-1 的 P0（body 被 status check 挡死 → 归类 unreachable → UI 恒显「daemon 未连接」）
**独立复现为真**，且新加的集成 case 对它有真判别力（不是橡皮图章用例）。
同一 case 在 bcdcdd7 上通过（下节）。

## 2. 协议语义亲验（njbx02 起真 daemon，手写 curl 脚本，不走 worker 任何代码）

`python -m mcp_server` + `PYTHONPATH=packages/mcp-server/src`，端口 19133，实测：

| 场景 | daemon 实际响应 |
|---|---|
| initialize（无 session） | **200** + `mcp-session-id: 3b1deb77…`（SSE `event: message` + `data: {…}`） |
| tools/call（带 sid） | **200**，SSE data 内含 `result.content[0].text` = usage_summary JSON |
| tools/call（无 session） | **400** + `-32600 Bad Request: Missing session ID` |
| 杀 daemon 重启后 tools/call（旧 sid） | **404** + `-32600 Session not found` |
| 错误 key | **401** |
| 重新 initialize | **200** + 新 sid（与旧 sid 不同）→ 新 sid 调用 **200** |

→ 与 round-2 报告里引用的 daemon 行为、以及 `attempt` 里 `/Missing session ID/i`、`/Session not found/i`
匹配规则**逐条对上**。真机「点刷新 → 卡恢复真数据」的协议路径成立。

## 3. 全量验证（bcdcdd7，njbx02 亲跑）

| 项 | 命令 | 结果 |
|---|---|---|
| typecheck | `pnpm -C packages/app typecheck`（core build 后） | **0 错** |
| 单测 | `vitest run electron/mcp-query.test.ts` | **19/19** |
| 真 daemon 集成 | `vitest run electron/mcp-query.integration.test.ts` | **5/5**（含协议层自愈 1686ms） |
| app 全量 | `vitest run` | **45 文件 / 549 tests 全绿** |
| 凭证扫描 | diff grep（sk-*/Bearer/key=/password） | 仅测试用假 key `00112233445566778899aabbccddeeff` |
| 边界 | `git diff --name-only 308f93f bcdcdd7` | 仅 3 文件：`mcp-query.ts` + 双测试；daemon / mcp-ipc.ts / mcp-daemon.ts / auth-* / UI 零触碰 ✓ |

注：fresh clone 上直接跑 `pnpm -C packages/app typecheck` 会先报 `@token-wallet/core/schema` 找不到 —
需先 `pnpm -C packages/core build`（前轮 evidence 未写这个前置，属证据精度问题，非缺陷）。

## 4. 逐条核对 round-1 打回项

- **P0 defaultHttpShim**：已修（L88-98：401/403 throw → unauthorized；其他 status 解析 body → 交上层判定；
  body 非 JSON-RPC envelope → 回落 throw → unreachable）。✅ 且经上节反向对照证明修复是真因。
- **P0 单测改真实 400/404 mock**：L426/452/473 已用 `{status:400/404, body: -32600}`，
  mock shim 401/403 亦对齐真 shim 行为（L46-48）。✅
- **P0 集成加协议层自愈 case**：L293-344 已加（杀 daemon → 不显式 invalidate → 旧 sid 走 404+body 自愈）。✅
- **P1 callMcpTool 收敛**：142 行 → 单 `attempt(callHeaders, allowSelfHeal)` 形态，重试块复用同函数。✅
- **P2 集成测试路径探测**：`detectPythonBin()` + `MCP_SERVER_SRC/CWD` 从 HERE 推。✅
  （残留：PYTHONPATH 里仍留 hermes venv site-packages 作兜底条目 — 不存在时仅为无效路径，无害。）
- **P3 L8 注释 `Bearer ***`**：**未落地**（grep 仍为 `*   - Authorization: Bearer ***`）。
  round-2 checklist 却标 pass —— 证据不实，记 WARNING（非阻塞，注释而已）。

## 5. WARNING（放行但记录，不构成打回）

1. **push 纪律**：交接时未推远端（见 §0）。已在本轮内要求 worker 补推并复核。建议后续卡把
   「ls-remote == head_sha」写进 reviewer 门禁的第一步，避免「本地绿 = 交付完成」。
2. **P3 声明未落地**（§4 末条）：checklist 自报与实测不符，注意 evidence_pack 的自证可信度。
3. **session 缓存键只有 endpoint URL**：task body 写的是「per configDir/endpoint 键」。
   实际 `sessionCache` 只按 `http://host:port/mcp` 索引（不含 key）。
   影响有限：换 key 后若 daemon 未重启，旧 session 仍有效；若重启则必然 404 → 自愈重握手。
   未复现出行为缺陷，故降级为记录项。
4. **SSE 多事件合并**：`parseStreamableBody` 把所有 `data:` 行用 `\n` 拼成一个 JSON。
   本 daemon 实测每次响应只 emit 一个 message 事件（§2 已验），故当前无害；
   若将来 daemon 在响应前追加 notification 事件，拼接会 JSON 解析失败 → 误归 unreachable。
   建议改为取最后一个 `data:` 行。
5. **non-200 且 body 可解析但无 error envelope**（如 500 + `{"detail":…}`）会归 protocol_error
   而非 unreachable。属文案分类边界（UI 会显「daemon 协议错误」而非「daemon 未连接」），非阻塞。

## 6. 未亲验项（归用户真机，不阻塞本卡）

**ac_12 / task body 验收第 2 条**：Windows 真机（app @ bcdcdd7）——
「主页 Agent 卡显 njbx02 真数据（~440 万 tokens）→ 杀 daemon → 卡显『daemon 未连接』→
重启 daemon（不重启 app）→ 点刷新 → 卡恢复真数据」。
理由：headless Linux 侧只有协议层可验（本轮已把该路径亲手跑通并反向对照证明），
Electron 壳 + Windows 真 daemon 的端到端呈现只能由用户在真机补一刀。

## 结论

**APPROVE。** 4 个 commit（482f825 / ec68f28 / cbe87af / bcdcdd7）已落 gitee feat/mcp-server（tip=bcdcdd7），
typecheck 0 / 单测 19 / 真 daemon 集成 5 / 全包 549 全绿，边界 3 文件零越界，
round-1 的 P0 经反向对照证明修复到位且门禁真咬。WARNING 5 条均为记录项，
唯一的真机端到端复验按既定分工留在用户侧。
