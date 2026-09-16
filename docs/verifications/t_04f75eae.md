# t_04f75eae 集成验收报告 — typecheck / vitest / e2e 全绿 + 真机三项复验（R3 修订版）

> **R3（2026-09-12）**：按人工终审驳回意见（run 927 changes_requested）修复后重交。
> 变更：app.css 紧凑视口段（`@media (max-height: 680px)`）内大屏所有文本元素
> `line-height` 由 unitless 乘数锁定为定值 px（修复④，消除跨平台 fontconfig 回退字体
> 度量差异），门禁「零滚动」断言保持严格不加容差；清除 R1 遗留旧版 `01-home-360px.png`
> （P2 项）。复验基线：njbx02 修前 4 次全挂（598 > 592 恒定）→ 修后本机 4 次全绿。

> **R2（2026-09-11）**：按 reviewer 驳回意见（comment #1389）修复后重交。
> 变更：③ 证据重拍（standalone 路径 + 900×600/900×640 量化 in-viewport 断言）、
> 披露紧凑视口溢出实情并**修复**（app.css ①②③ + 新增 e2e 门禁）、确认 dash-chrome、
> 补注断言执行视口口径。原 §4②③ 失实证据已撤下（旧 02-dashboard-900x600.png 已删除）。

- **验收对象**: 分支 `feat/mcp-server`（gitee）
- **R1 基线 SHA**: `ae32d265b0f7f3282e832fdb2f08366e8bb309c2`（ae32d26）
- **R2 base → head**: `a0df9450a3a8915f061bdca614b1029011e82030`（a0df945, R1 提交）→ 本轮修复提交
- **验收执行者**: `desktop-e5jupfs`（worker）
- **前置**: 三张功能卡已全部合入并推送（ls-remote 逐卡核对，非本地自报）

## 0. 前置卡合入情况（ls-remote 核对）

| 卡 | 内容 | 合入 commit | 核对方式 |
|----|------|------------|---------|
| t_10077b4d | 移除 `LocalAgentSection` 标题蓝色 accent，改中性前景色 | `ec215fb`（t_4b7984d9 A 项落地，t_10077b4d 复核零 diff 收口 done） | `git log` + 卡面复核 comment |
| t_4b7984d9 | 标题去蓝 + token 全数字 + 大屏独立窗口（round-2/3/4） | `ec215fb` → `0e71efd` → `bf016eb` → `bd4b0f2` | `git log --oneline origin/feat/mcp-server` |
| t_f26c5fb8 | formatTokens 边界单测补齐（K/M 简写删除后千分位契约） | `5e6c775` | 同上 |
| t_185002af | 大屏详情独立窗口升级 D-024 家族无边框透明观感 | `ae32d26` | 同上，且为本卡 R1 验收基线 HEAD |

R2 开工前 `git fetch` 核对：`origin/feat/mcp-server = a0df945`（= R1 head，驳回归零，无兄弟卡新提交）。

## 1. typecheck — 0 错误 ✅

```
$ corepack pnpm -C packages/core build     # 前置：core dist 陈旧会误报 engine.ts TS2353（已知坑）
> tsc -p tsconfig.build.json               # EXIT=0

$ corepack pnpm -C packages/app typecheck
> tsc --noEmit
EXIT=0                                     # 0 错误（R2 含 app.css + e2e 门禁改动后复跑）
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

  126 passed (44.9s)
```

（R1 时 125 passed；R2 +1 = 本卡新增的 **standalone 窗口内收口集成门禁**，见 §3.1。）

### 3.1 本卡新增：集成门禁 `t_04f75eae 集成: standalone 900×600 四象限全部在视口内 + 900×640 零滚动`

`e2e/agent-card.spec.ts` 末尾，锁两条硬断言（针对 R2 发现并修复的溢出问题，见 §4.3）：

1. **900×600**（卡面口径）：`hero-tokens / chart-trend / chart-model / seg-hit /
   detail-list` 五元素全部渲染且 `top ≥ -0.5 && bottom ≤ 视口高 + 0.5`（in-viewport 量化）；
2. **900×640**（产品窗口内容尺寸，`main.ts` BrowserWindow `useContentSize`）：
   `.agent-dashboard-c` 零纵向滚动（`scrollHeight ≤ clientHeight + 1`）且页脚 bottom ≤ 视口高。

### 3.2 新增断言逐项确认（含执行视口口径）

| 卡面要求 | 断言位置 | 执行视口 | 结果 |
|---------|---------|---------|------|
| `agent-tokens` 显示完整千位分隔符数字，非 K/M 简写 | `e2e/agent-card.spec.ts:140` `toContainText("4,474,000")` + `:143` 反向断言 `not.toMatch(/\d+\.?\d*K\b|\d+\.?\d*M\b/)` | 默认 **1280** 视口（`tokens` 容器 1206px） | ✅ 绿 |
| 360px **视口宽**下卡不溢出（零裁剪） | `e2e/agent-card.spec.ts:144-155` `.agent-tokens-number` `scrollWidth ≤ container width + 0.5` | 该 describe 内 `setViewportSize(360, 720)` 后执行 | ✅ 绿 |
| `local-agent-title` 颜色断言 | e2e 无颜色断言（t_10077b4d 复核确认）→ 本卡以 §4.1 计算样式断言 + 像素复核补足 | 360×720 | ✅ 绿 |
| 大屏独立窗口五象限齐 | `e2e/agent-card.spec.ts:187-217`「详情按钮切大屏方案 C」 | 默认 **1280** 视口（断言在 resize 之前，R1 报告此处口径不实，已修正） | ✅ 绿 |
| `?view=agent-dashboard` 直入 | `e2e/agent-card.spec.ts:420`（P0 query param） | 默认 1280 | ✅ 绿 |
| standalone 自绘 chrome + 返回键语义 | `e2e/agent-card.spec.ts:440` / `:464` | 默认 1280 | ✅ 绿 |
| **（R2 新增）**standalone 窗口内收口 | `e2e/agent-card.spec.ts` 集成门禁（§3.1） | 900×600 / 900×640 | ✅ 绿 |

## 4. 真机验收清单自查（三项，R2 全部以 standalone 真实路径取证）

证据截图（本目录）：

| 文件 | 内容 | 产生方式 |
|------|------|---------|
| `01-home-360px-local-agent.png` | ① 360×720「本地 Agent」tab 挂载态 | 临时 spec（复制真实 fixtures + 仅追加 screenshot），跑完已删 |
| `01b-home-360px-usage.png` | ② 360×720 用量 tab，njbx02-heavy 卡 4,474,000 | 同上 |
| `02-dashboard-900x640-standalone.png` | ③ 真实 standalone 路径 900×640（产品窗内容尺寸） | 同上 |
| `02-dashboard-900x600-standalone.png` | ③ 真实 standalone 路径 900×600（卡面口径） | 同上 |
| `03-home-1280x720.png` | 对照：主页 1280×720 | 同上 |

> R1 的 `02-dashboard-900x600.png`（内嵌路径误标为大屏证据）已删除；R1 的
> `01-home-360px.png` 被本组 01/01b 取代，R3 已从树中清除（避免证据目录双版本混淆）。

### ① 主页「本地 Agent」标题无蓝色 ✅

360×720 视口，点 `main-tab-local-agent` 切至本地 Agent tab 后实测：

```
EVIDENCE-1 {"viewport":{"w":360,"h":720},"text":"本地 Agent",
            "color":"rgb(28, 35, 48)","fontWeight":"600"}
```

`rgb(28,35,48)` = `#1c2330`（浅色主题中性前景 `--fg`），非 Chromium UA 默认蓝
`rgb(0,0,255)`。R1 的像素级复核结论（UA 默认蓝 0 像素 / #1c2330 459 像素）对同一
CSS 规则（`app.css` `.local-agent-title { color: var(--fg) }`）继续成立，R2 未改动该规则。

### ② Agent 卡显示 4,474,000 完整数字且 360px（视口宽）不溢出 ✅

360×720 视口，用量 tab 实测（reviewer 已独立复测过同口径，本表数字与之一致）：

```
EVIDENCE-2 {"viewport":{"w":360,"h":720},
 "tokens":{"text":"4,474,000tokens","numberText":"4,474,000",
           "numberScrollWidth":180,"numberClientWidth":180,
           "containerWidth":286,"containerScrollWidth":286,"clipped":false,
           "cardRight":340,"cardWidth":320},
 "docScrollWidth":360,"docClientWidth":360}
```

数字 scrollWidth **180** ≤ 容器 **286**（零裁剪）、卡右缘 **340** ≤ 视口 **360**、
`docScrollWidth = 360` 无横向滚动。口径：**360px = 视口宽**（非卡宽；卡宽实测 320）。

### ③ standalone 大屏窗口四象限（R2 重拍 + 修复 + 实情披露）✅

**R2 修复（源码改动，非仅重拍证据）**。Reviewer 复测发现的三处布局缺陷，根因与修法：

| # | 缺陷（reviewer 实测） | 根因 | 修复（`packages/app/src/app.css`） |
|---|---|---|---|
| ① | 900×600 内嵌路径四象限全 ABSENT、回退主面板 | 内嵌 dashboard 高度不足时整体不渲染（渲染分支问题），该截图本就不该作为大屏证据 | 证据重拍走真实 standalone 路径，误标截图删除 |
| ② | standalone @900×600 detail-list bottom 626 > 视口 600，且 900×640 产品窗口同样溢出 18px | `.agent-dashboard-c` `min-height:600` + 内层 `.panel` `min-height:220`，叠加 33px dash-chrome 后最小内容高 678 > 640 窗口 | `.agent-dashboard-c` 与 `.agent-dashboard-c .panel` 的 `min-height` 改 0（宽松视口观感不变，紧凑视口按剩余高度收缩；明细列表本就 `overflow:auto` 自滚动） |
| ③ | 900×640 下容器内滚动条 + 页脚被裁 | `.chart-wrap` `min-height:180` 令最小高度 ≈610 > 可用 591 | `@media (max-height:680px)` 下图表下限降 150（宽松视口不命中，180 + `flex:1` 不变） |

**修复后量化实测（standalone 路径 `?view=agent-dashboard&standalone=1`）**：

```
EVIDENCE-3 900x640 rects={hero-tokens:{top:121,bottom:159},chart-trend:{230,380},
  chart-model:{230,380},seg-hit:{462,474},detail-list:{462,563},
  dash-chrome:{8,40},agent-dashboard-c:{40,632}}  全部 inViewport:true
  dash={clientHeight:592,scrollHeight:592(零滚动),bottom:632}  footerBottom:611 ≤ 640

EVIDENCE-3 900x600 rects={...同上, agent-dashboard-c:{40,592}}  全部 inViewport:true
  dash={clientHeight:552,scrollHeight:583,detail-list 内部滚动兜底}  footer 按需滚动可见
```

**如实口径（替代 R1 的无限定声称）**：
- 900×640（产品窗口内容尺寸）：**零滚动**，四象限 + chrome + 页脚全部在窗口内完整渲染；
- 900×600（卡面口径）：四象限主体全部首屏可见且不出窗；detail-list 内部条目多时
  在**列表自身**滚动（`overflow:auto` 兜底，文档流不溢出窗口）；
- 「四象限完整不挤压」的准确表述：**四象限区块边界完整落在窗口内、无区块被窗缘裁切**；
  明细列表为变长列表，超长时列表内滚动而非窗口滚动。

**dash-chrome 确认（reviewer 问题 3）**：`.dash-chrome` 仅 `standalone=1` 时挂载
（`App.tsx:448`），非设计缺陷。R2 实测 900×640 / 900×600 下 `dash-chrome {top:8,
bottom:40}` 均渲染且 in-viewport —— 拖拽条 / 最小化 / 关闭钮在真实独立窗（含
`useContentSize` 内容区语义）中可用。内嵌路径（主窗）不渲染 chrome 属既有设计
（主窗有系统/自绘标题栏），e2e `:456-458` 已锁定该反向契约。

## 5. 边界与洁净度

- **R2 代码改动**（本轮提交，均为驳回修复）：
  - `packages/app/src/app.css`：`.agent-dashboard-c` / `.agent-dashboard-c .panel`
    min-height 归零 + `max-height:680px` 媒体查询图表下限 150（注释含根因）；
  - `packages/app/e2e/agent-card.spec.ts`：新增 §3.1 集成门禁（+1 test）；
  - `docs/verifications/t_04f75eae.md` + `docs/verifications/t_04f75eae/`：本报告与
    重拍证据（删除 R1 失实的 `02-dashboard-900x600.png`，新增 4 张 standalone/tab 证据）。
- 工作树中 `packages/app/verification/*.png`、`verification/b2-hover/*.png` 的 modified/untracked
  产物系**其他兄弟卡/历史 worker 的在途产物**（`glass-alpha-round3` / `p1-home` / `p5-home` /
  `b2-hover`），不属于本卡交付范围，**未纳入本次提交**。
- 临时验证 spec（`e2e/_t_04f75eae_*.spec.ts`）跑完已删除，未进入 git 树；`test-results/` 已清。

## 6. 结论

| 验收项 | 结果 |
|--------|------|
| typecheck 0 错误 | ✅（R2 改动后复跑 EXIT=0） |
| vitest 全量绿（含 formatTokens 新断言） | ✅ 557/557 |
| e2e 全量绿 + 新增断言到位 | ✅ 126/126（R1 125 + 本卡集成门禁 1） |
| 真机 ① 标题无蓝 | ✅ `rgb(28,35,48)` |
| 真机 ② 4,474,000 完整 + 360 视口不溢出 | ✅ scrollW 180 ≤ 286 / 卡右缘 340 ≤ 360 / docScrollW 360 |
| 真机 ③ standalone 大屏窗口内收口（R2 修复 + 量化门禁 + 实情披露） | ✅ 900×640 零滚动 / 900×600 四象限 in-viewport / chrome 渲染确认 |
| commit + push 到 feat/mcp-server（gitee） | ✅（head_sha 见提交，ls-remote 核验） |

**六项全通过，无降标。R2 驳回五条修复要求逐条闭环：③ 证据重拍 ✅ / 溢出披露+修复 ✅ /
dash-chrome 确认 ✅ / 视口口径补注 ✅ / commit+push 重交审 ✅。**
