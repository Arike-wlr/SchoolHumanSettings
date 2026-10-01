# -*- coding: utf-8 -*-
"""
一键把手机版 H5 资源推到已连接的 Android 设备 —— 改完 H5 不用重新打包 APK。

用法：
    python tools\\push-mobile.py --push            # 推送 assets/web → 设备 files/web-dev/（并开启开发模式）
    python tools\\push-mobile.py --push --restart   # 推送后自动重启 App
    python tools\\push-mobile.py --disable          # 关闭开发模式（回到 APK 内置资源）
    python tools\\push-mobile.py --status           # 查看当前状态
    python tools\\push-mobile.py --list             # 只列设备

==================== 一次性准备 ====================
本方案需要 MainActivity 支持「开发模式」加载（已加入 resolveStartUrl()）。
所以**必须先重新打一次 APK**，之后所有 H5 改动就能免打包：

    1. 打一次包（含开发模式支持）：
       cd android-app && gradlew.bat assembleRelease
    2. 覆盖安装到手机（**不要卸载**，卸载会清空 IndexedDB）：
       adb install -r app\\build\\outputs\\apk\\release\\app-release.apk
    3. 之后改 H5：
       python tools\\push-mobile.py --push --restart        # 几秒钟生效

==================== 前提 ====================
  * 手机开「USB 调试」，数据线连电脑（或 adb connect <IP>:5555 无线调试）
  * ⚠️ APK 必须可调试（debuggable）才能用 run-as 写入私有目录。
    检查：adb shell run-as com.occharacters ls
    若报 permission denied，需要在 build.gradle 的 release 块里加：
        debuggable true
    重新打一次包（正式发布时再移除）。

⚠️ 安装 APK 必须覆盖安装，不能卸载 —— 卸载会清掉 IndexedDB 全部数据。
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
WEB_DIR = os.path.join(ROOT, 'android-app', 'app', 'src', 'main', 'assets', 'web')
ADB = os.path.join(ROOT, 'android-sdk', 'platform-tools', 'adb.exe')

PKG = 'com.occharacters'
DEV_DIR = 'web-dev'
FLAG = '.enabled'
REMOTE_TMP = '/data/local/tmp/oc_web'


def run(args, check=False):
    r = subprocess.run(args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if check and r.returncode != 0:
        raise RuntimeError('%s\n%s' % (' '.join(args), (r.stderr or r.stdout or '').strip()))
    return r


def adb(*args, **kw):
    return run([ADB] + list(args), **kw)


def devices():
    r = adb('devices')
    out = []
    for l in (r.stdout or '').splitlines()[1:]:
        p = l.split()
        if len(p) >= 2 and p[1] == 'device':
            out.append(p[0])
    return out


def run_as_ok(pkg):
    """APK 是否可调试（能 run-as 进私有目录）"""
    r = adb('shell', 'run-as', pkg, 'echo', 'ok')
    return 'ok' in (r.stdout or '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pkg', default=PKG)
    ap.add_argument('--push', action='store_true', help='推送 H5 并开启开发模式')
    ap.add_argument('--disable', action='store_true', help='关闭开发模式')
    ap.add_argument('--status', action='store_true', help='查看状态')
    ap.add_argument('--restart', action='store_true', help='操作后重启 App')
    ap.add_argument('--list', action='store_true', help='只列设备')
    args = ap.parse_args()

    if not os.path.isfile(ADB):
        sys.stderr.write('找不到 adb：%s\n' % ADB)
        return 2

    devs = devices()
    if args.list or not devs:
        print('设备：%s' % (', '.join(devs) if devs else '（无）'))
        if not devs:
            print('\n请先连接手机：')
            print('  1. 开发者选项 → 开启「USB 调试」')
            print('  2. 数据线连接，手机上允许调试授权')
            print('  3. 或无线：%s connect <手机IP>:5555' % ADB)
        return 1 if not devs else 0

    print('设备：%s' % ', '.join(devs))

    if not run_as_ok(args.pkg):
        print('\n⚠️ run-as 不可用 —— 当前 APK 不可调试，无法写入应用私有目录。')
        print('   解决：在 android-app/app/build.gradle 的 release 块里加一行')
        print('         debuggable true')
        print('   然后重新打包并覆盖安装（正式发布时再移除该行）。')
        return 4

    if args.status or (not args.push and not args.disable):
        r = adb('shell', 'run-as', args.pkg, 'ls', 'files/%s/%s' % (DEV_DIR, FLAG))
        on = '.enabled' in (r.stdout or '')
        print('开发模式：%s' % ('已开启（加载 files/%s/）' % DEV_DIR if on else '未开启（加载 APK 内置 assets）'))
        if on:
            r2 = adb('shell', 'run-as', args.pkg, 'ls', 'files/%s' % DEV_DIR)
            n = len([x for x in (r2.stdout or '').splitlines() if x.strip()])
            print('副本文件数：%d' % n)
        return 0

    if args.disable:
        r = adb('shell', 'run-as', args.pkg, 'rm', '-f', 'files/%s/%s' % (DEV_DIR, FLAG))
        print('已关闭开发模式，下次启动回到 APK 内置资源。')
        if args.restart:
            restart(args.pkg)
        return 0

    # ---- push ----
    print('源  ：%s' % WEB_DIR)
    adb('shell', 'rm', '-rf', REMOTE_TMP)
    adb('shell', 'mkdir', '-p', REMOTE_TMP, check=True)
    r = adb('push', WEB_DIR + '/.', REMOTE_TMP)
    if r.returncode != 0:
        sys.stderr.write('push 失败：%s\n' % (r.stderr or '').strip())
        return 3
    print('已推送至设备 %s' % REMOTE_TMP)

    script = ('mkdir -p files/%s && rm -rf files/%s/* && '
              'cp -r %s/. files/%s/ && touch files/%s/%s && echo DONE'
              % (DEV_DIR, DEV_DIR, REMOTE_TMP, DEV_DIR, DEV_DIR, FLAG))
    r = adb('shell', 'run-as', args.pkg, 'sh', '-c', "'%s'" % script)
    if 'DONE' not in (r.stdout or ''):
        sys.stderr.write('写入失败：%s\n%s\n' % ((r.stdout or '').strip(), (r.stderr or '').strip()))
        return 5
    print('已写入 files/%s/ 并开启开发模式' % DEV_DIR)

    if args.restart:
        restart(args.pkg)
    else:
        print('\n提示：加 --restart 可自动重启 App 立即生效。')
    return 0


def restart(pkg):
    adb('shell', 'am', 'force-stop', pkg)
    adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1')
    print('已重启 App')


if __name__ == '__main__':
    sys.exit(main())
