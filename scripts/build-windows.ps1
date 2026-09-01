# token-wallet Windows 一键构建脚本 (E3/D-035: electron-builder NSIS 离线包)
# =============================================================================
# 用法:
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
#   （或用 PowerShell 右键"使用 PowerShell 运行"）
#
# 前置依赖（脚本自动检测，缺失时打印安装指引后退出）:
#   - Node.js 22+        https://nodejs.org  (LTS)
#   - pnpm 9.15.0        随 corepack 自动（脚本内 corepack prepare 对齐仓库声明）
#   - 不再需要 Rust / VS Build Tools / WebView2 工具链
#     （D-033 换壳 Electron 的直接红利：构建机只装 Node 即可）
#
# 产物:
#   packages/app/release/token-wallet_<version>_setup.exe   ← NSIS 离线安装包
#     oneClick(默认) / 静默(安装程序支持 /S) / 无签名(D-031) / 单 exe 全离线
#   packages/app/release/token-wallet_<version>_setup.exe.sha256
#   packages/app/release/latest.yml + .blockmap              ← D-046 自更新三件套(electron-updater 用)
#   脚本末尾打印安装包绝对路径 + SHA256 + gitee release 上传指引。
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

# ---------- 1. 依赖检测（仅 Node + corepack; Rust/VS 不再需要） ----------
$missing = @()

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $missing += "Node.js 22+  (winget install OpenJS.NodeJS.LTS  或 https://nodejs.org)"
} else {
    $nodeVer = node -v
    Write-Host "node: $nodeVer"
    $nodeMajor = [int](($nodeVer -replace "[^0-9.]", "") -split "\.")[0]
    if ($nodeMajor -lt 22) { $missing += "Node.js 22+（当前 $nodeVer）" }
}
if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
    $missing += "corepack  (随 Node.js 自带; 若缺失执行: npm install -g corepack)"
} else {
    Write-Host "corepack: 已安装"
}

if ($missing.Count -gt 0) {
    Write-Error2 "缺少以下依赖:"
    foreach ($m in $missing) { Write-Host "  - $m" -ForegroundColor Yellow }
    Write-Host "`n安装完成后重新运行本脚本即可。"
    exit 1
}

# ---------- 2. 镜像设置（大陆网络友好; 已有环境变量则不覆盖） ----------
if (-not $env:ELECTRON_MIRROR) {
    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
}
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}
Write-Host "ELECTRON_MIRROR: $env:ELECTRON_MIRROR"

# ---------- 3. 获取/更新源码 ----------
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
    Write-Step "更新仓库 (git pull --ff-only)"
    Push-Location $RepoDir
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Error2 "git pull 失败, 请检查本地是否有未提交改动"; exit 1 }
    Pop-Location
}

# ---------- 4. 安装依赖 + 构建 + 打包 ----------
Push-Location $RepoDir
try {
    Write-Step "对齐 pnpm 版本 (packageManager 声明)"
    corepack prepare pnpm@9.15.0 --activate
    if ($LASTEXITCODE -ne 0) { throw "corepack prepare 失败" }

    Write-Step "安装依赖 (pnpm install --frozen-lockfile)"
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败" }

    Write-Step "构建 core + app + 打包 NSIS (pnpm build:win)"
    # ⚠️ 必须走 root 的 build:win = pnpm -r build(vite build) + electron-builder。
    #    禁止只跑 pnpm -C packages/app dist:win —— 它会打包上一次 vite build 留下的
    #    陈旧 dist/，UI/core 改动全部不进包（2026-09-01 v0.2.1 真机踩雷实锤）。
    pnpm build:win
    if ($LASTEXITCODE -ne 0) { throw "pnpm build:win 失败" }

    # ---------- 5. 产物 + SHA256 ----------
    $pkg = Get-Content (Join-Path $RepoDir "packages\app\package.json") -Raw | ConvertFrom-Json
    $version = $pkg.version
    $artifactName = "token-wallet_${version}_setup.exe"
    $installer = Join-Path $RepoDir ("packages\app\release\" + $artifactName)

    if (-not (Test-Path $installer)) {
        # 兜底: 匹配 release 目录下最新的 setup exe
        $installer = Get-ChildItem -Path (Join-Path $RepoDir "packages\app\release") -Filter "*_setup.exe" |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $installer) { throw "未找到 NSIS 安装包: packages\app\release" }
        $installer = $installer.FullName
    }

    $hash = (Get-FileHash -Algorithm SHA256 -Path $installer).Hash.ToLower()
    # sidecar 格式与 8889 部署/README 一致: "hash  filename.ext"
    $hashFile = "$installer.sha256"
    Set-Content -Path $hashFile -Value "$hash  $(Split-Path -Leaf $installer)" -Encoding ascii

    Write-Step "构建完成"
    Write-Host "安装包  : $installer"
    Write-Host "SHA256  : $hash"
    Write-Host "校验文件: $hashFile"
    Write-Host ""
    Write-Host "gitee release 上传指引 (个人机手动; 服务器走 API v5 repos 建 release+传附件):"
    Write-Host "  1. 打开 https://gitee.com/ITEater/token-wallet/releases/new"
    Write-Host "  2. Tag 建议: v$version; 标题: token-wallet v$version"
    Write-Host "  3. 附件上传: $artifactName + $artifactName.sha256"
    Write-Host "  4. 发布后把 release 链接发给老大（真机验收下载源）"
}
finally {
    Pop-Location
}
