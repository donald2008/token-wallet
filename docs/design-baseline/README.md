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
| **基线版本** | v2（2026-09-18，D-056 Ops Wall 定案） |
| **形态裁定源** | `docs/DECISIONS.md` → **D-056**（IA/布局/命名/降级形态/testid 契约全套） |
| **基线 mock** | `docs/requests/2026-09-18-dashboard-redesign/50-design/_shots/`（ops-wall 系列 + 降级态 + hover 证明） |
| **翻牌记录** | `docs/requests/2026-09-18-dashboard-redesign/40-handoff/design-gate.json` |
| **规格/继承清单** | `docs/requests/2026-09-18-dashboard-redesign/30-spec.md` + `40-handoff/blast-radius.md`（H1-H10 不可回退 / B1-B4 禁恢复） |
| **验收锚点** | 3 秒三问（是什么/量级/健康吗）· 窗口 900×560 · 1920×1080 零滚动 |
| **布局物理约束** | 12 列网格 gutter 12px · footer 钉底 · 面板自身内滚（非整页滚） |

### 2. 本地 Agent 页（含置顶用量组件 + Agent 卡）

| 项 | 值 |
|---|---|
| **surface** | `App.tsx`（local-agent tab）· `components/AgentUsageHero.tsx` · `components/AgentCard.tsx` |
| **基线版本** | **A-rev3**（2026-09-24，含文字减法 + 四边界态） |
| **形态裁定源** | `docs/requests/2026-09-24-local-agent-redesign/00-lite-brief-v2.md` |
| **基线 mock** | 同目录 `plan-a-v3.png`（正常态 + 四边界态）· `plan-a-v3.html`（可交互原稿）· `plan-a-v3-viewport.png`（720 首屏） |
| **翻牌记录** | 同目录 `design-gate.json`（approved=true，老大 9/24） |
| **关键形态裁定** | 置顶组件三行结构（标签+大屏钮 / 大数字 / 52px 折线+时间轴）· 大屏入口**全局唯一在置顶**（卡内禁出现）· 卡 meta 无词化（左 calls 右 HH:MM）· 文字减法（禁「全部 agent」「AGENT 卡片 (N)」冗余）· 时间轴**真实时钟**（整点 HH:00 major + 半点 :30 短标，禁 -5h 相对标注） |
| **边界态定义** | ①数据滞后(>30min 黄点+快照带) ②全局零数据(0+虚线基线+引导句) ③列表空(虚线卡+删除回执) ④不足窗口(断线自绘+首点标记) |
| **布局物理约束** | 主窗 360×720 · 列表区 max-height 424 + 内滚 · 8px 网格 |
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

### 5. 首页 / Provider 卡 / 添加向导

| 项 | 值 |
|---|---|
| **surface** | `components/ProviderCard.tsx` · 添加向导组件 · 标题栏 |
| **基线版本** | 2026-09 系（早于 requests 目录制度，无独立 request 目录） |
| **形态裁定源** | `docs/frontend-AGENTS.md`（前端契约）+ `docs/DECISIONS.md`（D-015/D-024/D-029/D-030/D-038 等）+ `docs/design-tokens/` |
| **验收锚点** | 三主题三密度截图 `packages/app/verification/` · e2e 契约（settings/agent-card/panel-semantics 等 spec） |
| **⚠️ 缺口** | 无独立 mock 基线文档；改动前须从 e2e 断言 + verification 截图反推形态基准，或先补基线 |

---

## 基线缺口（待补）

按纪律，以下 surface 尚无锁定 mock 基线，**任何形态改动前必须先补基线**：

- 首页 Provider 卡列表（仅有 e2e 契约与截图，无设计稿）
- 添加 Provider 向导（同上）
- 标题栏 / 托盘面板 / 悬浮窄条
- 设置页其余区块（语言/排序/开机自启/存储路径/关于）

## 维护规则

- **谁能改本表**：主 agent（运维/文档域）可维护索引；**基线版本变更须老大翻牌**（design-gate 纪律）
- **更新时机**：每次 design-gate 翻牌后、每次基线修订后
- **禁止**：静默改基线（代码漂了基线跟着改 = 漂移合法化，正是 9 轮循环的病根）
