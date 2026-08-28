# token-wallet Windows 一键构建脚本 (D-031: Windows 构建 = Windows 本机唯一渠道)
# =============================================================================
# 用法:
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
#   （或用 PowerShell 右键"使用 PowerShell 运行"）
#
# 前置依赖（脚本自动检测，缺失时打印安装指引后退出）:
#   - Node.js 22+        https://nodejs.org  (LTS)
#   - pnpm 9.15.0        随 corepack 自动（脚本内 corepack prepare 对齐仓库声明）
#   - Rust stable        https://rustup.rs  (默认安装即可)
#   - VS Build Tools     https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/
#                         安装时勾选"使用 C++ 的桌面开发"
#
# 产物:
#   packages/app/src-tauri/target/release/bundle/nsis/token-wallet_*.exe   ← 主安装包
#   packages/app/src-tauri/target/release/bundle/msi/*.msi                ← 可选(WiX)
#   脚本末尾打印每个产物的 SHA256 校验值。
# =============================================================================

param(
    # 仓库根目录; 不传则自动探测脚本所在目录的上一级
    [string]$RepoDir = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Error2($msg) { Write-Host "[错误] $msg" -ForegroundColor Red }

# ---------- 0. 定位仓库根 ----------
if (-not $RepoDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $candidate = Split-Path -Parent $scriptDir   # scripts/ 的上一级 = 仓库根
    if (Test-Path (Join-Path $candidate "package.json")) { $RepoDir = $candidate }
    else { $RepoDir = Join-Path $env:USERPROFILE "token-wallet" }
}
Write-Host "仓库根: $RepoDir"

# ---------- 1. 依赖检测 ----------
$missing = @()

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $missing += "Node.js 22+  (winget install OpenJS.NodeJS.LTS  或 https://nodejs.org)"
} else {
    Write-Host "node: $(node -v)"
}
if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
    $missing += "corepack  (随 Node.js 自带; 若缺失执行: npm install -g corepack)"
} else {
    Write-Host "corepack: 已安装"
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $missing += "Rust (winget install Rustlang.Rustup 或 https://rustup.rs, 装完重开终端)"
} else {
    Write-Host "cargo: $(cargo --version)"
}

# VS Build Tools (MSVC 链接器) 检测 —— 通过 vswhere 查 VC 工具组件
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsFound = ""
if (Test-Path $vswhere) {
    $vsFound = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
}
if (-not $vsFound) {
    $missing += "VS Build Tools(勾选'使用 C++ 的桌面开发')  https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/"
}

if ($missing.Count -gt 0) {
    Write-Error2 "缺少以下依赖:"
    foreach ($m in $missing) { Write-Host "  - $m" -ForegroundColor Yellow }
    Write-Host "`n安装完成后重新运行本脚本即可。"
    exit 1
}

# ---------- 2. 获取/更新源码 ----------
if (-not (Test-Path (Join-Path $RepoDir "package.json"))) {
    Write-Step "clone 仓库到 $RepoDir"
    if (-not (Test-Path $RepoDir)) { New-Item -ItemType Directory -Path $RepoDir | Out-Null }
    # 优先 HTTPS（无需 SSH key）; 失败提示 SSH 替代
    git clone https://gitee.com/ITEater/token-wallet.git $RepoDir
    if ($LASTEXITCODE -ne 0) {
        Write-Error2 "HTTPS clone 失败, 可改用 SSH: git clone git@gitee.com:ITEater/token-wallet.git $RepoDir"
        exit 1
    }
} else {
    Write-Step "更新仓库 (git pull)"
    Push-Location $RepoDir
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Error2 "git pull 失败, 请检查本地是否有未提交改动"; exit 1 }
    Pop-Location
}

# ---------- 3. 安装依赖 + 构建 ----------
Push-Location $RepoDir
try {
    Write-Step "对齐 pnpm 版本 (packageManager 声明)"
    corepack prepare pnpm@9.15.0 --activate
    if ($LASTEXITCODE -ne 0) { throw "corepack prepare 失败" }

    Write-Step "pnpm install (frozen-lockfile)"
    corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败" }

    Write-Step "tauri build (Windows 安装包)"
    corepack pnpm -C packages/app tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build 失败(最常见原因: MSVC 链接器缺失/磁盘空间不足, 见 docs/windows-build.md)" }
} finally {
    Pop-Location
}

# ---------- 4. 产物 + SHA256 ----------
$bundleRoot = Join-Path $RepoDir "packages\app\src-tauri\target\release\bundle"
$artifacts = @()
if (Test-Path (Join-Path $bundleRoot "nsis")) {
    $artifacts += Get-ChildItem (Join-Path $bundleRoot "nsis") -Filter *.exe -ErrorAction SilentlyContinue
}
if (Test-Path (Join-Path $bundleRoot "msi")) {
    $artifacts += Get-ChildItem (Join-Path $bundleRoot "msi") -Filter *.msi -ErrorAction SilentlyContinue
}

if ($artifacts.Count -eq 0) {
    Write-Error2 "未找到构建产物, 请检查 $bundleRoot"
    exit 1
}

Write-Step "构建完成! 产物清单:"
foreach ($f in $artifacts) {
    $hash = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash
    Write-Host ""
    Write-Host "  文件: $($f.FullName)" -ForegroundColor Green
    Write-Host "  大小: $([math]::Round($f.Length / 1MB, 2)) MB"
    Write-Host "  SHA256: $hash" -ForegroundColor Yellow
}

# 打不开产物目录就到 bundle 目录手动找
if (Test-Path $bundleRoot) { Start-Process explorer.exe -ArgumentList $bundleRoot }

Write-Host ""
Write-Host "安装提示:" -ForegroundColor Cyan
Write-Host "  - 首次安装如遇 SmartScreen 蓝屏提示, 点『更多信息 → 仍要运行』(无签名, 属预期, D-031)"
Write-Host "  - 更新 = 重新安装新包(未接自动更新, D-031)"
exit 0