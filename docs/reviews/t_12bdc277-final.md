# t_12bdc277 人工终审（round-3，复审 B1 修复）— APPROVE

reviewer: njbx02（default, execution lens）
date: 2026-09-11
range: faa7cce → eab3818 → 894957c → 981c1cc → **0113472**
remote: origin/feat/mcp-server ls-remote == 0113472f11182399dbe91b34aebcf6cf1d4c661c ✓

## 复审方法（execution lens，全部亲跑，不采信 worker 自报）

干净 worktree `/root/work/tw-review-t12bdc277-r2` @ 0113472（ext4，非 9p 挂载），
`pnpm install --frozen-lockfile` + `pnpm -C packages/core build` 后逐项复跑。

## B1 复核（round-2 唯一 BLOCKING）

round-2 打回点：两条「零 provider 实例」e2e 在 dev harness 下被
`scenarioProviders("mixed")` 补卡，`providers.length > 0` 恒真，对门禁零判别力。

修复（0113472）：两条用例加 `scenario-empty` 探针（点两次，reload 后复点防脱），
让 `selectPanelProviders` 真返 `[]` 抵达门禁现场。

**反向对照我亲自重跑**：

1. App.tsx:493 门禁打回修复前 `providers !== null && providers.length > 0 &&`
   → `-g "scenario-empty"` **2 failed**（agent-card-section not found）✓ 真咬
2. `git checkout -- App.tsx` 还原 → agent-card.spec.ts **9 passed** ✓
3. 还原后工作树干净（git status 无残留）✓

判别力激活实锤，B1 关闭。

## 全量验证（0113472 亲跑）

| 项 | 结果 |
|---|---|
| typecheck（app，core build 后） | 0 错 |
| app vitest | 44 文件 535/535（首跑 1 挂为 mcp-daemon 10s 轮询计时 flake，重跑全绿） |
| e2e agent-card.spec.ts | 9/9 |
| e2e 全量 browser-only | 121/121 |
| git 证据链 | faa7cce→eab3818→894957c→981c1cc→0113472，ls-remote 一致 ✓ |
| 边界 | faa7cce..0113472 共 13 文件全在 packages/app + docs/reviews，mcp-*/engine/volcengine-ark 零触碰 ✓ |

round-1 已独立通过的项（A 三层判据 + 反向对照、B stripAnsi、C cli_missing + stderr 收集、
D detectPathHint、i18n zh/en、真机 fixture 非伪造）本轮无回退，Delta 仅 spec + 回执文档。

## 对修复方式的说明（非阻断）

round-2 要求①里我列了「断言 empty-state 可见」作为中间守卫；worker 未加该断言，
改用 scenario-empty 探针 + 反向对照实证。判别力由反向对照直接证明（比中间断言更强），
实质达成，不阻断。

## 未亲验项（机器隔离，归用户真机验收）

- ① 断开 SSO 再授权（arkcli 1.0.27 同账号刷新分支）→ 卡显「授权成功」
- ② 临时改 PATH 移除 arkcli → 卡显 cli_missing 引导而非黑话

## 结论

**APPROVE**。B1 修复真实有效，全链路验证绿，边界零越界，远端已推。
遗留 W1/S1-S4 非阻断项见 round-2 意见文件（docs/reviews/t_12bdc277.md），转 backlog。
