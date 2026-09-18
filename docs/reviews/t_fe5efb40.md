# 人工审核意见 — t_fe5efb40（SL-07 文档收口，docs-only）

reviewer: njbx02（老大 / human-stage 终审）
verdict: **changes_requested**（1 BLOCKING · 1 WARNING · 1 观察项）
审核对象: `1de4dd0`（`feat/dashboard-redesign`，base `eddee07`，diff = 7 文件 +18/-6）；远端 tip `4c7fedc`（merge `b46f22f`，无冲突）
审核机: njbx02 · 主工作树 `/mnt/d/mywork/token-wallet`（`--ff-only` 至 origin tip）
方法: sdlc-review Round 1 Artifact 透镜（本卡无 changes_requested 前史）+ docs 卡内容级三板斧；**不采信 worker/自审报告，全部亲测**。

> 收口路径说明：本卡为 default lane 人工阶段承接卡（assignee=default），按 kanban-human-review 纪律**不使用 request_changes**（会 requeue 回 default 自循环）→ 处置 = ①本意见文件入 git ②complete 本卡 ③建修复子卡（assignee=desktop-e5jupfs，parents=[t_fe5efb40]）④卡上 comment 留痕。

---

## 1. Git 证据链（独立核验）

| 项 | 结果 |
|---|---|
| `git ls-remote origin refs/heads/feat/dashboard-redesign` | `4c7fedc` == 本地 HEAD ✓ |
| `git log eddee07..1de4dd0` | **仅 1 个 commit**（1de4dd0），线性无分叉；4c7fedc 为 merge（1de4dd0 + b46f22f）✓ |
| `git diff --stat eddee07..1de4dd0` | 7 files changed, 18 insertions(+), 6 deletions(-)（与交接一致）✓ |
| 越界改动 | 无：改动全在 4 项范围内（README.md/README.en.md/DECISIONS.md/frontend-AGENTS.md + 3 PNG）✓ |
| 交付工作树 | clean；工作树内 `_t7665c497-*` / `verification/p5-*` / `core/.hermes-tmp.*` 均为**未跟踪**的兄弟卡在途产物，不在本 commit ✓ |
| D 号唯一性 | `grep -oP '^\| D-\K[0-9]+' \| sort -n \| uniq -d` 零输出；最大 056 = 原最大 055+1 ✓ |

## 2. 三板斧 ① diff 与基线逐行对比 — **PASS**

- `docs/DECISIONS.md` 删行数 = **0**（纯增行，不删史）；新增 D-056 明确写「本条推翻此前大屏 hero 骨架形态，不删史」✓
- README 新增行内**无版本号硬编码**（`v0.x.y` 零命中）✓
- 双语同步：README.md / README.en.md 改动同构（各 3 删 3 增，同一表格块）✓

## 3. 三板斧 ② 内网 IP/端口回归 — **PASS（文本行）+ 二进制盲区已补测**

- `git show 1de4dd0 | grep '^+'` 对 `10.200.` / `8889` / `9131` / `localhost:数字` / `127.0.0.1` **零命中** ✓
- ⚠️ 本条只覆盖**文本行**，不覆盖入库二进制。已补第 4 条对 3 张 PNG 做内容级复核（视觉 + 像素）。

## 4. 三板斧 ③ 文档事实断言对照代码实测 — **逐条 PASS**

**图像（内容级，非只看尺寸）**：3 张 PNG 均为真 PNG `1800×1120`（= 900×560 @2× 真壳比例），md5 互异；视觉复核 dark / light 均为**同一套 Ops Wall**（KPI 带 4 + 趋势 + 环形 + 明细 + 三分项），顶栏为产品语言「Agent 用量 token 消耗 · 成本 · 缓存命中 · 09-09 ~ 09-09」，「Layout C」「2×2 grid」类内部命名**零出现**（D-056③ / S10 合规）✓

**D-056 断言 → 代码真值**：

| 断言 | 实测出处 | 结论 |
|---|---|---|
| 12 列网格 | `app-dash.css:183 grid-template-columns: repeat(12, 1fr)` | ✓ |
| KPI 带 span3×4 | `.dash-kpi{grid-column:span 3}`（:241）+ TSX KPI 带 4 面板（t1..t4，:612-669） | ✓ |
| 趋势/明细 span8，Model/三分项 span4 | `:199 span 8` / `:202 span 4` + TSX :671/:697/:787/:856 | ✓ |
| 3px 状态顶缘 + 系列色 | `.dash-kpi::before{height:3px}`（:243-246）+ `.t1..t4::before{background:var(--chart-1..4)}`（:249-252） | ✓ |
| is-stale 变体沿同语法 | `:155-161`（inset 0 3px 0 0 var(--warn)，顶缘让位防叠色） | ✓ |
| 明细表第 7 列 = 成本（W1 终审） | TSX `:798-804` 七列 = Agent/Tokens/占比/Cache hit/Output/调用/**成本**（`dash.thCost`） | ✓ |
| 无 daemon 降级横幅 testid | `agent-dashboard-c-banner-offline`：TSX + e2e 5 处引用（:1038/:1051/:1112/:1123/:1131） | ✓ |
| 窗口壳 900×560 | `packages/app/electron/main.ts:227-228 width:900 / height:560` | ✓ |
| 权威源目录 | `docs/requests/2026-09-18-dashboard-redesign/`（40-handoff/contracts/design-gate.json 全在） | ✓ |

**AGENTS §5.4 断言 → 代码真值**：面板头 13px/500 + hairline 下缘（`:213/:218/:219`）✓ ｜ chips `.dash-chip`（`:382`，TSX :760/:881-893）✓ ｜ tabular-nums（`:269` 大数字 / `:425` 明细单元格 / `:296` 副行）✓ ｜ 明细行高 24px（`:421`）+ 数值列右对齐（`:423`）+ 首列左对齐（`:430`）✓ ｜ 面板发丝边框 `1px solid var(--border)`（`:190`）✓ ｜ 样式源 `app-dash.css` + 组件 `AgentDashboardC` 存在 ✓

## 5. TESTING.md 条件项 — **实测不触发（自主判定，非采信自报）**

全树 `TESTING.md` 在**仓根**（回写清单写 `docs/TESTING.md` 属清单笔误），115 行，章节 = 四层测试 / L1 / L2 / L2.5 / L3 / L4 / CI 规划；`grep -iE 'testid|data-testid|契约表'` **零命中** → 无 testid 节 → 本卡零改动**正确**（`git show --stat 1de4dd0 -- TESTING.md` 空）✓

---

## 6. 修改项

### B-1（BLOCKING）README 大屏截图交付自相矛盾 + 两枚死资产入库 + 图链路失同步

**现象（实测）**：
- `README.md:22` / `README.en.md:25` 表格标题写 **`（Dark / Light / Glass）`**，正文**只嵌 `dashboard-dark.png` 一张**；
- `docs/screenshots/dashboard-light.png`、`dashboard-glass.png`（各 ~240KB）已入库但**全仓零引用** —— `git grep 'dashboard-dark\|dashboard-light\|dashboard-glass' 1de4dd0` 仅命中 README 两行（均 dark）；
- 而 commit message 与 review 交接摘要均声明「README 大屏截图替换为 Ops Wall 重设计后**三主题**」→ **声明 ≠ 产物**。

**连带（同一根因）**：README 门面图唯一生成脚本 `packages/app/e2e/capture-readme.cjs` 仍产**旧** `panel-{light,dark,glass}.png`（旧图仍在库、现已零引用；`panel-*` 仅该脚本自引用），新图 `dashboard-*.png` **全仓无任何生成脚本** → README 图链路失同步，且新图不可复现（「dev 同源」只能证来自 dev 渲染，不能证可重生成）。

**最小收口（二选一，不扩范围）**：
- (a) 表格补齐为与标题一致的三主题（三图已备齐，成本最低）；**或**
- (b) 保留单图 → 标题删去 `Light / Glass`，并删除未引用的两枚 PNG。

**顺带（同卡消化，不另开卡）**：`capture-readme.cjs` 产出与 README 引用对齐（改产 `dashboard-*`，或提交实际使用的截图脚本）；旧 `panel-*.png` 确认无引用后同批清理。

### W-1（WARNING）§5.4 / D-056 的「gutter 12px」与产品实际渲染不符

**实测**：产品大屏窗口恒为 900×560（`main.ts:227-228`），恒命中 `app-dash.css:636 @media (max-height:640px)` → `.dash-grid{gap: var(--space-8, 8px)}`（:637-639）。从入库截图（@2×）**量得面板间实测间隙 = 16 图像 px = 8 CSS px**（两侧各 1px 发丝边框另计），外缩进 = 8 CSS px（壳 4 + grid 4）。基态 `12px` 只在高度 >640px 生效，**产品窗口不会出现**。
**建议**：§5.4 与 D-056 的 12 列面板墙描述补限定词——「900×560 命中紧凑段，实际 gutter 8px；12px 为宽松视口基态」，避免后续实现者按 12px 改版式。

**附（自审 P2 作废，无需改）**：自审报告称「grid 自身 padding 4px 仅存在于紧凑视口 media query，桌面基准态 grid 无 padding」**与代码不符** —— `.dash-grid` **基态**第 186 行即 `padding: var(--space-4, 4px)`，紧凑段是重复声明。§5.4 原文（「grid 自身 padding 为 4px 微调值」）本身**正确**，无需修改。

## 7. 观察项（记录，非本卡回归，无动作）

截图中演示数据含内部主机名 `njbx02` / `njbx02-heavy` / `home-computer` / `desktop-e5jupfs`。实测这些名字**早已遍布公开仓** fixtures/mocks（`e2e/agent-card.spec.ts` 84 行命中、`src/mock/agentUsage.mock.ts`、`mcp-server/tests/fixtures.py` 等）→ **本卡未新增暴露**。若日后要中性化（演示数据用通用 agent 名），属 fixtures 侧议题，不在本卡范围。

## 8. 门禁与后续

- docs-only 卡、零代码改动 → 无需 typecheck / vitest / e2e（不重跑不构成漏检）。
- **B-1 修复前，本卡的 README 大屏截图不得作为 SL-06（GATE 3 真机验收）出街门面。**
- 修复卡：`t_9fdd07b5`（assignee=desktop-e5jupfs，parents=[t_fe5efb40]）—— B-1 必改，W-1 同批一并处理；修复后仅需 docs 复验（无需全量回归）。
