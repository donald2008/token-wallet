# Provider 卡片卡内排版 4 方案 v2（t_85237167，9/5 清空重建）

> 上一轮方案：[provider-card-layouts.md(已删)](../)  — t_698a43c9 round2，d304801/279858d 提交。
> 本轮作废原因（用户 9/5 拍板）：S1-S4 差异点没建立在 tooltip QuotaMeter 原语上；含 4-6 窗假想场景过度设计。
> 任务体硬约束见 [t_85237167 卡体](https://kanban.njbx02/t_85237167)。

## 设计前提（与上一轮的差异）

- **唯一窗口行原语 = tooltip QuotaMeter**（BarRowTooltip + QuotaMeter layout=micro，t_a398348b / 6dde355+ea570a0 落地，9/4 主页已验证）。本轮所有方案**每窗一行实例**，不重造基础件，BarRowTooltip/micro 契约不动。
- **现实 provider 1-2 窗**（5h + 周，或 session + 周）。**禁止 4-6 窗密度压缩、周期分区标签**等假想维度。
- **用户 8/31 品味**：拒摘要条（警示色带 / 红色 callout），低频信息低调。本轮 D 方案"头部承担最紧窗"是**数字内联到头部信息流**，**不是摘要条**（不抽警示色带、不抽整段文字）。
- **异常形态（auth_expired/error）共用骨架 body 变体**，**不算独立布局**（卡体硬约束）。
- 8px 网格 / tokens.css / D-016 三态（dark/light/glass）；e2e DOM 契约（.progress / .progress-fill[data-health] / role=progressbar / testid）零破。
- 手动排序保留：拖拽把手 useCardDragSort 零改（D-039）；setup_hint 授权状态必须承载（保留 t_52e3a7fb 列式修复）。

## 共用结构（4 方案一致）

```
┌── CardHead ──────────────────────┐  ~360px 面板内宽 ~336px
│ [◆≡] Kimi-Code #1   [●] 偏低    │ ← handle(BrandLogo) + 名称 + StatusDot + 状态徽章
│                                 │   方案 B 改为「综合态」单行(灯+文字); 方案 D 加 headline 用量
├─────────────────────────────────┤
│ <WindowRow> 5h row QuotaMeter    │ ← 主页 row 排版(每窗一行); 行内嵌 <BarRowTooltip metric=m/>
│ <WindowRow> 周 row QuotaMeter    │   hover 弹 micro 四元素
└─────────────────────────────────┘
```

- **头 handle**：`BrandLogo`（D-039 拖把手载体；mock 放大到 20px 盒 + 虚线缘仅为「可拖」可读性提示，实现卡沿真卡结构落地用 `brand-block.drag-handle` 绑 `makeHandleProps`）
- **异常 body**：auth_expired = 黄灯 + setup_hint 授权面板（保留 t_52e3a7fb 列式修复：说明文字独占整行自然折行，动作钮换行并排）；error = 红字，无 hint
- **不渲染假窗口行**（§2.1）

## 方案 A · 简洁双行基线

```
┌────────────────────────────────┐
│ [◆≡] Kimi-Code #1     [●] 偏低 │ ← handle + 名称 + StatusDot + 状态徽章（最简头部）
│ 5 小时窗  ████████████░░  960/1200 (80%) │ ← row QuotaMeter + 行内 BarRowTooltip
│                        ~3.2 小时后重置       │
│ 周  窗    ████░░░░░░░░░░░  1200/6000 (20%) │
│                        ~5.8 天后重置         │
└────────────────────────────────┘
```

- **差异维度**：头部最小（4 元素直排），双窗 8px 节奏，无新结构
- **与 tooltip 关系**：每行内嵌 `<BarRowTooltip metric={m}/>`，**纯沿用 6dde355 契约**，无新增
- **token 引用**：卡 padding `--space-8/--space-12`；卡 bg `--bg-elev`、border `--border`、圆角 `--radius-12`；窗间 gap `--space-8`
- **实现边界**：复用主页 `.bar-row` 壳（t_a398348b 已挂 hover 揭示）；CSS 只补 `.qcard2` 容器层（`.qcard2 .bar-row:first-child .bar-tooltip` 改向下弹避免顶裁剪）
- **取舍**：~88px 总高最中性；与主页窗口行 1:1 零成本；无惊喜

## 方案 B · 头部综合态（信息上抬，无摘要条）

```
┌────────────────────────────────┐
│ [◆≡] Kimi-Code #1    ● 偏低 ⓘ │ ← 头部「综合态」单行: 灯+综合态文字+ⓘ 触发器
│ 5 小时窗  ████████████░░  960/1200 (80%) │
│                        ~3.2 小时后重置       │
│ 周  窗    ████░░░░░░░░░░░  1200/6000 (20%) │
│                        ~5.8 天后重置         │
└────────────────────────────────┘
   ⓘ hover 揭示合并 tooltip:
   ┌─────────────────────────────┐
   │ ● 5 小时窗  micro 四元素    │
   │ ● 周  窗     micro 四元素    │
   └─────────────────────────────┘
```

- **差异维度**：头部右侧合并「灯 + 综合态文字」单行（替代裸灯 + 文字徽章两件）；整卡右上 ⓘ hover 触发合并 tooltip（双 BarRowTooltip 上下堆叠）
- **与 tooltip 关系**：每行 BarRowTooltip 不变；**新增**：整卡触发器 hover 弹合并 tooltip（`.qcard2-trigger:hover .qcard2-merged-tip { display:flex }`）
- **token 引用**：综合态文字 `--font-11` + `--fg`；触发器圆 `--radius-pill`；合并 tooltip 复用 `.bar-tooltip` 既有容器样式（border/box-shadow/backdrop-filter）
- **实现边界**：复用主页 `.bar-row` 壳 + BarRowTooltip；新增 `.qcard2-trigger` 容器（24×24 圆角按钮）+ `.qcard2-merged-tip`（绝对定位下拉，240px min-width）
- **取舍**：综合态一行让「健康/偏低/告急」一瞥可读，ⓘ 是新交互；**风险颜色仍走行内自身 color，不抽最紧窗**——是信息上抬但**不是摘要条**；真实屏 ~336px 宽下「handle + 名称 + 综合态 + ⓘ」是否拥挤需选型实测

## 方案 C · 状态色条 + 锁住态 tooltip

```
┌────────────────────────────────┐
█ [◆≡] Kimi-Code #1     [●] 偏低 │ ← 整卡左竖 2px 色条(--warn, 对应最紧窗 health)
█ 5 小时窗  ████████████░░  960/1200 (80%) │
█                        ~3.2 小时后重置       │
█ 周  窗    ████░░░░░░░░░░░  1200/6000 (20%) │
█                        ~5.8 天后重置         │
└────────────────────────────────┘
█ = 2px 色条(--warn 黄)始终可见
   锁住态(Tab focus / 点卡): 行 BarRowTooltip 持续可见, 整卡 1px outline
```

- **差异维度**：整卡左竖 2px 色条（--ok/--warn/--bad，反映最紧窗 health）+ 整卡可点击锁住（tabIndex + role=button，无 JS 状态机）
- **与 tooltip 关系**：每行 BarRowTooltip 默认 hover；**锁住态 CSS 让 .bar-tooltip 常驻揭示**（`.qcard2--status-bar:focus-within .bar-tooltip { opacity:1; visibility:visible }`，不依赖 hover）
- **token 引用**：色条用 `currentColor` + `::before` 2px 绝对定位；锁住态 outline `color-mix(in srgb, var(--accent) 50%, transparent)`
- **实现边界**：复用主页 `.bar-row` 壳 + BarRowTooltip；卡上加 `tabIndex={0}` `role="button"` `data-pinnable="true"`；CSS 一条规则搞定锁住态
- **取舍**：色条 2px 不占宽度预算；锁住态=新交互（键盘 Tab 可达，按 Esc 取消聚焦）；色条是**整卡外缘视觉锚点**，与摘要条（卡内头部下方色块）形态完全不同源

## 方案 D · 头部承担最紧窗（无摘要条）

```
┌────────────────────────────────┐
│ [◆≡] Kimi-Code #1   5h 960/1200 [●] 偏低 │ ← 头部承担最紧窗: 窗名小字 + 用量数字 + 灯 + 徽章
│ 5 小时窗  ████████████░░░             │ ← 主页 QuotaMeter(hideUsage, 无 .quota-usage)
│                        ~3.2 小时后重置       │
│ 周  窗    ████░░░░░░░░░░░  1200/6000 (20%) │ ← 周窗显用量
│                        ~5.8 天后重置         │
└────────────────────────────────┘
   头部 hover 揭示最紧窗完整 micro tooltip:
   ┌─────────────────────────────┐
   │ 5 小时窗 micro 四元素        │
   └─────────────────────────────┘
```

- **差异维度**：头部右侧并入「最紧窗用量数字 + 窗名小字」；该窗主页 QuotaMeter 隐藏 .quota-usage（used=undefined，QuotaMeter 契约不破）
- **与 tooltip 关系**：每行 BarRowTooltip 不变；**头部 hover 弹最紧窗 BarRowTooltip**（`.qcard2-trigger--head:hover .qcard2-head-tip`）
- **token 引用**：headline 用 `--font-10` 窗名 + `--font-11` tabular-nums 数字；触发器 padding `--space-8` 横向
- **实现边界**：复用主页 `.bar-row` 壳 + BarRowTooltip；`WindowRow` 加 `hideUsage` prop；最紧窗判定复用 `metricHealth` + remaining 比例（纯函数，可单测）
- **取舍**：风险数字一瞥可见（数字内联到头部信息流）；**不是摘要条形态**（不抽警示色带）；隐含 S2「风险上抬」精神但换形态；与 B 同属头部扩展，区别在 **D 显数字 / B 显综合态文字**

## 横向对比

| 方案 | 核心维度 | 窗口行数最佳 | 信息层级 | 结构增量 | 与 tooltip 关系 | 风险一瞥 |
|------|----------|--------------|----------|----------|------------------|----------|
| A 基线 | 不重排 | 1-2 | 头>行，主从 | 容器层零 | 纯沿用 | 弱（行内色） |
| B 头部综合态 | 头部「灯+综合态文字」单行 + ⓘ | 1-2 | 综合态>头>行 | +ⓘ 触发器+合并 tip | 新增整卡合并 tooltip | 中（综合态） |
| C 状态色条+锁住 | 整卡左竖 2px + 锁住 | 1-2 | 色条外缘锚点 | +CSS 一条规则 | 锁住态常驻 micro | 强（色条+常驻） |
| D 头部承担最紧窗 | 头部并入最紧窗数字 | 1-2 | 头部承担>行 | +headline+head-trigger | 新增头部 trigger tooltip | 强（数字） |

## 建议

- **首选候选 B**：综合态一行让「健康/偏低/告急」一瞥可读；ⓘ 整卡合并 tooltip 适合双窗横比；不引入摘要条，符合用户 8/31 品味；结构增量小。
- **次选 C**：状态色条成本最低（2px + 一条 CSS）；锁住态把双窗 micro 同时常驻适合深度对比；但锁住交互需用户适应。
- **基线对照 A**：实现零风险（与主页 1:1），适合保守用户。
- **D 是 B 的另一种头部扩展**：选型时若用户偏好「数字而非文字」，换 D。
- 4 方案共用一个异常卡 body 变体（auth_expired+error），选型不参与异常卡改造。

## 实现边界（实现卡承接要点）

- 4 方案全部基于 `ProviderCardVariants.tsx`（已落地，QUOTA_GALLERY mock 渲染）；用户选型后另开实现卡把选中的 variant 接入主页 `.card` 结构
- **不动**：BarRowTooltip（micro 契约）、QuotaMeter、BrandLogo、StatusDot、t_52e3a7fb hint 列式、useCardDragSort 把手、D-039 拖拽
- **新增实现**：若选 B/C/D 实现卡需接 OneClickAuth 类交互（当前 mock 静态 tabIndex）
- **mock 数据**：`getVariantMockProviders()` 返回 3 个静态快照（kimi ok / 百炼 auth_expired / DeepSeek error），与 S1-S4 同规
- **截图**：mock 在 QuotaGallery 中渲染，e2e 截图取 `/tmp/quota-card2-{a,b,c,d,abn}.png`

## 变更记录

- 2026-09-05：4 方案 v2 首版（本档，d304801/279858d 旧 S1-S4 全删后重建）
- 上轮废弃：provider-card-layouts.md（279858d 创建，d304801 修订）— 与 4 方案 v2 差异点未建立在 tooltip 原语上，含 4-6 窗假想场景过度设计，用户 9/5 拍板作废
