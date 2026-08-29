@echo off
rem token-wallet 一键开发启动（Windows 双击入口）
rem 真正的逻辑在 start-dev.mjs（跨平台）；本文件只做 Node 兜底检查 + 转发参数。
rem   双击           = 全流程启动 Electron dev 壳
rem   start-dev.cmd --check   = 只装依赖不起壳
rem   start-dev.cmd --web     = 浏览器预览（无主进程，不能联调）
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [X] 未找到 Node.js
  echo      请从 https://nodejs.org 安装 LTS 版本^(22 或更高^)，
  echo      安装后**重新打开**本窗口再试^(PATH 需要重新加载^)。
  echo.
  pause
  exit /b 1
)

node "%~dp0start-dev.mjs" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo  [X] 启动失败^(退出码 %EXITCODE%^) — 具体原因见上方提示
  echo.
  pause
)
exit /b %EXITCODE%
