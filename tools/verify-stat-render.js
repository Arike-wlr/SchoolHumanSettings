/**
 * 统计「全字段字数」改动 —— 页面渲染验证。
 *   1) 桌面版 stats.html（后端 :8000）：新标签出现、总字数与 Python 侧一致、无控制台报错
 *   2) 手机版统计视图（调试服务器 :8100）：同样检查
 *
 * 用法：node tools/verify-stat-render.js
 * 前置：先跑 tools/verify-stat-chars.py（期望总字数从它产出的 py_stats.json 读，
 *       不写死 —— 否则用户一改内容这个脚本就误报失败）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT_DBG = 9369;
const PROFILE = path.join(os.tmpdir(), 'statrender-' + Date.now());
const OUTDIR = path.join(__dirname, '..', '.workbuddy', 'tmp_scan');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 期望值来源：Python 侧写出的 py_stats.json（页面用 toLocaleString()，同样是逗号分组）
let EXPECT_TOTAL = null;
try {
  const t = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'py_stats.json'), 'utf8')).total_setting_chars;
  EXPECT_TOTAL = t.toLocaleString('en-US');
} catch (e) { /* 下面会提示 */ }

// ⚠️ 要塞进「浏览器侧」脚本的东西必须在 Node 侧先算成字符串。
//    浏览器脚本体是 cdp.eval(`...`) 的模板字符串，只有 ${} 里的内容会被 Node 求值，
//    裸写变量名会被原样发到浏览器 → ReferenceError: xxx is not defined。
const EXPECT_JS = EXPECT_TOTAL === null ? 'null' : `has(${JSON.stringify(EXPECT_TOTAL)})`;

function get(u) {
  return new Promise((res, rej) => {
    http.get(u, { setHost: false }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); this.logs = []; }
  static async attach(u) {
    if (/^wss?:\/\/\//.test(u)) u = u.replace(/^(wss?):\/\/\//, '$1://127.0.0.1:' + PORT_DBG + '/');
    const ws = new WebSocket(u);
    await new Promise((a, b) => { ws.addEventListener('open', a, { once: true }); ws.addEventListener('error', b, { once: true }); });
    const c = new CDP(ws);
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && c.p.has(m.id)) { c.p.get(m.id)(m); c.p.delete(m.id); }
      if (m.method === 'Runtime.consoleAPICalled') {
        const lvl = m.params.type;
        const txt = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
        c.logs.push({ lvl, txt });
      }
      if (m.method === 'Runtime.exceptionThrown') {
        c.logs.push({ lvl: 'exception', txt: m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '') });
      }
    });
    return c;
  }
  send(m, p = {}) { const id = ++this.id; return new Promise((a, b) => { this.p.set(id, x => x.error ? b(new Error(x.error.message)) : a(x.result)); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async eval(e, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

(async () => {
  const b = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  const proc = spawn(b, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `--remote-debugging-port=${PORT_DBG}`, `--user-data-dir=${PROFILE}`,
    '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
  let failed = 0;
  try {
    let raw = null;
    for (let i = 0; i < 40; i++) { try { raw = await get(`http://127.0.0.1:${PORT_DBG}/json/list`); break; } catch { await sleep(250); } }
    const arr = JSON.parse(raw).filter(x => x.type === 'page');
    const cdp = await CDP.attach((arr.find(x => x.url === 'about:blank') || arr[0]).webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    // ---------------- 1) 桌面版 ----------------
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: 'http://localhost:8000/static/stats.html?cb=' + Date.now() });
    await sleep(4500);

    const desk = await cdp.eval(`(function(){
      var body = document.body.innerText || '';
      function has(s){ return body.indexOf(s) !== -1; }
      return JSON.stringify({
        renderedLen: body.length,
        hasAllFieldsLabel: has('全字段字数'),
        hasAvgAll: has('人均全字段字数'),
        hasTotalAll: has('角色全字段总字数'),
        hasOldSettingLabel: has('setting 字数'),
        hasOldAvgLabel: has('人均 setting 字数'),
        hasOldTotal: has('角色设定总字数'),
        hasExpectTotal: ${EXPECT_JS},
        hint: (body.match(/全字段[\\s\\S]{0,40}/) || [''])[0].replace(/\\s+/g,' '),
      });
    })()`);
    console.log('=== 桌面版 stats.html ===');
    console.log('  ' + desk);
    const d = JSON.parse(desk);
    if (!d.hasAllFieldsLabel || !d.hasAvgAll || !d.hasTotalAll) { console.log('  ❌ 新标签缺失'); failed++; }
    if (d.hasOldSettingLabel || d.hasOldAvgLabel || d.hasOldTotal) { console.log('  ❌ 旧标签残留'); failed++; }
    if (EXPECT_TOTAL === null) { console.log('  ⚠️ 跳过「总字数」断言（先跑 tools/verify-stat-chars.py）'); }
    else if (!d.hasExpectTotal) { console.log(`  ❌ 页面未出现期望总字数 ${EXPECT_TOTAL}`); failed++; }

    // ---------------- 2) 手机版 ----------------
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: 'http://localhost:8100/index.html?cb=' + Date.now() });
    await sleep(4500);
    await cdp.eval('navigateTo("stats")');
    await sleep(3000);

    const mob = await cdp.eval(`(function(){
      var v = document.getElementById('view-stats');
      var body = v ? (v.innerText || '') : '';
      function has(s){ return body.indexOf(s) !== -1; }
      return JSON.stringify({
        renderedLen: body.length,
        hasAllFieldsLabel: has('全字段字数'),
        hasAvgAll: has('人均全字段字数'),
        hasTotalAll: has('角色全字段总字数'),
        hasOldSettingLabel: has('setting 字数'),
        hasOldAvgLabel: has('人均 setting 字数'),
        hasOldTotal: has('角色设定总字数'),
        hasExpectTotal: ${EXPECT_JS},
        // ⚠️ 手机版榜单的类名是 .stats-crown-row（不是桌面版的 .crown-body）
        crowns: document.querySelectorAll('#view-stats .stats-crown-row').length,
      });
    })()`);
    console.log('\n=== 手机版统计视图 ===');
    console.log('  ' + mob);
    const m = JSON.parse(mob);
    if (!m.hasAllFieldsLabel || !m.hasAvgAll || !m.hasTotalAll) { console.log('  ❌ 新标签缺失'); failed++; }
    if (m.hasOldSettingLabel || m.hasOldAvgLabel || m.hasOldTotal) { console.log('  ❌ 旧标签残留'); failed++; }
    if (EXPECT_TOTAL === null) { console.log('  ⚠️ 跳过「总字数」断言（先跑 tools/verify-stat-chars.py）'); }
    else if (!m.hasExpectTotal) { console.log(`  ❌ 页面未出现期望总字数 ${EXPECT_TOTAL}`); failed++; }
    if (m.crowns < 1) { console.log('  ❌ 榜单未渲染（选择器：.stats-crown-row）'); failed++; }

    // ---------------- 控制台噪音 ----------------
    const bad = cdp.logs.filter(l => l.lvl === 'exception' || /Uncaught|Failed to|SyntaxError/.test(l.txt || ''));
    console.log('\n=== 控制台 ===');
    console.log('  报错:', bad.length ? bad.slice(0, 5) : '无 ✅');
    if (bad.length) failed++;

    fs.mkdirSync(OUTDIR, { recursive: true });
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUTDIR, 'stat-render-mobile.png'), Buffer.from(s.data, 'base64'));

    console.log('\n结论:', failed ? `有 ${failed} 项未通过 ❌` : '全部通过 ✅');
    process.exitCode = failed ? 1 : 0;
    try { cdp.ws.close(); } catch {}
  } finally {
    try { proc.kill(); } catch {}
    await sleep(300);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  }
})().catch(e => { console.error('出错:', e && e.message || e); process.exitCode = 2; });
