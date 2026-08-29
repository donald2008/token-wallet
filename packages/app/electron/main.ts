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
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, Tray } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { atomicWrite, consentSettingsJson, readSettingsFile, recordAutostart } from "./persist";
import { hostHttpGetJson } from "./host-http";
import { SafeStorageLike, deleteSecret, getSecret, setSecret } from "./keyring";
import { deriveStoragePaths, type StoragePaths } from "./paths";
import { batch, closeAll, exec, query } from "./sqlite";

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
    height: 600,
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

  // 窗口控制: HTML TitleBar 的 min/close(E1 新增)
  ipcMain.handle("win_minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("win_close", () => {
    mainWindow?.hide(); // 关闭 = 隐藏到托盘(D-003)
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
}

// ---------------- 生命周期 ----------------

// 单实例锁: 二次启动聚焦已有实例, 不重复开窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    createTray();
  });
  app.on("window-all-closed", () => {
    // 托盘常驻: 窗口全关不退出(退出走托盘菜单)
  });
  app.on("will-quit", () => {
    closeAll(); // sqlite 连接统一关闭(见 sqlite.ts), 失败不阻断退出
  });
}
