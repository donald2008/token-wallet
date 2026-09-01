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
    aria: "功能侧栏",
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
    authWorking: "处理中…",
    authBrowserHint: "浏览器已打开, 请完成授权后粘贴页面显示的授权码",
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
    localUsage: "{name} · 本地用量(P3)",
  },
  local: {
    title: "本地 Agent",
    tag: "P3 占位",
    body: "per-agent 用量 + 云×本地对比行(P3 接入真实数据)",
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
    themeHint:
      "默认追随系统(prefers-color-scheme), 可在此覆盖(D-010)。侧栏底部 ☀ 钮可快切循环\n            (t_66b67453 契约2), 与此处三档同走一个主题状态。",
    sort: "排序",
    sortName: "名称",
    sortUrgency: "紧要度",
    sortManual: "手动",
    sortAsc: "正排",
    sortDesc: "倒排",
    sortHint:
      "缺省: 名称正排。紧要度 = 按卡内最紧窗口剩余比例(剩余越少越靠前), 方向独立生效(#829 R1)。\n            手动 = 拖拽卡片顺序(D-039), 方向不适用。",
    autostart: "开机自启",
    autostartHint: "登录时自动启动(默认关,D-024)",
    storage: "存储路径",
    config: "配置",
    data: "数据",
    storageHint: "配置与数据分家(D-019), 运行时解析的真实路径。",
    about: "AI 套餐/额度桌面仪表盘",
    aboutHint: "内置单色品牌图标, 离线可渲染(currentColor 随主题自适应)。",
    language: "语言",
    languageHint: "界面显示语言, 切换即生效, 重启后保持。",
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
    authWorking: "Working…",
    authBrowserHint: "Browser opened. After approving, paste the code shown on the page",
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
    localUsage: "{name} · local usage (P3)",
  },
  local: {
    title: "Local agents",
    tag: "P3 placeholder",
    body: "Per-agent usage + cloud×local comparison rows (real data lands in P3)",
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
    themeHint:
      "Defaults to system (prefers-color-scheme); override here. The ☀ button at the bottom of the\n            sidebar cycles the same three modes sharing one theme state.",
    sort: "Sort order",
    sortName: "Name",
    sortUrgency: "Urgency",
    sortManual: "Manual",
    sortAsc: "Asc",
    sortDesc: "Desc",
    sortHint:
      "Default: by name, ascending. Urgency = tightest remaining window ratio first; direction applies\n            independently. Manual = drag cards to reorder; direction not applicable.",
    autostart: "Launch at login",
    autostartHint: "Start automatically at login (off by default)",
    storage: "Storage paths",
    config: "Config",
    data: "Data",
    storageHint: "Config and data are separated (D-019); paths resolved at runtime.",
    about: "Desktop widget for AI plan quotas and balances",
    aboutHint: "Built-in monochrome brand logos render offline (currentColor follows theme).",
    language: "Language",
    languageHint: "UI display language; applies immediately and persists across restarts.",
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
