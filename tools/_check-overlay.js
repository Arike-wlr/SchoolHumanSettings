/**
 * 专项检查：底部导航**可见**时，两个 DEV 浮层是否压住它。
 * 顺带截图，肉眼复核。
 *
 * 用法：node tools/_check-overlay.js
 */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8100';
const DEBUG_PORT = 9356;
const PROFILE = path.join(os.tmpdir(), 'oc-overlay-' + Date.now());
const SHOT = path.join(__dirname, '..', '.workbuddy', 'tmp_scan', 'overlay-check.png');

const CAND = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function findBrowser() { for (const p of CAND) if (fs.existsSync(p)) return p; throw new Error('no browser'); }
function get(url) {
  return new Promise((res, rej) => {
    http.get(url, { setHost: false }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); }
  static async attach(u) {
    // ⚠️ Chrome 有时返回 ws:///devtools/page/xxx（host 为空，扩展先加载时尤其常见）
    //    Node 的 WebSocket 解析不了，会报 "non-101 status code"。手动补上 host。
    //    ⚠️ 替换要连最后一个斜杠一起吃掉（/\/\/\//），只替 // 会得到 ...:port//devtools 双斜杠，照样连不上。
    if (/^wss?:\/\/\//.test(u)) u = u.replace(/^(wss?):\/\/\//, '$1://127.0.0.1:' + DEBUG_PORT + '/');
    const ws = new WebSocket(u);
    await new Promise((a, b) => { ws.addEventListener('open', a, { once: true }); ws.addEventListener('error', b, { once: true }); });
    const c = new CDP(ws);
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && c.p.has(m.id)) { c.p.get(m.id)(m); c.p.delete(m.id); } });
    return c;
  }
  send(m, p = {}) {
    const id = ++this.id;
    return new Promise((a, b) => { this.p.set(id, x => x.error ? b(new Error(x.error.message)) : a(x.result)); this.ws.send(JSON.stringify({ id, method: m, params: p })); });
  }
  async eval(e, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

(async () => {
  const proc = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-component-extensions-with-background-pages',
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let list = null;
    for (let i = 0; i < 40; i++) { try { list = await get(`http://127.0.0.1:${DEBUG_PORT}/json/list`); break; } catch { await sleep(250); } }
    if (!list) throw new Error('调试端口没起来');
    // 优先挑 about:blank 的那个 page（别挑到扩展的 background_page）
    const arr = JSON.parse(list).filter(x => x.type === 'page');
    const t = arr.find(x => x.url === 'about:blank') || arr[0];
    if (!t) throw new Error('没有可用 page 目标');
    const cdp = await CDP.attach(t.webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });

    await cdp.send('Page.navigate', { url: BASE + '/index.html?cb=' + Date.now() });
    await sleep(4000);

    // 切到 index 视图 —— 首页才显示底部导航、且卡片有数据
    await cdp.eval('navigateTo("index")');
    await sleep(2500);
    // 展开面板，让 panel 也参与检测
    await cdp.eval('document.getElementById("oc-dev-dock-knob").click()');
    await sleep(400);

    const geom = await cdp.eval(`(function(){
      function R(id){ var e=document.getElementById(id); if(!e) return null;
        var s=getComputedStyle(e); if(s.display==='none'||s.visibility==='hidden') return {hidden:true};
        var r=e.getBoundingClientRect();
        return {left:Math.round(r.left),top:Math.round(r.top),right:Math.round(r.right),bottom:Math.round(r.bottom),h:Math.round(r.height)}; }
      function I(a,b){ if(!a||!b||a.hidden||b.hidden) return null;
        return a.left<b.right && b.left<a.right && a.top<b.bottom && b.top<a.bottom; }
      var nav=R('bottomNav');
      return JSON.stringify({
        nav: nav,
        knob: R('oc-dev-dock-knob'),
        panel: R('oc-dev-dock-panel'),
        badge: R('oc-dev-badge'),
        knobHitsNav: I(R('oc-dev-dock-knob'), nav),
        panelHitsNav: I(R('oc-dev-dock-panel'), nav),
        badgeHitsNav: I(R('oc-dev-badge'), nav),
      });
    })()`);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));

    console.log('============ 浮层遮挡专项检查 ============');
    console.log(JSON.stringify(JSON.parse(geom), null, 2));
    console.log('截图:', SHOT);
    const g = JSON.parse(geom);
    // knob 在面板展开时是 display:none（几何取不到 → null），null 不算遮挡。
    // 真正的失败只有「明确算出相交 === true」。
    const hits = [g.knobHitsNav, g.panelHitsNav, g.badgeHitsNav];
    const ok = g.nav && g.nav.h > 0 && !hits.some(h => h === true);
    console.log('结论:', ok ? '无遮挡 ✅' : '仍有重叠 ❌');
    process.exitCode = ok ? 0 : 1;
    try { cdp.ws.close(); } catch {}
  } finally {
    try { proc.kill(); } catch {}
    await sleep(300);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  }
})().catch(e => { console.error('出错:', e.message); process.exitCode = 2; });
