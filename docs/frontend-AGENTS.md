# token-wallet 前端开发约束 (AGENTS.md)

> 本项目**前端代码（packages/app）的唯一契约文档**。老大 2026-09-03 定调：停止 vibecoding，
> 一切 UI 实现先过本契约。违反布局铁律 = 代码不合格。
>
> 配套权威来源：`docs/DESIGN.md`（设计原理）、`docs/DECISIONS.md`（决策记录 D-001~D-031）、
> `docs/design-tokens/`（DTCG 三层 token 定义，本契约的数值唯一来源）。三者冲突时以
> DESIGN.md 相关章节 + 本 AGENTS.md 的明示条款优先（SPEC 裁决见 DESIGN.md §2.1 先例）。

---

## 0. 项目定位与 UI 设计原则

**产品**：AI 套餐/额度统一实时视图（多云 Coding Plan + 余额 + 本地 token 消耗），
主形态 = 系统托盘 + 弹出面板（宽 ~360px），辅形态 = 桌面悬浮窄条（可最小化到托盘）。

**第一设计原则 = Glanceability（一瞥可读，DESIGN.md §6.1）**：

1. **最坏情况优先排序**：卡片按剩余健康度动态排序，最危险/最需处理置顶。
2. **颜色即状态**：绿(ok)/黄(warn)/红(bad)/灰(unknown) 四色承担全部语义，**无第五种强调色**。
3. **数字回答「还能撑多久」**：余额配「预计可用天数」，窗口配重置倒计时。
4. **品牌 logo 识别先于文字**：卡片名称左侧 16px 品牌色块；正式版用内置单色 SVG 品牌图标，
   不依赖外网 favicon。品牌色表见 `components.tokens.json` 的 `color.brand`。

**托盘色点语义（§6.2 / D-003）**：托盘图标色点 = 全局最差状态；tooltip 摘要
（如「2健康 1偏低 1过期」）。前端把最差状态 + 摘要推给 Rust 侧（`update_tray_status` IPC）。

**模板 / 主题分层（D-004，§6.3）**：`Theme` = 配色/密度（dark/light，默认追随系统）；
`Template` = 信息结构与视觉形态（bars/ticker/gauge/battery/ring-stack/ledger），
注册进 `registry` 按 `plan_type` 默认指派。**改模板形态不改主题配色**，反之亦然。

**信息架构分区（§6.5 面板结构）**：

```
标题栏: 全局状态点 / 手动刷新 / 设置
云端卡片区: 按健康度排序, 原型模板渲染
本地 Agent 区(默认折叠): per-agent 用量 + 云×本地对比行
```

> 注：任务 body 提到 D-038「信息架构分区」，但 master 的 `docs/DECISIONS.md` 仅到 **D-031**，
> 无 D-038。已以 DESIGN.md §6.5 为准（更权威的设计文档）。若后续分支新增 D-038 再说。

---

## 1. 布局铁律（用户 2026-09-03 拍板，违反=代码不合格，逐字保留）

1. **8px 网格制**：`margin` / `padding` / `gap` / `border-radius` 必须为 **4/8 的倍数**；
   唯二例外 = **1px 边框**、**50% 圆角**。
   - 语法照：`4 8 12 16 20 24 28 32 ...`（步进 4）。凡是能除 4 出不来整数的值一律禁止。
   - 例：`6px 10px 14px 2px 3px 7px 5px` 全部违规。
2. **布局双轨制**：页面级布局用 **Grid**；组件级排列用 **Flexbox**；**禁 `position:absolute` 做常规布局**
   （absolute 仅允许用于进度条填充等真正的覆盖/定位场景，且须有明确理由）。
3. **对齐显式声明**：每个 Flex/Grid 容器必须显式写 `align-items` + `justify-content`，不允许留浏览器默认值。
4. **等距原则**：同一视觉层级的一组元素，`gap` 必须统一（同层级不允许 4px / 6px 混用）。
5. **边缘对齐**：相邻模块**左缘同线、右缘同线**；禁「错落有致」随意偏移。

---

## 2. 现有硬编码违背清单（审计 $base_sha 937baea，2026-09-03）

> 方法：对 `packages/app/src/{app.css,theme.css,components/}` 全扫描稀数值。**下表行号对齐审计基准 base $base_sha 937baea**（不是当前 master HEAD）。
> theme-glass 分支(branch)另列，勿合 master（见 §4 玻璃纪律）。
> **后续任何改动不得新增此类数值**；现有违背由单独 UI 收敛卡逐条替换为 token。

### 2.1 master 违背（全部应收敛到 §3 token / §5 tokens.css 变量)

| 位置 (app.css 行) | 现状 | 违规项 | 应收敛到 |
|---|---|---|---|
| L36 `.titlebar` | `padding:10px 12px` | 10px | `--space-12` / `--gutter` |
| L67 `.btn` | `gap:4px padding:4px 8px` | 合规 ✓ | — |
| L94 `.btn-icon` | `padding:4px 6px` | 6px | `--space-8` |
| L109 `.card-list` | `padding:10px 12px` | 10px | `--space-12` |
| L126 `.card-head` | `margin-bottom:6px` | 6px | `--space-8` |
| L156 `.card-error-note` | `margin-top:4px` | 合规 ✓ | — |
| L164 `.abnormal-body` | `gap:2px` | 2px | `--space-4` 或 8 |
| L170 `.lamp` | `margin-right:6px` | 6px | `--space-4`(声明即含) |
| L203 `.local-agent-head` | `gap:6px` | 6px | `--space-4` |
| L237 `.local-agent-body` | `padding:4px 12px 10px 28px` | 10px | `--space-8`/`--space-12` |
| L245 `.bar-row` | `margin-top:6px` | 6px | `--space-8` |
| L261 `.progress` | `height:14px` (尺寸) | 14px | `--space-8` |
| L263 `.progress` | `border-radius:7px` | 7px | `--radius-4` 或 8 |
| L270 `.progress-fill` | `border-radius:7px 0 0 7px` | 7px | `--radius-4` |
| L300 `.bar-row[tightest]` | `border-left:2px` | 2px(非1px边框例外) | `--border-hairline`=1px |
| L119 `.card` | `padding:10px 12px` | 10px | `--space-12` |
| L312 `.ticker-number` | `margin:2px 0` | 2px | `--space-4` |
| L327 `.placeholder` | `gap:10px` | 10px | `--space-8`/`--space-12` |
| L348 `.skeleton-card` | `padding:10px 12px` | 10px | `--space-12` |
| L373 `.scenario-bar` | `padding:6px 12px` | 6px | `--space-8` |
| L380 `.scenario-bar .btn` | `padding:2px 6px` | 2/6px | `--space-4`/`--space-8` |
| L402 `.settings-section` | `padding:10px 12px` | 10px | `--space-12` |
| L448 `.settings-section h4` | `gap:6px` | 6px | `--space-4` |
| L453 `.count-badge` | `border-radius:10px` | 10px | `--radius-pill` (胶囊) |
| L454 `.count-badge` | `padding:0 6px` | 6px | `--space-8` |
| L471 `.tree-platform-btn` | `gap:6px` | 6px | `--space-4` |
| L473 `.tree-platform-btn` | `padding:5px 6px` | 5px | `--space-4` |
| L497 `.tree-platform-logo-dot` | `border-radius:3px` | 3px | `--radius-4` 或 8 |
| L507 `.tree-products` | `gap:2px` | 2px | `--space-4` |
| L514 `.tree-product-leaf` | `gap:6px` | 6px | `--space-4` |
| L515 `.tree-product-leaf` | `padding:4px 6px` | 6px | `--space-8` |
| L537 `.dynamic-form` | `gap:10px` | 10px | `--space-8`/`--space-12` |
| L556 `.input` | `padding:6px 8px` | 6px | `--space-4` |
| L575 `.check-row` | `gap:6px` | 6px | `--space-4` |
| L623 `.instance-list` | `gap:6px` | 6px | `--space-4` |
| L630 `.instance-row` | `padding:6px 8px` | 6px | `--space-4`/`--space-8` |
| L637 `.instance-info` | `gap:2px` | 2px | `--space-4` |
| L655 `.btn-sm` | `padding:2px 6px` | 2/6px | `--space-4`/`--space-8` |
| L660 `.confirm-row` | `gap:6px` | 6px | `--space-4` |
| L674 `.path-row` | `padding:3px 0` | 3px | `--space-4` |

**组件内**：
| 文件 | 现状 | 违规项 | 应收敛到 |
|---|---|---|---|
| `components/StatusDot.tsx` L5 | `size=10` | 10px | `--space-8` |
| `components/TitleBar.tsx` L26 | `size={10}` | 10px | `--space-8` |
| `components/ProgressBar.tsx` | `height` 走 CSS | — | 随 `.progress` 表 |

### 2.2 已合规无需改（对照确认）

`.titlebar gap:var(--gap)=8px`、`.card brand-block 16px/radius4px`、`.setup-hint`、
`.placeholder padding:24px`、`.settings-section margin:0 0 8px`、`.seg gap`、缩进 `28px/24px`、
`bar-label width:72px`（4 倍数，非 4/8 网格点位但为整数）等。

### 2.3 theme-glass 分支（勿合 master）

`feat/theme-glass`（origin 已有）玻璃变体违背与先例，单独收敛；本卡只记录，不改分支：

- `theme.css` `--card-blur: blur(32px) saturate(115%)` : 32px **合规**（4 倍数），但硬编码须 token 化 → `--glass-blur`（primitives.blur.glass-blur）
- `app.css` glass 版 `border-radius:14px` → `--radius-16`；`gap:6px` → `--space-4/8`；
  `padding:34px 12px 10px`（34px 违规）→ `--space-32` 层级；`height:2px`、`padding:3px 6px`、
  `gap:2px`、`min-width:18px`、`padding:0 5px` 等全部非 4/8 → 对应 token。
- **逐条点名（任务卡明确要求，勿遗漏）**：
  - `app.css` L742 `.bar-track-wrap` → `gap:3px`（条+数值+重置 纵向序列的非等距间距）→ `--space-4`
  - `app.css` L779 `.bar-value` → `min-width:52px`（数值右缘定宽列; 52 虽是 4 的倍数(52=4×13)，但 **不在 `--space` 刻度上**(最高 `--space-32`)、无对应 token）→ 应收敛到就近 4 倍数刻度 `--space-48` 或独立定宽 token（交由 UI 收敛卡定稿）

---

## 3. 色彩 / 主题纪律

### 3.1 语义色双 token 先例（D-016）

状态色都是**双 token**：`--ok/--ok-fg`、`--warn/--warn-fg`、`--bad/--bad-fg`、`--unknown/--unknown-fg`。

- 填充/图形用 `--X`：进度条填充、色点、图标。
- 文字用 `--X-fg`：**浅色主题下 warn 文字必须压深**（`--warn-fg: #92600a`）。共用单一色值会把黄色压成棕色。
- **禁止**给文字直接写 `--warn`，给背景写 `--warn-fg`。

### 3.2 glass 变体（feat/theme-glass，勿合 master）

玻璃=加衬底透明的背景 + `backdrop-filter: blur(32px) saturate(115%)` + 半透明边框。
**透明色必须 token 化**（primitives.color.glass 的 white-a08/12/16 与 black-a42）。
浅色用 white-alpha，深色用 black-alpha。玻璃只在悬浮面板/玻璃卡片等少数面用，不做全屏玻璃；
无 blur 时须有足够对比（`prefers-reduced-transparency` 回退）。

### 3.3 深浅双套（D-010）

`dark` / `light` 双套 CSS 变量：`background/surface/surfaceHover/border/text` 全套分组。
默认追随 `prefers-color-scheme`，可配置覆盖（存储在 localStorage，`theme.ts` 管理）。
**status fill 两主题可共用，但 text-fg 必须按主题区分**（浅色压深）。禁止纯 `#000`/`#fff`（用 900 墨 / off-white）。

### 3.4 平台品牌色

品牌色块色表集中在 `components.tokens.json` `color.brand`（deepseek/kimi-code/aliyun/ark/opencode-go），
沿当前 `BRAND_COLORS`。**新增平台必须在此登记**，禁止在组件里散落裸 hex。

---

## 4. 排版 / 间距 / 圆角 / 阴影规范（与 design-tokens 一致）

数值唯一来源 = `docs/design-tokens/`。三层：**primitive（裸值）→ semantic（语义别名）→ component（组件）**。
CSS 落地见 `tokens.css`（生成映射）。

| 维度 | 规范 | token |
|---|---|---|
| 字号 | 基准 13px（`--font-size`）；正文 13 / 小号 12 / 状态 12 / 最小 10-11 / 大数字 22 | `--font-10..22` / `typography.body/caption/micro/badge/metric` |
| 间距 | 8px 网格（4/8 倍数）；基准 gap 8，卡片内边距 12 | `--space-*` / `spacing.gap/gutter/card/section` |
| 圆角 | 基准 8px；小 4 / 大 12 / 特大全玻璃 16；徽标胶囊 pill(999px)；**全域统一，禁混搭** | `--radius-*` / `radius.medium/small/panel/pill` |
| 投影 | X=0，同背景色相，禁纯黑投影；三档 sm/md/lg | `--shadow-sm/md/lg` / `shadow.elevation*` |
| 字体 | `Segoe UI / PingFang SC / Microsoft YaHei / system-ui`；**数值用 `tabular-nums` 防跳动** | `--font-sans` / `fontFamily.sans/numeric` |
| 动效 | 交互反馈 ≤200ms；fast 100 / med 150(现 chevron) / slow 250(现 progress) | `--dur-*` / `motion.fast/medium/slow` |
| 边框 | 仅 `1px`（`--border-hairline`，8px 网格唯一例外）；禁任意 2px+ 边框 | `--border-hairline` / `border.hairline` |

**对齐**：每 Flex/Grid 写 `align-items`+`justify-content`（铁律 3）；图标按钮必须 `aria-label`；
数据大数字用 `tabular-nums`；首帧前同步主题防 FOUC（`main.tsx` 顶层副作用，见 token-wallet-frontend skill）。

---

## 5. 前端工作流约定

### 5.1 改动范围（禁止越权）

- 本仓 `packages/app` 仅处理前端；`packages/core` 由数据面 lane 管。
- **状态阈值/CSS 变量语义改动**必须先对齐 DESIGN.md §9 / DECISIONS 相关决策，再改代码 + README 注释（auth_expired 先例）。
- **禁止 vibecoding**：任何 UI 数值改动必须命中 `docs/design-tokens/` 已有 token 或经老大确认新增。

### 5.2 验证要求

新功能/改动合并前必须：

```bash
pnpm -C packages/app typecheck        # 强校验脚本验证无关文件的静态错误
pnpm -C packages/app test             # 单测 (vitest)
pnpm -C packages/app test:e2e         # Playwright browser 模式 (自动起 vite :1420, mock Tauri IPC)
pnpm -C packages/app build            # vite build → dist
```

- **e2e 是回归面**：任何改动后必须 `test:e2e` 全绿再交审。新增功能必须补对应 spec。
- 布局/间距/颜色改动尤其要跑视觉相关用例（托盘四色、双 token、bars/ticker 模板）。

### 5.3 e2e 断言依赖的 DOM 结构（不可随意改）

以下 testid / class 被 `e2e/smoke.spec.ts`、`e2e/settings.spec.ts` 硬依赖，**改名/删结构=改断言契约，需连同 spec 一起改并同步老大**：

- `consent-page` / `consent-agree`（首开隐私声明）
- `card-list` / `provider-card` / `empty-state`（卡片容器/空态）
- `status-dot` + `data-health={ok|warn|bad|unknown}`（全局/条目状态点）
- `theme-toggle`（主题切换）；`update_tray_status` IPC cmd（托盘色点 + tooltip）
- `scenario-*`（dev 场景切换，仅 DEV）
- `bars-template` / `ticker-template` / `.progress` / `.bar-row[data-tightest]` / `.bar-label` / `.ticker-number` / `.bar-reset` / `[data-lamp="auth_expired"]` / `setup-hint` / `abnormal-body`
- `add-provider` / `add-channel-step` / `dynamic-form` / `tree-platform-*` / `tree-product-*`（设置页/树形 C/D-025）

标题栏 `titlebar` + `app-title` + `spacer` + `btn btn-icon`（refresh/settings）为标题栏骨架，改布局须保持 e2e 可达。

---

## 6. 提交约定

- 分支策略遵循 token-wallet P0 系列现状（历史直推 master）；UI 收敛类改造按老大指示走特性分支再合。
- 提交信息：`feat(app): ...` / `fix(app): ...` / `docs(...): ...`。
- 完成后 `git ls-remote origin master` 核对远程==本地 HEAD（`git status` 干净 ≠ 远程有该 commit）。

---

## 7. 验收基线（baseline-ui 交叉）

- 无渐变滥用、无纯黑/纯白、圆角全域统一、空态必有下一步动作、视口用 `h-dvh` 不用 `h-screen`、
  交互反馈 ≤200ms、`prefers-reduced-motion` 文明降级、紫色/AI 默认渐变不在 token 体系内。
- AGENTS.md 与 DESIGN.md / DECISIONS.md 现有决策**零矛盾**是本契约的硬门槛。