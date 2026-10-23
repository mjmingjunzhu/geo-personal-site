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

if not exist "node_modules" (
    echo [1/3] 第一次运行，正在安装依赖（需要联网，稍等一两分钟）...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试。
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
echo       关闭这个窗口，预览就会停止。
echo.
node serve.js
pause
