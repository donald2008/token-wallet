# 设计基线 · 设置页（全量区块）

> **基线版本**：v1（2026-09-24 存档，含 9/23-24 MCP 面板与主题模块两轮修订）
> **存档方式**：缺口补档 + 已有修订并入（MCP 面板/主题模块的裁定已在 registry 主表，本文补全其余区块）

## surface

| 路径 | 说明 |
|---|---|
| `packages/app/src/components/SettingsView.tsx` | 设置页装配（区块顺序） |
| `packages/app/src/components/McpServicePanel.tsx` | MCP 服务区（本页最后一块） |
| `packages/app/src/components/UpdaterControl.tsx` | 更新控件（关于区） |
| `packages/app/src/components/BrandLogo.tsx` | 品牌 logo（内置 SVG） |
| `packages/app/src/app.css`（`.settings-*`） | 样式 |

## 基线截图（三主题 × 三屏覆盖全量）

| 文件 | 覆盖区块 |
|---|---|
| `_shots/settings-top-{theme}.png` | 标题栏 + 主题区 + 语言区 + 排序区 + 开机自启区（上部） |
| `_shots/settings-mid-{theme}.png` | 存储路径区 + 关于区（版本/检查更新） |
| `_shots/settings-bottom-{theme}.png` | MCP 服务区（含服务地址/引导链接/API Key 三行） |

## 区块清单（顺序即信息架构，禁静默调序）

| # | 区块 | testid | 形态 |
|---|---|---|---|
| 1 | **主题** | `theme-seg` | 三档按钮组（跟随系统/浅色/深色）+ hint（**紧贴按钮组**）+ 玻璃开关 `glass-toggle` + 玻璃 α 滑槽 `glass-alpha-row`（缩进 24px 视觉从属，玻璃 off 时 disabled 降透明） |
| 2 | **界面语言** | `lang-seg` | 二档按钮组（简体中文 / English），切换即生效 + settings.json 持久化 |
| 3 | **排序** | `sort-sec` | **纯说明文字，无控件**（拖拽即排序；新实例自动置顶） |
| 4 | **开机自启** | `autostart-sec` | 复选框 `autostart-toggle` + hint（默认关，D-024） |
| 5 | **存储路径** | `storage-paths` | 定义列表：配置 `config-dir` / 数据 `data-dir`（路径换行显示；`storagePaths` 未就绪时整块不渲染） |
| 6 | **关于** | `about-section` | 品牌 logo + 名称 + 版本 `about-version`（`v<version>`）+ `UpdaterControl`（检查更新）+ hint |
| 7 | **MCP 服务** | `mcp-sec` | 见下表（本页最复杂区块） |

### MCP 服务区（区块 7）细分

| 元素 | testid | 形态 |
|---|---|---|
| 状态行 | `mcp-status` | 状态点（`data-status` 四态：loading/running/stopped/not_installed）+ 状态词 + 副题 |
| 操作钮 | `mcp-start` / `mcp-stop` / `mcp-copy-guide` | 三钮横排；daemon 未安装时 start 禁用 |
| 引导 hint | `mcp-guide-hint` | 常驻一行（「把引导链接发给你使用的 agent…」） |
| 复制 toast | `mcp-toast` | 2.6s 瞬态（「已复制引导链接 — 粘贴给你的 agent 即可开始接入」） |
| 陈旧警示 | `mcp-stale-warning` | daemon build_id 与本机 exe 不一致时出（黄框 + 一键重启） |
| 开机自启 | `mcp-autostart` | 复选框（Q1 联动：同时启用 app 自启） |
| 服务地址 | `mcp-endpoint` + `mcp-endpoint-copy` | 左标签右值 + 「复制地址」（复制**地址本体**） |
| 引导链接 | `mcp-guide-url` + `mcp-guide-copy` | 独立行展示 `/guide` URL + 复制钮 |
| API Key | `mcp-key-masked` + `mcp-key-copy` + `mcp-key-regen` | 遮罩显示 + 复制 + 随机生成（二次确认 `mcp-confirm-*`） |

**MCP 区关键形态裁定**（2026-09-23/24 两轮，commit `663166e` / `040d6b7`）：
- 服务地址行复制**地址本体**（原误复制 guide，与行标签语义冲突）
- 引导链接独立成行、语义唯一
- URL 禁字符级断行（`nowrap + ellipsis`；`dd` flex-wrap 兜底整体掉行）
- 三行右缘成线（`.btn-icon min-width 64px` + `justify-content: flex-end`）
- 复制成功双反馈：钮文案 1.5s「已复制」+ 面板 toast 2.6s

## 验收锚点

- e2e：`e2e/settings.spec.ts`（设置页全量）· `e2e/mcp-service.spec.ts`（MCP 区 12 用例）· `e2e/i18n-lang.spec.ts`（语言）· `e2e/updater.spec.ts`（更新）· `e2e/persistence.spec.ts`（持久化）
- 单测：`SettingsView.test.tsx` · `McpServicePanel.test.tsx`
- 视觉：本基线 `_shots/settings-*`（三主题 × 三屏）

## 布局物理约束

- 弹窗 = 全窗覆盖；`.settings-head` **固定不滚**，滚动只发生在 `.settings-body`（#829 R3 契约）
- 区块 = `.settings-section` 卡片分组；区块标题 `h4`
- 8px 网格；组件级 Flexbox 且显式声明对齐
- 三主题（含玻璃）成本意识：新控件须三主题过目

## 已知缺口

- 无设计意图稿（区块顺序由 D-038 信息架构改造确定，未成设计文档）
- 设置页内部区块的间距节奏未见文档化规范（现为 `.settings-section` 默认 + 各区块自加 hint）
- 玻璃 α 滑槽的 15%~100% 范围与默认值 100% 仅存于代码常量

## 变更流程

同 `01-home-provider-cards.md`。**注意**：区块顺序属信息架构（D-038），调序须走完整管线（非修正卡）。
