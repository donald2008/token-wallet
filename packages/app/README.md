# @token-wallet/app

Tauri 2 桌面部件(React 19 + Vite), 内嵌 `@token-wallet/core`。

## 形态

- **主形态**: 系统托盘 + 点击弹出面板(宽 ~360px), 托盘图标色点 = 全局最差状态
- **可选形态**: 桌面悬浮窄条(无边框/置顶/可拖动)
- 可最小化到托盘

## UI 原则

1. Glanceability 一瞥可读: 卡片按剩余健康度动态排序, 最坏情况永远置顶
2. 颜色即状态: 绿(健康)/黄(<30% 或临期)/红(耗尽或 auth_expired)/灰(unsupported)
3. 数字回答"还能撑多久", 不只是"还剩多少"

## 技术选型

- React 19 + Vite, 不引组件库(卡片/进度条/按钮全部手写)
- Chart.js v4(react-chartjs-2)负责趋势图; 进度条/仪表盘/电池格等状态微部件手绘 SVG
- 主题: 深/浅双套 CSS 变量, 默认追随系统(`prefers-color-scheme` + Tauri 原生 API)
- 模板体系: Template(视觉形态)与 Theme(配色)分离, 模板注册进 TemplateRegistry;
  MVP 实现 `bars` + `ticker`, 后续 gauge / battery / ring-stack / ledger

详见 [../../docs/DESIGN.md](../../docs/DESIGN.md)。

## 开发 / 验证命令

```bash
pnpm install                # workspace 根
pnpm -C packages/app dev    # vite dev(:1420), 浏览器可直接预览(IPC 走 fallback)
pnpm tauri dev              # 桌面壳(Tauri window + 托盘), 需本机 Rust 环境
pnpm -C packages/app typecheck   # tsc --noEmit
pnpm -C packages/app build       # vite build → dist/
pnpm -C packages/app test:e2e    # Playwright browser 模式(headless Chromium, mock IPC)
```

## 壳已实现(P0-2)

- 托盘 4 色状态点(绿/黄/红/灰 = 全局最差状态) + tooltip 摘要, IPC `update_tray_status`
- 点击托盘弹出/收起面板(宽 360px); 关闭按钮 = 最小化到托盘, 真实退出走托盘菜单
- 单实例锁(tauri-plugin-single-instance): 二次启动聚焦已有实例
- 主题 dark/light 双套 CSS 变量, 默认追随系统, 设置页可覆盖; 语义色双 token(D-016)
- 首开隐私声明页占位(D-021) + 零 provider 空态 + 加载骨架屏
- dev 场景切换器(仅 DEV): 全绿/黄/红/灰/混合 mock 场景, 驱动托盘联动

## E2E 说明(D-030)

- browser 模式(本仓库默认): 不需要 Rust, `withGlobalTauri: true` + ipcMocks 即可
- tauri 模式(后置): 需 `cargo tauri dev --features e2e-testing`(Cargo feature `e2e-testing`
  引入 `tauri-plugin-playwright`, 生产构建不受影响); 届时 capabilities 需补
  `playwright:default` 权限(仅测试构建, 勿进生产配置)
