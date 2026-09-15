/**
 * E1 主进程(D-033: 壳从 Rust/Webview 换 Electron, core 纯 TS 全复用)。
 *
 * - 窗口: BrowserWindow{ frame:false, transparent:true, thickFrame:false },
 *   HTML TitleBar 拖拽走 CSS -webkit-app-region, min/close 走 win_minimize/win_close IPC
 * - 托盘: 四态状态点 nativeImage + 菜单(打开面板/自启/退出); 关闭按钮=隐藏到托盘(D-003)
 * - 单实例: app.requestSingleInstanceLock, 二次启动聚焦已有窗口
 * - 持久化(D-019/D-032 语义不变): instances.yaml(YAML 解析/生成在主进程, 前端零 YAML 依赖)
 *   + settings.json consent RMW, 均走 persist.ts 原子写
 * - E2 keyring(D-029): keyring_get/set|delete 接真 — safeStorage OS 级加密,
 *   secret 落 `<dataDir>/secrets/*.blob`(0700/0600, 见 keyring.ts); 不可用显式报错
 * - E2 sqlite(D-020): sqlite_batch/exec/query 接真 — node:sqlite 同步 API(D-034),
 *   SCHEMA_SQL 单源 = core `storage/schema-sql`(禁第二份 DDL), db 落 dataDir,
 *   连接按 dataDir 缓存单例, will-quit 统一 close(见 sqlite.ts)
 * - 显式降级: E2 并行卡/E3 才接真的通道, 返回显式错误,
 *   面板出错误卡是预期行为, 不许静默空返回
 * - E2 http 通道接真: host-http.ts(undici fetch + AbortController 超时,
 *   返回 {status, body 脱敏}, 非 2xx 不抛由引擎分类 — 对齐旧 Rust 实现)
 *
 * D-055 MCP daemon 托管(t_4bd214de): registerMcpIpc 在文件下方 registerIpc() 内调用,
 * 注入 9 通道(probe / start / stop / restart / get_config / gen_key / set_autostart /
 * get_autostart / get_guide) — 注: round-1 自述 7 通道, round-2 增 mcp_restart 编排
 * 通道用于 key regen 后真实停启 daemon(BLOCKING-1 修复)。
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { autoUpdater } from "electron-updater";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { atomicWrite, consentSettingsJson, normalizeLangValue, normalizeSortConfigValue, readSettingsFile, recordAlwaysOnTop, recordAutostart, recordLang, recordSortConfig } from "./persist";
import { hostHttpGetJson } from "./host-http";
import { SafeStorageLike, deleteSecret, getSecret, setSecret } from "./keyring";
import { deriveStoragePaths, type StoragePaths } from "./paths";
import { batch, closeAll, exec, query } from "./sqlite";
import { runCommandFetch, type CommandRunPayload } from "./command-run";
import {
  abortAllAuthSessions,
  cancelAuthSession,
  detectPathHint,
  finishAuthSession,
  startAuthSession,
  type AuthFailureKind,
} from "./auth-session";
import { authDefFor } from "./auth-defs";
import { AppUpdaterController } from "./updater";
import { registerMcpIpc } from "./mcp-ipc";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

/**
 * 应用名固定(D-033 换壳后继续生效): package.json name 是 @token-wallet/app(scope
 * 斜杠), 直接当 userData 会解析成 ~/.config/@token-wallet/app 双层目录;
 * 显式 setName 保证 userData=~/.config/token-wallet(Windows=%APPDATA%\token-wallet,
 * macOS=~/Library/Application Support/token-wallet), 与 E1 既有数据位置一致。
 * 必须在 ready 前调用。
 */
app.setName("token-wallet");

/** D-019: 配置(Roaming)与数据(Local)分家, 零硬编码盘符; 运行时按平台解析(userData 派生) */
function storagePaths(): StoragePaths {
  return deriveStoragePaths(process.platform, (name) => app.getPath(name));
}

function instancesFilePath(): string {
  return path.join(storagePaths().configDir, "instances.yaml");
}

function settingsFilePath(): string {
  return path.join(storagePaths().configDir, "settings.json");
}

/**
 * 开机自启状态校正(D-024): settings.json 记录的是用户期望, OS login item 是
 * 实际状态; 用户在系统层(任务管理器/登录项)关掉自启时以实际为准 —
 * 查询/启动时读取 OS 实际, 与 settings 记录比对, 有偏差则把 settings 校正为
 * OS 实际(recordAutostart RMW, 复用 consent 模式), 返回 OS 实际值。
 * 平台不支持(部分 Linux)→ false(默认关 D-024), 不写盘(无偏差语义)。
 */
function syncAutostartSettings(): boolean {
  let osActual: boolean;
  try {
    osActual = app.getLoginItemSettings().openAtLogin;
  } catch {
    return false; // 平台不支持 → 默认关(D-024)
  }
  const recorded = readSettingsFile(settingsFilePath()).autostart;
  if (recorded !== osActual) {
    try {
      recordAutostart(settingsFilePath(), osActual);
    } catch {
      /* 写盘失败不阻断查询(下次启动再校正) */
    }
  }
  return osActual;
}

// ---------------- 托盘四态状态点(D-003), 嵌入产物零运行时外部依赖 ----------------

function statusIcon(status: string): Electron.NativeImage {
  const name = ["ok", "warn", "bad"].includes(status) ? status : "unknown";
  const file = path.join(__dirname, "..", "electron", "icons", `status-${name}.png`);
  return nativeImage.createFromPath(file);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** 托盘菜单"退出"置位后才允许真退出; 否则关闭按钮=隐藏到托盘(D-003) */
let allowQuit = false;
/** t_185002af: Agent 用量详情大屏独立窗口单例。D-024 家族观感(frame:false +
 *  transparent:true, .panel 悬浮圆角卡片同源), URL 携带 ?view=agent-dashboard&standalone=1。
 *  singleton: 已开则聚焦不重开。 */
let agentDashboardWindow: BrowserWindow | null = null;

function showMainWindow(): void {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.restore();
  mainWindow.focus();
}

function toggleMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else showMainWindow();
}

function createTray(): void {
  try {
    tray = new Tray(statusIcon("unknown"));
    const menu = Menu.buildFromTemplate([
      { label: "打开面板", click: () => showMainWindow() },
      {
        label: "开机自启",
        type: "checkbox",
        checked: syncAutostartSettings(),
        click: (item) => {
          try {
            app.setLoginItemSettings({ openAtLogin: item.checked });
            recordAutostart(settingsFilePath(), item.checked);
          } catch {
            /* 平台不支持时静默(设置页另有显式入口) */
          }
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          allowQuit = true;
          app.quit();
        },
      },
    ]);
    tray.setToolTip("token-wallet — 初始化中");
    tray.setContextMenu(menu);
    tray.on("click", () => toggleMainWindow());
  } catch (e) {
    // WSLg/无托盘区环境: 降级为无托盘运行, 不崩应用
    console.warn("[token-wallet] tray unavailable:", e);
    tray = null;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 360,
    // t_27eeadad: 9/4 用户提「整个 app 加一下高度」+ 9/7 拍板 600→720(8 倍数, 容纳更多 provider 卡);
    // minHeight 沿用 400(P1 单卡 ≈ 112px + chrome 88 = 200, 400 容纳 1-2 卡, 保留窄屏安全冗余)。
    height: 720,
    minWidth: 320,
    minHeight: 400,
    maximizable: false,
    frame: false,
    transparent: true,
    thickFrame: false,
    title: "token-wallet",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // 置顶开关读回(P1, D-019 配置侧): 窗口创建后、内容加载前应用, 默认关(不擅改窗口行为)
  if (readSettingsFile(settingsFilePath()).alwaysOnTop === true) {
    mainWindow.setAlwaysOnTop(true);
  }
  // 关闭按钮 = 隐藏到托盘(D-003), 真实退出走托盘菜单"退出"
  mainWindow.on("close", (event) => {
    if (!allowQuit) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (isDev) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL as string);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

/** t_185002af: 大屏详情独立窗口升级 D-024 家族观感 — frame:false + transparent:true +
 *  thickFrame:false, 与主窗同源(.panel 悬浮圆角卡片, body 透明)。round-1 曾以同组合真壳
 *  开窗验证过可行性; round-2 暂回系统边框是「最小可用优先」的过渡态, 本卡完成回切。
 *  拖拽/最小化/关闭由渲染层窗口 chrome(.dash-chrome) 承担: 拖拽走 -webkit-app-region:drag,
 *  最小化/关闭走既有 win_minimize / win_close IPC(main 进程按 sender 分流到本窗口,
 *  通道名逐字保全零新增)。URL 携带 ?view=agent-dashboard&standalone=1 双参数,
 *  渲染层 App.tsx 据此进 dashboard 视图 + 挂独立窗 chrome(返回键语义=关窗)。 */
function createAgentDashboardWindow(): void {
  if (agentDashboardWindow && !agentDashboardWindow.isDestroyed()) {
    agentDashboardWindow.show();
    agentDashboardWindow.focus();
    return;
  }
  // t_4b7984d9 round-4 ②: 高度 640(原 600 内容区仅 ~570 底部截断), useContentSize 让
  // width/height 描述内容区; autoHideMenuBar 去掉菜单栏横条占高。无边框窗本无菜单/标题栏,
  // 保留这三项配置对 frame:false 无副作用, 后续若回退系统边框仍是正确形态。
  // t_e83ad982(问题 4, 底部空白回收): 640→560 高度预算法(comment 1497) —
  // 改版前基线截图实测内容只填到 y≈515, 底部空白 ~110px ≈ 17%; 密度改版后内容预算
  // 516px(chrome 33 + padding 8 + head 16 + hero 88 + 网格 2×188 + footer 16, gap 4×4)
  // → 窗 560 内容区 527, 内容 516/527 = 98% 占满。900×560 均 8px 网格整数。
  agentDashboardWindow = new BrowserWindow({
    width: 900,
    height: 560,
    useContentSize: true,
    autoHideMenuBar: true,
    // 设计基准 900×640, 内容自适应, 不强制最大化
    minWidth: 600,
    minHeight: 480,
    maximizable: true,
    // t_185002af: D-024 家族无边框透明观感(与主窗 createWindow 同源组合)。
    frame: false,
    transparent: true,
    thickFrame: false,
    title: "token-wallet · Agent 用量详情",
    parent: mainWindow ?? undefined, // 隶属主窗口, 主窗最小化/隐藏不影响 dashboard
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // dashboard 窗的关闭按钮 = 直接销毁(不挂托盘, 用户拍板"带系统边框先交付, 标注后续美化")
  agentDashboardWindow.on("closed", () => {
    agentDashboardWindow = null;
  });
  // t_4b7984d9 round-4 ② 居中修复: 旧版用 mainWindow 居中(main.x + (main.width - 900)/2),
  // 当主窗 360 宽时 main.width - 900 = -540 ⇒ dashboard 左缘跑到主窗左侧 270px(可能负偏移出屏)。
  // 正解: 屏幕 workArea 居中(900×640 dashboard 居中于屏幕,与主窗位置无关,层次感清晰)。
  try {
    const { screen } = require("electron");
    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;
    const dash = agentDashboardWindow.getBounds();
    agentDashboardWindow.setBounds({
      x: Math.round(wa.x + (wa.width - dash.width) / 2),
      y: Math.round(wa.y + (wa.height - dash.height) / 2),
      width: dash.width,
      height: dash.height,
    });
  } catch {
    /* screen 模块不可用时 fallback 主窗居中(老逻辑,但加了 dash.width > main.width 防护) */
    if (mainWindow) {
      const main = mainWindow.getBounds();
      const dash = agentDashboardWindow.getBounds();
      const dx = Math.max(0, Math.round((main.width - dash.width) / 2));
      const dy = Math.max(0, Math.round((main.height - dash.height) / 2));
      agentDashboardWindow.setBounds({
        x: main.x + dx,
        y: main.y + dy,
        width: dash.width,
        height: dash.height,
      });
    }
  }
  if (isDev) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL as string);
    url.searchParams.set("view", "agent-dashboard");
    url.searchParams.set("standalone", "1");
    void agentDashboardWindow.loadURL(url.toString());
  } else {
    void agentDashboardWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
      search: "?view=agent-dashboard&standalone=1",
    });
  }
}

// ---------------- IPC: 通道名与契约保全(与换壳前逐字一致) ----------------

function registerIpc(): void {
  ipcMain.handle("get_bootstrap", () => {
    const settings = readSettingsFile(settingsFilePath());
    // 首开判定接真(§10): consent 已同意 → 不再弹隐私声明页
    const firstRun = !settings.consentAgreed;
    console.log(
      `[token-wallet] get_bootstrap: settings=${settingsFilePath()} firstRun=${firstRun}`,
    );
    return {
      firstRun,
      theme: "system",
      version: app.getVersion(),
    };
  });

  ipcMain.handle("record_consent", () => {
    const now = Math.floor(Date.now() / 1000);
    const filePath = settingsFilePath();
    let existing: string | null = null;
    try {
      existing = fs.readFileSync(filePath, "utf8");
    } catch {
      existing = null; // 不存在/读失败 → 首开态
    }
    atomicWrite(filePath, consentSettingsJson(existing, now));
  });

  // instances.yaml 读写(DESIGN §5.0.1): YAML 解析/生成在主进程, 前端零 YAML 依赖,
  // IPC 传 JSON 值, zod(schema.ts)仍是唯一校验权威
  ipcMain.handle("instances_load", () => {
    const filePath = instancesFilePath();
    if (!fs.existsSync(filePath)) return null; // 首开零配置
    const text = fs.readFileSync(filePath, "utf8");
    if (!text.trim()) return null;
    try {
      return YAML.parse(text) as unknown; // 语法损坏 → throw = fail-fast, 不静默丢配置
    } catch (e) {
      throw new Error(`instances.yaml 解析失败: ${(e as Error).message}`);
    }
  });

  ipcMain.handle("instances_save", (_event, payload: { file?: unknown }) => {
    // 入参已由前端 zod 校验; 落盘只有 CredentialRef 引用, secret 值只进 OS 钥匙串(D-029)
    const yamlText = YAML.stringify(payload?.file ?? null);
    atomicWrite(instancesFilePath(), yamlText);
  });

  ipcMain.handle("get_storage_paths", () => {
    const { configDir, dataDir } = storagePaths();
    // D-019: dataDir 不存在时 mkdir(配置侧由原子写自动建目录; 数据侧 db/secrets 依赖显式存在)
    fs.mkdirSync(dataDir, { recursive: true });
    return { configDir, dataDir };
  });

  ipcMain.handle("get_launch_at_login", () => syncAutostartSettings());

  ipcMain.handle("set_launch_at_login", (_event, payload: { enabled?: boolean }) => {
    const enabled = Boolean(payload?.enabled);
    try {
      app.setLoginItemSettings({ openAtLogin: enabled });
      recordAutostart(settingsFilePath(), enabled);
    } catch {
      /* 平台不支持时静默(设置页另有显式入口, 托盘已静默) */
    }
  });

  ipcMain.handle("update_tray_status", (_event, payload: { status?: string; tooltip?: string }) => {
    if (!tray) return; // 无托盘区环境(WSLg 等)降级 no-op
    tray.setImage(statusIcon(String(payload?.status ?? "unknown")));
    tray.setToolTip(String(payload?.tooltip ?? "token-wallet"));
  });

  // 窗口控制: HTML TitleBar 的 min/close(E1 新增)。
  // t_185002af: sender-aware — 调用方窗口自己受效(主窗 TitleBar / dashboard 独立窗
  // .dash-chrome 都走这两个通道, channel 名逐字保全零新增)。无 sender(异常)回退主窗,
  // 保持旧行为兼容。
  ipcMain.handle("win_minimize", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    win?.minimize();
  });
  ipcMain.handle("win_close", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win) return;
    if (win === mainWindow) {
      win.hide(); // 主窗关闭 = 隐藏到托盘(D-003)
    } else {
      win.close(); // 其他窗(dashboard 独立窗)关闭 = 直接销毁(不挂托盘)
    }
  });

  // 窗口置顶开关(P1): 用户可切换, 默认关; 切换即 RMW 落 settings.json(重启不丢)。
  // ⚠️ setAlwaysOnTop 的 level 参数仅 macOS 完整支持(Windows 基本无效), 不做平台分支, 用默认。
  ipcMain.handle("win_get_always_on_top", () =>
    mainWindow
      ? mainWindow.isAlwaysOnTop()
      : readSettingsFile(settingsFilePath()).alwaysOnTop === true,
  );
  ipcMain.handle("win_set_always_on_top", (_event, payload: { enabled?: boolean }) => {
    const enabled = Boolean(payload?.enabled);
    mainWindow?.setAlwaysOnTop(enabled);
    try {
      recordAlwaysOnTop(settingsFilePath(), enabled);
    } catch {
      /* 写盘失败不阻断窗口行为(下次启动按旧值恢复; 与托盘自启开关同策略) */
    }
  });

  // 卡间排序配置(#829 R1): {key,dir} 整体 RMW 落 settings.json(重启不丢);
  // 读取侧归一化(非法/缺失 → 缺省名称正排), 写入侧同样归一化防脏数据。
  ipcMain.handle("get_sort_config", () =>
    normalizeSortConfigValue(readSettingsFile(settingsFilePath()).sortConfig),
  );
  ipcMain.handle("set_sort_config", (_event, payload: { config?: unknown }) => {
    try {
      recordSortConfig(settingsFilePath(), payload?.config);
    } catch {
      /* 写盘失败不阻断 UI(内存态仍生效, 下次启动按旧值恢复; 与置顶开关同策略) */
    }
  });

  // Phase B(i18n): 界面语言(zh/en) — settings.json RMW(重启保持);
  // 读取侧归一化(非法/缺失 → zh), 写入侧同样归一化防脏数据。
  ipcMain.handle("get_lang", () => normalizeLangValue(readSettingsFile(settingsFilePath()).language));
  ipcMain.handle("set_lang", (_event, payload: { lang?: unknown }) => {
    try {
      recordLang(settingsFilePath(), payload?.lang);
    } catch {
      /* 写盘失败不阻断 UI(内存态仍生效, 下次启动按旧值恢复; 与置顶/排序同策略) */
    }
  });

  // ---- E2: sqlite 三通道接真(D-020; node:sqlite 同步 API, D-034) ----
  // SCHEMA_SQL 单源 = core(storage.ts renderer 侧同源 import, 主进程建表同文);
  // db 落 dataDir(D-019 数据侧), 目录不存在自动建; node:sqlite 抛错原样上抛,
  // ipcMain.handle 转 IPC reject → 面板错误卡(E1 显式错误约定)。
  ipcMain.handle("sqlite_batch", (_event, payload: { sql?: string }) => {
    batch(storagePaths().dataDir, String(payload?.sql ?? ""));
  });
  ipcMain.handle(
    "sqlite_exec",
    (_event, payload: { sql?: string; params?: unknown[] }) =>
      exec(storagePaths().dataDir, String(payload?.sql ?? ""), payload?.params ?? []),
  );
  ipcMain.handle(
    "sqlite_query",
    (_event, payload: { sql?: string; params?: unknown[] }) =>
      query(storagePaths().dataDir, String(payload?.sql ?? ""), payload?.params ?? []),
  );

  // ---- E2: keyring 三通道接真(safeStorage OS 级加密, D-029) ----
  // secret 落 `<dataDir>/secrets/<ref>.blob`, 目录 0700 / 文件 0600;
  // safeStorage 不可用 → 结构化显式错误(IPC reject → 面板错误条), 绝不明文降级。
  // 注意: safeStorage 的可用性判定依赖 app ready, registerIpc 在 whenReady 之后调用。
  const safeStorageAdapter: SafeStorageLike = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (enc) => safeStorage.decryptString(enc),
    getSelectedBackendName: () => {
      try {
        return safeStorage.getSelectedStorageBackend() ?? "unknown";
      } catch {
        return "unknown";
      }
    },
  };
  ipcMain.handle("keyring_get", (_event, payload: { service?: string; key?: string }) => {
    const { dataDir } = storagePaths();
    return getSecret(safeStorageAdapter, dataDir, String(payload?.service), String(payload?.key));
  });
  ipcMain.handle(
    "keyring_set",
    (_event, payload: { service?: string; key?: string; value?: string }) => {
      const { dataDir } = storagePaths();
      setSecret(
        safeStorageAdapter,
        dataDir,
        String(payload?.service),
        String(payload?.key),
        String(payload?.value),
      );
    },
  );
  ipcMain.handle("keyring_delete", (_event, payload: { service?: string; key?: string }) => {
    const { dataDir } = storagePaths();
    deleteSecret(safeStorageAdapter, dataDir, String(payload?.service), String(payload?.key));
  });
  // ---- E2 http(D-029): GET + headers + timeout, 返回 {status, body 已脱敏};
  // 非 2xx 不抛(引擎层分类, 换壳前后语义一致), 网络错/超时抛(消息脱敏) ----
  ipcMain.handle("http_get_json", (_event, payload: Record<string, unknown> | undefined) =>
    hostHttpGetJson(payload ?? {}),
  );

  // ---- D-042: command 类通道执行桥(主进程真实 spawn, renderer 零 Node 能力) ----
  // 纯逻辑在 command-run.ts(node vitest 直测), 这里仅做 IPC 注册
  ipcMain.handle("command_run", (_event, payload: CommandRunPayload | undefined) =>
    runCommandFetch(payload ?? {}),
  );

  // ---- t_fb8c44d8: command 通道一键授权(2026-09-01, round1 修正) ----
  // 用户点「授权」→ 主进程 spawn auth login 取 URL 自动开浏览器 → 按 finishMode 分流完成:
  //   "code"(arkcli): 设备码协议, 浏览器页面显示 code → 用户粘贴 → spawn 新进程 --code 回喂, 解析 ok
  //   "callback"(bl): localhost 自闭环, 浏览器授权后 302 回跳 CLI 自收 code, 等 close(0) 免回喂
  // CLI 名从 renderer 的 setup_hint 提取(ep: arkcli/bl)。返回 finishMode 供 UI 分流渲染。
  // 2026-09-11 P0 补: catch 时提取 err.kind(CliMissingKind → 引导文案)+ err.pathHint(npm prefix 不在 PATH)。
  // 这两类信息由 waitForUrl / completeWithCode 写在 throw 的 Error 对象上(见 auth-session.ts)。
  ipcMain.handle(
    "command_auth_start",
    async (_event, payload: { cli?: string } | undefined) => {
      const def = authDefFor(String(payload?.cli ?? ""));
      if (!def) return { ok: false, message: `未知 CLI: ${String(payload?.cli)}` };
      try {
        const { sessionId, url, finishMode } = await startAuthSession(def, (u) => {
          void shell.openExternal(u);
        });
        return { ok: true, sessionId, url, finishMode };
      } catch (err) {
        const typed = err as { kind?: AuthFailureKind; message?: string };
        const baseMsg = typed.message ?? String(err);
        const result: {
          ok: false;
          message: string;
          kind?: AuthFailureKind;
          pathHint?: { npmPrefix: string };
        } = { ok: false, message: baseMsg.startsWith("授权") ? baseMsg : `授权启动失败: ${baseMsg}` };
        if (typed.kind) result.kind = typed.kind;
        if (typed.kind === "cli_missing") {
          // L2 PATH 自检: 命中 npm prefix 不在 PATH 时附 pathHint, renderer 渲染额外引导
          result.pathHint = await detectPathHint(def.command);
        }
        return result;
      }
    },
  );
  ipcMain.handle(
    "command_auth_finish",
    async (_event, payload: { sessionId?: string; code?: string } | undefined) => {
      const result = await finishAuthSession(
        String(payload?.sessionId ?? ""),
        String(payload?.code ?? ""),
      );
      // finish 阶段的 cli_missing 也补一次 pathHint(保持 L2 引导一致)
      if (!result.ok && result.kind === "cli_missing" && result.cli) {
        result.pathHint = await detectPathHint(result.cli);
      }
      return result;
    },
  );
  // 取消进行中的授权会话(浏览器等待中放弃; bl callback 模式进程保持存活, 必须有取消出口 kill 掉防残留)
  ipcMain.handle("command_auth_cancel", (_event, payload: { sessionId?: string } | undefined) => {
    cancelAuthSession(String(payload?.sessionId ?? ""));
    return { ok: true };
  });

  // ---- D-046: 自动更新三通道(状态机在 updater.ts, node vitest 直测) ----
  // updater_check: 查当前态+触发检查; updater_download: 用户显式下载(进度走 updater_event);
  // updater_install: quitAndInstall(仅 ready 态生效)。dev 下三通道恒 unavailable。
  ipcMain.handle("updater_check", () => appUpdater.check());
  ipcMain.handle("updater_download", () => appUpdater.download());
  ipcMain.handle("updater_install", () => {
    appUpdater.install();
  });

  // ---- t_4b7984d9 C: 详情大屏独立窗口 IPC(真壳路径, 浏览器降级走 portal 模态) ----
  // 主窗口 Agent 卡点 [详情→] → 触发此通道 → 主进程 createAgentDashboardWindow 开
  // 900×600 frame:false transparent 窗口, URL 携带 ?view=agent-dashboard, 渲染层自动进入 dashboard
  ipcMain.handle("open_agent_dashboard", () => {
    createAgentDashboardWindow();
    return { ok: true };
  });

  // ---- D-055: MCP daemon 托管 11 通道(t_4bd214de + t_9255cb63) ----
  // 主进程持有 daemon 真实生命周期: probe / start / stop / restart / config / key /
  // autostart / guide — round-2 增 restart 通道编排 key regen 后真实停启。
  // t_9255cb63 增 mcp_usage_summary / mcp_usage_report_echo 读数据桥 —
  // 主页 Agent 卡 + 大屏方案 C 数据源。
  // 全部 shim 在 mcp-daemon.ts 注入便于测试, 真运行时用 defaultSpawnShim/defaultPathShim
  // + 简易 fetch 实现 defaultHttpShim(POST /mcp initialize, 卡体钉死不裸 TCP)
  registerMcpIpc({
    isPackaged: app.isPackaged,
    appRoot: app.getAppPath(),
    platform: process.platform,
    storagePathsFn: () => storagePaths(),
    settingsFilePathFn: () => settingsFilePath(),
    app: {
      setLoginItemSettings: (opts: { openAtLogin: boolean }) => app.setLoginItemSettings(opts),
      getLoginItemSettings: () => app.getLoginItemSettings(),
    },
  });
}

/** D-046: updater 控制器(ready 前创建; 事件推当前窗口渲染层) */
let appUpdater: AppUpdaterController;

function setupUpdater(): void {
  appUpdater = new AppUpdaterController({
    updater: autoUpdater,
    isPackaged: app.isPackaged,
    emit: (event) => {
      mainWindow?.webContents.send("updater_event", event);
    },
  });
  // 启动静默 CHECK ONLY(D-046): 只发现不下载, 下载/安装永远用户显式触发
  if (app.isPackaged) {
    void appUpdater.check();
  }
}

// ---------------- 生命周期 ----------------

// 单实例锁: 二次启动聚焦已有实例, 不重复开窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
  app.whenReady().then(() => {
    setupUpdater();
    registerIpc();
    createWindow();
    createTray();
  });
  app.on("window-all-closed", () => {
    // 托盘常驻: 窗口全关不退出(退出走托盘菜单)
  });
  app.on("will-quit", () => {
    abortAllAuthSessions(); // 授权会话残留子进程清理(t_fb8c44d8)
    closeAll(); // sqlite 连接统一关闭(见 sqlite.ts), 失败不阻断退出
  });
}
