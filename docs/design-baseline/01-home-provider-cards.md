# 设计基线 · 首页（Provider 卡列表）

> **基线版本**：v1（2026-09-24 存档 — 以当前上线实现为基准）
> **存档方式**：本轮为「缺口补档」——该界面此前无独立设计稿，基线由**当前实现 + e2e 契约 + DECISIONS** 反向提取并锁定，作为后续改动的对稿基准。
> **⚠️ 性质说明**：本基线是**现状快照**，非设计意图稿。将来若要改形态，先对照本基线判断「符合/偏离」，偏离则先修订本基线。

## surface

| 路径 | 说明 |
|---|---|
| `packages/app/src/App.tsx`（usage tab 渲染段） | 首页主体装配 |
| `packages/app/src/components/ProviderCard.tsx` | 卡片组件 |
| `packages/app/src/components/BottomBar.tsx` | 底部操作栏 |
| `packages/app/src/components/States.tsx` | 空态/错误态 |
| `packages/app/src/app.css`（`.card` / `.card-list` / `.bottombar`） | 样式 |

## 基线截图

`_shots/home-{dark,light,glass}.png`（360×720 双倍像素，三主题）

## 形态裁定（现有实现的锁定事实）

### 布局骨架（自上而下）

```
titlebar 32px（拖拽区 + 5 钮）
main-tabs（「用量」/「本地 Agent」两 tab）
card-list（Provider 卡纵向列表，gap 12px）
bottombar（＋添加 / 设置）
```

### 卡片结构（`.card`）

```
card-head   : logo + display_name + 状态点 + status badge（右对齐）
card-body   : 按 provider 类型渲染指标
  ├─ 余额制（如 deepseek/balance）: 总余额大数字 + 赠送/充值分项 + 日均消耗 + 可用天数
  └─ 窗口制（如 kimi/coding）    : 每窗口一行（5h / weekly），使用率 + 重置时间
card 尾部   : 异常态 error note / 一键授权钮（按状态条件渲染）
```

### 关键形态契约（不可静默回退）

| 项 | 契约 | 出处 |
|---|---|---|
| 卡片排序 | 按健康度动态排序，**最危险置顶**（用户偏好：最坏情况优先） | DECISIONS/DESIGN |
| 状态点 | `data-health` ∈ ok/warn/bad/unknown → 四色 | `.status-dot[data-health]` |
| 删除钮 | 绝对定位，`top: var(--space-28)`（**禁改回 4px** — 9/7 t_433892c6 实测与 badge 重叠 23×17px，误触 + 盖状态文字） | `.card-del-btn` |
| 悬浮显隐 | `opacity:0 + pointer-events:auto`，卡 hover / 钮 focus-visible 触发；**单条 :hover，禁叠多层热区** | 悬浮纪律 |
| 卡片宽度 | 全宽单列（360 − 24 padding） | `.card-list` |
| 空态 | daemon/无实例 → 显式空态（`empty-state` / `no-instances`），**不静默渲染 0 卡** | States.tsx |

### 底部操作栏（`.bottombar`）

- 左：`add-btn`（＋ 添加 Provider）
- 右：`settings-btn`（设置）
- 双层职责：`add-provider`（空态内的主 CTA）与 `add-btn` 并存，均进同一向导

## 验收锚点

- 三主题截图一致性：`packages/app/verification/` 历史截图 + 本基线 `_shots/home-*`
- e2e 契约：`e2e/agent-card.spec.ts`（卡列表/徽章语义/排序）、`e2e/badge-semantics.spec.ts`（状态徽章）、`e2e/b2-overlap.spec.ts`（**重叠回归锁**）、`e2e/bar-tooltip.spec.ts`、`e2e/panel-semantics.spec.ts`
- 关键回归锁：`b2-overlap.spec.ts` 专测「删除钮与 badge 零几何重叠」

## 布局物理约束

- 主窗内容区 **360×720**（titlebar 32 + tabs + 内容 + bottombar）
- 卡列表：`gap 12px`；卡片 padding `12px 16px`
- 8px 网格（margin/padding/gap/border-radius 为 4/8 倍数；唯二例外 1px 边框 + 50% 圆角）

## 已知缺口（本基线未覆盖）

- 无设计意图稿（设计意图从未成文）——将来简化/改版时应先出稿，再改基线
- 卡片内部指标区（余额制 vs 窗口制）的视觉规范未文档化，仅代码实现

## 变更流程

1. 改动前对照本文 + `_shots/home-*`
2. **符合基线** → design-fix 修正卡，卡体引用本文件
3. **偏离基线** → 先修订本文（更新裁定 + 重出 `_shots`）+ 老大翻牌，再派实现卡
4. 基线更新后在 `docs/design-baseline/README.md` 更新版本号
