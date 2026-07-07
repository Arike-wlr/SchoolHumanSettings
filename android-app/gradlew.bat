@echo off
REM Custom gradlew.bat - downloads and runs Gradle without wrapper jar
setlocal

set GRADLE_VERSION=8.11.1
set GRADLE_URL=https://services.gradle.org/distributions/gradle-%GRADLE_VERSION%-bin.zip
set GRADLE_HOME=%USERPROFILE%\.gradle\wrappers\dists\gradle-%GRADLE_VERSION%-bin
set GRADLE_EXE=%GRADLE_HOME%\gradle-%GRADLE_VERSION%\bin\gradle.bat

if exist "%GRADLE_EXE%" goto run

echo Downloading Gradle %GRADLE_VERSION%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue';" ^
  "$dir='%GRADLE_HOME%';" ^
  "New-Item -ItemType Directory -Force -Path $dir | Out-Null;" ^
  "$retries=0;" ^
  "while($retries -lt 5) {" ^
  "  try {" ^
  "    Invoke-WebRequest -Uri '%GRADLE_URL%' -OutFile \"$dir\gradle.zip\" -UseBasicParsing -TimeoutSec 300;" ^
  "    break" ^
  "  } catch {" ^
  "    $retries++;" ^
  "    Write-Host \"Retry $retries...\";" ^
  "    Start-Sleep -Seconds 3" ^
  "  }" ^
  "}" ^
  "if(-not (Test-Path \"$dir\gradle.zip\")) { Write-Host 'Download failed'; exit 1 };" ^
  "Expand-Archive -Path \"$dir\gradle.zip\" -DestinationPath $dir -Force;" ^
  "Remove-Item \"$dir\gradle.zip\" -Force"

if not exist "%GRADLE_EXE%" (
    echo Failed to download Gradle.
    exit /b 1
)

:run
set JAVA_HOME=
call "%GRADLE_EXE%" %*
