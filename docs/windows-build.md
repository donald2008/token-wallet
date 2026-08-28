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

## 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `link.exe 未找到` / MSVC 报错 | VS Build Tools 未装或未勾选 C++ 桌面开发 | 重装 Build Tools 勾选后重跑 |
| `tauri build` 慢 / 卡 | 首次 Rust 全量编译（依赖多） | 正常，5-15 分钟，增量后秒级 |
| 磁盘空间不足 | target 目录大 | 预留 ≥10GB；`pnpm -C packages/app tauri clean` 可清 |
| 无 .msi 产物 | 未装 WiX | 不影响使用：NSIS .exe 是主安装包 |
| dev 模式预览 | — | `pnpm -C packages/app tauri dev`（免安装直接看壳） |

## 现状提示（2026-08-28）

P0-2 壳阶段的安装包可安装运行：托盘四色状态点（mock 联动）、弹出面板、主题切换、
首开隐私声明门、设置页骨架。面板模板（bars/ticker/健康度排序/异常卡）为 P0-3，
真实数据通道为 P0-5——正式可用包请等 P0 全部完成后再发版。