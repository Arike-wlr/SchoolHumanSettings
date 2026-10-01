/**
 * 无头 Chrome 端到端验证：ocDev 灌数据 → 页面渲染。
 *
 * 用法：node tools/verify-mock-data.js
 *   （需要先启动 tools/mobile-dev-server.py --port 8100 --proxy）
 */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PORT = 8100;
const BASE = `http://localhost:${PORT}`;
const PROFILE = path.join(os.tmpdir(), 'oc-dev-verify-' + Date.now());

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function findBrowser() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Chrome/Edge');
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { setHost: false }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search,
      method: opts.method || 'GET',
    }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = []; }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = new CDP(ws);
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) { c.pending.get(m.id)(m); c.pending.delete(m.id); }
      if (m.method === 'Runtime.consoleAPICalled') {
        c.logs.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        c.logs.push('EXCEPTION: ' + (m.params.exceptionDetails.text || ''));
      }
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) throw new Error('eval 异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

(async () => {
  const browser = findBrowser();
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=9333`, `--user-data-dir=${PROFILE}`,
    '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    // 等调试端口
    let list = null;
    for (let i = 0; i < 40; i++) {
      try { list = await httpGet('http://127.0.0.1:9333/json/list'); break; } catch (e) { await sleep(250); }
    }
    if (!list) throw new Error('Chrome 调试端口没起来');
    const target = JSON.parse(list.body).find(t => t.type === 'page');
    const cdp = await CDP.attach(target.webSocketDebuggerUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430, height: 932, deviceScaleFactor: 2, mobile: true,
    });

    const NAV = BASE + '/index.html?cb=' + Date.now();
    await cdp.send('Page.navigate', { url: NAV });
    await sleep(3500);

    const out = {};

    // --- 1. ocDev 是否就绪 ---
    out.ocDevReady = await cdp.eval('typeof ocDev');
    out.ocDevApi = await cdp.eval('Object.keys(ocDev || {}).join(",")');
    out.probeInjected = await cdp.eval('window.__OC_DEV__ === true');
    out.hasBridge = await cdp.eval('!!(window.Android && window.Android.saveImage)');

    // --- 2. 自动灌数据：页面打开就该有数据，不用手敲 load() ---
    out.autoFilled = await cdp.eval('(async()=>JSON.stringify((await ocDev.stats()).local))()');

    // --- 2b. 浮标遮挡检查：两个 DEV 浮层都不得与底部导航相交 ---
    // ⚠️ 底部导航只在进入具体视图后才显示（home 视图是 display:none，量到 navH=0，
    //    这种「没量到」不算通过）。所以先切到 index 再看。
    await cdp.eval('navigateTo("index")');
    await sleep(1500);
    out.overlayGeom = await cdp.eval(`(function(){
      function rect(id){ var e=document.getElementById(id); if(!e) return null;
        var s=getComputedStyle(e); if(s.display==='none'||s.visibility==='hidden') return null;
        var r=e.getBoundingClientRect();
        return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,h:Math.round(r.height)}; }
      function inter(a,b){ if(!a||!b) return null;
        return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; }
      var nav = rect('bottomNav');
      var out = { navH: nav ? nav.h : 0 };
      // 面板展开态也一起测：knob 会被隐藏，null 不算遮挡
      var p = document.getElementById('oc-dev-dock-panel'); if (p) p.style.display = 'block';
      var k = document.getElementById('oc-dev-dock-knob'); if (k) k.style.display = 'none';
      out.knobOverlapsNav = inter(rect('oc-dev-dock-knob'), nav);
      out.panelOverlapsNav = inter(rect('oc-dev-dock-panel'), nav);
      out.badgeOverlapsNav = inter(rect('oc-dev-badge'), nav);
      return JSON.stringify(out);
    })()`);

    // --- 3. 真正 load 一份服务器导出包（覆盖自动灌入的那份，验证可重复灌） ---
    out.loadMsg = await cdp.eval('(async () => { try { return await ocDev.load(); } catch (e) { return "ERR: " + e.message; } })()');

    // --- 4. 灌数据后：条数 ---
    out.afterLocal = await cdp.eval('(async()=>JSON.stringify((await ocDev.stats()).local))()');

    // --- 5. 页面是否真的渲染出来了 ---
    // ⚠️ 冷启动停在 home 视图，#charGrid 是空的 —— 必须先切到 index 才有卡片。
    //    这不是 bug：各视图进入时才拉数据。
    await cdp.eval('navigateTo("index")');
    await sleep(2000);
    out.charCards = await cdp.eval(`document.querySelectorAll('#charGrid .card').length`);
    out.gridInnerHTMLLen = await cdp.eval(`(document.getElementById('charGrid')||{}).innerHTML?.length || 0`);
    out.firstCardName = await cdp.eval(`(document.querySelector('#charGrid .card .card-name')||{}).textContent?.trim().slice(0,12) || '(取不到)'`);
    out.gridCols = await cdp.eval(`getComputedStyle(document.getElementById('charGrid')).gridTemplateColumns.split(' ').length`);

    // --- 6. 真机差异确认：图片引用降级 ---
    out.firstImageSrc = await cdp.eval(`(function(){
      var c = document.querySelector('#charGrid .card');
      var im = c && c.querySelector('img');
      return im ? (im.getAttribute('src')||'').slice(0,70) : '(无 img 元素)';
    })()`);

    // --- 7. seed 最小样本（换一批数据，验证可重复灌） ---
    await cdp.eval('ocDev.seed()');
    await sleep(1200);
    await cdp.eval('navigateTo("index")');
    await sleep(1500);
    out.afterSeedCards = await cdp.eval(`document.querySelectorAll('#charGrid .card').length`);

    // --- 8. reset 清空 ---
    await cdp.eval('ocDev.reset(true)');
    await sleep(800);
    out.afterReset = await cdp.eval('(async()=>JSON.stringify((await ocDev.stats()).local))()');
    await cdp.eval('navigateTo("index")');
    await sleep(1200);
    out.afterResetCards = await cdp.eval(`document.querySelectorAll('#charGrid .card').length`);

    // --- 9. 控制台噪音 ---
    const bad = cdp.logs.filter(l => /EXCEPTION|Uncaught|Failed to|ERR:/.test(l));
    out.consoleErrors = bad.slice(0, 8);
    out.consoleTotal = cdp.logs.length;

    console.log('================ ocDev 端到端验证 ================');
    for (const [k, v] of Object.entries(out)) {
      if (k === 'consoleErrors' || k === 'overlayGeom') continue;
      console.log(`  ${k.padEnd(18)} ${v}`);
    }
    console.log('  overlayGeom        ' + out.overlayGeom);
    console.log('  consoleErrors      ', out.consoleErrors.length ? out.consoleErrors : '无 ✅');

    // 判定
    const geom = JSON.parse(out.overlayGeom);
    const hits = [geom.knobOverlapsNav, geom.panelOverlapsNav, geom.badgeOverlapsNav];
    const pass =
      out.ocDevReady === 'object' &&
      out.probeInjected === true &&
      out.hasBridge === false &&
      // 打开即有数据（自动灌入生效）
      parseInt(out.autoFilled.match(/"characters":(\d+)/)[1]) === 82 &&
      // 底部导航确实可见（不然遮挡检查是空转），且三个浮层都不压它
      geom.navH > 0 &&
      !hits.some(h => h === true) &&
      /ERR/.test(out.loadMsg) === false &&
      parseInt(out.afterLocal.match(/"characters":(\d+)/)[1]) === 82 &&
      out.charCards > 0 &&
      out.afterSeedCards === 20 &&
      parseInt(out.afterReset.match(/"characters":(\d+)/)[1]) === 0 &&
      out.afterResetCards === 0 &&
      out.consoleErrors.length === 0;
    console.log('  ------------------------------------------------');
    console.log('  结论:', pass ? '全部通过 ✅' : '有断言未通过 ❌');
    process.exitCode = pass ? 0 : 1;

    try { cdp.ws.close(); } catch (e) {}
  } finally {
    try { proc.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
})().catch(e => { console.error('验证脚本出错:', e.message); process.exitCode = 2; });
