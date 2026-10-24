@echo off
chcp 65001 >nul
title 个人网站 - 一键上线
cd /d "%~dp0"

echo.
echo ============================================
echo    个人网站 - 一键上线
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

if not exist "deploy.env" (
    copy /y "deploy.env.example" "deploy.env" >nul
    echo 第一次上线，需要先填服务器信息。
    echo 已经帮你建好了 deploy.env，马上用记事本打开：
    echo   填好服务器 IP 和登录密码，保存，关掉记事本，再双击一次本文件。
    echo   不知道怎么填，看项目里的 DEPLOY.md，或者让 AI 助手帮你填。
    echo.
    start "" notepad "deploy.env"
    pause
    exit /b 0
)

if not exist "node_modules\ssh2" (
    echo 第一次上线，正在安装部署用的组件（需要联网，稍等一两分钟）...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

node deploy\deploy.js %*
echo.
pause
