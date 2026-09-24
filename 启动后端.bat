@echo off
setlocal enableextensions
chcp 936 >nul
title 高校拟人 OC - 后端服务

cd /d "%~dp0"

set "PORT=8000"
set "VENV_PY=%~dp0.venv\Scripts\python.exe"
set "BACKEND=%~dp0server\backend.py"

if not exist "%VENV_PY%"  goto :no_venv
if not exist "%BACKEND%"  goto :no_backend

rem ============================================================
rem  端口占用检查：若后端已在运行，则不重复启动，直接开浏览器
rem ============================================================
set "INUSE="
for /f "delims=" %%a in ('netstat -ano ^| findstr /r /c:":%PORT% " ^| findstr /c:"LISTENING"') do set "INUSE=1"
if defined INUSE (
  echo.
  echo   [提示] 端口 %PORT% 已在监听，后端似乎已经在运行。
  echo          直接为你打开浏览器，不重复启动。
  echo.
  start "" "http://localhost:%PORT%"
  rem 延时约 4 秒，让上面两行提示来得及看清。
  rem 这里不用 timeout.exe：它在 stdin 被重定向时会直接报错退出，
  rem 且 PATH 里若存在同名命令（如 Git Bash 的 timeout）会被顶掉。
  rem ping.exe 用绝对路径 + 回环地址，无控制台依赖、无 PATH 歧义。
  "%SystemRoot%\System32\ping.exe" -n 5 127.0.0.1 >nul
  exit /b 0
)

echo.
echo  ============================================================
echo    高校拟人 OC 设定管理  ·  后端服务
echo  ------------------------------------------------------------
echo    本机访问 :  http://localhost:%PORT%
echo    手机同步 :  http://本机局域网IP:%PORT%
echo    停止服务 :  关闭本窗口  或  按 Ctrl+C
echo  ============================================================
echo.

rem ------------------------------------------------------------
rem  后台静默等待端口就绪，然后自动打开默认浏览器
rem  用独立 PowerShell 进程轮询端口，不阻塞下面的后端日志输出
rem ------------------------------------------------------------
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();Start-Process 'http://localhost:%PORT%';exit}catch{};if($i -ge 240){exit};Start-Sleep -Milliseconds 250}"

rem ------------------------------------------------------------
rem  前台启动后端：日志实时输出到本窗口，关窗口即停止服务
rem ------------------------------------------------------------
"%VENV_PY%" "%BACKEND%" --port %PORT%

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


:no_backend
echo.
echo  [错误] 找不到后端文件：
echo         %BACKEND%
echo.
echo  请确认本脚本位于项目根目录，且与 server 文件夹同级。
echo.
pause
exit /b 1
