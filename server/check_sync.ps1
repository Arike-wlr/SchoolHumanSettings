# check_sync.ps1 - 手机 <-> 电脑 局域网同步排查脚本
# 用法:
#   powershell -ExecutionPolicy Bypass -File check_sync.ps1           只诊断
#   powershell -ExecutionPolicy Bypass -File check_sync.ps1 -Fix      诊断 + 一键放行防火墙 8000 端口(需管理员)

param([switch]$Fix)

$ErrorActionPreference = 'Continue'

Write-Host ""
Write-Host "==== 手机 <-> 电脑 局域网同步排查 ====" -ForegroundColor Cyan

# [1] 后端服务检查
Write-Host ""
Write-Host "[1/4] 后端服务 (端口 8000)..." -ForegroundColor Yellow
$listening = netstat -ano | findstr ":8000" | findstr "LISTENING"
if ($listening) {
    $listening.Trim() | ForEach-Object { Write-Host "  OK  $_" -ForegroundColor Green }
} else {
    Write-Host "  FAIL: 8000 端口无服务在监听!" -ForegroundColor Red
    Write-Host "  请先在 server 目录启动后端: python backend.py" -ForegroundColor Red
}

# [2] 本机 IP
Write-Host ""
Write-Host "[2/4] 本机 IPv4 地址 (手机端填: <以下IP>:8000)..." -ForegroundColor Yellow
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown'
}
foreach ($ip in $ips) {
    Write-Host ("  {0,-18} {1}" -f $ip.InterfaceAlias, $ip.IPAddress) -ForegroundColor White
}
$gw = Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' } | Select-Object -First 1 -ExpandProperty NextHop
if ($gw) {
    Write-Host ("  默认网关(手机热点/路由器): {0}" -f $gw) -ForegroundColor DarkGray
}

# [3] 网络配置文件类型
Write-Host ""
Write-Host "[3/4] 网络配置文件类型..." -ForegroundColor Yellow
Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.NetworkCategory -eq 'Public') {
        Write-Host ("  {0}  公用网络 [防火墙默认拦截入站, 见 [4]]" -f $_.Name) -ForegroundColor Red
    } else {
        Write-Host ("  {0}  {1}" -f $_.Name, $_.NetworkCategory) -ForegroundColor Green
    }
}

# [4] 防火墙规则
Write-Host ""
Write-Host "[4/4] 防火墙 8000 端口入站规则..." -ForegroundColor Yellow
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    $rule = Get-NetFirewallPortFilter -Protocol TCP -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 8000 } |
        Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }
    if ($rule) {
        Write-Host ("  OK 已存在放行规则: {0}" -f $rule.DisplayName) -ForegroundColor Green
    } else {
        Write-Host "  未找到放行 8000 端口的入站规则 -> 手机将无法连接!" -ForegroundColor Red
        if ($Fix) {
            netsh advfirewall firewall add rule name="OC Backend 8000" dir=in action=allow protocol=TCP localport=8000 | Out-Null
            Write-Host "  已添加放行规则 OK" -ForegroundColor Green
        } else {
            Write-Host "  修复: 以管理员运行本脚本加 -Fix 参数一键放行" -ForegroundColor DarkGray
            Write-Host '  或手动: netsh advfirewall firewall add rule name="OC Backend 8000" dir=in action=allow protocol=TCP localport=8000' -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "  需要管理员权限才能检查/修改防火墙规则" -ForegroundColor DarkGray
    Write-Host ("  提示: 以管理员身份运行: powershell -ExecutionPolicy Bypass -File `"{0}`" -Fix" -f $PSCommandPath) -ForegroundColor DarkGray
}

# 汇总
Write-Host ""
Write-Host "==== 下一步 ====" -ForegroundColor Cyan
Write-Host "1. 手机与电脑连同一个 WiFi / 热点"
Write-Host "2. 手机浏览器打开 http://<[2]中的IP>:8000 验证"
Write-Host "3. App 同步设置填 <IP>:8000, 点[测试]"
Write-Host ""
