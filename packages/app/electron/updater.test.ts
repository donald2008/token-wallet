/**
 * D-046: updater 状态机单测(fake autoUpdater, node 直测无 Electron 依赖)。
 * 真实链路(真 latest.yml → 检测 → 下载 → 重启)归 dist:win 产物侧自测链路, 本文件管逻辑分支。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdaterController, type UpdaterEvent } from "./updater";

type Handler = (...args: unknown[]) => void;

/** electron-updater autoUpdater 的最小 fake: on/once 注册 + checkForUpdates/downloadUpdate 可编程 */
function fakeUpdater() {
  const handlers = new Map<string, Handler[]>();
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
    checkForUpdates: vi.fn().mockResolvedValue(null),
    downloadUpdate: vi.fn().mockResolvedValue(null),
    quitAndInstall: vi.fn(),
  };
}

type Fake = ReturnType<typeof fakeUpdater>;

describe("AppUpdaterController(D-046)", () => {
  let events: UpdaterEvent[];
  let collect: (e: UpdaterEvent) => void;
  let upd: Fake;

  beforeEach(() => {
    events = [];
    collect = (e) => events.push(e);
    upd = fakeUpdater();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeController(isPackaged: boolean): AppUpdaterController {
    return new AppUpdaterController({ updater: upd as never, isPackaged, emit: collect });
  }

  it("构造即关闭自动下载/自动安装(静默 CHECK ONLY 定案)", () => {
    makeController(true);
    expect(upd.autoDownload).toBe(false);
    expect(upd.autoInstallOnAppQuit).toBe(false);
  });

  it("dev(isPackaged=false): check/download 恒 unavailable, 不触碰 updater", async () => {
    const c = makeController(false);
    expect(await c.check()).toEqual({ status: "unavailable" });
    expect(await c.download()).toEqual({ status: "unavailable" });
    expect(upd.checkForUpdates).not.toHaveBeenCalled();
    expect(upd.autoDownload).toBe(true); // dev 下不改动全局配置
  });

  it("check: update-available → available + 版本号", async () => {
    const c = makeController(true);
    upd.checkForUpdates.mockImplementation(async () => {
      upd.emit("update-available", { version: "0.2.1" });
      return null;
    });
    const result = await c.check();
    expect(result.status).toBe("available");
    expect(result.version).toBe("0.2.1");
  });

  it("check: update-not-available → up-to-date", async () => {
    const c = makeController(true);
    upd.checkForUpdates.mockImplementation(async () => {
      upd.emit("update-not-available");
      return null;
    });
    expect((await c.check()).status).toBe("up-to-date");
  });

  it("check: 网络失败 → error 态 + 脱敏消息直出", async () => {
    const c = makeController(true);
    upd.checkForUpdates.mockRejectedValue(new Error("ENOTFOUND updater-host"));
    const result = await c.check();
    expect(result.status).toBe("error");
    expect(result.message).toContain("ENOTFOUND");
  });

  it("download: 进度事件推 downloading + percent, 完成推 ready", async () => {
    const c = makeController(true);
    upd.downloadUpdate.mockImplementation(async () => {
      upd.emit("download-progress", { percent: 37.9 });
      upd.emit("update-downloaded", { version: "0.2.1" });
      return null;
    });
    const result = await c.download();
    expect(result.status).toBe("ready");
    expect(result.version).toBe("0.2.1");
    const downloading = events.find((e) => e.status === "downloading");
    expect(downloading?.percent).toBe(38); // 四舍五入整数
  });

  it("download 中途 error 且已知新版本 → 回落 available(可重试)", async () => {
    const c = makeController(true);
    upd.emit("update-available", { version: "0.2.1" }); // 先发现
    upd.downloadUpdate.mockRejectedValue(new Error("connection reset"));
    const result = await c.download();
    expect(result.status).toBe("available"); // 不是死 error, 用户可重试
  });

  it("install: 仅 ready 态触发 quitAndInstall", () => {
    const c = makeController(true);
    c.install();
    expect(upd.quitAndInstall).not.toHaveBeenCalled(); // 未 ready 不许装
    upd.emit("update-downloaded", { version: "0.2.1" });
    c.install();
    expect(upd.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("getStatus 在 downloading 时带 percent(进程重启面板恢复展示不丢进度语义)", async () => {
    const c = makeController(true);
    upd.emit("download-progress", { percent: 55 });
    const status = c.getStatus();
    expect(status.status).toBe("downloading");
    expect(status.percent).toBe(55);
  });
});
