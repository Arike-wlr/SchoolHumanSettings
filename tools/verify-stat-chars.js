/**
 * 统计口径两路验证 —— JS 侧：node:vm 加载 api-shim.js，喂 mock DB，调 computeStats()。
 * 与 Python 侧 tools/_verify-stat-chars.py 写出的 py_stats.json 逐项比对。
 *
 * 用法：
 *   1) .venv\Scripts\python.exe tools\_verify-stat-chars.py     （先生成 py_stats.json）
 *   2) node tools/_verify-stat-chars.js
 *
 * ⚠️ vm 里没有 Blob / window，要补桩（api-shim.js 顶层 `const _originalFetch = window.fetch`）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SHIM = path.join(ROOT, 'android-app', 'app', 'src', 'main', 'assets', 'web', 'api-shim.js');
const MOCK = path.join(ROOT, '.workbuddy', 'mock', 'mock-backup.json');
const PY = path.join(ROOT, '.workbuddy', 'tmp_scan', 'py_stats.json');

const mock = JSON.parse(fs.readFileSync(MOCK, 'utf8'));
const src = fs.readFileSync(SHIM, 'utf8');

// --- 最小桩：api-shim.js 顶层只需 window.fetch；Blob 只在响应构造时用 ---
const sandbox = {
  console,
  JSON, Math, Array, Object, String, Number, Boolean, Date, RegExp, Error, Promise, Map, Set,
  setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
  Uint8Array, TextEncoder,
  Blob: class Blob { constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; } },
  window: {},
  // 假 DB：形状与 db.js 暴露的 store 一致
  charDB: { list: async () => mock.characters || [] },
  worldDB: { list: async () => mock.worldBuildings || [] },
  relDB: { list: async () => mock.relations || [] },
  docDB: { list: async () => [] },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'api-shim.js' });

(async () => {
  const stats = await vm.runInContext('computeStats()', sandbox);

  const hl = stats.highlights;
  const js = {
    total_setting_chars: hl.total_setting_chars,
    longest_setting: hl.items.longest_setting,
    setting_distribution: hl.setting_distribution,
    regions: (stats.regions || []).map(r => ({ name: r.name, avg_setting: r.avg_setting })),
    char_total: stats.characters.total,
  };

  // 顺带确认新口径函数本身与后端字段清单一致
  const fieldList = vm.runInContext('STATS_CHAR_TEXT_FIELDS.join(",")', sandbox);

  console.log('=== JS 侧（api-shim computeStats）===');
  console.log('  字段清单          ', fieldList);
  console.log('  角色数            ', js.char_total);
  console.log('  全字段总字数      ', js.total_setting_chars);
  console.log('  最厚 Top5         ', js.longest_setting.slice(0, 5).map(x => [x.name, x.value]));
  console.log('  篇幅分布          ', js.setting_distribution.map(d => [d.name, d.count]));
  console.log('  地区设定厚度      ', js.regions.slice(0, 6).map(r => [r.name, r.avg_setting]));

  if (!fs.existsSync(PY)) {
    console.log('\n⚠️ 找不到 py_stats.json，先跑 tools/_verify-stat-chars.py');
    process.exitCode = 2;
    return;
  }
  const py = JSON.parse(fs.readFileSync(PY, 'utf8'));

  // --- 逐项比对 ---
  const problems = [];
  if (js.char_total !== py.char_total) problems.push(`char_total: js=${js.char_total} py=${py.char_total}`);
  if (js.total_setting_chars !== py.total_setting_chars)
    problems.push(`total_setting_chars: js=${js.total_setting_chars} py=${py.total_setting_chars}`);

  const jd = js.setting_distribution.map(d => `${d.name}=${d.count}`).join('|');
  const pd = py.setting_distribution.map(d => `${d.name}=${d.count}`).join('|');
  if (jd !== pd) problems.push(`setting_distribution: js[${jd}] py[${pd}]`);

  const jl = js.longest_setting.map(x => `${x.name}:${x.value}`).join('|');
  const pl = py.longest_setting.map(x => `${x.name}:${x.value}`).join('|');
  if (jl !== pl) problems.push(`longest_setting 顺序/取值不一致:\n    js ${jl}\n    py ${pl}`);

  const jr = js.regions.map(r => `${r.name}:${r.avg_setting}`).join('|');
  const pr = py.regions.map(r => `${r.name}:${r.avg_setting}`).join('|');
  if (jr !== pr) problems.push(`regions.avg_setting 不一致:\n    js ${jr}\n    py ${pr}`);

  console.log('\n================ 两路一致性 ================');
  if (problems.length === 0) {
    console.log('全部一致 ✅');
  } else {
    console.log('不一致 ❌');
    problems.forEach(p => console.log('  - ' + p));
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
})().catch(e => { console.error('出错:', e && e.stack || e); process.exitCode = 2; });
