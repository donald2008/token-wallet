# t_12bdc277 round-3 — B1 修复回执 + 反向对照证据

reviewer: njbx02 (981c1cc, REQUEST_CHANGES)
worker: desktop-e5jupfs
date: 2026-09-11
branch: feat/mcp-server @ 894957c → **commit TBD（round-3）**

## B1 复述

`packages/app/e2e/agent-card.spec.ts:236` / `:256` 两条 round-2 用例
"零 provider 实例 + daemon ok / unreachable" 在 e2e harness 里**未真正构造零 provider**:
vite DEV 构建走 `scenarioProviders("mixed")` 返回多张演示卡, `providers.length > 0` 恒成立,
两条用例对 `App.tsx:493` `providers.length > 0 &&` 门禁**零判别力**。
reviewer 实测: 打回门禁 → 9/9 仍全绿。

## 修复方案 + 实测

### 步骤 1 — 探针注入 (`packages/app/e2e/agent-card.spec.ts` L245 / L268)

两条用例改为先同意隐私声明 → **点 `scenario-empty` (`data-testid="scenario-empty"`)**
让 `scenarioProviders` 真返 `[]` → `seedAgentUsage(...)` → `page.reload()` →
**reload 后 React useState 默认丢失, 复点一次探针确保空数组** → 断言 agent-card-section 可见 / AgentCardEmpty reason。

注释里写明判别力激活原理 + 反向对照位置。

### 步骤 2 — 反向对照: 临时把 `App.tsx:493` 打回修复前门禁, 跑这两条

```diff
-{providers !== null && (
+{providers !== null && providers.length > 0 && (
```

`pnpm exec playwright test --project=browser-only agent-card.spec.ts --reporter=list -g "scenario-empty"`:

```
2 failed
  [browser-only] › e2e/agent-card.spec.ts:245:1 › 零 provider 实例 + daemon ok: 点 scenario-empty 让 providers 真为 [] → Agent 卡区仍可见 + 渲染 AgentCard
  [browser-only] › e2e/agent-card.spec.ts:268:1 › 零 provider 实例 + daemon unreachable + scenario-empty 探针: AgentCardEmpty 显式 reason, 区不消失
```

✅ **真咬**: 打回门禁 + scenario-empty 探针 → 2/2 红灯 (agent-card-section not found)

### 步骤 3 — 还原源码 + 复跑

```diff
-{providers !== null && providers.length > 0 && (
+{providers !== null && (
```

`pnpm exec playwright test --project=browser-only agent-card.spec.ts`:

```
9 passed (7.8s)
```

✅ 全绿, 修复后源码 + scenario-empty 探针下两条用例保护住自己声称保护的门禁。

## 修复后全量验证

| 项 | 结果 | 命令 |
|---|---|---|
| typecheck | ✓ 0 错 | `pnpm exec tsc --noEmit` |
| vitest | ✓ 535/535 | `pnpm exec vitest run` |
| e2e agent-card | ✓ 9/9 | `pnpm exec playwright test agent-card.spec.ts` |
| e2e 全量 | ✓ 121/121 | `pnpm exec playwright test --project=browser-only` |

## 边界

仅改 `packages/app/e2e/agent-card.spec.ts` (加 scenario-empty 探针 + reload 后复点 + 注释
写明判别力原理)。`App.tsx` 未变, 沿用 round-2 @ 894957c 修复版本。未碰 mcp-* / engine /
volcengine-ark / auth-defs / auth-session (D-041/D-052 已验证链不扰动)。

## W1 响应

reviewer W1: 「『零 provider 实例』措辞在 dev harness 下名不副实」。
注释里已写明:

> 关键判别探针(round-3 必加): e2e 跑 vite DEV 构建, panelProviders.ts:21
> 在 hasInstances=false + isProd=false 时回退 scenarioProviders(scenario)。
> 默认 scenario="mixed" 返 3 张演示卡 → providers.length > 0 恒成立,
> 门禁永远命中, 两条用例对「门禁是否被关」零判别力。

## 未亲验项 (沿用 round-2 结论)

- Windows 侧 arkcli 1.0.27 真机两连待用户复验: ① 断 SSO 再授权 → 卡显「授权成功」
  ② 改 PATH 移除 arkcli → 卡显 cli_missing 引导。

## 结论

B1 修复完成, 反向对照真咬, 全量 e2e 121 全绿, typecheck 0, vitest 535 全绿。
待 commit + push 后重新 request_review (provenance 回到 njbx02)。