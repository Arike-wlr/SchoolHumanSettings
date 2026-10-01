@echo off
setlocal enableextensions
chcp 936 >nul
title 手机版调试服务器

cd /d "%~dp0.."

set "PORT=8100"
set "VENV_PY=%~dp0..\.venv\Scripts\python.exe"
set "DEVSERVER=%~dp0mobile-dev-server.py"

if not exist "%VENV_PY%"  goto :no_venv
if not exist "%DEVSERVER%" goto :no_server

echo.
echo  ============================================================
echo    手机版调试服务器
echo  ------------------------------------------------------------
echo    地址     :  http://localhost:%PORT%
echo    手机布局 :  浏览器按 F12  -^>  Ctrl+Shift+M
echo    停止服务 :  关闭本窗口  或  按 Ctrl+C
echo  ------------------------------------------------------------
echo    改完 android-app/app/src/main/assets/web/ 下的文件，
echo    直接刷新浏览器即可，无需打包 APK。
echo.
echo    注意：此模式没有原生桥，图片存储与自动备份走降级路径，
echo          显示不出来属预期现象，不是 bug。
echo  ============================================================
echo.

rem ------------------------------------------------------------
rem  稍等后端/服务器就绪后自动开浏览器（独立进程轮询端口）
rem ------------------------------------------------------------
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();Start-Process 'http://localhost:%PORT%';exit}catch{};if($i -ge 60){exit};Start-Sleep -Milliseconds 250}"

rem ------------------------------------------------------------
rem  前台启动：日志实时输出到本窗口，关窗口即停止
rem ------------------------------------------------------------
"%VENV_PY%" "%DEVSERVER%" --port %PORT%

echo.
echo  [服务已停止]  按任意键关闭窗口...
pause >nul
exit /b 0


:no_venv
echo.
echo  [错误] 找不到虚拟环境 Python：
echo         %VENV_PY%
echo.
echo  请在项目根目录先执行一次：
echo         python -m venv .venv
echo         .venv\Scripts\python.exe -m pip install -r server\requirements.txt
echo.
pause
exit /b 1


:no_server
echo.
echo  [错误] 找不到调试服务器脚本：
echo         %DEVSERVER%
echo.
echo  请确认 tools\mobile-dev-server.py 存在。
echo.
pause
exit /b 1
