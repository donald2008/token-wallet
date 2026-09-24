# 设计基线 · 标题栏 / 托盘面板壳

> **基线版本**：v1（2026-09-24 存档 — 以当前上线实现为基准）
> **存档方式**：缺口补档（反向提取现状 + e2e 契约）
> **⚠️ 本界面是产品形态的身份层**——用户偏好明确（2026-08 起）：无边框透明圆角悬浮卡片 + 托盘即弹，**反感普通 app 窗口观感**（Windows 原生边框视为丑）。改动此界面须格外谨慎。

## surface

| 路径 | 说明 |
|---|---|
| `packages/app/src/components/TitleBar.tsx` | 标题栏（拖拽区 + 工具钮） |
| `packages/app/src/components/BottomBar.tsx` | 底部栏（＋添加 / 设置） |
| `packages/app/electron/main.ts`（createWindow 段） | 窗壳配置（360×720 / frame:false / transparent） |
| `packages/app/src/app.css`（`.titlebar` / `.bottombar`） | 样式 |

## 基线截图

- `_shots/titlebar-{dark,light,glass}.png`（顶部 120px 特写：标题栏 + tabs + 紧邻区域）
- `_shots/home-{theme}.png`（完整壳，含 tabs 与 bottombar）

## 宿主形态（Electron 窗壳）

| 项 | 值 | 出处 |
|---|---|---|
| 内容区尺寸 | **360×720** | `main.ts` createWindow |
| 边框 | `frame: false`（无系统边框） | D-033 |
| 透明 | `transparent: true` + `thickFrame: false` | D-024 家族 |
| 托盘行为 | 托盘图标即弹面板（托盘区 + 弹出面板双形态） | D-024 |
| 置顶 | 标题栏 `pin-btn` 切换 always-on-top | — |

## 形态裁定（现有实现的锁定事实）

### 标题栏（`.titlebar`，高 **32px** 稳态）

```
[托盘状态点] token-wallet [spacer] [刷新] [主题循环] [置顶] [最小化] [关闭]
   no-drag        app-title       flex:1   btn-icon ×5（各 30px 热区）
```

| 契约 | 内容 | 出处 |
|---|---|---|
| 高度 | `height: var(--space-32)` = 32px（8px 网格取整；t_f7d1beeb 9/7 修订 C 压矮，**禁回弹**） | `.titlebar` |
| padding | `0 var(--space-12)`（12px），改动需重算按钮预算 | 同上 |
| 拖拽 | 整栏 `-webkit-app-region: drag`；交互控件经 `.btn` / `.no-drag` 排除 | D-033 |
| 标题 | `app-title` **默认态完整可见**（禁 ellipsis 截断——t_2ca0af5e P0 终审打回固化；360 宽预算 94+8 < 320 充足） | `.app-title` |
| 按钮组 | 5 钮：`refresh-btn`（含 spinning 态）· `theme-cycle-btn` · `pin-btn` · `win-min-btn` · `win-close-btn` | TitleBar.tsx |
| 状态点 | 托盘四色状态点 + tooltip 同步主进程（`update_tray_status` IPC） | App.tsx |

**超预算兜底**：按钮增多导致超宽 → 走 `.titlebar` 横向溢出，由 e2e `docOverflow<=0` 兜底报红（**不会无声截断**）。

### 底部栏（`.bottombar`）

```
[＋ add-btn]                    [settings-btn]
```
`aria-label` = `t("side.aria")`（导航语义，非普通工具条）。

### 主题与玻璃（与壳正交）

- 三主题：`system` / `light` / `dark`（D-010），标题栏 ☀ 钮快切与设置页三档**同一套 theme state**
- 玻璃特效：半透明面板 + 背景模糊 32px，正交于主题三态；α 15%~100%（默认 100%）
- 无边框透明壳 + 玻璃 = 产品身份（用户偏好：托盘即弹的桌面部件感，非 app 窗口）

## 验收锚点

- e2e：`e2e/titlebar-bars.spec.ts`（栏高/预算/溢出）· `e2e/shell-visual.spec.ts`（壳视觉）· `e2e/pin-toolbar.spec.ts`（置顶）· `e2e/i18n-lang.spec.ts`
- 历史三主题三密度实测截图：`packages/app/verification/quota-cards3/`

## 布局物理约束

- 标题栏 32px 稳态 + `.btn-icon` 30px 热区（内嵌不溢出，drag 区不缩水）
- 全窗 360×720；8px 网格
- 组件级 Flexbox；Flex 容器须显式 `align-items` + `justify-content`（UI 铁律③）

## 已知缺口

- 无设计意图稿（壳形态由 D-024/D-033 + 用户口头偏好确定）
- 悬浮窄条形态（「可最小化到托盘」之外的第二形态）**未实现**，若将来要做得先出稿
- 托盘右键菜单、通知气泡无基线

## 变更流程

同 `01-home-provider-cards.md`。**注意**：涉及窗壳（`frame`/`transparent`/尺寸）的改动会影响产品身份观感，须先出稿并经老大确认——禁按「看起来更好」直接调。
