/**
 * 手写 i18n 字典(D-047): 不引 react-i18next 等重型库(D-002 精神, 应用小)。
 *
 * - zh 为 canonical 形态(全量既有文案原样搬), en 为翻译; `Dict = typeof zh` 强制 en 键位对齐,
 *   编译期即兜住"en 漏键"。
 * - t() 读模块级当前语言, 纯函数 + 零 react/零 DOM 依赖(顶层) —— 渲染组件、引擎/连接层
 *   非React模块、Electron 主进程(托盘菜单, Phase B)三方可共用同一字典。
 * - React 组件用 i18nReact.tsx 的 useLang() 订阅语言切换(切语言 → Provider 重渲染整树,
 *   各处 t() 在渲染时重读当前语言, 无需逐组件改造)。
 * - 插值: "{name}" 占位符, t("card.deleteNamed", { name }); 缺参原样保留占位(便于发现)。
 * - 抽取边界: UI chrome(按钮/标题/状态徽章/空态/错误条/表单提示)入字典;
 *   动态数据文案(display_name / setup_hint / error_message / 通道产品名)随通道数据走, 不入字典。
 */

export type Lang = "zh" | "en";

export const LANGS: readonly Lang[] = ["zh", "en"];

/** t() 的键路径类型("badge.ok" 等), 由 zh 字典形状推导 */
type DictPaths<T, P extends string = ""> = T extends string
  ? P
  : { [K in keyof T & string]: DictPaths<T[K], P extends "" ? K : `${P}.${K}`> }[keyof T & string];

/** zh 字典(canonical): 全量既有用户可见文案原样搬入 */
const zh = {
  common: {
    add: "添加 Provider",
    back: "← 返回",
    settings: "设置",
    close: "关闭",
  },
  tray: {
    collecting: "token-wallet — 数据采集中",
    loading: "token-wallet — 加载中",
    noProviders: "token-wallet — 暂无 Provider",
    /** 托盘摘要条目: "{count}{label}"(zh 无空格) / "{count} {label}"(en 留空格) */
    countBadge: "{count}{label}",
  },
  badge: {
    ok: "健康",
    warn: "偏低",
    exhausted: "已耗尽",
    exhausting: "即将耗尽",
    unknown: "未知",
    auth_expired: "待授权",
    stale: "已陈旧",
    unsupported: "未接入",
    error: "采集失败",
  },
  statusText: {
    stale: "数据过期(超 2 个轮询周期未更新)",
    auth_expired: "登录态过期, 请重新授权",
    unsupported: "该通道暂未接入",
    error: "采集失败",
  },
  theme: {
    system: "跟随系统",
    light: "浅色",
    dark: "深色",
  },
  side: {
    aria: "功能底栏",
    refresh: "刷新",
    themeTitle: "主题: {mode}(点击切换)",
  },
  tb: {
    unpin: "取消置顶",
    pin: "置顶窗口",
    min: "最小化",
    close: "关闭(隐藏到托盘)",
  },
  filter: {
    all: "全部",
    available: "可用",
    abnormal: "异常",
    aria: "过滤 Provider",
  },
  card: {
    copy: "复制",
    copied: "已复制",
    copyCmdTitle: "复制命令: {cmd}",
    copyCmdAria: "复制命令 {cmd}",
    authStart: "一键授权",
    authDone: "已授权 ✓",
    authDonePreviewTitle: "预览卡不可刷新(仅真实实例可点)",
    authDonePreviewAria: "已授权 - 预览卡不可刷新",
    authWorking: "处理中…",
    authBrowserHint: "浏览器已打开, 请完成授权后粘贴页面显示的授权码",
    authWaitingCallback: "等待浏览器授权完成…(已自动处理授权码)",
    authOpenUrl: "重新打开授权页",
    authCodePlaceholder: "粘贴授权码",
    authConfirm: "完成",
    authCancel: "取消",
    authRetry: "重试",
    deleteNamed: "删除 {name}",
    dragSort: "拖动排序 {name}",
    confirmDelete: "删除并清钥匙串?",
    confirm: "确认",
    cancel: "取消",
    lastUpdate: "上次更新: {ago}",
    lampAuthTitle: "登录态失效, 亮黄灯",
    lampAuthAria: "auth_expired 黄灯",
    statusDot: "状态: {label}",
    /* t_5d8c3c81 只读缓存语义: 异常卡有旧数据时, 标注数据时效让用户知道不是最新值 */
    staleFetchedAgo: "当前数据为 {ago} 采集(非最新)",
    /* t_12bdc277 火山授权三连 P0 + L1/L2 引导(2026-09-11):
     * cli_missing: 授权阶段 CLI 不可用, 用户无需翻日志也能自助恢复 */
    authCliMissingTitle: "{cli} 未安装或不在 PATH",
    authCliMissingInstall: "请先安装: {cmd}",
    authCliMissingRestart: "装完需重启 app(PATH 继承)",
    authCliMissingPathHintTitle: "检测到 npm 全局目录 {prefix} 不在 PATH",
    authCliMissingPathHintDesc: "包已安装但 app 找不到。请把 npm prefix 加入 PATH 后重启 app:",
    authCliMissingPathHintCmd: "$env:Path = \"{prefix};$env:Path\"",
  },
  ago: {
    now: "刚刚",
    minutes: "{n} 分钟前",
    hours: "{n} 小时前",
  },
  reset: {
    soon: "即将重置",
    days: "{n}天",
    hours: "{n}小时",
    minutes: "{n}分",
  },
  plan: {
    balance: "余额",
    window: "窗口",
  },
  planType: {
    balance: "余额制",
    window: "窗口制",
  },
  tpl: {
    granted: "赠送 {amount}",
    toppedUp: "充值 {amount}",
    rate7: "近 7 天 ~{rate}/天",
    eta: "预计可用约 {days} 天",
    noRate: "余额 · 预计可用天数待消耗速率数据(历史积累后显示)",
    localUsage: "{name} · 本地用量",
  },
  /* 2026-09-03 文案本地化(UI 重设计 ⑤): metric key 直出 → 友好窗名 */
  metric: {
    rolling_5h: "5 小时窗",
    weekly: "周窗",
    monthly: "月窗",
    balance: "余额",
    session: "会话窗",
    fallback: "{key}",
  },
  /* 计量单位标签(t_23800bd4): QuotaMeter 用量行按 Metric.unit 语义展示, 禁止硬编码单位词 */
  unit: {
    requests: "次",
    tokens: "tokens",
    credits: "credits",
  },
  local: {
    title: "本地 Agent",
    tag: "即将推出",
    body: "per-agent 用量 + 云×本地对比行(接入真实数据后显示)",
  },
  consent: {
    title: "欢迎使用 token-wallet",
    l1a: "本应用",
    l1b: "零遥测、零上报",
    l1c: ", 你的套餐与凭据数据",
    l1d: "只保存在本机",
    p2: "继续使用即表示你已知晓以上隐私声明。",
    agree: "同意并继续",
  },
  empty: {
    title: "暂无 Provider",
    desc: "添加第一个 AI 套餐 / 余额通道, 额度健康状况将显示在这里。",
  },
  collecting: {
    title: "数据采集中",
    desc: "已配置的 Provider 正在采集额度数据, 首个快照到达后即显示。",
  },
  noMatch: {
    title: "无匹配实例",
    desc: "当前过滤条件下没有 Provider, 切换其他过滤视角查看。",
  },
  cfgErr: {
    title: "配置加载失败",
    desc: "实例配置(instances.yaml)损坏或未通过校验。为避免覆盖你的配置,\n        应用已停止加载, 请修复配置文件后重启。",
    pathLabel: "配置文件位置: ",
  },
  persistError: {
    text: "配置未能保存到磁盘，重启后可能丢失：{error}",
  },
  wizard: {
    firstTitle: "引导: 选择第一个平台",
    pickTitle: "选择平台",
    hint: "展开平台, 点击产品直达配置表单(D-025)。",
    configure: "配置 {name}",
    closeAria: "关闭添加向导",
  },
  form: {
    cliFallback: "官方 CLI",
    okTitle: "✓ 连接成功",
    nameEmpty: "实例名不能为空",
    nameDup: "实例名已存在: {name}",
    keyDup: "该 key 已存在于实例「{name}」",
    saved: "已保存到实例列表",
    adapterCommand: "command(官方 CLI)",
    adapterHttp: "http",
    nameLabel: "实例名称",
    namePlaceholder: "DeepSeek-按量 #1",
    pollLabel: "轮询间隔",
    pollPlaceholder: "5m(可选, 覆盖全局默认)",
    test: "测试连接",
    testing: "测试中…",
    save: "保存实例",
    saving: "保存中…",
    back: "← 返回选择",
    twoStep: "两段式授权",
    twoStep1: "① 先安装官方 CLI(",
    twoStep2: ", 见通道说明)",
    twoStepLogin: "② 再完成一次登录:{hint}",
  },
  test: {
    instanceName: "测试连接",
    notWired: "通道 {channel} 未接入真实采集(目录不变量破坏)",
    authFailed401: "认证失败: API Key 无效 (401 Unauthorized)",
    fetchFailed: "采集失败({status})",
    cmdBridgeFailed: "command 测试连接失败: {err}",
    needsHost: "command 通道需桌面壳(主进程)执行",
    sessionExpired: "控制台会话已失效, 请重新登录",
    authFailedPrefix: "认证失败: {reason}",
    missingParam: "缺少必填参数: {label}",
  },
  engine: {
    credInvalid: "凭据引用非法",
    keyringMissing: "钥匙串条目不存在: {key}",
    envMissing: "环境变量未设置: {name}",
    credSourceUnsupported: "凭据源暂不支持: {source}",
    unsupportedAlert: "通道 {channel} 暂未接入, 等待适配器(P2 多通道)",
  },
  schema: {
    nameDup: "实例名重复: {name}",
    idDup: "实例 id 重复: {id}",
    nameEmpty: "实例名不能为空",
    nameExists: "实例名已存在: {name}",
    badChannelPath: "通道路径非法: {channel}",
    noSchema: "通道不存在或无参数 schema: {channel}",
    unknownError: "未知错误",
  },
  store: {
    validateFailed: "实例配置校验失败: {msg}",
    yamlReadFailed: "instances.yaml 读取失败: {err}",
    yamlValidateFailed: "instances.yaml 校验失败: {err}",
  },
  scenario: {
    loading: "加载中",
    empty: "空态",
    allOk: "全绿",
    warn: "黄(偏低)",
    auth: "黄(auth_expired)",
    stale: "灰(stale)",
    error: "红(error)",
    mixed: "混合示例",
    expectHealth: "期望托盘色: {health}",
  },
  // ---- 设置页(Phase B 接线; 键位先入字典保证单源) ----
  set: {
    closeAria: "关闭设置",
    theme: "主题",
    glass: "玻璃特效(半透明面板 · 背景模糊)",
    // t_c20d4d11 9/7 玻璃透明度滑槽: 范围 15%-100%, 默认 100% 不透明
    glassAlpha: "玻璃透明度",
    glassAlphaHint: "默认不透明, 拖低滑槽变半透明(背景模糊常开 32px)。停手自动保存。",
    themeHint:
      "默认追随系统外观, 可在此覆盖。标题栏 ☀ 钮可快切浅色/深色/跟随系统, 与此处三档同走一套主题。",
    sort: "排序",
    sortHint: "排序只留手动: 在面板上直接拖动卡片即可自定义顺序, 无需在此选择。新添加的 Provider 会自动出现在第一位。",
    autostart: "开机自启",
    autostartHint: "登录系统时自动启动本应用(默认关闭)。",
    storage: "存储路径",
    config: "配置",
    data: "数据",
    storageHint: "配置与数据分开存储, 路径在运行时解析。",
    about: "AI 套餐/额度桌面仪表盘",
    aboutHint: "内置单色品牌图标, 离线可渲染(currentColor 随主题自适应)。",
    language: "语言",
    languageHint: "界面显示语言, 切换即生效, 重启后保持。",
    quotaGallery: "四元素排版变体方案(theme-glass 实验)",
    // ---- D-055 / t_4bd214de: 设置页 [MCP 服务] 区块 ----
    mcpTitle: "MCP 服务",
    mcpSubtitle: "本地 MCP daemon 管理, agent 通过 127.0.0.1:{port}/mcp 接入。",
    mcpStatusRunning: "运行中",
    mcpStatusStopped: "未运行",
    mcpStatusProbe: "正在探测…",
    mcpStatusNotInstalled: "未找到 daemon 可执行文件",
    mcpStart: "一键启动",
    mcpStop: "停止",
    mcpRestarting: "重启中…",
    mcpAutostartLabel: "开机自启",
    mcpAutostartHint: "登录系统后自动启动 daemon(Q1 联动: 同时启用应用自启)。",
    mcpEndpointLabel: "服务地址",
    mcpKeyLabel: "API Key",
    mcpKeyMasked: "{key}(已遮罩)",
    mcpKeyCopy: "复制",
    mcpKeyCopied: "已复制",
    mcpKeyRegen: "随机生成",
    mcpKeyRegenConfirmTitle: "重新生成 API Key?",
    mcpKeyRegenConfirmBody:
      "新 key 写入 mcp.env, 已配 agent 必须更新才能继续调用。daemon 需手动重启后新 key 生效。",
    mcpKeyRegenConfirm: "生成并提示",
    mcpKeyRegenCancel: "取消",
    mcpKeyRegenRestartHint: "新 key 已写入, 请点 [停止] → [一键启动] 让 daemon 生效。",
    mcpKeyRegenAutoRestartHint: "新 key 已写入, daemon 已自动重启生效。",
    mcpKeyRegenRestartFailedHint: "新 key 已写入, 但 daemon 自动重启失败, 请手动 [停止] → [一键启动]。",
    mcpAgentTitle: "Agent 接入",
    mcpAgentOpenGuide: "查看安装步骤",
    mcpAgentGuideEmpty: "daemon 未运行, 无法获取接入步骤。先启动 daemon。",
    mcpAgentGuideFailed: "获取接入步骤失败。",
    mcpAgentGuideStep: "步骤",
    mcpErrorGeneric: "操作失败: {msg}",
    mcpStaleTitle: "daemon 版本陈旧",
    mcpStaleBody: "正在运行的 MCP daemon 与本机安装的版本不一致(可能是升级后残留的旧进程)。建议重启 daemon 以加载新版本。",
    mcpStaleRestartAction: "一键重启",
  },
  updater: {
    unavailable: "更新功能仅安装版可用",
    checking: "正在检查更新…",
    check: "检查更新",
    toVersion: "更新到 v{version}",
    downloading: "正在下载 {percent}%",
    installTo: "重启安装 v{version}",
    failed: "更新失败, 稍后重试",
  },
  quota: {
    title: "Provider 卡片排版方案",
    subtitle:
      "同一套 kimi-code 三窗真实数据(rolling_5h + weekly + monthly, requests 计数制), 分别用 3 种卡头×三窗空间关系渲染。**三窗 QuotaMeter(layout=micro) 常驻直显**是信息主体(无 hover 依赖)—— micro 就是悬浮窗内 QuotaMeter 的同一形态(title+bar+(usage|reset) 三层 grid, 4px 条, font-10)。差异落在真排版维度, 不是头部装饰件堆叠。",
    open: "查看方案页",
    legendOk: "ok(健康)",
    legendWarn: "warn(偏低)",
    legendBad: "bad(耗尽)",
    // t_73c110ea 9/7 重建: 3 方案 + 异常段 mock, 全部基于真排版维度差异(无头部装饰件堆叠)
    // t_5b092750 9/7 加 P5(短窗并排) — 短窗两列 grid + 月独占一行, 来自 token-monitor 布局
    // P3 三列 grid 在 360px 屏下实测文字重叠 + 列被裁切 —— 故本轮不交付 P3
    // 留 4 个真维度方案: 空间结构(P1)/信息层级(P2)/头部承载(P4)/短窗并排(P5)
    cardP1Name: "Provider 卡 · P1 基线竖排(主页同构)",
    cardP1Desc:
      "卡头 = handle + 名称 + StatusDot + 状态徽章(一行)。三窗 micro 各一行 QuotaMeter, 窗间 4px gap(micro = 悬浮窗内 QuotaMeter 的同一形态, title+bar+(usage|reset) 三层 grid)。**与主页 ProviderCard 形态对齐, 认知零成本**。",
    cardP2Name: "Provider 卡 · P2 头部综合态(信息上抬, 无摘要条)",
    cardP2Desc:
      "卡头右侧合并「StatusDot + 综合态文字」一行(整卡 health 一瞥可读); 三窗 micro 同 P1。**不引入摘要条形态**——风险颜色仍走行内自身 color, 头部不抽警示带。",
    cardP4Name: "Provider 卡 · P4 头部数字(最紧窗内联, 无摘要条)",
    cardP4Desc:
      "卡头右侧并入「最紧窗用量数字 + 窗名小字」一行, 该窗行隐藏用量避免重复(QuotaMeter 缺省即不渲染, 契约不破)。**风险数字内联到头部信息流, 不用摘要条形态**。",
    cardP5Name: "Provider 卡 · P5 短窗并排(monitor 布局, 5h+周同窗/月独占)",
    cardP5Desc:
      "卡头同 P1; **5h+周两窗同一行两列 grid**(gap=8), **月窗独占下一行全宽**。三窗全复用 layout=\"micro\" QuotaMeter — **不重造单元, 只重排窗口间网格**。来自用户 9/7 拍板的 token-monitor 窗口布局。360px 双列实测无文字重叠 / 无裁切。",
    cardAbnName: "Provider 卡 · 异常卡共用骨架(4 方案同一套)",
    cardAbnDesc:
      "auth_expired / error 共用 AbnormalBody(不计入独立布局): 状态灯 + 状态文字 + (auth_expired only) setup_hint 授权面板(复制命令) + 最近更新/alerts。结构与主页 ProviderCard AbnormalBody 同构。",
  },
} as const;

/** Dict = zh 字典的宽松形态: 结构同 zh 但值放宽为 string(as const 的字面量类型会让 en 无法对齐) */
type Writable<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Writable<T[K]> };
export type Dict = Writable<typeof zh>;

/** en 字典: 类型强制与 zh 键位完全对齐(漏键/多键编译期报错) */
const en: Dict = {
  common: {
    add: "Add provider",
    back: "← Back",
    settings: "Settings",
    close: "Close",
  },
  tray: {
    collecting: "token-wallet — Collecting data",
    loading: "token-wallet — Loading",
    noProviders: "token-wallet — No providers",
    countBadge: "{count} {label}",
  },
  badge: {
    ok: "OK",
    warn: "Low",
    exhausted: "Depleted",
    exhausting: "Nearly depleted",
    unknown: "Unknown",
    auth_expired: "Re-auth",
    stale: "Stale",
    unsupported: "Not wired",
    error: "Failed",
  },
  statusText: {
    stale: "Data is stale (no update for 2+ poll cycles)",
    auth_expired: "Session expired, please re-authorize",
    unsupported: "This channel is not supported yet",
    error: "Fetch failed",
  },
  theme: {
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  side: {
    aria: "Action bar",
    refresh: "Refresh",
    themeTitle: "Theme: {mode} (click to switch)",
  },
  tb: {
    unpin: "Unpin",
    pin: "Always on top",
    min: "Minimize",
    close: "Close (hide to tray)",
  },
  filter: {
    all: "All",
    available: "Available",
    abnormal: "Issues",
    aria: "Filter providers",
  },
  card: {
    copy: "Copy",
    copied: "Copied",
    copyCmdTitle: "Copy command: {cmd}",
    copyCmdAria: "Copy command {cmd}",
    authStart: "Authorize",
    authDone: "Authorized ✓",
    authDonePreviewTitle: "Preview card cannot refresh (only real instances)",
    authDonePreviewAria: "Authorized - preview card cannot refresh",
    authWorking: "Working…",
    authBrowserHint: "Browser opened. After approving, paste the code shown on the page",
    authWaitingCallback: "Waiting for approval in browser… (code auto-handled)",
    authOpenUrl: "Reopen auth page",
    authCodePlaceholder: "Paste auth code",
    authConfirm: "Done",
    authCancel: "Cancel",
    authRetry: "Retry",
    deleteNamed: "Delete {name}",
    dragSort: "Drag to reorder {name}",
    confirmDelete: "Delete and clear keychain?",
    confirm: "Confirm",
    cancel: "Cancel",
    lastUpdate: "Last updated: {ago}",
    lampAuthTitle: "Session expired (yellow)",
    lampAuthAria: "auth_expired yellow",
    statusDot: "Status: {label}",
    /* t_5d8c3c81: data freshness note shown on abnormal cards with stale-but-rendered data */
    staleFetchedAgo: "Data last fetched {ago} (stale)",
    /* t_12bdc277 cli_missing onepager guidance (2026-09-11) */
    authCliMissingTitle: "{cli} not installed or not in PATH",
    authCliMissingInstall: "Install first: {cmd}",
    authCliMissingRestart: "Restart app after installing (PATH is inherited at launch)",
    authCliMissingPathHintTitle: "npm global prefix {prefix} is not in PATH",
    authCliMissingPathHintDesc: "The package is installed but the app can't find it. Add the npm prefix to PATH and restart the app:",
    authCliMissingPathHintCmd: "$env:Path = \"{prefix};$env:Path\"",
  },
  ago: {
    now: "just now",
    minutes: "{n} min ago",
    hours: "{n} h ago",
  },
  reset: {
    soon: "resets soon",
    days: "{n}d",
    hours: "{n}h",
    minutes: "{n}m",
  },
  plan: {
    balance: "Balance",
    window: "Window",
  },
  planType: {
    balance: "Balance-based",
    window: "Window-based",
  },
  tpl: {
    granted: "Grant {amount}",
    toppedUp: "Top-up {amount}",
    rate7: "7-day ~{rate}/day",
    eta: "≈{days} days left",
    noRate: "Balance · estimated days pending usage-rate data (shown after history accumulates)",
    localUsage: "{name} · local usage",
  },
  metric: {
    rolling_5h: "5h window",
    weekly: "Weekly",
    monthly: "Monthly",
    balance: "Balance",
    session: "Session",
    fallback: "{key}",
  },
  /* unit labels (t_23800bd4): QuotaMeter usage line follows Metric.unit semantics, no hardcoded unit words */
  unit: {
    requests: "times",
    tokens: "tokens",
    credits: "credits",
  },
  local: {
    title: "Local agents",
    tag: "Coming soon",
    body: "Per-agent usage + cloud×local comparison rows (shown once real data lands)",
  },
  consent: {
    title: "Welcome to token-wallet",
    l1a: "This app ",
    l1b: "collects zero telemetry and zero reporting",
    l1c: "; your plan and credential data ",
    l1d: "never leaves this device",
    p2: "By continuing you acknowledge this privacy notice.",
    agree: "Agree and continue",
  },
  empty: {
    title: "No providers yet",
    desc: "Add your first AI plan / balance channel; quota health will show up here.",
  },
  collecting: {
    title: "Collecting data",
    desc: "Configured providers are being polled; the first snapshot will appear shortly.",
  },
  noMatch: {
    title: "No matching instances",
    desc: "No providers under the current filter; try another view.",
  },
  cfgErr: {
    title: "Failed to load configuration",
    desc: "The instance config (instances.yaml) is corrupted or failed validation.\n        To avoid overwriting your config, the app stopped loading. Fix the file and restart.",
    pathLabel: "Config file location: ",
  },
  persistError: {
    text: "Failed to save config to disk; it may be lost after restart: {error}",
  },
  wizard: {
    firstTitle: "Get started: pick your first platform",
    pickTitle: "Choose a platform",
    hint: "Expand a platform and click a product to open its form.",
    configure: "Configure {name}",
    closeAria: "Close add wizard",
  },
  form: {
    cliFallback: "official CLI",
    okTitle: "✓ Connected",
    nameEmpty: "Instance name is required",
    nameDup: "Instance name already exists: {name}",
    keyDup: "This key already exists in instance \"{name}\"",
    saved: "Saved to instance list",
    adapterCommand: "command (official CLI)",
    adapterHttp: "http",
    nameLabel: "Instance name",
    namePlaceholder: "DeepSeek-PayG #1",
    pollLabel: "Poll interval",
    pollPlaceholder: "5m (optional, overrides global default)",
    test: "Test connection",
    testing: "Testing…",
    save: "Save instance",
    saving: "Saving…",
    back: "← Back to selection",
    twoStep: "Two-step setup",
    twoStep1: "1. Install the official CLI (",
    twoStep2: ", see channel notes)",
    twoStepLogin: "2. Then log in once: {hint}",
  },
  test: {
    instanceName: "Test connection",
    notWired: "Channel {channel} is not wired to real collection (catalog invariant broken)",
    authFailed401: "Auth failed: invalid API key (401 Unauthorized)",
    fetchFailed: "Fetch failed ({status})",
    cmdBridgeFailed: "command test failed: {err}",
    needsHost: "command channel requires the desktop shell (main process)",
    sessionExpired: "Console session expired, please log in again",
    authFailedPrefix: "Auth failed: {reason}",
    missingParam: "Missing required parameter: {label}",
  },
  engine: {
    credInvalid: "Invalid credential reference",
    keyringMissing: "Keychain entry not found: {key}",
    envMissing: "Environment variable not set: {name}",
    credSourceUnsupported: "Credential source not supported: {source}",
    unsupportedAlert: "Channel {channel} is not supported yet (adapter lands in P2)",
  },
  schema: {
    nameDup: "Duplicate instance name: {name}",
    idDup: "Duplicate instance id: {id}",
    nameEmpty: "Instance name is required",
    nameExists: "Instance name already exists: {name}",
    badChannelPath: "Invalid channel path: {channel}",
    noSchema: "Unknown channel or no params schema: {channel}",
    unknownError: "Unknown error",
  },
  store: {
    validateFailed: "Instance config validation failed: {msg}",
    yamlReadFailed: "Failed to read instances.yaml: {err}",
    yamlValidateFailed: "instances.yaml validation failed: {err}",
  },
  scenario: {
    loading: "Loading",
    empty: "Empty",
    allOk: "All green",
    warn: "Yellow (low)",
    auth: "Yellow (auth_expired)",
    stale: "Gray (stale)",
    error: "Red (error)",
    mixed: "Mixed sample",
    expectHealth: "Expected tray color: {health}",
  },
  set: {
    closeAria: "Close settings",
    theme: "Theme",
    glass: "Glass effect (translucent panel · blurred background)",
    // t_c20d4d11 9/7 glass alpha slider: 15%-100%, default 100% opaque
    glassAlpha: "Glass opacity",
    glassAlphaHint: "Opaque by default; drag down for translucency (background blur stays at 32px). Saves on release.",
    themeHint:
      "Defaults to system (prefers-color-scheme); override here. The ☀ button in the title bar cycles the same three modes sharing one theme state.",
    sort: "Sort order",
    sortHint:
      "Manual ordering only: drag cards on the panel to reorder; no selection needed here. Newly added providers appear first automatically.",
    autostart: "Launch at login",
    autostartHint: "Start automatically at login (off by default)",
    storage: "Storage paths",
    config: "Config",
    data: "Data",
    storageHint: "Config and data are stored separately; paths are resolved at runtime.",
    about: "Desktop widget for AI plan quotas and balances",
    aboutHint: "Built-in monochrome brand logos render offline (currentColor follows theme).",
    language: "Language",
    languageHint: "UI display language; applies immediately and persists across restarts.",
    quotaGallery: "Layout-variant gallery (theme-glass experiment)",
    // ---- D-055 / t_4bd214de: Settings [MCP Service] section ----
    mcpTitle: "MCP Service",
    mcpSubtitle: "Local MCP daemon manager. Agents connect via 127.0.0.1:{port}/mcp.",
    mcpStatusRunning: "Running",
    mcpStatusStopped: "Stopped",
    mcpStatusProbe: "Probing…",
    mcpStatusNotInstalled: "Daemon executable not found",
    mcpStart: "Start",
    mcpStop: "Stop",
    mcpRestarting: "Restarting…",
    mcpAutostartLabel: "Launch at login",
    mcpAutostartHint: "Auto-start daemon at login (Q1 linked: also enables app launch at login).",
    mcpEndpointLabel: "Endpoint",
    mcpKeyLabel: "API Key",
    mcpKeyMasked: "{key} (masked)",
    mcpKeyCopy: "Copy",
    mcpKeyCopied: "Copied",
    mcpKeyRegen: "Regenerate",
    mcpKeyRegenConfirmTitle: "Regenerate API Key?",
    mcpKeyRegenConfirmBody:
      "New key is written to mcp.env. Configured agents must update to keep working. Restart daemon to apply.",
    mcpKeyRegenConfirm: "Generate & notify",
    mcpKeyRegenCancel: "Cancel",
    mcpKeyRegenRestartHint: "New key written. Tap [Stop] → [Start] to apply on the daemon.",
    mcpKeyRegenAutoRestartHint: "New key written. Daemon auto-restarted with new key.",
    mcpKeyRegenRestartFailedHint: "New key written. Daemon auto-restart failed — tap [Stop] → [Start] manually.",
    mcpAgentTitle: "Agent access",
    mcpAgentOpenGuide: "View setup steps",
    mcpAgentGuideEmpty: "Daemon not running. Start it first to fetch setup steps.",
    mcpAgentGuideFailed: "Failed to fetch setup steps.",
    mcpAgentGuideStep: "Step",
    mcpErrorGeneric: "Operation failed: {msg}",
    mcpStaleTitle: "daemon is outdated",
    mcpStaleBody:
      "The running MCP daemon does not match the installed version (likely a leftover process from before an upgrade). Restart the daemon to load the new version.",
    mcpStaleRestartAction: "Restart now",
  },
  updater: {
    unavailable: "Updates are only available in the installed build",
    checking: "Checking for updates…",
    check: "Check for updates",
    toVersion: "Update to v{version}",
    downloading: "Downloading {percent}%",
    installTo: "Restart & install v{version}",
    failed: "Update failed, retry later",
  },
  quota: {
    title: "Provider card layout options",
    subtitle:
      "The same kimi-code three-window real data (rolling_5h + weekly + monthly, requests count), rendered in 3 head × three-window spatial relations. **Three-window QuotaMeter (layout=micro) is always-on and direct** — that's the card's information main body, no hover dependency. micro = the same compact vertical stack as the hover tooltip's QuotaMeter (title+bar+(usage|reset) three-layer grid, 4px bar, font-10). Differences live in real layout dimensions, not in head decoration stacking.",
    open: "View gallery",
    legendOk: "ok (healthy)",
    legendWarn: "warn (low)",
    legendBad: "bad (exhausted)",
    // t_73c110ea 9/7 rebuild: 3 schemes + abnormal skeleton, all based on real layout dimensions (no head decoration stacking)
    // t_5b092750 9/7 add P5 (short-side-by-side) — two-col grid for short windows + monthly full-width row, from token-monitor layout
    // P3 three-column grid had measured text overlap + column clipping at 360px panel — therefore dropped this round.
    // Keep 4 real-dimension schemes: spatial (P1)/info hierarchy (P2)/head carrying (P4)/short-side (P5)
    cardP1Name: "Provider card · P1 baseline vertical (home page aligned)",
    cardP1Desc:
      "Head = handle + name + StatusDot + status badge (one row). Three windows as QuotaMeter(micro) each on its own line, 4px gap between windows (micro = same compact stack as the hover tooltip's QuotaMeter, title+bar+(usage|reset) three-layer grid). **Aligned with home page ProviderCard, zero cognitive cost**.",
    cardP2Name: "Provider card · P2 head carries rollup (info elevation, no summary strip)",
    cardP2Desc:
      "Head right side merges 'StatusDot + rollup label' into one line (whole-card health at a glance); three windows micro, same as P1. **No summary strip** — risk color stays on each row's own color, the head does not extract a warning band.",
    cardP4Name: "Provider card · P4 head carries tightest number (no summary strip)",
    cardP4Desc:
      "Head right side embeds 'tightest-window usage number + window label sub-line'; that row hides its usage to avoid duplication (QuotaMeter omits when prop undefined, contract intact). **Risk number lives inside the head's information flow, no strip**.",
    cardP5Name: "Provider card · P5 short-side-by-side (monitor layout, 5h+weekly same row / monthly full-width row)",
    cardP5Desc:
      "Head same as P1; **5h + weekly two windows share one row as two-column grid** (gap=8), **monthly window takes the next row full-width**. All three windows reuse layout=\"micro\" QuotaMeter — **no new unit, only the between-window grid is reshaped**. From the token-monitor window layout the user confirmed on 9/7. Measured at 360px: no text overlap, no clipping in the two-column row.",
    cardAbnName: "Provider card · Abnormal skeleton (shared by all 4 schemes)",
    cardAbnDesc:
      "auth_expired / error share AbnormalBody (does NOT count as an independent layout): status lamp + status text + (auth_expired only) setup_hint auth panel (copy command) + last-update/alerts. Structurally isomorphic with the home page ProviderCard AbnormalBody.",
  },
};

const DICTS: Record<Lang, Dict> = { zh, en };

// ---------------- 当前语言状态(模块级, 非 React 场景共用) ----------------

const LANG_KEY = "token-wallet.lang.v1";
export { LANG_KEY };

function isLang(v: unknown): v is Lang {
  return v === "zh" || v === "en";
}

/** 初始语言: localStorage(浏览器/e2e) → zh; 主进程侧由启动流程显式 setLang(settings.language) */
function loadInitialLang(): Lang {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(LANG_KEY);
      if (isLang(v)) return v;
    }
  } catch {
    /* 隐私模式忽略 */
  }
  return "zh";
}

let currentLang: Lang = loadInitialLang();

export function getLang(): Lang {
  return currentLang;
}

/** 切换语言(模块级); 持久化 localStorage(真壳 settings.json 的 RMW 由 ipc 层另落, 见 ipc.ts) */
export function setLang(lang: Lang): void {
  currentLang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* 隐私模式: 内存态仍生效 */
  }
}

/** 仅切内存态不落盘(主进程启动读 settings 后注入用) */
export function setCurrentLang(lang: Lang): void {
  currentLang = lang;
}

/** toLocaleString 用的 locale(tpl fmtMoney 等) */
export function currentLocale(): string {
  return currentLang === "zh" ? "zh-CN" : "en-US";
}

function lookup(dict: unknown, path: string): string | undefined {
  let node: unknown = dict;
  for (const seg of path.split(".")) {
    if (node && typeof node === "object" && seg in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * 翻译: t("card.deleteNamed", { name }) 。占位符 "{key}" 用 params 替换;
 * 缺参保留占位原样(便于发现漏传)。键不存在 → 回退 zh → 仍无 → 原样返回键名(不崩)。
 */
export function t(key: DictPaths<Dict>, params?: Record<string, string | number>): string {
  const raw = lookup(DICTS[currentLang], key) ?? lookup(zh, key);
  if (raw === undefined) return key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** 运行时键位形态(供非 TS 严格路径场景, 如 `filter.${k}` 动态拼键) */
export function tKey(path: string, params?: Record<string, string | number>): string {
  return t(path as DictPaths<Dict>, params);
}
