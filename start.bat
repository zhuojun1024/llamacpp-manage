@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem ---------- 定位 Node.js（PATH 优先，nvm4w / 默认安装位置兜底） ----------
set "NODE_EXE="
set "NPM_EXE="
where node >nul 2>nul
if %errorlevel%==0 (
    set "NODE_EXE=node"
    set "NPM_EXE=npm"
) else (
    if exist "C:\nvm4w\nodejs\node.exe" (
        set "NODE_EXE=C:\nvm4w\nodejs\node.exe"
        set "NPM_EXE=C:\nvm4w\nodejs\npm.cmd"
    )
    if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" (
        set "NODE_EXE=C:\Program Files\nodejs\node.exe"
        set "NPM_EXE=C:\Program Files\nodejs\npm.cmd"
    )
)

if not defined NODE_EXE (
    echo [ERROR] 未检测到 Node.js，请先安装 Node.js 18+ : https://nodejs.org
    echo         若已装 nvm4w，请先运行 nvm use 选择版本，或重新登录刷新环境变量
    pause
    exit /b 1
)

if not exist node_modules (
    echo [1/3] 安装依赖（首次运行）...
    call "%NPM_EXE%" install
    if errorlevel 1 (
        echo [ERROR] 依赖安装失败，请检查网络后重试
        pause
        exit /b 1
    )
)

if not exist web\dist (
    echo [2/3] 构建前端（首次运行）...
    call "%NPM_EXE%" run build
    if errorlevel 1 (
        echo [ERROR] 前端构建失败
        pause
        exit /b 1
    )
)

echo [3/3] 启动服务 http://localhost:8787 ...
"%NODE_EXE%" server\index.js
endlocal
pause
