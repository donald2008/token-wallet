# token-wallet 决策记录

格式: D-NNN | 日期 | 决策 | 理由 | 状态

| ID | 日期 | 决策 | 理由 |
|----|------|------|------|
| D-001 | 2026-08-27 | 全 TS 技术栈: React 19 + Vite, Tauri 2 仅作窗口壳 | 团队 React/RN 延续性零学习成本; 复杂度在接口对接不在系统编程; Svelte 包体优势对部件应用无足轻重 |
| D-002 | 2026-08-27 | 图表: Chart.js v4(数据序列) + 手绘 SVG(状态微部件); 不引 echarts/组件库 | echarts 按需引入仍 150KB+ 对部件太重; Chart.js v4 是现代重写版(ESM/TS/tree-shake); 微部件手绘仅几十个 SVG 元素 |
| D-003 | 2026-08-27 | 部件形态 A+B: 托盘+弹出面板为主, 悬浮窄条可选, 可最小化到托盘 | 托盘色点回答"有没有事"是 glanceability 极致; 窄条满足零点击可见 |
| D-004 | 2026-08-27 | Template(视觉形态)与 Theme(配色)分层; 模板注册进 registry, MVP 先做 bars+ticker | 用户要求多套模板且不限于颜色变化; registry 发现机制便于开源贡献 |
| D-005 | 2026-08-27 | 数据面 cache-first / stale-while-revalidate; UI 永不直连 provider | 启动即出数/断网可用/历史速率计算; status 一等公民表达 stale/auth_expired/unsupported |
| D-006 | 2026-08-27 | 持久化: StorageBackend 接口先行, MVP JsonlStore, P3 评估 SqliteStore | 双宿主约束(webview 无 Node API); 等 quota_history 查询需求明确再上索引, 先实现再抽象 |
| D-007 | 2026-08-27 | monorepo 三包: core / app / mcp-server; mcp-server 定位=常驻数据面 daemon 而非单纯 Agent 接口 | 桌面 app 关闭不影响采集; 一套代码三种部署形态 |
| D-008 | 2026-08-27 | Agent 对接唯一通道 = MCP(streamable-http) | 复用 kanban-mcp 鉴权经验; 不维护第二套 HTTP API |
| D-009 | 2026-08-27 | 通知后置 P3, 配置项默认关, Notifier 接口 P0 先行(空实现) | 优先跑通核心功能; 接口先行使 P3 不动数据面 |
| D-010 | 2026-08-27 | 主题深浅双套 CSS 变量, 默认追随系统 | prefers-color-scheme + Tauri 原生 API |
| D-011 | 2026-08-27 | 轮询 per-provider 可配置, 默认 T2 档 5min | 额度数据无推送通道, 实时上限=轮询; T3 控制台类 30min+ |
| D-012 | 2026-08-27 | Apache-2.0; gitee 主仓(ITEater/token-wallet), v1 稳定后 GitHub 镜像 | 用户偏好 gitee 管理, 国际化后置 |
| D-013 | 2026-08-27 | 凭据 CredentialSource 接口: env/file/command; 仓库不落任何密钥 | 开源项目不假设 Consul; 我们部署用 command 接 Consul KV |
| D-014 | 2026-08-27 | 三原型建模: balance / window / local; 统一 ProviderSnapshot schema | 覆盖 coding plan 窗口制/余额制/本地用量三类典型 |
| D-015 | 2026-08-27 | 框架边界: 四个注册点(ProviderAdapter/Template/CredentialSource/Notifier), 不做插件市场不做热加载 | 防过度设计; 加平台=发新版 |
