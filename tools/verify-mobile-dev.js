// 用 CDP 驱动真实 Chrome 验证手机版页面在电脑浏览器里能跑
// 注意：Node 内置 WebSocket 用 addEventListener，不是 .on()
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));

if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(1); }
console.log('浏览器:', CHROME);

const PORT = 9333;
const userDir = path.join(os.tmpdir(), 'oc-dev-chrome-' + Date.now());

const child = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + userDir,
  '--no-first-run', '--no-default-browser-check',
  '--no-proxy-server',
  '--headless=new',
  '--disable-gpu',
  'about:blank',
], { detached: true, stdio: 'ignore' });
child.unref();

function get(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej);
  });
}

async function waitTargets(n = 15) {
  for (let i = 0; i < n; i++) {
    try {
      const list = JSON.parse(await get('/json/list'));
      const t = list.find(x => x.type === 'page');
      if (t && t.webSocketDebuggerUrl) return t;
    } catch (e) { }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('拿不到调试目标');
}

(async () => {
  const target = await waitTargets();
  console.log('目标:', target.webSocketDebuggerUrl);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];

  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[' + m.params.type + '] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description
        || m.params.exceptionDetails.text));
    }
  });

  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await new Promise(r => ws.addEventListener('open', r));

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  // 手机视口
  await send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 932, deviceScaleFactor: 2, mobile: true,
  });

  await send('Page.navigate', { url: 'http://127.0.0.1:8100/?cb=' + Date.now() });
  await new Promise(r => setTimeout(r, 3500));

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'ERR: ' + r.result.exceptionDetails.text;
    return r.result?.result?.value;
  };

  console.log('\n===== 页面状态 =====');
  console.log('URL        :', await ev('location.pathname + location.search'));
  console.log('标题       :', await ev('document.title'));
  console.log('探针已注入 :', await ev('!!window.__OC_DEV__'));
  console.log('原生桥     :', await ev('!!(window.Android && window.Android.saveImage)'));
  console.log('DEV 徽标   :', await ev('!!document.getElementById("oc-dev-badge")'));
  console.log('DB 已就绪  :', await ev('typeof db !== "undefined" && typeof charDB !== "undefined"'));
  console.log('视图容器数 :', await ev('document.querySelectorAll("[id^=view-]").length'));
  console.log('可见视图   :', await ev('(document.querySelector(".view:not([style*=\\"none\\"])")||{}).id '
    + '|| (function(){var v=document.querySelectorAll("[id^=view-]");for(var i=0;i<v.length;i++){if(getComputedStyle(v[i]).display!=="none")return v[i].id;}return "无";})()'));

  console.log('\n===== 写入并读取（IndexedDB 通路）=====');
  const writeRead = await ev(`(async function(){
    try {
      var id = await charDB.create({name:'__devtest__', university:'测试大学', setting:'probe'});
      var all = await charDB.list('');
      var found = all.filter(function(c){return c.id === id;}).length;
      // 清理
      var del = await charDB.delete ? true : false;
      if (charDB.delete) await charDB.delete(id);
      var after = (await charDB.list('')).filter(function(c){return c.id === id;}).length;
      return 'create=ok id=' + id + ' 读到=' + found + ' 删除后=' + after;
    } catch (e) { return 'ERR: ' + e.message; }
  })()`);
  console.log('结果       :', writeRead);

  console.log('\n===== 控制台输出 =====');
  if (!logs.length) console.log('  （无 console 输出）');
  logs.slice(0, 25).forEach(l => console.log('  ' + l));

  // 截图
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) {
    const out = path.join(__dirname, 'dev-shot.png');
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('\n截图:', out);
  } else {
    console.log('\n截图失败');
  }

  await ev('true');
  ws.close();
  try { process.kill(-child.pid); } catch (e) { }
  try { child.kill(); } catch (e) { }
  setTimeout(() => process.exit(0), 500);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
