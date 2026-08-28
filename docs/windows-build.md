# token-wallet Windows 构建手册（D-031 落地）

> 目标平台是 Windows 桌面。Tauri **不支持** Linux→Windows 交叉编译（需要 MSVC +
> Windows SDK + NSIS/WiX 原生工具链），因此 **Windows 安装包只能在 Windows 环境构建**。
> 原生 Windows 机器 = 用户 Windows 本机（老二/老三的 WSL2 与 njbx02 Linux 均不可）。

## 一键脚本（推荐）

```
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

脚本自动完成：依赖检测 → clone/pull → pnpm install → tauri build → 产物 SHA256 打印
→ 打开产物目录。缺失依赖时打印安装指引并退出，装完重跑即可（幂等）。

## 前置依赖

| 依赖 | 版本 | 安装 | 检测 |
|---|---|---|---|
| Node.js | 22+ (LTS) | `winget install OpenJS.NodeJS.LTS` 或 https://nodejs.org | `node -v` |
| pnpm | 9.15.0（仓库 `packageManager` 声明） | 随 corepack：`corepack prepare pnpm@9.15.0 --activate` | 脚本自动对齐 |
| Rust | stable | https://rustup.rs 默认装 | `cargo --version` |
| VS Build Tools | 最新 | https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/ **必须勾选"使用 C++ 的桌面开发"** | 脚本 vswhere 检测 |
| WebView2 | Win11 自带 / Win10 需 Evergreen Runtime | https://developer.microsoft.com/microsoft-edge/webview2/ | — |
| WiX Toolset（可选） | 3.x | 仅构建 .msi 需要；NSIS .exe 无此依赖 | 无 msi 产物即未装 |

## 手动构建（不用脚本时）

```bash
git clone https://gitee.com/ITEater/token-wallet.git   # 或 git@gitee.com:ITEater/token-wallet.git
cd token-wallet
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
pnpm -C packages/app tauri build
```

## 产物

```
packages/app/src-tauri/target/release/bundle/
  nsis/token-wallet_0.1.0_x64-setup.exe   ← 主安装包（无签名，SmartScreen 蓝屏属预期）
  msi/token-wallet_0.1.0_x64.msi          ← 可选（需 WiX）
```

每次构建后核对 SHA256（脚本已打印）：
```powershell
Get-FileHash .\token-wallet_0.1.0_x64-setup.exe -Algorithm SHA256
```

## 安装 / 更新

- 首次安装：SmartScreen 提示 → **更多信息 → 仍要运行**（无签名，D-031 定案）
- 更新 = 重新运行新安装包覆盖安装（未接自动更新，D-031）
- Windows Defender 误报：加排除目录或将产物报给 Windows 安全中心"允许"

## 发版

正式发版按 `RELEASE.md`：产物 + SHA256 挂 gitee release，README 指向下载。

## 独立安装包（离线，无任何运行时依赖）

已配置 `webviewInstallMode: offlineInstaller`（tauri.conf.json）：**构建时把全量
WebView2 离线安装器（~130MB）打进 NSIS 安装包**，安装过程不联网、不依赖系统已装
组件——旧 Win10 无 WebView2 的机器也能直接装，真·独立安装包。

安装包体积对比：
| 模式 | 包体 | 效果 |
|---|---|---|
| downloadBootstrapper（默认） | ~10MB | 安装时联网下载 WebView2（~1.5MB 引导+在线源） |
| **offlineInstaller（本项目当前）** | ~140MB | 完全离线，装完即用，任意 Windows 10/11 |
| skip | ~10MB | 要求系统已有 WebView2，否则不可用 |

> 需要切换回小体积模式时改 `bundle.windows.webviewInstallMode.type` 为
> `"downloadBootstrapper"` 即可（构建机需联网时 Tauri 会自动拉取）。

使用方**无需** Node / Rust / VS Build Tools 任何开发环境——那是构建机的事。

## crates 镜像配置（Cargo 拉取 Rust 依赖）

国内镜像有时**同步滞后于 Cargo.lock 锁定的版本**（实测 2026-08-28：tuna 缺
flate2 1.1.10，rsproxy 有）。报错特征：`failed to select a version for the
requirement flate2 = "^1.0.35" (locked to 1.1.10)`。推荐 rsproxy（字节，同步快）：

```toml
# %USERPROFILE%\.cargo\config.toml
[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[registries.crates-io]
protocol = "sparse"
```

不想换源时临时绕过：在 src-tauri 目录执行
`cargo update -p flate2 --precise 1.1.9`（用镜像现有版本降锁，仅本地生效）。

## 常见问题

### 便携/绿色版（免安装）

Tauri v2 NSIS 支持 `portable` target：单文件 exe 双击即用、免安装、免管理员。
需要时在 `bundle.targets` 加 `"portable"`（产物增加一个 `*_x64-portable.exe`，
随包附带同体积 WebView2 离线依赖语义）。

## 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `'pnpm' is not recognized`（tauri beforeBuildCommand 阶段） | Windows 下 corepack prepare 不创建 pnpm shim | 已双保险：tauri.conf.json 的 before/after 命令走 `corepack pnpm`；脚本构建前会自动 `corepack enable`。老包需 `git pull` 取最新配置 |
| `failed to select a version for the requirement flate2`（cargo 报 locked to 高版本） | crates 镜像同步滞后于 Cargo.lock | 换 rsproxy 镜像（见上节）或 `cargo update -p flate2 --precise <镜像现有版本>` 临时降锁 |
| `link.exe 未找到` / MSVC 报错 | VS Build Tools 未装或未勾选 C++ 桌面开发 | 重装 Build Tools 勾选后重跑 |
| `tauri build` 慢 / 卡 | 首次 Rust 全量编译（依赖多） | 正常，5-15 分钟，增量后秒级 |
| 磁盘空间不足 | target 目录大 | 预留 ≥10GB；`pnpm -C packages/app tauri clean` 可清 |
| 无 .msi 产物 | 未装 WiX | 不影响使用：NSIS .exe 是主安装包 |
| dev 模式预览 | — | `pnpm -C packages/app tauri dev`（免安装直接看壳） |

## 现状提示（2026-08-28）

P0-2 壳阶段的安装包可安装运行：托盘四色状态点（mock 联动）、弹出面板、主题切换、
首开隐私声明门、设置页骨架。面板模板（bars/ticker/健康度排序/异常卡）为 P0-3，
真实数据通道为 P0-5——正式可用包请等 P0 全部完成后再发版。