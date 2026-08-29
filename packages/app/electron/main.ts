/**
 * E1 主进程(D-033: 壳从 Rust/Webview 换 Electron, core 纯 TS 全复用)。
 *
 * - 窗口: BrowserWindow{ frame:false, transparent:true, thickFrame:false },
 *   HTML TitleBar 拖拽走 CSS -webkit-app-region, min/close 走 win_minimize/win_close IPC
 * - 托盘: 四态状态点 nativeImage + 菜单(打开面板/自启/退出); 关闭按钮=隐藏到托盘(D-003)
 * - 单实例: app.requestSingleInstanceLock, 二次启动聚焦已有窗口
 * - 持久化(D-019/D-032 语义不变): instances.yaml(YAML 解析/生成在主进程, 前端零 YAML 依赖)
 *   + settings.json consent RMW, 均走 persist.ts 原子写
 * - 显式降级: keyring/sqlite/http 通道本卡不移植(E2/E3 的事), 返回显式错误,
 *   面板出错误卡是预期行为, 不许静默空返回
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { atomicWrite, consentSettingsJson, readSettingsFile } from "./persist";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

/** D-019: 配置(Roaming)与数据(Local)分家, 零硬编码盘符; 运行时按平台解析 */
function storagePaths(): { configDir: string; dataDir: string } {
  if (process.platform === "win32") {
    const roaming = app.getPath("appData");
    return {
      configDir: path.join(roaming, "token-wallet"),
      dataDir: path.join(roaming, "..", "Local", "token-wallet"),
    };
  }
  if (process.platform === "darwin") {
    const base = path.join(app.getPath("appData"), "token-wallet");
    return { configDir: base, dataDir: base };
  }
  const home = app.getPath("home");
  return {
    configDir: path.join(home, ".config", "token-wallet"),
    dataDir: path.join(home, ".local", "share", "token-wallet"),
  };
}

function instancesFilePath(): string {
  return path.join(storagePaths().configDir, "instances.yaml");
}

function settingsFilePath(): string {
  return path.join(storagePaths().configDir, "settings.json");
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
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          try {
            app.setLoginItemSettings({ openAtLogin: item.checked });
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

/** 显式降级(E1 不移植的通道): 抛错让面板出错误卡, 不许静默空返回 */
function notConnected(channel: string): never {
  throw new Error(`通道 ${channel} 未接入(E2 卡接真): Electron 壳 E1 暂不提供服务`);
}

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
    return { configDir, dataDir };
  });

  ipcMain.handle("get_launch_at_login", () => {
    try {
      return app.getLoginItemSettings().openAtLogin;
    } catch {
      return false; // 平台不支持(部分 Linux)→ 默认关(D-024)
    }
  });

  ipcMain.handle("set_launch_at_login", (_event, payload: { enabled?: boolean }) => {
    try {
      app.setLoginItemSettings({ openAtLogin: Boolean(payload?.enabled) });
    } catch {
      /* 平台不支持时静默 */
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

  // ---- 显式降级: E2/E3 才接真的通道, 本卡返回显式错误 ----
  ipcMain.handle("keyring_get", () => notConnected("keyring_get"));
  ipcMain.handle("keyring_set", () => notConnected("keyring_set"));
  ipcMain.handle("keyring_delete", () => notConnected("keyring_delete"));
  ipcMain.handle("http_get_json", () => notConnected("http_get_json"));
  ipcMain.handle("sqlite_batch", () => notConnected("sqlite_batch"));
  ipcMain.handle("sqlite_exec", () => notConnected("sqlite_exec"));
  ipcMain.handle("sqlite_query", () => notConnected("sqlite_query"));
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
}
