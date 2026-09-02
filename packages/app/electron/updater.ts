/**
 * D-046: 自动更新 = electron-updater generic 通道(v0.2.4 起托管于 gitee stable release)。
 * 定案(卡 t_88fd4ed8 + 2026-09-02 用户反馈收敛, 勿改):
 * - 启动静默 CHECK ONLY: autoDownload=false / autoInstallOnAppQuit=false,
 *   更新一律用户在设置页显式触发(借 hermes update 模式)
 * - **一键更新**(2026-09-02 用户拍板「不想点两下」): 点「更新到 vX」= 下载 + 完成后
 *   自动重启安装 —— 点击本身就是显式授权, 下载完成自动 quitAndInstall 是同一授权的
 *   延续; 「重启安装」钮仅保留在自动安装未生效的兜底场景(如下载完成前切走设置页后
 *   回来看到 ready 态)
 * - 完整性: latest.yml SHA512 内建校验 + blockmap 差量, 不做代码签名(D-031 边界延续)
 * - dev(app.isPackaged=false)返回 unavailable 态: update 通道物理不存在, 显式而非假装
 * - 纯逻辑模块(依赖注入 electron-updater 实例), main.ts 只做 IPC 注册;
 *   单测注入 fake updater 覆盖状态机, 真 autoUpdater 冒烟在 dist:win 产物侧验证
 */
import type { AppUpdater } from "electron-updater";

/** 渲染层四态 + error(SettingsView 关于区); status 字段与 IPC 契约逐字对应 */
export type UpdaterStatus =
  | "unavailable" // dev / 更新源不可达初始态
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready" // 下载完成, 待重启安装
  | "error";

/** webContents.send(updater_event) 推给渲染层的载荷(onUpdaterEvent 桥消费) */
export interface UpdaterEvent {
  status: UpdaterStatus;
  /** available/ready: 目标版本号 */
  version?: string;
  /** downloading: 0~100 */
  percent?: number;
  /** error: 脱敏消息( electron-updater 错误不含凭据, url 属自家基础设施可直出) */
  message?: string;
}

export interface UpdaterDeps {
  /** electron-updater autoUpdater(生产) / fake(单测) */
  updater: AppUpdater;
  /** dev 判定注入(main.ts 传 app.isPackaged, 单测直控) */
  isPackaged: boolean;
  /** 状态变化外推(main.ts 里 webContents.send 到渲染层) */
  emit?: (event: UpdaterEvent) => void;
}

export class AppUpdaterController {
  private readonly updater: AppUpdater;
  private readonly isPackaged: boolean;
  private readonly emit: (event: UpdaterEvent) => void;
  private status: UpdaterStatus = "unavailable";
  private pendingVersion: string | null = null;
  private lastPercent = 0;
  private wired = false;

  constructor(deps: UpdaterDeps) {
    this.updater = deps.updater;
    this.isPackaged = deps.isPackaged;
    this.emit = deps.emit ?? (() => {});
    if (this.isPackaged) {
      // D-046: 启动静默 CHECK ONLY, 下载/安装必须用户显式触发
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = false;
      // 事件接线提前到构造(测试在 check 前直接 emit 事件也必须被状态机看到;
      // 生产语义一致: 控制器存活期内的 error 事件不能丢)
      this.wire();
    }
  }

  /** 当前状态快照(IPC updater_check 返回; dev → unavailable 恒定) */
  getStatus(): UpdaterEvent {
    if (!this.isPackaged) return { status: "unavailable" };
    return {
      status: this.status,
      version: this.pendingVersion ?? undefined,
      percent: this.status === "downloading" ? this.lastPercent : undefined,
      message: this.lastMessage,
    };
  }

  private lastMessage: string | undefined;
  /** 一键更新: download() 由用户点击发起时置位, 下载完成后自动 install(见 wire) */
  private autoInstallRequested = false;

  /** 接 autoUpdater 事件 → 状态机(仅打包态接线一次) */
  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    this.updater.on("checking-for-update", () => this.setStatus("checking"));
    this.updater.on("update-available", (info) => {
      this.pendingVersion = info?.version ?? null;
      this.setStatus("available");
    });
    this.updater.on("update-not-available", () => {
      this.pendingVersion = null;
      this.setStatus("up-to-date");
    });
    this.updater.on("download-progress", (progress) => {
      this.lastPercent = Math.round(progress.percent ?? 0);
      this.setStatus("downloading");
    });
    this.updater.on("update-downloaded", (info) => {
      this.pendingVersion = info?.version ?? this.pendingVersion;
      this.setStatus("ready");
      // 一键更新(2026-09-02): 用户点「更新到 vX」已显式授权整个更新动作,
      // 下载完成即自动重启安装, 不要求第二次点击
      if (this.autoInstallRequested) {
        this.autoInstallRequested = false;
        // 微延迟让 ready 态先渲染(事件循环下一拍), 安装即退出
        setTimeout(() => this.install(), 50);
      }
    });
    this.updater.on("error", (err) => this.fail(err?.message ?? "unknown updater error"));
  }

  /** 失败分类: 已知新版本 → available(可重试, 更新机会不丢); 否则 error。消息直出 */
  private fail(message: string): void {
    this.setStatus(this.pendingVersion ? "available" : "error", message);
  }

  private setStatus(status: UpdaterStatus, message?: string): void {
    this.status = status;
    this.lastMessage = message;
    this.emit({
      status,
      version: this.pendingVersion ?? undefined,
      percent: status === "downloading" ? this.lastPercent : undefined,
      message,
    });
  }

  /** 用户点「检查更新」/ 启动静默检查共用 */
  async check(): Promise<UpdaterEvent> {
    if (!this.isPackaged) return { status: "unavailable" };
    try {
      await this.updater.checkForUpdates();
    } catch (err) {
      // 网络不可达/源挂了: 显式失败态(设置页可重试), 不静默
      this.fail((err as Error)?.message ?? "check failed");
    }
    return this.getStatus();
  }

  /** 用户点「更新」: 下载(进度走 emit → updater_event), 完成后自动重启安装(一键更新) */
  async download(): Promise<UpdaterEvent> {
    if (!this.isPackaged) return { status: "unavailable" };
    if (this.status === "ready") return this.getStatus();
    this.autoInstallRequested = true; // 用户已显式授权: 下载完成自动安装
    try {
      await this.updater.downloadUpdate();
    } catch (err) {
      this.autoInstallRequested = false; // 失败不残留标记(下次点击重新授权)
      this.fail((err as Error)?.message ?? "download failed");
    }
    return this.getStatus();
  }

  /** 用户点「重启安装」: quitAndInstall; 静默不装(更新时机永远用户说了算) */
  install(): void {
    if (!this.isPackaged || this.status !== "ready") return;
    // isInstalled 钩子不适用(退出即装); args 默认; 强制运行后退出由 NSIS 接管
    this.updater.quitAndInstall();
  }
}
