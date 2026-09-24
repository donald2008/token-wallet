# 设计基线注册表（Design Baseline Registry）

> **本表是「设计是基础」纪律的载体**（product-pipeline 微调沉淀第 5 条，2026-09-24 老大定调）。
> 任何界面/组件的形态改动，先查本表定位其**设计基线**，再按「符合基线 → 走修正卡」/「偏离基线 → 先改基线」处理。
> 没有基线可查 = 该界面尚无锁定形态，任何改动前必须先补基线（禁直接改代码）。

## 怎么用

1. **改形态前**：从下表找到对应 surface 的基线资产路径，打开最终 mock + 形态裁定通读
2. **判定归属**：
   - 改动**符合基线** → 派 design-fix 修正卡，卡体「对稿目标」引用本表路径
   - 改动**偏离基线** → 先走基线修订（更新 mock/裁定 + 老大翻牌 + 更新本表版本号），再派实现卡
3. **基线更新后**：在本表对应行更新「版本/日期」，并在 `design-gate.json` 记录翻牌

**为什么必须有基线**：形态漂移的根因不是某一轮改错，而是**无基线可量**——每处「当时合理」的修复在缺乏参照时独立判断，N 轮累积后远离设计意图且无法归因（大屏 9 轮补丁的教训）。

---

## 基线清单

### 1. Agent 大屏（用量大屏 / Ops Wall）

| 项 | 值 |
|---|---|
| **surface** | `packages/app/src/components/AgentDashboardC.tsx` · `packages/app/src/app-dash.css` |
| **基线版本** | **v2.1**（2026-09-25，Model 面板三修并入；v2.0 = 2026-09-18 D-056 Ops Wall 定案） |
| **形态裁定源** | `docs/DECISIONS.md` → **D-056**（IA/布局/命名/降级形态/testid 契约全套）+ 本节 **Model 面板三修**（用户 9/24 23:09 拍板 B 方案，t_c1e454aa） |
| **基线 mock** | `docs/requests/2026-09-18-dashboard-redesign/50-design/_shots/`（ops-wall 系列 + 降级态 + hover 证明） |
| **翻牌记录** | `docs/requests/2026-09-18-dashboard-redesign/40-handoff/design-gate.json` |
| **规格/继承清单** | `docs/requests/2026-09-18-dashboard-redesign/30-spec.md` + `40-handoff/blast-radius.md`（H1-H10 不可回退 / B1-B4 禁恢复） |
| **验收锚点** | 3 秒三问（是什么/量级/健康吗）· 窗口 900×560 · 1920×1080 零滚动 |
| **布局物理约束** | 12 列网格 gutter 12px · footer 钉底 · 面板自身内滚（非整页滚） |
| **Model 面板三修（v2.1 增补）** | ① **agent 过滤 tabs 退役**——大屏是整体，禁 per-agent 切换，Model 分布为**全局聚合**（`dash-agent-tab` 残留=0 为回归锁）；② **hover 闪烁根因**——`renderCharts` 依赖数组禁含 `hoveredSlice`（否则每次 hover 重建图表）；③ **悬浮信息=外置浮层**（`.dash-model-float`，absolute + z-index 5 + `is-visible` opacity 切换），禁覆盖图形本体 |

### 2. 本地 Agent 页（含置顶用量组件 + Agent 卡）

| 项 | 值 |
|---|---|
| **surface** | `App.tsx`（local-agent tab）· `components/AgentUsageHero.tsx` · `components/AgentCard.tsx` |
| **基线版本** | **A-rev3.2**（2026-09-25：A-rev3 = 09-24 文字减法 + 四边界态；.1 = 列表区内滚；.2 = 大数字 5h 口径，用户 9/24 23:36 拍板 A 方案） |
| **形态裁定源** | `docs/requests/2026-09-24-local-agent-redesign/00-lite-brief-v2.md` + 本节「大数字口径」行（t_235f60c0） |
| **基线 mock** | 同目录 `plan-a-v3.png`（正常态 + 四边界态）· `plan-a-v3.html`（可交互原稿）· `plan-a-v3-viewport.png`（720 首屏） |
| **翻牌记录** | 同目录 `design-gate.json`（approved=true，老大 9/24） |
| **关键形态裁定** | 置顶组件三行结构（标签+大屏钮 / 大数字 / 52px 折线+时间轴）· 大屏入口**全局唯一在置顶**（卡内禁出现）· 卡 meta 无词化（左 calls 右 HH:MM）· 文字减法（禁「全部 agent」「AGENT 卡片 (N)」冗余）· 时间轴**真实时钟**（整点 HH:00 major + 半点 :30 短标，禁 -5h 相对标注） |
| **大数字口径（A-rev3.2 增补）** | 大数字 = **5h 窗 hour 桶求和**（`heroBuckets.reduce`），与标签、折线**同源同窗口**——三者任一处换窗口都是 bug（历史事故：标签硬编码「近 5 小时」而数字取 7d 全局 total = 401M vs 真实 7.47M，差两个数量级）。**派生纪律：窗口标签不得硬编码，须与数据源同源**。降级：hour 从未成功 → 「—」暗色（禁假 0）；有旧快照 → 续显旧值；5h 内真实零上报 → 如实显 0 + 虚线基线 |
| **边界态定义** | ①数据滞后(>30min 黄点+快照带) ②全局零数据(0+虚线基线+引导句) ③列表空(虚线卡+删除回执) ④不足窗口(断线自绘+首点标记) |
| **布局物理约束** | 主窗 360×720 · 列表区 `max-height: 400px` + `overflow-y:auto` + `overscroll-behavior:contain`（少卡时无空滚区）· 8px 网格 |
| **落选方案（归档）** | `plan-b.*`（双区条）/ `plan-c.*`（迷你工具条） |

### 3. 设置页 · MCP 服务面板

| 项 | 值 |
|---|---|
| **surface** | `components/McpServicePanel.tsx` |
| **基线版本** | 2026-09-23/24（语义消歧 + 对齐修复两轮） |
| **形态裁定源** | 本表 + commit `663166e`（引导语义消歧）· `040d6b7`（URL 断行修复） |
| **关键形态裁定** | 服务地址行复制**地址本体** · 引导链接独立行展示 · 常驻引导 hint（发给 agent 用法）· 复制成功 toast 2.6s · 三行按钮右缘成线（min-width 64）· URL 禁字符级断行（nowrap+ellipsis） |
| **验收锚点** | 五块结构（标题/状态/操作钮/自启/地址+Key）· 三行右缘 1222 坐标对齐 |
| **布局物理约束** | 8px 网格 · dd flex-wrap 兜底 |

### 4. 设置页 · 主题模块

| 项 | 值 |
|---|---|
| **surface** | `components/SettingsView.tsx`（theme section）· `theme.css` · `tokens.css` |
| **基线版本** | 2026-09-24（从属层级优化） |
| **关键形态裁定** | 主题 hint 贴按钮组正下方 · 玻璃 α 滑槽**视觉从属**玻璃开关（缩进 24px + off 时 disabled 降透明）· 三主题（system/light/dark）+ 玻璃开关正交 |
| **派生约束** | 三主题×密度成本意识（新组件须三主题过目） |
| **tokens 权威源** | `docs/design-tokens/`（三层 DTCG + tokens.css 生成映射 + validate_aliases.py） |

### 5. 首页（Provider 卡列表）

| 项 | 值 |
|---|---|
| **surface** | `App.tsx`（usage tab）· `components/ProviderCard.tsx` · `components/BottomBar.tsx` · `components/States.tsx` |
| **基线版本** | **v1**（2026-09-24 缺口补档 — 现状快照） |
| **基线文档** | `docs/design-baseline/01-home-provider-cards.md` |
| **基线截图** | `_shots/home-{dark,light,glass}.png` |
| **形态裁定源** | 该文档「形态裁定」节 + `docs/DECISIONS.md` + e2e 契约 |
| **关键回归锁** | `e2e/b2-overlap.spec.ts`（删除钮与 badge 零重叠）· 删除钮 `top: var(--space-28)` 禁回 4px |

### 6. 添加 Provider 向导

| 项 | 值 |
|---|---|
| **surface** | `components/AddProviderWizard.tsx` · `ChannelTree.tsx` · `DynamicForm.tsx` |
| **基线版本** | **v1**（2026-09-24 缺口补档 — 现状快照） |
| **基线文档** | `docs/design-baseline/02-add-wizard.md` |
| **基线截图** | `_shots/wizard-{theme}.png`（选平台）· `wizard-expanded-{theme}.png`（展开）· `wizard-form-{theme}.png`（配置表单） |
| **形态裁定源** | 该文档 + D-025（树形两段式）/ D-026（双重 zod）/ D-017（测试连接） |

### 7. 标题栏 / 托盘面板壳（产品身份层）

| 项 | 值 |
|---|---|
| **surface** | `components/TitleBar.tsx` · `BottomBar.tsx` · `electron/main.ts`（createWindow）· `.titlebar`/`.bottombar` |
| **基线版本** | **v1**（2026-09-24 缺口补档 — 现状快照） |
| **基线文档** | `docs/design-baseline/03-titlebar-shell.md` |
| **基线截图** | `_shots/titlebar-{theme}.png` · `_shots/home-{theme}.png` |
| **形态裁定源** | 该文档 + D-024 家族 / D-033（无边框壳） |
| **⚠️ 敏感度** | 用户偏好明确：无边框透明圆角悬浮 + 托盘即弹，**反感普通 app 窗口观感**。窗壳改动（frame/transparent/尺寸）须先出稿并确认 |

### 8. 设置页（全量区块）

| 项 | 值 |
|---|---|
| **surface** | `components/SettingsView.tsx` 及各子区块 · `.settings-*` |
| **基线版本** | **v1**（2026-09-24 缺口补档 + 已含 MCP/主题两轮修订） |
| **基线文档** | `docs/design-baseline/04-settings.md` |
| **基线截图** | `_shots/settings-{top,mid,bottom}-{theme}.png`（三屏覆盖全量区块） |
| **区块顺序** | 主题 → 语言 → 排序 → 开机自启 → 存储路径 → 关于 → MCP 服务（D-038 信息架构，**调序须走完整管线**） |

---

## 基线缺口（待补）

~~首页 Provider 卡列表 / 添加向导 / 标题栏托盘 / 设置页其余区块~~ → **2026-09-24 已补齐**（上述 5-8 条，现状快照形态）。

**仍缺**（将来动到这些面之前必须补）：

- 悬浮窄条形态（「可最小化到托盘」之外的第二形态，尚未实现 —— 要做先出稿）
- 托盘右键菜单 / 通知气泡
- 各 Provider 渠道的指标区视觉规范（余额制 vs 窗口制，现仅代码实现）
- 空态/错误态全谱系（`States.tsx` 各 reason 变体）

**⚠️ 补档性质提醒**：5-8 号基线是**现状快照**（反向提取），不是设计意图稿——它们能防「静默漂移」，但不能防「现状本身就不理想」。将来要简化/改版这些界面时，应先出设计稿（走 lite 或完整管线），再更新基线。

## 产图工具

- `packages/app/e2e/capture-baseline.cjs` —— 本目录 `_shots` 的产图脚本（mock 桥经 esbuild 转译自 `e2e/fixtures.ts`，与 e2e 单一事实源）。
- 用法：先起 dev server，再 `BASE=http://127.0.0.1:<port> node e2e/capture-baseline.cjs`
- 覆盖：首页 / 标题栏 / 向导（选平台·展开·表单）/ 设置页（上·中·下三屏）× 三主题 = 24 张

## 维护规则

- **谁能改本表**：主 agent（运维/文档域）可维护索引；**基线版本变更须老大翻牌**（design-gate 纪律）
- **更新时机**：每次 design-gate 翻牌后、每次基线修订后
- **禁止**：静默改基线（代码漂了基线跟着改 = 漂移合法化，正是 9 轮循环的病根）
- **收敛纪律**：卡 done 后若产出改了基线收录面的形态（含口径/交互/降级语义），**当轮补录本表**——凭「代码已改、测试已过」跳过补录，等于把基线变成过期文档，下一轮改动就失去参照物（t_c1e454aa / t_235f60c0 两卡均按此补录）
