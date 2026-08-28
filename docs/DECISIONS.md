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
| D-016 | 2026-08-27 | 语义色拆双 token: --warn(填充/图形) 与 --warn-fg(文字) | 浅色主题下亮黄填充上文字必须深色, 共用单一色值会把黄色压成棕色; 同一语义不同角色不同色值, ok/bad 同理预留 |
| D-017 | 2026-08-27 | 平台对接=预置通道(channel)+参数录入; 用户不接触 YAML/JSONPath; 设置页动态表单+测试连接; custom-http 高级通道后置 | 映射规则是通道内部实现细节不是用户输入面; 录入即验证(测试连接) |
| D-018 | 2026-08-27 | 适配器实现四类: http / command(包装官方 CLI) / session(Cookie) / local-agent; 配置三层分离(内置通道目录/实例/全局设置); 凭据统一 CredentialRef(store/env/file/command) | 由 7 家实战收敛; aliyun 走 bl CLI(command 类首实例), api_key 保留用于探针模式; longcat 暂缓 |
| D-019 | 2026-08-27 | 存储位置按平台解析(Tauri path API / env-paths), 零硬编码; 配置(Roaming)与数据(Local)分家; 凭据进 OS 钥匙串, headless 降级 600 文件 | Windows 为主平台, Roaming 漫游同步不应拖快照大文件 |
| D-020 | 2026-08-27 | 持久化转正 SQLite 为 P0 主力(推翻 D-006 的 JSONL-first): app 走 tauri-plugin-sql, mcp-server 走 node:sqlite; JsonlStore 降级为调试导出 | 每时段×每模型消耗记录是核心需求, 聚合查询需要索引, JSONL 全扫扛不住 |
| D-021 | 2026-08-27 | 分发=标准 Windows 安装包(NSIS); 首开向导=隐私声明(零遥测, 须同意) → 引导添加首个 provider; 初始零配置 | 用户明确定调标准安装形态 |
| D-022 | 2026-08-27 | 状态阈值全局可配置(黄线默认 30%, 红线默认 10%); error/耗尽恒红不走阈值; auth_expired 定黄(见 §2.1) | 用户要求阈值入配置 |
| D-023 | 2026-08-27 | command 通道依赖由 app 内一键安装(bl 走官方二进制脚本 irm|iex, 无需 Node), 安装过程 stdout 实时流入 log 抽屉 | 用户要求安装进度可视化; bl 官方提供免 Node 二进制安装 |
| D-024 | 2026-08-27 | 托盘/应用图标为自设计 token-wallet logo; 开机自启开关默认关; mcp-server 同机本地部署; local-agent 通道 v1 仅预留占位 | 用户定调; MCP 设计后置 |
| D-025 | 2026-08-27 | 通道两层模型: platform → product(同平台多计费产品: coding plan/token plan/按量); 添加流程两步(选平台→选产品→填参数); 同平台实例面板可聚合 | 单层通道无法表达"同一平台多种计费形态"; 用户指出 |
| D-026 | 2026-08-27 | 实例多账号: 同产品允许多实例; name 必填全局唯一, 默认"<平台>-<产品> #N"自动编号; 表单+加载双重校验; 卡片标题显示实例名 | 同一平台不同账号(api-key)需区分, 用户指出 |
| D-027 | 2026-08-27 | 调度器全异步并发: 实例独立循环/防重叠/超时硬切断/启动抖动/失败指数退避/auth_expired 停摆 | 单实例故障零影响他人; 防风控叠加 |
| D-028 | 2026-08-27 | 采集方式收敛为两类: http(API 直调) + command(官方 CLI 包装); session/控制台 Cookie 模拟类整体移除(含阿里 Cookie 兜底) | 官方 CLI(bl/arkcli)已覆盖原需 Cookie 的平台; 少一类少一份会话维护与风控风险; 用户定调 |
| D-029 | 2026-08-27 | 凭据存储: 桌面端一律 OS 钥匙串(Windows 凭据管理器/macOS Keychain, keyring crate); headless 降级链 env → command(Consul) → 600 权限文件(文档显著警告)。内存纪律: key 只活在请求构造瞬间, 日志统一出口模式脱敏, 数据目录 0700, 删实例同步删钥匙串条目 | 威胁模型: 同机进程读文件 > 误提交/误贴 > 备份上云; 主密码加密文件体验不可接受 |
| D-030 | 2026-08-28 | 前端 E2E = Playwright browser 模式(tauri-plugin-playwright): headless Chromium + mock Tauri IPC, Linux/CI 可跑全平台 | 官方 WebDriver(tauri-driver+WebdriverIO)配置繁琐/flaky 社区差评多; browser 模式无 Windows 依赖, 与 visual-test 同构; 真 E2E(tauri/cdp 模式)后置 |
| D-031 | 2026-08-28 | 安装实施: 无代码签名(P4 前), Windows 本机 `pnpm tauri build` 唯一构建渠道, WebView2 downloadBootstrapper, 自动更新后置(更新=重装), gitee release 挂 NSIS + SHA256 | 签名/updater 是 P4 商业化/发布项; Linux/WSL2 无法可靠 cross 出 Windows 包; 不为低频发版维护 Windows gateway |
| D-032 | 2026-08-28 | instances.yaml 读写走 Rust IPC(serde_yaml 解析/生成, tmp+rename 原子写), IPC 传 JSON, 前端零 YAML 依赖、zod(schema.ts)仍是唯一校验权威; consent 首开判定落 configDir/settings.json(配置侧) | webview 无 fs 权限; 前端引 YAML 库违背零冗余依赖; 配置/数据分家(D-019): instances.yaml+settings.json 进 configDir, 快照 sqlite 留 dataDir |
