@echo off
setlocal enableextensions
chcp 936 >nul
title 手机版调试（连后端）

cd /d "%~dp0.."

set "PORT=8100"
set "BACKEND=http://localhost:8000"
set "VENV_PY=%~dp0..\.venv\Scripts\python.exe"
set "DEVSERVER=%~dp0mobile-dev-server.py"
set "APPPY=%~dp0..\server\backend.py"

if not exist "%VENV_PY%"  goto :no_venv
if not exist "%DEVSERVER%" goto :no_server
if not exist "%APPPY%"     goto :no_app

echo.
echo  ============================================================
echo    手机版调试（一体模式：前端 + 后端 + API 代理）
echo  ------------------------------------------------------------
echo    地址     :  http://localhost:%PORT%
echo    后端     :  %BACKEND%   （已开，日志在另一个窗口）
echo    同步地址 :  http://localhost:%PORT%
echo.
echo    同步弹窗里的服务器地址就填上面那个，
echo    同源转发，不用管跨域，也不用再开 8000 端口。
echo  ------------------------------------------------------------
echo    改完 assets/web/ 下的文件，直接刷新浏览器即可。
echo    停止：关掉两个窗口，或分别按 Ctrl+C。
echo  ============================================================
echo.

rem 先起后端（独立窗口，日志可查），再起前端
start "OC Backend :8000" /min "%VENV_PY%" "%APPPY%" --port 8000

rem 轮询等后端就绪（最多约 20 秒）
set "READY="
for /l %%i in (1,1,40) do (
  if not defined READY (
    "%VENV_PY%" "%~dp0_waitport.py" 8000 >nul 2>&1 && set "READY=1"
    if not defined READY ping -n 1 -w 500 127.0.0.1 >nul
  )
)
if defined READY goto :backend_ok
echo  [警告] 后端 20 秒内没起来，代理会报 502
goto :backend_done

:backend_ok
echo  [OK] 后端已就绪

:backend_done

rem 自动开浏览器
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();Start-Process 'http://localhost:%PORT%';exit}catch{};if($i -ge 60){exit};Start-Sleep -Milliseconds 250}"

"%VENV_PY%" "%DEVSERVER%" --port %PORT% --proxy --backend %BACKEND%

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


:no_app
echo.
echo  [错误] 找不到后端脚本：
echo         %APPPY%
echo.
echo  请确认 server\backend.py 存在。
echo.
pause
exit /b 1
