/**
 * 存储路径派生(D-019/D-033): 零硬编码, 全部从 Electron app.getPath 派生。
 *
 * 本文件零 electron 依赖(纯 node:path + 注入的 getPath), 供主进程与 node vitest
 * 单测共用 — 测试注入 mock getPath 即可断言三平台语义。
 *
 * 与 Tauri 版(app.path().app_config_dir()/app_data_dir())语义对齐:
 * - configDir = 配置侧(Roaming): instances.yaml / settings.json
 *   Electron userData 恰为 Roaming 下的应用目录(Windows), 直接复用;
 *   macOS/Linux userData 亦与 Tauri app_config_dir 一致(见下表)
 * - dataDir   = 数据侧(Local): SQLite 快照等大文件, 不进 Roaming 漫游同步(D-019)
 *
 * | 平台   | Tauri app_config_dir      | Tauri app_data_dir           | Electron userData           |
 * |--------|---------------------------|------------------------------|-----------------------------|
 * | win32  | %APPDATA%/<id> (Roaming)  | %LOCALAPPDATA%/<id> (Local)  | %APPDATA%/<name> (Roaming)  |
 * | darwin | ~/Library/Application Support/<id> | 同左(不分家)          | 同左(不分家)                |
 * | linux  | $XDG_CONFIG_HOME/<id>     | $XDG_DATA_HOME/<id>          | $XDG_CONFIG_HOME/<name>     |
 *
 * 因此: configDir ≡ userData(三平台全覆盖); dataDir 仅在 win32 需要把 Roaming
 * 换成 Local(从 userData 的祖父目录 AppData 下取 Local/<name>), darwin 同 userData,
 * linux 用 XDG_DATA_HOME 兜底 ~/.local/share(D-019 数据侧)。
 */
import * as path from "node:path";

export interface StoragePaths {
  configDir: string;
  dataDir: string;
}

export type PathGetter = (name: "userData" | "home") => string;

/** D-019 按平台解析; getPath 由主进程注入 app.getPath(测试注入 mock) */
export function deriveStoragePaths(
  platform: NodeJS.Platform,
  getPath: PathGetter,
  env: NodeJS.ProcessEnv = process.env,
): StoragePaths {
  const userData = getPath("userData");
  const appName = path.posix.basename(userData.replace(/\\/g, "/"));
  if (platform === "win32") {
    // userData = C:\Users\<u>\AppData\Roaming\<name>; 数据侧换 Local 分家。
    // 显式 path.win32: 该分支语义即 Windows 分隔符, 与运行平台解耦(测试可在 Linux 断言)
    const appData = path.win32.dirname(path.win32.dirname(userData)); // ...\AppData
    return {
      configDir: userData,
      dataDir: path.win32.join(appData, "Local", appName),
    };
  }
  if (platform === "darwin") {
    // Tauri macOS 配置/数据同目录, 不分家
    return { configDir: userData, dataDir: userData };
  }
  // linux: 配置侧=userData(~/.config/<name> 或 XDG_CONFIG_HOME 下);
  // 数据侧=XDG_DATA_HOME/<name>, 未设则 ~/.local/share/<name>
  const xdgData = env.XDG_DATA_HOME;
  const dataDir = xdgData
    ? path.join(xdgData, appName)
    : path.join(getPath("home"), ".local", "share", appName);
  return { configDir: userData, dataDir };
}
