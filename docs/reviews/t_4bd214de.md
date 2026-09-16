# 人工审核意见 — t_4bd214de

reviewer: njbx02 (default / human 终审)
verdict: changes_requested
round: 2 (auto 自审通过 → human 打回)
reviewed_sha: 884de69fac4030cee23f398935ce979060d72e36

## 复验方式（独立，非采信 worker 自述）

- 隔离 clone @884de69（ext4 /root/verify-t_4bd214de）独立复跑：core build → typecheck 0；vitest 436 passed（39 files，精确复现）；e2e 全量 112 passed（含 mcp-service 8 用例）
- vision 降级通道（minimax-m3，主链周配额耗尽）独立复核 6 张 evidence PNG
- 冷读关键代码：McpServicePanel.tsx / AgentGuideModal.tsx / electron/{mcp-ipc,mcp-daemon,mcp-autostart,mcp-env,main}.ts / src/ipc.ts / scripts/screenshot-mcp-section.mjs / e2e/mcp-service.spec.ts
- git 三查：remote HEAD=884de69 == ls-remote；本卡 7 commits 零 packages/mcp-server；全改 packages/app+docs

## 已验证通过项（不复述为问题）

- 状态机 + 按钮矩阵（running 禁 start / stopped 禁 stop / busy 全禁 / not_installed 禁 start）✓
- probe=POST /mcp initialize 真握手（非裸 TCP，卡体钉死）✓；spawn detached + polling 至绿 ✓
- mcp-env 5 键位 atomic 写 / 32hex key 重生成二次确认 ✓
- autostart 默认开 + Q1 决议 B 联动（resolveOsAutostart 语义与 D-056 一致）✓
- AgentGuideModal portal 三态 + 双 agent configure/verify 步骤渲染（e2e 断言）✓
- panel 三态截图真实有效（not-installed/running/stopped，md5 全互异）✓
- 真 bug 修复落地：probe 不再抹 start 失败错误条；regen testid 拆分 ✓

---

## 修改项

### 1. [packages/app/src/components/McpServicePanel.tsx:L63-92 + packages/app/electron/mcp-ipc.ts:L115-138 + L155-166] BLOCKING — 停止链路 pid 断裂，真实桌面「停止」空转

证据链（全代码路径）：
1. `mcp_start` handler → `startFn` 返回 `{started, pid}`；renderer `McpServicePanel.onStart` 只读 `r.started`（L68-72），**丢弃 pid**
2. `onStop` 调 `mcpStop()` **不传 pid**（L87）
3. 主进程 `mcp_stop` 无 pid 分支：probe 活 → 返 `{stopped:false, reason:"pid_required"}`（mcp-ipc.ts L122-128）
4. UI **忽略返回值**直接 `probe()`（L88），无任何用户提示 → 状态仍 running，按钮无效

主进程/renderer 均无 pid 持有（全仓 grep 实证）。后果：
- 卡体数据契约「停止：优雅停止（Windows taskkill /T /F 或 SIGTERM）」在真实链路不可达
- key 重生成「重启 daemon 生效」无法编排：ipc.ts L156-157 注释自称「重启由 renderer 编排 stop + start」，实际 `onRegen` 只写盘+提示（L117-133），daemon 持旧 key
- McpServicePanel L83-86 注释自述「返 pid_required，UI 提示…」—— 提示未实现，注释与行为不符

建议（择一 + 兜底）：
- (a) renderer 持 last pid（useRef/state 存 `mcpStart().pid`）→ `onStop` 传 `mcpStop(pid)`；或
- (b) 主进程 mcp_start 缓存 module 级 pid → mcp_stop 无 pid 先查缓存
- 兜底：pid 未知/失败必须**用户可见**（error 条或禁用说明），不许静默吞
- key regen 走真实编排：daemon 活 → stop→start（或独立 restart），新 key 生效；e2e/mock 断言编排被调用

### 2. [packages/app/scripts/screenshot-mcp-section.mjs:L96-107 + verification/mcp-section/*-stopped-modal.png ×3] P1 — evidence 截图错标 + 引导弹窗零截图

- 三张 `*-stopped-modal.png` 经 vision 独立复核 = 设置面板本体（标题「设置」，主题/语言/排序/自启），**非** AgentGuideModal。根因：`what==="modal"` 分支截 `.settings-modal`（L99-100）且脚本从未点 `mcp-open-guide`
- 验收 evidence 清单含「key」态与「接入引导」：引导弹窗 agent 列表、key 二次确认态均无截图
- 修：脚本补点 `[data-testid="mcp-open-guide"]` → 截 `[data-testid="mcp-guide-overlay"]` 或 `.mcp-guide-modal`；另补 key-regen 确认态或 panel key 行截；md5 互异自检保留

### 3. [review_requested 摘要 + electron/mcp-ipc.ts:L5-6 + electron/main.ts:L424] P2 — 自报 commit hash 虚报 + 「7 通道」注释漂移

- 摘要列 `b21e905/c446c54/fab6715/672a0e6/43ce467/10ba0a6/884de69` —— 前 4 个 hash **全仓不存在**（git cat-file 实证）。本卡真实 7 commits = `686b248/defca46/c0bb3f2/a7026e7/43ce467/10ba0a6/884de69`。卡评论订正，防下游 `git show` 失败
- 「7 通道」注释 3 处（main.ts L424 / mcp-ipc.ts L5-6）实际注册 **8 个** handler（含 mcp_get_guide）→ 改 8
- （建议，非强制）mcp-ipc.ts 补专属单测：8 handler payload 解析仅 e2e 覆盖

## 备注

- 隔离性 OK：本卡零动 packages/mcp-server；branch 上 app.css/ProviderCard.tsx 属 t_5d8c3c81 合并链，与本卡 7 commits 隔离
- auto-reviewer（deepseek-v4-pro）P2-1/2/3/4 观察基本属实，但漏了 BLOCKING-1（pid 断裂）；其「7 commits 全部是远端祖先 ✓」只核 HEAD 未核 hash 列表
- 修完请重新 request_review，复验重点：stop 真实变更状态 + regen 编排 + evidence 真截图
