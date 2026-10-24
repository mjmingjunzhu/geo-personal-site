@echo off
chcp 65001 >nul
title 个人网站 - 一键启动
cd /d "%~dp0"

echo.
echo ============================================
echo    个人网站 - 一键启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 没有找到 Node.js。
    echo        请先到 https://nodejs.org 安装 Node.js（选 LTS 版本），再双击本文件。
    echo.
    pause
    exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
    echo [提示] 你的 Node.js 版本较旧：网站可以正常生成和预览，但联系表单需要 22.13 或更高版本。
    echo        需要联系表单的话，到 https://nodejs.org 安装最新的 LTS 版本。
    echo.
)

if not exist "node_modules" (
    echo [1/3] 第一次运行，正在安装依赖（需要联网，稍等一两分钟）...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试。
        echo        国内网络慢的话，可以先在命令行运行下面这句，换成国内镜像，再双击本文件：
        echo        npm config set registry https://registry.npmmirror.com
        pause
        exit /b 1
    )
) else (
    echo [1/3] 依赖已安装
)

echo [2/3] 正在根据 src\data.js 生成网站...
call npm run build
if errorlevel 1 (
    echo [错误] 生成失败，请看上面的报错信息（多半是 src\data.js 里少了逗号或引号）。
    pause
    exit /b 1
)

if exist ".env" (
    echo       检测到 .env，在后台启动联系表单服务（端口 3011）
    start "联系表单后端" /min cmd /c "node server\index.js"
) else (
    echo       没有 .env，跳过联系表单服务（只预览网站不需要它）
)

echo [3/3] 正在打开本地预览，浏览器会自动弹出...
if exist "public\start.html" (
    echo       现在还是示例网站，浏览器会先打开「上手指南」，照着三步做就能换成你自己的。
)
echo       关闭这个窗口，预览就会停止。
echo.
node serve.js
pause
