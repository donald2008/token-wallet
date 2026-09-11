# t_04f75eae 集成验收报告 — typecheck / vitest / e2e 全绿 + 真机三项复验

- **验收对象**: 分支 `feat/mcp-server`（gitee）
- **验收基线 SHA**: `ae32d265b0f7f3282e832fdb2f08366e8bb309c2`
- **验收执行者**: `desktop-e5jupfs`（worker）
- **前置**: 三张功能卡已全部合入并推送（ls-remote 逐卡核对，非本地自报）

## 0. 前置卡合入情况（ls-remote 核对）

| 卡 | 内容 | 合入 commit | 核对方式 |
|----|------|------------|---------|
| t_10077b4d | 移除 `LocalAgentSection` 标题蓝色 accent，改中性前景色 | `ec215fb`（t_4b7984d9 A 项落地，t_10077b4d 复核零 diff 收口 done） | `git log` + 卡面复核 comment |
| t_4b7984d9 | 标题去蓝 + token 全数字 + 大屏独立窗口（round-2/3/4） | `ec215fb` → `0e71efd` → `bf016eb` → `bd4b0f2` | `git log --oneline origin/feat/mcp-server` |
| t_f26c5fb8 | formatTokens 边界单测补齐（K/M 简写删除后千分位契约） | `5e6c775` | 同上 |
| t_185002af | 大屏详情独立窗口升级 D-024 家族无边框透明观感 | `ae32d26` | 同上，且为本卡验收基线 HEAD |

集成前已 `git merge --ff-only origin/feat/mcp-server`（`5e6c775` → `ae32d26`），工作树代码状态 = 远端 tip。

## 1. typecheck — 0 错误 ✅

```
$ corepack pnpm -C packages/core build     # 前置：core dist 陈旧会误报 engine.ts TS2353（已知坑）
> tsc -p tsconfig.build.json               # EXIT=0

$ corepack pnpm -C packages/app typecheck
> tsc --noEmit
EXIT=0                                     # 0 错误
```

## 2. vitest — 全量绿 ✅

```
$ corepack pnpm -C packages/app test

 Test Files  45 passed (45)
      Tests  557 passed (557)
   Duration  20.80s
```

**含 formatTokens 新断言**：`src/components/AgentCard.test.tsx`（17 tests）内含
`formatTokens 边界(t_f26c5fb8: K/M 简写分支已删, 一律 Intl.NumberFormat 千分位全数字)`
用例组——覆盖 0 / 999 / 1000 / 4,474,000 / 十亿级 / 负数，含 K/M 负向断言与
`agent-tokens` 行 title 保留完整数字契约。

## 3. e2e — 全量绿 + 新增断言到位 ✅

```
$ corepack pnpm -C packages/app exec playwright test

  125 passed (43.2s)
```

（较兄弟卡交接时的 123/123 新增 2 条：t_185002af 的 standalone 直入 + 返回键语义分流。）

### 新增断言逐项确认

| 卡面要求 | 断言位置 | 结果 |
|---------|---------|------|
| `agent-tokens` 显示完整千分位数字，非 K/M 简写 | `e2e/agent-card.spec.ts:140` `toContainText("4,474,000")` + `:143` 反向断言 `not.toMatch(/\d+\.?\d*K\b|\d+\.?\d*M\b/)` | ✅ 绿 |
| 360px 卡宽不溢出（零裁剪） | `e2e/agent-card.spec.ts:144-155` `.agent-tokens-number` `scrollWidth ≤ container width + 0.5` | ✅ 绿 |
| `local-agent-title` 颜色断言 | e2e 无颜色断言（t_10077b4d 复核确认：local-agent 相关 e2e 仅断言显隐与占位文案，无颜色断言、无截图快照）→ 本卡补**计算样式断言**（见 §4.1） | ✅ 绿 |
| 大屏独立窗口五象限齐 | `e2e/agent-card.spec.ts:187-217`「详情按钮切大屏方案 C」 | ✅ 绿 |
| `?view=agent-dashboard` 直入 | `e2e/agent-card.spec.ts:420`（P0 query param） | ✅ 绿 |
| standalone 自绘 chrome + 返回键语义 | `e2e/agent-card.spec.ts:440` / `:464` | ✅ 绿 |

## 4. 真机验收清单自查（三项）

证据截图位于本目录 `01-home-360px.png` / `02-dashboard-900x600.png` / `03-home-1280x720.png`。
截图由**与 `e2e/agent-card.spec.ts` 完全同源**的临时 spec（复制真实 spec 后仅追加 `screenshot()`
调用，跑完删除、未进 git 树）产出——即截图所拍画面与 e2e 通过的画面是同一次渲染，非另起路径。

### ① 主页「本地 Agent」标题无蓝色 ✅

**客观断言（非目检）**：

```
local-agent-title color = rgb(28, 35, 48)     # = #1c2330，浅色主题中性前景色（--fg）
```

断言 `not.toBe("rgb(0, 0, 255)")`（Chromium user-agent 默认蓝）+ 蓝调启发式
（`b > 150 && b > r+40 && b > g+40` 必须为 false）——两条均通过。

实现侧佐证：`packages/app/src/app.css:862-868`

```css
.local-agent-title {
  font-weight: 600;
  flex: 1;
  /* t_4b7984d9 A: 干掉 button 子元素 user-agent 默认蓝, 与「即将推出」tag 同族克制视觉;
   * 卡上拍板中性前景色(实测本地 CSS 无 color 声明, 吃 Chromium user-agent 蓝) */
  color: var(--fg);
}
```

### ② Agent 卡显示 4,474,000 类完整数字且 360px 宽不溢出 ✅

360×720 视口下渲染（`01-home-360px.png`），断言：

```
njbx02-heavy [data-testid="agent-tokens"]  toContainText("4,474,000")           ✅
                          textContent      not.toMatch(/\d+\.?\d*K\b|M\b/)      ✅
                          .agent-tokens-number scrollWidth ≤ 容器 width + 0.5   ✅（零裁剪）
```

数据源为 e2e fixture 的 9 位数字场景（`input_cache_hit_tokens: 3_310_760` +
`827_690` + `335_550` = 4,474,000），即老大战报的真实 buggy 场景（原 CSS 下 tokens
1fr 列仅 ~140px、数字 scrollWidth 180 → 被 `.card overflow:hidden` 视觉裁掉）。

### ③ 详情打开 900×600 大屏窗口四象限完整不挤压 ✅

在真实 spec 的「详情按钮切大屏方案 C」用例内，进入大屏后切视口至 900×600 再截图并断言
（`02-dashboard-900x600.png`）：

```
agent-dashboard-c              可见（大屏容器）                     ✅
agent-dashboard-c-hero-tokens  toContainText("4,555,000")          ✅ hero
agent-dashboard-c-chart-trend  可见                                ✅ 趋势（canvas）
agent-dashboard-c-chart-model  可见                                ✅ model（canvas）
agent-dashboard-c-detail-list  可见                                ✅ 明细列表
agent-dashboard-c-seg-hit      可见                                ✅ 三分项 split-bar
```

hero 合计 4,555,000 = 64,000 + 4,474,000 + 17,000 + 0（四卡 tokens 全量汇总），
证明 9 位数字在大屏聚合后仍为全数字千分位、未被简写或截断。

> 说明：本卡执行期间视觉模型（vision）配额耗尽（429 Token Plan 上限），
> 三项证据以 **DOM/计算样式客观断言** 为准（比目检更硬），截图为附加证据文件。
> e2e 断言本身即是对真实 Chromium 渲染结果（`getBoundingClientRect` / `getComputedStyle` /
> canvas 元素可见性）的读取，不是静态检查。

## 5. 边界与洁净度

- **本卡零代码改动**：交付物仅为本验收报告 + 证据截图（`docs/verifications/t_04f75eae/`）。
- 工作树中 `packages/app/verification/*.png`、`verification/b2-hover/*.png` 的 modified/untracked
  产物系**其他兄弟卡/历史 worker 的在途产物**（`glass-alpha-round3` / `p1-home` / `p5-home` /
  `b2-hover`），不属于本卡交付范围，**未纳入本次提交**。经 `git log origin/feat/mcp-server -- <path>`
  核对，这些路径在远端无对应提交。
- 临时验证 spec（`e2e/_t_04f75eae_realdevice.spec.ts`、`e2e/_tmp_shot.spec.ts`）跑完已删除，
  未进入 git 树。

## 6. 结论

| 验收项 | 结果 |
|--------|------|
| typecheck 0 错误 | ✅ |
| vitest 全量绿（含 formatTokens 新断言） | ✅ 557/557 |
| e2e 全量绿 + 新增断言到位 | ✅ 125/125 |
| 真机 ① 标题无蓝 | ✅ |
| 真机 ② 4,474,000 完整 + 360px 不溢出 | ✅ |
| 真机 ③ 900×600 四象限完整不挤压 | ✅ |
| commit + push 到 feat/mcp-server（gitee） | ✅（见提交记录） |

**六项全通过，无降标。**
