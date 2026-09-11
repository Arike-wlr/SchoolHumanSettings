// P06 gate：隔离验证"轻量读取投影"（D006 / CONTRACT revision 9）。
//
// 覆盖 Gate ①–⑦：
//   ① 稳态字节：?projection=list 较全量下载 ≥95%；?projection=names 不含图片数据且 <全量 1%
//   ② 等价：投影文本字段与完整记录逐字段一致；图数徽标一致；卡片 HTML 与全量路径逐字相同
//   ③ 维护：POST/PUT/DELETE/reorder/updateThumb/bulkSet/clear 之后投影与源记录重建结果一致
//   ④ 并发：迟到的自愈写入不得覆盖并发写入产生的新投影
//   ⑤ 自愈：清空/缺失投影后列表仍与基线一致、不重写 characters、needsOriginal 回退原图
//   ⑥ 非阻塞：缺投影补齐分批让出主线程；app.js 首屏只发一次请求、无额外等待
//   ⑦ 泄漏：投影与 thumbs 不进导出/备份/上传 payload
// 另：单独测量并报告"升级后首次加载（尚无 thumbs）"的一次性过渡成本。
//
// 环境：真 db.js + 真 api-shim.js + 假 IndexedDB（含 characterLite 与 getAllKeys）。
// 不触碰真实 server / 数据库 / 浏览器 / 设备，也不执行真实同步或删除。
// 限制（如实标注）：所有数字均为 Node 隔离口径，不等于实机；真实 WebView 解码/持久化/耗时 = UNVERIFIED。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const WEB = path.join(root, 'android-app/app/src/main/assets/web');
const APP = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
const DB = fs.readFileSync(path.join(WEB, 'db.js'), 'utf8');
const SHIM = fs.readFileSync(path.join(WEB, 'api-shim.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(WEB, 'sync.js'), 'utf8');

// ---------------------------------------------------------------- 源码切片
// 按名字提取函数体（跳过字符串、注释与正则字面量；同 p05 的健壮实现）。
const REGEX_PREV = '(,=:[!&|?{};+-*%^~<>';
const REGEX_KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void',
  'instanceof', 'new', 'do', 'else', 'yield', 'await'];
function extractFunction(src, name) {
  const marker = 'function ' + name + '(';
  let start = src.indexOf(marker);
  assert.ok(start >= 0, '未找到函数: ' + name);
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  let i = src.indexOf('{', start);
  assert.ok(i > 0, name + ' 缺少函数体');
  let depth = 0, quote = null, inLine = false, inBlock = false, inRegex = false, prev = '';
  for (; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i++; } continue; }
    if (inRegex) {
      if (ch === '\\') { i++; continue; }
      if (ch === '/') inRegex = false;
      continue;
    }
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    if (ch === '/') {
      const word = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, i - 12), i));
      const kw = word ? word[1] : '';
      if (REGEX_PREV.indexOf(prev) !== -1 || REGEX_KEYWORDS.indexOf(kw) !== -1) inRegex = true;
      prev = '/';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; prev = ch; continue; }
    if (ch === '{') { depth++; prev = ch; continue; }
    if (ch === '}') { depth--; prev = ch; if (depth === 0) return src.slice(start, i + 1); continue; }
    if (!/\s/.test(ch)) prev = ch;
  }
  throw new Error('花括号不平衡: ' + name);
}

// ---------------------------------------------------------------- 合成样本
// 与 server 样本同形：80 角色 / 17 有图（11×1、5×2、1×4）/ 25 张图。
const PNG_HEAD = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
// 样本尺度必须让"原图 >> 缩略图"的现实比例成立（真实服务器样本 ≈3.5 MiB/图、≈54 KB 缩略图），
// 否则"载荷下降 ≥95%"这一门槛失去意义（列表本来就必须携带缩略图）。
// 可用 P03_IMAGE_KB 覆盖（单位 KiB；下限 64 KiB）。
const IMAGE_BYTES = Math.max(64 * 1024, Number(process.env.P03_IMAGE_KB || 1024) * 1024);
const SAMPLE = 80, IMAGE_TOTAL = 25;
function dataUrlOfBytes(bytes, tag) {
  const body = Buffer.alloc(Math.max(0, bytes - PNG_HEAD.length), 0x5a);
  Buffer.from(String(tag || ''), 'utf8').copy(body, 0);
  return 'data:image/png;base64,' + Buffer.concat([PNG_HEAD, body]).toString('base64');
}
const FULL_IMAGES = Array.from({ length: IMAGE_TOTAL }, (_, i) => dataUrlOfBytes(IMAGE_BYTES, 'full' + i));
const THUMB_IMAGE = dataUrlOfBytes(40 * 1024, 'thumb');

function sampleCharacters() {
  const list = [];
  let img = 0;
  for (let i = 0; i < SAMPLE; i++) {
    const count = i < 11 ? 1 : (i < 16 ? 2 : (i === 16 ? 4 : 0));
    const images = [];
    for (let k = 0; k < count; k++) images.push(FULL_IMAGES[img++]);
    list.push({
      id: i + 1, name: '角色' + (i + 1), alias: '别名' + i, university: '高校' + (i % 7),
      region: '地区' + (i % 6), gender: (i % 2) ? '女' : '男', status: '存在',
      height: '16' + (i % 10), birthday: '01-0' + ((i % 9) + 1), setting: '设定文本'.repeat(6),
      appearance: '外貌' + (i + 1), identity_period: '', birth_time: '', naming_rationale: '',
      family: '家族' + (i % 8), sort_order: i, images, image_url: images[0] || '',
    });
  }
  return list;
}
function sampleRelations() {
  return Array.from({ length: 50 }, (_, i) => ({
    id: i + 1, from_char_id: (i % SAMPLE) + 1, to_char_id: ((i * 7 + 3) % SAMPLE) + 1,
    relation_type: ['CP', '朋友', '师生', '冤家', '亲属'][i % 5], description: '关系' + i, sort_order: i,
  }));
}

// ---------------------------------------------------------------- 假 IndexedDB
function makeIdb() {
  const stores = new Map();
  const counters = { getAll: {}, getAllKeys: {}, get: {}, put: {} };
  const bump = (kind, name) => { counters[kind][name] = (counters[kind][name] || 0) + 1; };
  const ensure = (name, keyPath) => {
    if (!stores.has(name)) stores.set(name, { keyPath: keyPath || 'id', rows: new Map() });
    return stores.get(name);
  };

  function open() {
    const req = {};
    setImmediate(() => {
      const db = {
        objectStoreNames: { contains: n => stores.has(n) },
        createObjectStore: (n, o) => { ensure(n, o.keyPath); return {}; },
        transaction: (nameOrNames) => {
          const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
          names.forEach(n => ensure(n, 'id'));
          const t = { oncomplete: null, onerror: null, onabort: null };
          // 真实 IDB 只在**事务内全部请求**结束后触发一次 complete；
          // 这里用 pending 计数模拟：请求的 onsuccess 里新建的请求也会被计入。
          let pending = 0;
          const finish = () => {
            if (pending !== 0) return;
            setImmediate(() => { if (t.oncomplete && pending === 0) t.oncomplete(); });
          };
          t.objectStore = (which) => {
            const name = which || names[0];
            const meta = stores.get(name);
            const rq = value => {
              const r = { result: value };
              pending++;
              setImmediate(() => {
                pending--;
                if (r.onsuccess) r.onsuccess();
                finish();
              });
              return r;
            };
            return {
              getAll: () => { bump('getAll', name); return rq([...meta.rows.values()].map(v => structuredClone(v))); },
              getAllKeys: () => { bump('getAllKeys', name); return rq([...meta.rows.keys()]); },
              get: key => { bump('get', name); const v = meta.rows.get(key); return rq(v === undefined ? undefined : structuredClone(v)); },
              put: value => { bump('put', name); meta.rows.set(value[meta.keyPath], structuredClone(value)); return rq(value[meta.keyPath]); },
              add: value => {
                bump('put', name);
                const key = value[meta.keyPath] != null ? value[meta.keyPath] : meta.rows.size + 1;
                value[meta.keyPath] = key;
                meta.rows.set(key, structuredClone(value));
                return rq(key);
              },
              delete: key => { meta.rows.delete(key); return rq(undefined); },
              clear: () => { meta.rows.clear(); return rq(undefined); },
            };
          };
          return t;
        },
      };
      req.result = db;
      if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  return {
    open, stores, counters,
    ensure,
    count: (kind, name) => counters[kind][name] || 0,
    reset() { for (const k of Object.keys(counters)) counters[k] = {}; },
    rows: name => ensure(name).rows,
    seed(name, keyPath, rows) {
      const meta = ensure(name, keyPath);
      rows.forEach(r => meta.rows.set(r[keyPath], structuredClone(r)));
      return meta.rows;
    },
  };
}

// ---------------------------------------------------------------- 隔离上下文（真 db.js + 真 api-shim.js）
function makeCtx(options) {
  const opts = options || {};
  const idb = makeIdb();
  const yields = { zeroTimeout: 0 };
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    window: { fetch: () => { throw new Error('不得调用真实 fetch'); }, addEventListener() {}, devicePixelRatio: 1 },
    document: { addEventListener() {}, visibilityState: 'visible' },
    navigator: { storage: { persist: async () => true } },
    localStorage: { getItem: () => '', setItem() {} },
    indexedDB: { open: idb.open },
    Headers, Response, Blob, URL, URLSearchParams, TextDecoder,
    structuredClone, atob, btoa,
    setTimeout: (fn, ms) => { if (!ms) yields.zeroTimeout++; return setTimeout(fn, ms); },
    clearTimeout, setImmediate,
    Promise, Set, Map, JSON, Date, RegExp, Object, Array, String, Number, Math, isFinite, Error,
    confirm: () => false, alert() {}, location: { reload() {} },
    FileReader: class { readAsDataURL() { if (this.onload) this.onload(); } },
  });
  vm.runInContext(DB, ctx);
  vm.runInContext(SHIM, ctx);
  vm.runInContext('globalThis.__db = { charDB, charLiteDB, buildCharacterLite, putCharacterLiteIfAbsent,'
    + ' listCharactersLiteShared, firstImageRefOf, openDB, STORES, DB_VERSION, collectBackupData, LITE_TEXT_FIELDS };', ctx);
  vm.runInContext('globalThis.__fetch = window.fetch;', ctx);

  const chars = sampleCharacters();
  if (opts.seed !== false) {
    idb.seed('characters', 'id', chars);
    idb.seed('relations', 'id', sampleRelations());
  }
  return {
    ctx, idb, yields, chars,
    db: ctx.__db,
    fields: ctx.__db.LITE_TEXT_FIELDS,
    fetch: (url, init) => ctx.__fetch(url, init),
    async json(url, init) { return (await ctx.__fetch(url, init)).json(); },
    liteRow: id => idb.rows('characterLite').get(id),
    charRow: id => idb.rows('characters').get(id),
    liteRows: () => [...idb.rows('characterLite').values()],
    charRows: () => [...idb.rows('characters').values()],
  };
}

// ---------------------------------------------------------------- 断言/工具
const bytesOf = v => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
const deepEq = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
const refsOf = record => {
  if (typeof record.images === 'string') return [];
  const imgs = Array.isArray(record.images) ? record.images : [];
  if (imgs.length === 0 && record.image_url) return [record.image_url];
  return imgs;
};

// app.js 的卡片 HTML 隔离环境（与 p05 同构，仅多出 P06 的 listImageRefs）
function makeCardEnv() {
  const ctx = vm.createContext({ window: { devicePixelRatio: 1 }, Set, Math, String, Number, Array, Object, RegExp, isFinite });
  vm.runInContext([
    'var CARD_BOX_W = 88, CARD_BOX_H = 64;',
    extractFunction(APP, 'esc'),
    extractFunction(APP, 'safeImageSrc'),
    extractFunction(APP, 'imageRepairHint'),
    extractFunction(APP, 'imageRefSig'),
    extractFunction(APP, 'cardThumbOf'),
    extractFunction(APP, 'thumbTargetSize'),
    extractFunction(APP, 'normalizeImages'),
    extractFunction(APP, 'listImageRefs'),
    extractFunction(APP, 'cardHTML'),
    extractFunction(APP, 'cardSig'),
    'var selectedIds = new Set(); var exportMode = false;',
    'globalThis.__api = { cardHTML, cardSig, listImageRefs, normalizeImages };',
  ].join('\n'), ctx);
  return ctx.__api;
}

// app.js 的导出隔离环境（真实 confirmExport）
function runExport(list) {
  const ctx = vm.createContext({
    window: {}, Set, Math, String, Number, Array, Object, RegExp, JSON, Date,
    allCharacters: plain(list),
    selectedIds: new Set(list.map(c => c.id)),
    saveExportFile(json) { ctx.__json = json; },
    cancelExport() {},
  });
  vm.runInContext('var exportMode=true;' + extractFunction(APP, 'confirmExport')
    + '\nglobalThis.__export = confirmExport;', ctx);
  ctx.__export();
  return ctx.__json;
}

async function backfillThumbs(api) {
  for (const c of api.charRows()) {
    const refs = refsOf(c);
    if (!refs.length) continue;
    const result = await api.db.charDB.updateThumb(c.id, refs[0], THUMB_IMAGE);
    assert.ok(result === 'ok' || result === 'stale', '缩略图写入应返回 ok/stale，实际 ' + result);
  }
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const report = { sample: { characters: SAMPLE, images: IMAGE_TOTAL, imageKiB: IMAGE_BYTES / 1024 }, checks: [], counts: {} };
  const ok = (id, detail) => { report.checks.push({ id, ok: true, detail }); console.log('  [ok] ' + id + ' — ' + detail); };

  // ================= ① 稳态字节：list / names 相对全量 =================
  {
    const api = makeCtx();
    const full = await api.json('/api/characters');                 // 默认全量（向后兼容）
    const fullBytes = bytesOf(full);
    const names = await api.json('/api/characters?projection=names');
    const namesBytes = bytesOf(names);
    assert.equal(full.length, SAMPLE, '默认全量仍应返回全部角色');
    assert.ok(full[0].images && full[0].images.length, '默认全量仍应含原图（向后兼容）');

    // names 形状：只有 4 个字段，且不含任何图片数据
    assert.deepEqual(Object.keys(names[0]).sort(), ['family', 'id', 'name', 'university'], 'names 只含 id/name/university/family');
    assert.ok(JSON.stringify(names).indexOf('data:image') === -1, 'names 载荷不得含图片数据');
    assert.ok(namesBytes < fullBytes * 0.01, `names 载荷应 <全量 1%（${namesBytes}/${fullBytes}）`);

    // 稳态 list：先补齐 thumbs（模拟 P05 backfill 已完成），再测投影载荷
    await backfillThumbs(api);
    api.idb.reset();
    const list = await api.json('/api/characters?projection=list');
    const listBytes = bytesOf(list);
    assert.equal(list.length, SAMPLE, 'list 投影应返回全部角色');
    assert.ok(listBytes <= fullBytes * 0.05, `list 投影应较全量下降 ≥95%（${listBytes}/${fullBytes}）`);
    assert.equal(api.idb.count('getAll', 'characters'), 0, '投影读取不得物化 characters 全量值');
    assert.ok(api.idb.count('getAllKeys', 'characters') >= 1, '应用 getAllKeys 只取主键');
    report.counts.steadyState = { fullBytes, listBytes, namesBytes, listRatio: Number((listBytes / fullBytes).toFixed(4)) };
    ok('①-steady-bytes', JSON.stringify(report.counts.steadyState));
  }

  // ================= ② 等价：字段 / 徽标 / 卡片 HTML =================
  {
    const api = makeCtx();
    await backfillThumbs(api);
    const list = await api.json('/api/characters?projection=list');
    const card = makeCardEnv();
    let multiChecked = 0;
    for (const proj of list) {
      const full = api.charRow(proj.id);
      for (const f of api.fields) {
        assert.equal(f in proj, f in full, `字段存在性必须一致：${f} (id=${proj.id})`);
        if (f in full) assert.equal(proj[f], full[f], `字段值必须一致：${f} (id=${proj.id})`);
      }
      const refs = refsOf(full);
      assert.equal(proj.images_count, refs.length, `图数必须一致 (id=${proj.id})`);
      assert.equal(proj.firstRefSig, api.db.buildCharacterLite(full).firstRefSig, `首图签名必须一致 (id=${proj.id})`);
      assert.equal(card.cardHTML(proj, 0), card.cardHTML(full, 0), `卡片 HTML 必须逐字相同 (id=${proj.id})`);
      if (refs.length > 1) {
        multiChecked++;
        assert.ok(card.cardHTML(proj, 0).indexOf('共' + refs.length + '张') !== -1, '图数徽标必须按真实张数');
      }
      // 持久化的投影不得含着原图（避免投影 store 变相复制图片字节）
      const row = api.liteRow(proj.id);
      if (refs.length && refs[0].indexOf('data:') === 0) {
        assert.equal(row.firstRef, '', 'data URL 首图不得写进持久化投影（由读路径按需补）');
        assert.ok(JSON.stringify(row).indexOf(refs[0]) === -1, '投影记录不得包含原图 data URL');
      }
    }
    assert.equal(multiChecked, 6, '应覆盖到多图角色的徽标比较');
    report.counts.equivalence = { recordsCompared: list.length, multiImage: multiChecked };
    ok('②-equivalence', '文本字段/图数/首图签名/卡片 HTML 全部逐字一致（' + list.length + ' 条，含 ' + multiChecked + ' 条多图）');
  }

  // ================= ③ 维护：每个写入点之后投影与源记录一致 =================
  {
    const api = makeCtx();
    const checkAll = label => {
      const src = api.charRows(), lite = api.liteRows();
      assert.equal(lite.length, src.length, label + '：投影条数应等于角色数');
      for (const s of src) {
        const expected = api.db.buildCharacterLite(s);
        const got = api.liteRow(s.id);
        assert.ok(got, label + '：缺少投影 id=' + s.id);
        deepEq(got, expected, label + '：投影必须等于由源记录重建的结果 id=' + s.id);
      }
    };
    // 投影按需建立：先做一次列表读取（应用总是先读列表），此后所有写入都必须维护它
    await api.json('/api/characters?projection=list');
    checkAll('初始（首次读取自愈后）');
    const created = await api.json('/api/characters', { method: 'POST', body: JSON.stringify({ name: '新建角色', images: [], image_url: '' }) });
    assert.ok(created.id, 'POST 应返回新 id');
    checkAll('POST');
    await api.json('/api/characters/1', { method: 'PUT', body: JSON.stringify({ name: '改名角色' }) });
    checkAll('PUT');
    await api.json('/api/characters/2', { method: 'DELETE' });
    assert.equal(api.liteRow(2), undefined, 'DELETE 必须同时删除投影');
    checkAll('DELETE');
    await api.json('/api/characters/reorder', { method: 'POST', body: JSON.stringify({ items: [{ id: 3, sort_order: 0 }, { id: 1, sort_order: 1 }] }) });
    checkAll('reorder');
    const ref5 = refsOf(api.charRow(5))[0];
    const r = await api.db.charDB.updateThumb(5, ref5, THUMB_IMAGE);
    assert.equal(r, 'ok', 'updateThumb 应成功');
    assert.deepEqual(plain(api.liteRow(5).thumbs), [THUMB_IMAGE], '投影 thumbs 必须同步');
    assert.equal(api.liteRow(5).needsOriginal, false, '有缩略图后 needsOriginal 必须转 false');
    checkAll('updateThumb');
    await api.db.charDB.bulkSet([{ id: 900, name: '批量', images: [], image_url: '', sort_order: 99 }]);
    checkAll('bulkSet');
    await api.db.charDB.clear();
    assert.equal(api.idb.rows('characters').size, 0, 'clear 应清空角色');
    assert.equal(api.idb.rows('characterLite').size, 0, 'clear 必须同时清空投影');
    await api.db.charDB.bulkSet(api.chars);        // 恢复路径：bulkSet 重建
    checkAll('clear+bulkSet（恢复路径）');
    report.counts.maintenance = { writePoints: ['POST', 'PUT', 'DELETE', 'reorder', 'updateThumb', 'bulkSet', 'clear+bulkSet'], records: api.charRows().length };
    ok('③-maintenance', '七个写入点之后投影均等于源记录重建结果（含 sort_order/thumbs/needsOriginal）');
  }

  // ================= ④ 并发：迟到的自愈写入不得覆盖新投影 =================
  {
    const api = makeCtx();
    api.idb.rows('characterLite').delete(7);                      // 缺投影
    const stale = api.db.buildCharacterLite(api.charRow(7));      // 读取时构建的投影（旧）
    await api.json('/api/characters/7', { method: 'PUT', body: JSON.stringify({ name: '并发改名' }) });
    const written = await api.db.putCharacterLiteIfAbsent([stale]);   // 迟到的补写
    assert.equal(written, 0, '已有更新的投影时不得再补写');
    assert.equal(api.liteRow(7).name, '并发改名', '投影不得被陈旧快照覆盖');
    assert.equal(api.liteRow(7).sort_order, api.charRow(7).sort_order, '投影字段必须与源记录一致');
    deepEq(api.liteRow(7), api.db.buildCharacterLite(api.charRow(7)), '并发后投影必须等于源记录重建结果');
    ok('④-concurrency', 'putCharacterLiteIfAbsent 只补缺失，迟到的自愈不覆盖并发写入');
  }

  // ================= ⑤ 自愈（+ 升级后首次加载的一次性过渡成本） =================
  {
    const api = makeCtx();                                   // 全新库，且没有 thumbs（= 升级后首次启动）
    const beforeChars = JSON.stringify(plain(api.charRows().sort((a, b) => a.id - b.id)));
    const full = await api.json('/api/characters');
    const fullBytes = bytesOf(full);
    api.idb.reset();
    const list = await api.json('/api/characters?projection=list');   // 首次加载：缺全部投影 + 缺 thumbs
    const firstBytes = bytesOf(list);
    const getsUsed = api.idb.count('get', 'characters');
    assert.equal(api.idb.count('put', 'characters'), 0, '自愈不得写入 characters');
    assert.equal(JSON.stringify(plain(api.charRows().sort((a, b) => a.id - b.id))), beforeChars, '角色记录必须原样不动');
    assert.equal(api.idb.rows('characterLite').size, SAMPLE, '自愈后投影应补齐全部角色');

    const card = makeCardEnv();
    const withOrig = list.filter(r => r.needsOriginal);
    assert.ok(withOrig.length >= 17, '尚无 thumbs 时，data URL 首图记录应标记 needsOriginal');
    for (const proj of withOrig) {
      const fullRec = api.charRow(proj.id);
      assert.equal(proj.firstRef, refsOf(fullRec)[0], 'needsOriginal 记录必须补上原图首图引用');
      assert.equal(card.cardHTML(proj, 0), card.cardHTML(fullRec, 0), '缺缩略图时卡片仍须与基线逐字相同（回退原图）');
    }
    report.counts.firstLoadTransition = {
      fullBytes, firstListBytes: firstBytes, ratio: Number((firstBytes / fullBytes).toFixed(4)),
      charactersGets: getsUsed, needsOriginal: withOrig.length,
      note: '升级后首次加载（尚无 thumbs）会按记录回退读取原图；此后为稳态。',
    };
    ok('⑤-self-heal', JSON.stringify(report.counts.firstLoadTransition));
  }

  // ================= ⑥ 非阻塞：分批让出 + 首屏不额外等待 =================
  {
    const api = makeCtx();
    api.idb.rows('characterLite').clear();                   // 24 条缺投影
    api.idb.reset();
    api.yields.zeroTimeout = 0;
    await api.json('/api/characters?projection=list');
    assert.ok(api.yields.zeroTimeout >= 2, '缺投影补齐必须分批让出主线程，实际让出 ' + api.yields.zeroTimeout + ' 次');
    const loadSrc = extractFunction(APP, 'loadCharacters');
    assert.equal((loadSrc.match(/fetch\(/g) || []).length, 1, 'loadCharacters 只发一次请求（首屏不等待额外投影构建）');
    assert.ok(/applyFilter\(\)/.test(loadSrc), '首屏渲染与请求在同一流程内完成');
    report.counts.nonBlocking = { yieldedBatches: api.yields.zeroTimeout, missing: SAMPLE };
    ok('⑥-nonblocking', '分批让出 ' + api.yields.zeroTimeout + ' 次；app.js 首屏一次请求、无额外等待');
  }

  // ================= ⑦ 泄漏：投影与 thumbs 不进导出/备份/上传 =================
  {
    const api = makeCtx();
    await backfillThumbs(api);
    const list = await api.json('/api/characters?projection=list');
    const backup = await api.db.collectBackupData();
    assert.ok(backup.indexOf('thumbs') === -1, '备份不得含 thumbs');
    assert.ok(backup.indexOf('firstRefSig') === -1 && backup.indexOf('images_count') === -1, '备份不得含投影字段');
    assert.ok(backup.indexOf('characterLite') === -1, '备份不得含投影 store');

    const exportProj = runExport(list);
    const exportFull = runExport(api.charRows());
    assert.equal(exportProj, exportFull, '投影列表导出的 JSON 必须与完整记录导出逐字相同');
    for (const k of ['thumbs', 'firstRefSig', 'images_count', 'firstRef', 'needsOriginal']) {
      assert.ok(exportProj.indexOf(k) === -1, '导出不得出现 ' + k);
    }
    assert.ok(exportProj.indexOf('data:image') === -1, '导出本就不含图片数据');

    const bodies = SYNC.match(/const body = \{[\s\S]*?\n      \};/g) || [];
    assert.ok(bodies.length >= 2, '应能定位角色上传 body 字段表');
    for (const b of bodies) {
      assert.ok(!/thumbs|firstRefSig|images_count/.test(b), '上传字段表不得含派生字段');
    }
    report.counts.leakage = { exportBytes: bytesOf(exportProj), backupBytes: bytesOf(backup) };
    ok('⑦-no-leak', '导出与基线逐字相同；备份/上传不含 thumbs 或投影字段');
  }

  // ================= 版本与只读兼容 =================
  {
    const api = makeCtx({ seed: false });
    assert.equal(api.db.DB_VERSION, 3, 'IDB 版本必须为 3（加性新增 projection store）');
    assert.equal(api.db.STORES.characterLite, 'characterLite', '投影 store 名称固定');
    assert.equal(api.db.STORES.characters, 'characters', '既有 store 名称不得改动');
    ok('extra-idb-version', 'DB_VERSION=3（2→3 加性），既有 store 名称/keyPath 未变');
  }

  console.log(JSON.stringify(report, null, 2));
  console.log('[p06] OK：' + report.checks.length + ' 项计数/行为/不变量门槛通过');
  console.log('[p06] 注意：设备项（真实 WebView 解码/持久化、实机页面加载耗时）= UNVERIFIED（无设备/无浏览器）；'
    + '所有字节/计数均为 Node 隔离口径。');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
