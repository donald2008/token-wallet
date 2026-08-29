/**
 * paths.ts 单测(D-019/D-033): 用 mock getPath 断言三平台 userData 派生,
 * 语义与 Tauri app.path().app_config_dir()/app_data_dir() 对齐(见 paths.ts 头注释)。
 *
 * 三平台期望值(与 Tauri 语义表逐行对应):
 * - win32: configDir=userData(Roaming), dataDir=Local 分家
 * - darwin: config=data 同目录(不分家)
 * - linux: config=userData, data=XDG_DATA_HOME 或 ~/.local/share
 */
import { describe, it, expect } from "vitest";
import { deriveStoragePaths, type PathGetter } from "./paths";

/** 各平台 mock app.getPath(与真实 Electron userData 形态一致) */
function mockGetPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): PathGetter {
  const bases: Record<string, Record<string, string>> = {
    win32: {
      userData: "C:\\Users\\test\\AppData\\Roaming\\token-wallet",
      home: "C:\\Users\\test",
    },
    darwin: {
      userData: "/Users/test/Library/Application Support/token-wallet",
      home: "/Users/test",
    },
    linux: {
      userData: "/home/test/.config/token-wallet",
      home: "/home/test",
    },
  };
  void env; // 派生函数内部读 env.XDG_DATA_HOME, 测试经第三参注入
  return (name) => bases[platform][name];
}

describe("deriveStoragePaths — Windows(Roaming/Local 分家, D-019)", () => {
  it("configDir=userData(Roaming), dataDir=Local 分家", () => {
    const p = deriveStoragePaths("win32", mockGetPath("win32"));
    expect(p.configDir).toBe("C:\\Users\\test\\AppData\\Roaming\\token-wallet");
    expect(p.dataDir).toBe("C:\\Users\\test\\AppData\\Local\\token-wallet");
  });

  it("与 Tauri app_config_dir/app_data_dir 语义一致(路径值等价)", () => {
    const p = deriveStoragePaths("win32", mockGetPath("win32"));
    // Tauri: config=%APPDATA%/token-wallet, data=%LOCALAPPDATA%/token-wallet
    expect(p.configDir).toBe("C:\\Users\\test\\AppData\\Roaming\\token-wallet");
    expect(p.dataDir).toBe("C:\\Users\\test\\AppData\\Local\\token-wallet");
  });
});

describe("deriveStoragePaths — macOS(配置/数据同目录, 不分家)", () => {
  it("configDir=dataDir=userData", () => {
    const p = deriveStoragePaths("darwin", mockGetPath("darwin"));
    expect(p.configDir).toBe("/Users/test/Library/Application Support/token-wallet");
    expect(p.dataDir).toBe(p.configDir);
  });
});

describe("deriveStoragePaths — Linux(XDG_DATA_HOME 派生, 兜底 ~/.local/share)", () => {
  it("未设 XDG_DATA_HOME → dataDir=~/.local/share/token-wallet, config=userData", () => {
    const p = deriveStoragePaths("linux", mockGetPath("linux"));
    expect(p.configDir).toBe("/home/test/.config/token-wallet");
    expect(p.dataDir).toBe("/home/test/.local/share/token-wallet");
  });

  it("设 XDG_DATA_HOME → dataDir 跟随, 不硬编码 ~/.local/share", () => {
    const p = deriveStoragePaths("linux", mockGetPath("linux"), {
      XDG_DATA_HOME: "/var/lib/tw-data",
    });
    expect(p.dataDir).toBe("/var/lib/tw-data/token-wallet");
    expect(p.configDir).toBe("/home/test/.config/token-wallet");
  });
});

describe("deriveStoragePaths — userData 派生不变式(应用名来自 userData basename)", () => {
  it("应用名不同(userData 不同 basename)时仍正确派生, 零硬编码", () => {
    const getPath = (name: "userData" | "home") =>
      name === "userData" ? "/home/x/.config/my-app" : "/home/x";
    const p = deriveStoragePaths("linux", getPath);
    expect(p.dataDir).toBe("/home/x/.local/share/my-app");
  });

  it("win32 下应用名派生自 userData basename 而非硬编码 token-wallet", () => {
    const getPath = (name: "userData" | "home") =>
      name === "userData" ? "D:\\Apps\\Data\\Roaming\\my-app" : "D:\\Apps";
    const p = deriveStoragePaths("win32", getPath);
    expect(p.dataDir).toBe("D:\\Apps\\Data\\Local\\my-app");
  });
});
