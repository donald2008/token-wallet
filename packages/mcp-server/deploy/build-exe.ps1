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
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed (exit $LASTEXITCODE)" }

    # ---- 产物校验 ----
    if (-not (Test-Path $outExe)) { throw "exe not produced at $outExe" }
    $size = (Get-Item $outExe).Length
    Write-Host ("OK: {0}  ({1:N1} MB)" -f $outExe, ($size / 1MB))
    Write-Host "next: 冒烟验证见文件头注释 (需 TOKEN_WALLET_MCP_KEY)"
}
finally {
    Pop-Location
}
