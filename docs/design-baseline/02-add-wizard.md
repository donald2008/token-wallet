# 设计基线 · 添加 Provider 向导

> **基线版本**：v1（2026-09-24 存档 — 以当前上线实现为基准）
> **存档方式**：缺口补档（反向提取现状 + e2e 契约），性质为现状快照非设计意图稿。

## surface

| 路径 | 说明 |
|---|---|
| `packages/app/src/components/AddProviderWizard.tsx` | 向导主体（两步态机） |
| `packages/app/src/components/ChannelTree.tsx` | 通道树（平台→产品两段式） |
| `packages/app/src/components/DynamicForm.tsx` | 动态表单（按 params_schema 渲染） |
| `packages/app/src/App.tsx`（add-overlay 段） | 弹窗容器 |

## 基线截图

| 文件 | 步骤 |
|---|---|
| `_shots/wizard-{theme}.png` | 步 1：选择平台（6 平台卡片，各带品牌 logo + 产品数角标 + 产品标签） |
| `_shots/wizard-expanded-{theme}.png` | 步 1 展开态：平台展开出产品项 |
| `_shots/wizard-form-{theme}.png` | 步 2：配置表单 |

三主题各一套（dark / light / glass）。

## 形态裁定（现有实现的锁定事实）

### 两步态机（D-025 树形两段式）

```
step: "add-channel" → "fill-form"
  add-channel: 平台列表（展开即见产品）→ 点产品直达表单（不做三级跳）
  fill-form  : DynamicForm 按 params_schema 渲染 + 测试连接 + 保存实例 + ← 返回选择
```

### 步 1 · 选择平台（`add-channel-step`）

- 标题：首开 = `wizard.firstTitle`；非首开 = `wizard.pickTitle`
- hint：`展开平台, 点击产品直达配置表单(D-025)`
- 平台项：品牌 logo + 平台名 + **角标数字（该平台可配置产品数）** + 产品标签（如 `按量`/`余额`/`窗口`/`Coding Plan`）
- 首开路径由空态 `add-provider` CTA 进入；非首开由 `add-btn` 进入

### 步 2 · 配置表单（`dynamic-form`）

| 元素 | testid | 形态 |
|---|---|---|
| 实例名称 | `inst-name` | 文本输入，预填默认名 |
| 名称重复错误 | `name-error` | 字段级错误（zod 双重校验，D-026） |
| 动态字段 | `param-<key>` | 按 `params_schema` 渲染；secret 类型 = 密码框（**不回显**） |
| API Key 错误 | `key-error` | 字段级错误（role=alert） |
| 命令提示 | `command-help` | 渠道需 CLI 时的引导（含复制钮） |
| 轮询间隔 | `poll-interval` | 数值输入（可选） |
| 测试连接 | — | 成功 → `test-ok`（余额快照）；失败 → 具体错误（D-017） |
| 保存 / 返回 | — | 主钮 + 返回选择步 |

### 弹窗外壳

- `add-overlay`（点击遮罩关闭）+ `settings-view` 同构外壳（`add-wizard`）
- 关闭钮 `add-close`（右上）；返回钮 `add-back`（步 2）

## 验收锚点

- e2e `e2e/settings.spec.ts`：首开向导/同意→空态→`add-channel-step`、树形选择器、动态表单渲染、secret 不回显、测试连接成功/失败、双重 zod 拒绝重复 name
- `packages/app/src/components/SettingsView.test.tsx:113` 断言四 testid 齐全（`add-instance`/`instance-list`/`no-instances`/`add-channel-step`）

## 布局物理约束

- 弹窗 = 全窗覆盖（360×720 内容区），**body 自身滚动**
- 表单字段：标签在上、输入框在下、**撑满容器宽**；底部操作钮横排
- 8px 网格；secret 输入框类型 `password`（永不回显明文）

## 已知缺口

- 无设计意图稿
- 步 1 平台卡片的品牌 logo 规范散落在 `BrandLogo`（内置 SVG，D-002 不引图标库），未成文

## 变更流程

同 `01-home-provider-cards.md`（符合基线 → 修正卡；偏离 → 先改基线 + 翻牌）。
