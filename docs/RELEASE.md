# token-wallet Windows 构建交接包（E3 / D-035）

> 本文档是 E3 交付的构建交接包（老大边界指引 comment #806 要求，同 t_6cc6020b 模式）。
> 用途：在 **Windows 原生环境**一键产出 NSIS 离线安装包并挂 gitee release（D-031 渠道）。
> WSL2/Linux 侧仅作构建链验证（证据见文末），最终安装包按 D-031 在 Windows 本机构建。

## 1. 前置依赖（比 Tauri 时代大幅收窄）

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | **≥ 22**（22.5+ 内置 node:sqlite） | winget install OpenJS.NodeJS.LTS 或 https://nodejs.org |
| corepack | 随 Node 自带 | 脚本自动 `corepack prepare pnpm@9.15.0 --activate` |
| ~~Rust~~ | ~~不需要~~ | D-033 换壳 Electron 后废弃 |
| ~~VS Build Tools~~ | ~~不需要~~ | 无原生模块（D-034 node:sqlite），零 MSVC 依赖 |
| ~~WebView2 工具链~~ | ~~不需要~~ | Electron 自带 Chromium |

## 2. 构建命令（二选一）

### 方式 A：一键脚本（推荐）
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```
脚本自动：探测仓库根 → 检测 Node/corepack（缺失打印指引退出）→ 注入大陆镜像
（ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR）→ git clone/pull →
pnpm install（frozen-lockfile）→ pnpm -r build → electron-builder NSIS → 输出 SHA256。

### 方式 B：手动分步（脚本等价物）
```powershell
# 0. 镜像（大陆网络必需）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

# 1. 取源码
git clone git@gitee.com:ITEater/token-wallet.git
cd token-wallet

# 2. 对齐 pnpm + 装依赖
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile

# 3. 构建 core + app（esbuild 主进程 + vite 渲染层，base "./" 已配）
pnpm -r build

# 4. electron-builder NSIS 离线包（oneClick/静默/无签名，配置见 packages/app/package.json "build"）
pnpm -C packages/app dist:win

# 5. SHA256
Get-FileHash .\packages\app\release\token-wallet_0.1.0_setup.exe -Algorithm SHA256
```

## 3. 预期产物

| 路径 | 说明 |
|------|------|
| `packages/app/release/token-wallet_<version>_setup.exe` | NSIS 离线安装包（oneClick 默认静默，支持 /S；无签名，SmartScreen 提示为预期） |
| `packages/app/release/token-wallet_<version>_setup.exe.sha256` | SHA256 校验值（一键脚本自动落盘） |
| `packages/app/release/win-unpacked/` | 解包目录（自检用，非交付物） |

Windows 构建下 electron-builder 会在 Windows 原生 rcedit 嵌入自设计图标
（`packages/app/build-resources/icon.ico`，迁自旧 Tauri 壳 D-024 logo）。

## 4. gitee release 挂包（D-031 渠道不变）

1. 打开 https://gitee.com/ITEater/token-wallet/releases/new（需仓主 token/登录）
2. Tag 建议 `v0.1.0`；标题 `token-wallet v0.1.0`
3. 附件上传：`token-wallet_<version>_setup.exe` + `.sha256`
4. 发布后把 release 链接发给真机验收人（下载源）

## 5. 真机验收清单（用户/老大，产品红线）

安装 → 首开 consent（一次，同意后重启不再弹）→ 添加 provider →
托盘四态状态点 → 透明无边框观感（无边框透明圆角悬浮卡 + 托盘即弹）→
重启实例仍在 → 开机自启（托盘/设置开关）→ 卸载。

## 6. WSL2 侧已验证范围（E3 证据，2026-08-29）

- `electron-builder@26.15.3` NSIS 目标在 Linux 原生产包成功（装 wine64 后资源嵌入全量通过）：
  `packages/app/release/token-wallet_0.1.0_setup.exe`（93.2MB，SHA256 见构建日志）
- asar 内容核验：dist/（index.html + assets）+ dist-electron/（main/preload.cjs）+ electron/icons/ 四态全在
- **vite base "./" 修复**：修复前 dist/index.html 的 `/assets/*` 在 file:// 下解析到盘符根会白屏；修复后 `./assets/` 相对路径
- 生产模式冒烟（Linux Electron 加载 dist）：首开 consent 页真实渲染（OCR 文本证据）；
  预置 consentAgreed 后 `get_bootstrap firstRun=false`，UI 切到「添加 Provider」页 —— consent 一次语义在打包路径生效
- 回归：core vitest 61/61、app vitest 69/69、typecheck 0 error、e2e 27/27
- WSLg 无法注入鼠标点击（已知限制），完整交互流由真机验收覆盖
