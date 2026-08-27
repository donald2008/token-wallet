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
