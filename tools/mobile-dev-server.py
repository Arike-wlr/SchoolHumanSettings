# -*- coding: utf-8 -*-
"""
手机版调试服务器 —— 在电脑浏览器里直接跑 Android 端 H5 页面。

用法：
    .venv\\Scripts\\python.exe tools\\mobile-dev-server.py            # 默认 8100 端口
    .venv\\Scripts\\python.exe tools\\mobile-dev-server.py --port 8101
    .venv\\Scripts\\python.exe tools\\mobile-dev-server.py --lan      # 允许局域网访问（手机也能连）
    .venv\\Scripts\\python.exe tools\\mobile-dev-server.py --proxy    # 顺带代理后端 API（见下）
    .venv\\Scripts\\python.exe tools\\mobile-dev-server.py --backend http://localhost:8000

特性：
  * 直接托管 android-app/app/src/main/assets/web/（改完刷新即见，无需打 APK）
  * 提供 /dev-mock-backup.json → 从数据库导出的「手机版备份格式」测试数据
  * 注入 ocDev 数据工具，控制台里可 load / seed / stats / reset
  * 注入 dev 探针（可开关），在页面上显示原生桥的降级状态
  * --proxy：把 /api/**、/images/** 转发到后端，
    于是页面里填的服务器地址可以直接写 http://localhost:8100 ——
    同源，不用管 CORS，也不用为了同步再开一个端口。
  * 关闭：Ctrl+C

⚠️ 与真机的差异（降级路径）：
  * window.Android 不存在 → 图片存入走 data URL、自动备份不可用、
    img:// 引用无法解析（会显示占位）。
  这些属预期行为，判断「是不是 bug」时先排除。
"""
import argparse
import http.server
import json
import os
import socketserver
import sys
import time
import urllib.error
import urllib.request

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.abspath(os.path.join(TOOLS_DIR, '..',
                                       'android-app', 'app', 'src', 'main', 'assets', 'web'))
MOCK_PATH = os.path.abspath(os.path.join(TOOLS_DIR, '..',
                                         '.workbuddy', 'mock', 'mock-backup.json'))
DEV_TOOLS_PATH = os.path.join(TOOLS_DIR, 'mobile-dev-tools.js')

# --proxy 转发到后端的路径前缀
PROXY_PREFIXES = ('/api/', '/images/', '/static/')

DEV_TOOLS_TAG = '<script src="/mobile-dev-tools.js"></script>\n'

# 未开 --proxy 时，图片回退用这个基址直连后端（后端开了 CORS allow_origins=['*']，
# 但 <img> 不受 CORS 约束，所以照样能显示）。开了 --proxy 就用同源，留空。
DEV_BASE_FALLBACK = 'http://localhost:8000'

DEV_PROBE = r'''
<script>
(function () {
  window.__OC_DEV__ = true;
  // 只保留一个「轻提示条」，放在**顶部**右上角：底部留给 .bottom-nav 和 ocDev 面板，
  // 之前把徽标放 bottom:8px 正好压住导航栏，用户点不到。
  function badge() {
    var b = document.createElement('div');
    b.id = 'oc-dev-badge';
    b.style.cssText = 'position:fixed;right:8px;top:8px;z-index:2147482000;'
      + 'font:11px/1.5 system-ui,sans-serif;padding:4px 8px;border-radius:14px;'
      + 'background:rgba(250,238,218,.94);color:#633806;border:1px solid #EF9F27;'
      + 'max-width:56vw;pointer-events:auto;cursor:pointer;white-space:nowrap;'
      + 'overflow:hidden;text-overflow:ellipsis;opacity:.9;';
    var hasBridge = !!(window.Android && window.Android.saveImage);
    b.innerHTML = '<b>DEV</b> · 桥：' + (hasBridge ? '有' : '无')
      + ' · <span id="oc-dev-msg">点此重载</span>';
    b.title = '点击重新加载页面';
    b.onclick = function () { location.reload(); };
    document.body.appendChild(b);
  }
  function setMsg(text, color) {
    var m = document.getElementById('oc-dev-msg');
    if (m) { m.textContent = text; m.style.color = color || ''; }
  }
  window.addEventListener('error', function (e) {
    setMsg('JS 报错：' + (e.message || '').slice(0, 30), '#A32D2D');
  });
  window.addEventListener('unhandledrejection', function (e) {
    setMsg('Promise 异常：' + String(e.reason).slice(0, 30), '#A32D2D');
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', badge);
  } else { badge(); }
})();
</script>
'''


class Handler(http.server.SimpleHTTPRequestHandler):
    probe = True
    backend = None          # --proxy 时是后端基址，如 http://localhost:8000

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def end_headers(self):
        # 开发期禁用缓存，避免「改了没生效」
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    # ---------------- 反向代理：把 /api/**、/images/** 交给后端 ----------------
    def _proxy(self):
        url = self.backend.rstrip('/') + self.path
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(url, data=body, method=self.command)
        for h in ('Content-Type', 'Accept', 'Authorization'):
            v = self.headers.get(h)
            if v:
                req.add_header(h, v)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                status = resp.status
                ctype = resp.headers.get('Content-Type', 'application/octet-stream')
        except urllib.error.HTTPError as e:
            data = e.read()
            status = e.code
            ctype = e.headers.get('Content-Type', 'application/json')
        except Exception as e:                       # 后端没起来
            data = json.dumps({'detail': '代理失败: %s' % e}).encode('utf-8')
            status = 502
            ctype = 'application/json; charset=utf-8'
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?')[0]
        if self.backend and path.startswith(PROXY_PREFIXES):
            return self._proxy()
        if path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return
        if path == '/dev-mock-backup.json':
            return self._serve_file(MOCK_PATH, 'application/json; charset=utf-8',
                                    '还没有测试数据包，先运行：\n'
                                    '  .venv\\Scripts\\python.exe tools\\export-mock-backup.py')
        if path == '/mobile-dev-tools.js':
            return self._serve_file(DEV_TOOLS_PATH, 'application/javascript; charset=utf-8',
                                    '找不到 tools/mobile-dev-tools.js')
        if path in ('/', '/index.html'):
            try:
                with open(os.path.join(WEB_DIR, 'index.html'), encoding='utf-8') as f:
                    html = f.read()
            except OSError:
                self.send_error(404)
                return
            if self.probe:
                # ocDev 工具要在 app.js 之后加载：它只用 window 上的全局，DOM 就绪后自初始化。
                # BASE 用于图片回退：--proxy 时同源（留空），否则直指后端并依赖 CORS。
                base = '' if self.backend else DEV_BASE_FALLBACK
                inject = ('<script>window.__OC_DEV_BASE__=%s;</script>\n' % json.dumps(base)
                          + DEV_TOOLS_TAG + DEV_PROBE)
                if '</body>' in html:
                    html = html.replace('</body>', inject + '</body>', 1)
                else:
                    html += inject
            body = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        if self.backend and self.path.split('?')[0].startswith(PROXY_PREFIXES):
            return self._proxy()
        self.send_error(405)

    def do_PUT(self):
        if self.backend and self.path.split('?')[0].startswith(PROXY_PREFIXES):
            return self._proxy()
        self.send_error(405)

    def do_DELETE(self):
        if self.backend and self.path.split('?')[0].startswith(PROXY_PREFIXES):
            return self._proxy()
        self.send_error(405)

    def do_HEAD(self):
        if self.backend and self.path.split('?')[0].startswith(PROXY_PREFIXES):
            return self._proxy()
        return super().do_HEAD()

    def _serve_file(self, path, ctype, hint):
        if not os.path.isfile(path):
            body = ('%s\n' % hint).encode('utf-8')
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        with open(path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        msg = fmt % args
        if ' 200 ' in msg or ' 304 ' in msg:
            return                     # 静默成功请求，只报异常
        sys.stderr.write('[dev] %s\n' % msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8100)
    ap.add_argument('--lan', action='store_true', help='允许局域网访问（0.0.0.0）')
    ap.add_argument('--no-probe', action='store_true', help='不注入 dev 探针与 ocDev 工具')
    ap.add_argument('--proxy', action='store_true',
                    help='把 /api/**、/images/** 转发到 --backend（默认 http://localhost:8000）')
    ap.add_argument('--backend', default='http://localhost:8000',
                    help='后端地址，配合 --proxy 使用')
    args = ap.parse_args()

    if not os.path.isdir(WEB_DIR):
        sys.stderr.write('找不到手机版 web 目录：%s\n' % WEB_DIR)
        return 2

    Handler.probe = not args.no_probe
    Handler.backend = args.backend if args.proxy else None
    host = '0.0.0.0' if args.lan else '127.0.0.1'

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((host, args.port), Handler) as httpd:
        url_host = 'localhost' if not args.lan else '<本机IP>'
        print('=' * 60)
        print('  手机版调试服务器已启动')
        print('=' * 60)
        print('  目录 : %s' % WEB_DIR)
        print('  地址 : http://%s:%d' % (url_host, args.port))
        print('  提示 : 浏览器按 F12 → 切换设备模拟（iPhone/Android）看手机布局')
        print('         Ctrl+Shift+M 快速切设备模式')
        if os.path.isfile(MOCK_PATH):
            print('  测试数据 : /dev-mock-backup.json (%.1f KB)'
                  % (os.path.getsize(MOCK_PATH) / 1024))
            print('             控制台里执行 await ocDev.load() 即可灌入')
        else:
            print('  测试数据 : 尚未生成 —— 先跑 tools/export-mock-backup.py')
        if Handler.backend:
            print('  API 代理 : %s  （同步弹窗里服务器地址填 http://localhost:%d）'
                  % (Handler.backend, args.port))
        print('  ⚠️   无原生桥，图片存储/自动备份走降级路径，属预期')
        print('  停止 : Ctrl+C')
        print('=' * 60)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已停止。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
