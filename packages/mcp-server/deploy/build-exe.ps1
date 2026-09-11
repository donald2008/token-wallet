# token-wallet MCP daemon — Windows PyInstaller onefile 构建脚本
# 产物: packages/app/resources/token-wallet-mcp.exe (不进 git, resources/ 已 gitignore)
# 前置: Python >= 3.11 + pip install fastmcp pydantic pyinstaller tzdata
# 用法: powershell -ExecutionPolicy Bypass -File packages\mcp-server\deploy\build-exe.ps1
# 冒烟验证 (构建后):
#   $env:TOKEN_WALLET_MCP_KEY = "<mcp.env 里的 key>"
#   packages\app\resources\token-wallet-mcp.exe   # 另开窗口跑
#   curl -H "Authorization: Bearer $env:TOKEN_WALLET_MCP_KEY" `
#        -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" `
#        -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' `
#        http://127.0.0.1:9131/mcp   # 应 200 + serverInfo

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$mcpPkg = Join-Path $repoRoot "packages\mcp-server"
$outDir = Join-Path $repoRoot "packages\app\resources"

Write-Host "== token-wallet-mcp exe build =="
Write-Host "repo: $repoRoot"

# ---- t_1b396e2f: build_id 注入 (每次构建必变; 禁硬编码进源码) ----
# 构建时生成 <git 短hash>-<UTC yyyymmddHHMMss>, 追加标记 TW_MCP_BUILD_ID=<id> 到产物
# exe 字节流。daemon onboarding.build_id() 从自身 exe 扫描后经 /guide 自报,
# app 侧与本机 exe 同法扫描比对 → panel 提示「daemon 版本陈旧, 建议重启」。
# 附着段格式: \n# <json-safe ascii>\n — 不影响 PE 加载(附加数据), 不含 0 字节。
$gitShort = "nogit"
try { $gitShort = (git -C $repoRoot rev-parse --short HEAD).Trim() } catch { }
if ([string]::IsNullOrWhiteSpace($gitShort)) { $gitShort = "nogit" }
$buildId = "$gitShort-" + (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")

# ---- 依赖自检 (fastmcp/pydantic/pyinstaller/tzdata) ----
# 注: 不能用 PowerShell 的 2>$null 重定向 native stderr — PS 5.1 会转 error record
# 配合 $ErrorActionPreference=Stop 直接抛异常 (实踩), 走 cmd 层静默。
cmd /c "python -c ""import fastmcp, pydantic, PyInstaller, tzdata"" >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "deps missing -> pip install (tsinghua mirror)"
    python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple fastmcp pydantic pyinstaller tzdata
    if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
}

# ---- 路径准备 ----
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Push-Location $mcpPkg
try {
    # ---- 清理旧产物/旧 build 现场 (陈旧 binaries 会让 hidden import 问题难判) ----
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue build, dist
    $outExe = Join-Path $outDir "token-wallet-mcp.exe"
    Remove-Item -Force -ErrorAction SilentlyContinue $outExe

    # ---- onefile 构建 (console 模式: daemon 日志走 stdout) ----
    # hidden imports: fastmcp 经 importlib 动态加载 provider/工具模块, PyInstaller 静态
    # 分析扫不到 -> 全量收 fastmcp 子包; mcp 卡 server 品牌/版本; zoneinfo 需 tzdata。
    # PS 5.1: PyInstaller stderr 会以 NativeCommandError 形式触发 ErrorActionPreference=Stop
    # 误杀构建 (实踩) — 本段临时降为 Continue, stderr 由 PyInstaller 自打, 判定只看 $LASTEXITCODE
    $ErrorActionPreference = "Continue"
    python -m PyInstaller `
        --onefile `
        --console `
        --name token-wallet-mcp `
        --distpath "$outDir" `
        --workpath (Join-Path $mcpPkg "build") `
        --specpath (Join-Path $mcpPkg "build") `
        --paths (Join-Path $mcpPkg "src") `
        --hidden-import fastmcp `
        --hidden-import fastmcp.server `
        --hidden-import fastmcp.client `
        --hidden-import fastmcp.tools `
        --hidden-import fastmcp.prompts `
        --hidden-import fastmcp.resources `
        --hidden-import fastmcp.server.server `
        --hidden-import fastmcp.server.http `
        --hidden-import fastmcp.server.middleware `
        --hidden-import fastmcp.server.auth `
        --hidden-import fastmcp.exceptions `
        --hidden-import fastmcp.mcp_config `
        --hidden-import fastmcp.utilities `
        --hidden-import mcp `
        --hidden-import mcp.server `
        --hidden-import mcp.server.fastmcp `
        --hidden-import mcp.shared `
        --hidden-import mcp.types `
        --collect-submodules fastmcp `
        --collect-submodules mcp.server `
        --collect-submodules mcp.shared `
        --collect-data mcp `
        --copy-metadata fastmcp `
        --copy-metadata fastmcp-slim `
        --copy-metadata mcp `
        --copy-metadata mcp-types `
        --copy-metadata pydantic `
        --copy-metadata pydantic-settings `
        --copy-metadata anyio `
        --copy-metadata starlette `
        --copy-metadata httpx2 `
        --copy-metadata sse-starlette `
        --copy-metadata uvicorn `
        --hidden-import uvicorn `
        --hidden-import uvicorn.logging `
        --hidden-import uvicorn.loops.auto `
        --hidden-import uvicorn.protocols.http.auto `
        --hidden-import uvicorn.protocols.websockets.auto `
        --hidden-import uvicorn.lifespan.on `
        --hidden-import uvicorn.lifespan.off `
        --hidden-import anyio._backends._asyncio `
        --hidden-import email_validator `
        --hidden-import pydantic `
        --hidden-import pydantic_settings `
        --hidden-import tzdata `
        --collect-all tzdata `
        (Join-Path $mcpPkg "deploy\exe-entry.py")
    $ErrorActionPreference = "Stop"
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed (exit $LASTEXITCODE)" }

     # ---- 产物校验 ----
    if (-not (Test-Path $outExe)) { throw "exe not produced at $outExe" }

    # ---- t_1b396e2f: build_id 附着 (PyInstaller 之后追加, 每次构建必变) ----
    $marker = "# TW_MCP_BUILD_ID=$buildId`n"
    $tailLen = $marker.Length
    # PS 5.1 无 -AsByteStream → FileStream 手工附着; Append 模式 Seek 受限 → 先读尾判断, 再 Append 写
    $tailLen = $marker.Length
    $tailText = ""
    if ((Get-Item $outExe).Length -ge $tailLen) {
        $readFs = [System.IO.File]::OpenRead($outExe)
        try {
            [void]$readFs.Seek(-$tailLen, 'End')
            $tailBuf = New-Object byte[] $tailLen
            [void]$readFs.Read($tailBuf, 0, $tailLen)
            $tailText = [System.Text.Encoding]::ASCII.GetString($tailBuf)
        } finally { $readFs.Close() }
    }
    if ($tailText -ne $marker) {
        # 已附着旧 build_id → 截掉旧标记段; 全新 → 直接追加
        $allText = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($outExe))
        $idx = $allText.LastIndexOf("# TW_MCP_BUILD_ID=")
        if ($idx -ge 0) {
            $fs = [System.IO.File]::Open($outExe, 'Open', 'ReadWrite')
            try { $fs.SetLength($idx) } finally { $fs.Close() }
        }
        $stamp = [System.Text.Encoding]::ASCII.GetBytes($marker)
        $fs = [System.IO.File]::Open($outExe, 'Append', 'Write')
        try { $fs.Write($stamp, 0, $stamp.Length) } finally { $fs.Close() }
    }
    $allText = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($outExe))
    if (-not $allText.Contains("TW_MCP_BUILD_ID=$buildId")) { throw "build_id stamp verification failed: $buildId" }
    $allText = $null
    Write-Host "build_id stamped: $buildId"

    $size = (Get-Item $outExe).Length
    Write-Host ("OK: {0}  ({1:N1} MB)" -f $outExe, ($size / 1MB))
    Write-Host "next: 冒烟验证见文件头注释 (需 TOKEN_WALLET_MCP_KEY)"
}
finally {
    Pop-Location
}
