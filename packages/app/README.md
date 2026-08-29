# @token-wallet/app

Electron 桌面部件(React 19 + Vite, D-033), 内嵌 `@token-wallet/core`。

## 形态

- **主形态**: 系统托盘 + 点击弹出面板(宽 ~360px), 托盘图标色点 = 全局最差状态
- **可选形态**: 桌面悬浮窄条(无边框/置顶/可拖动)
- 可最小化到托盘

## UI 原则

1. Glanceability 一瞥可读: 卡片按剩余健康度动态排序, 最坏情况永远置顶
2. 颜色即状态: 绿(健康)/黄(<30%、临期或 auth_expired 登录态失效)/红(耗尽或 error)/灰(stale/unsupported)
3. 数字回答"还能撑多久", 不只是"还剩多少"

## 技术选型

- React 19 + Vite, 不引组件库(卡片/进度条/按钮全部手写)
- 趋势图规划中(未引入; 定案 D-002 是 Chart.js v4, 待数据序列需求接入); 进度条/仪表盘/电池格等状态微部件手绘 SVG
- 主题: 深/浅双套 CSS 变量, 默认追随系统(`prefers-color-scheme` + 桌面壳原生 API)
- 模板体系(P0-3): Template(视觉形态)与 Theme(配色)分离, 模板注册进 TemplateRegistry(D-004);
  MVP 实现 `bars`(window 窗口制) + `ticker`(balance 余额制) + `local`(占位), 后续 gauge / battery / ring-stack / ledger

详见 [../../docs/DESIGN.md](../../docs/DESIGN.md)。

## 开发 / 验证命令

```bash
pnpm install                   # workspace 根
pnpm -C packages/app dev       # Electron 真壳(esbuild 主进程 + vite dev :1420 + 起窗)
pnpm -C packages/app dev:web   # 仅 vite dev(:1420), 浏览器可直接预览(IPC 走 fallback)
pnpm -C packages/app typecheck # tsc --noEmit
pnpm -C packages/app build     # 主进程/Preload 打包(dist-electron/) + vite build → dist/
pnpm -C packages/app test      # vitest: src L1 + electron/ 主进程单测(原子写/consent RMW)
pnpm -C packages/app test:e2e  # Playwright browser 模式(headless Chromium, mock 桌面桥 IPC)
```

## 壳已实现(P0-2 / E1)

- 托盘 4 色状态点(绿/黄/红/灰 = 全局最差状态) + tooltip 摘要, IPC `update_tray_status`
- 点击托盘弹出/收起面板(宽 360px); 关闭按钮 = 最小化到托盘, 真实退出走托盘菜单
- 单实例锁(app.requestSingleInstanceLock): 二次启动聚焦已有实例
- 无边框透明窗(frame:false + transparent:true), HTML TitleBar 拖拽走
  CSS `-webkit-app-region`, min/close 走 `win_minimize` / `win_close` IPC(E1)
- 主题 dark/light 双套 CSS 变量, 默认追随系统, 设置页可覆盖; 语义色双 token(D-016)
- 首开隐私声明页(D-021) + 零 provider 空态 + 加载骨架屏; consent 首开判定走真实
  configDir/settings.json(P0-7/E1 主进程原子写 + RMW)
- dev 场景切换器(仅 DEV): 全绿/黄/红/灰/混合 mock 场景, 驱动托盘联动

## 面板模板已实现(P0-3)

- Template 注册进 TemplateRegistry(D-004): `src/templates/registry.tsx`, 按 plan_type 默认指派
- `bars` 模板(window 窗口制): 每窗口一条进度条+压字+重置倒计时; 最紧窗口(剩余比例最小)置顶标红
- `ticker` 模板(balance 余额制): 剩余大数字 + 按近 7 天速率的"预计可用天数"(mock 阶段 data 带 daily_rate, P0-5 接历史快照计算)
- 健康度排序(§6.1): 最坏情况优先; 同带内 auth_expired/error 前置, ok 态按最紧 metric 剩余比例升序
- 异常卡(§2.1): auth_expired/stale/unsupported/error 整卡文字替代图表, 不显示假数据;
  auth_expired 亮黄灯 + setup_hint 恢复指引(注: auth_expired 定黄, 见 DESIGN §2.1 与 P0-3 验收)
- 本地 Agent 区(§6.5): 默认折叠占位, P3 接真实数据

## E2E 说明(D-030 / D-033)

- browser 模式(本仓库默认): `e2e/fixtures.ts` 自家 harness 注入 `window.tokenWallet`
  mock 桥(与 Electron preload 同形态), 前端逻辑全部真跑, Linux/CI 可跑
- 真壳 E2E(Electron 窗口): 记 P2
