// P05 gate：隔离验证“列表卡片缩略图”管线与不变量（D004 / CONTRACT revision 6）。
//
// 覆盖：缩略图尺寸规则、首图-only、卡片优先用 thumbs[0] 且缺失回退原图、图数徽标不变、
//      cardSig 随缩略图变化、backfill 异步分批且不在首屏前生成、改图后 thumbs 失效、
//      导出/备份/上传不含 thumbs、内嵌 base64 字节下降门槛、列表渲染耗时代理对比。
//
// 限制（必须如实标注）：Node 无 canvas/createImageBitmap，**缩略图像素级输出无法在此验证**；
// 本文件只验证管线、尺寸规则与不变量。真实画质等价与实机页面加载耗时属真机验收（当前 UNVERIFIED）。
// 不触碰真实 server / 数据库 / 浏览器 / 设备，也不执行真实同步或删除。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const WEB = path.join(root, 'android-app/app/src/main/assets/web');
const APP = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
const DB = fs.readFileSync(path.join(WEB, 'db.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(WEB, 'sync.js'), 'utf8');

// ---------------------------------------------------------------- 源码切片
// 按名字提取函数体。需跳过字符串、注释与**正则字面量**——源码里有 /'/g、/^data:image\//i
// 这类写法，朴素的花括号计数会被误判。
const REGEX_PREV = '(,=:[!&|?{};+-*%^~<>';
const REGEX_KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void',
  'instanceof', 'new', 'do', 'else', 'yield', 'await'];
function extractFunction(src, name) {
  const marker = 'function ' + name + '(';
  let start = src.indexOf(marker);
  assert.ok(start >= 0, '未找到函数: ' + name);
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;   // 保留 async 修饰符
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
const PNG_HEAD = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
function dataUrlOfBytes(bytes) {
  const body = Buffer.alloc(Math.max(0, bytes - PNG_HEAD.length), 0x5a);
  return 'data:image/png;base64,' + Buffer.concat([PNG_HEAD, body]).toString('base64');
}
const FULL_IMAGE = dataUrlOfBytes(1024 * 1024);        // ≈1 MiB 原图（模拟真实场景）
const THUMB_IMAGE = dataUrlOfBytes(40 * 1024);         // ≈40 KiB 缩略图（显示盒所需量级）

function character(over) {
  return Object.assign({
    id: 1, name: '角色甲', alias: '别名', university: '某高校', region: '南京',
    gender: '女', status: '存在', height: '170', birthday: '01-01',
    setting: '设定文本', appearance: '', identity_period: '', birth_time: '',
    naming_rationale: '', images: [FULL_IMAGE], image_url: FULL_IMAGE,
  }, over || {});
}

// ---------------------------------------------------------------- 纯函数 / 卡片 HTML 环境
function makeCardEnv() {
  const ctx = vm.createContext({ window: { devicePixelRatio: 1 }, Set, Math, String, Number, Array, Object, RegExp, isFinite });
  const parts = [
    'var CARD_BOX_W = 88, CARD_BOX_H = 64;',
    extractFunction(APP, 'esc'),
    extractFunction(APP, 'safeImageSrc'),
    extractFunction(APP, 'imageRepairHint'),
    extractFunction(APP, 'imageRefSig'),
    extractFunction(APP, 'cardThumbOf'),
    extractFunction(APP, 'thumbTargetSize'),
    extractFunction(APP, 'normalizeImages'),
    extractFunction(APP, 'cardHTML'),
    extractFunction(APP, 'cardSig'),
    'var selectedIds = new Set(); var exportMode = false;',
    'globalThis.__api = { esc, safeImageSrc, imageRepairHint, imageRefSig, cardThumbOf, thumbTargetSize, normalizeImages, cardHTML, cardSig, selectedIds };',
  ];
  vm.runInContext(parts.join('\n'), ctx);
  return ctx.__api;
}

function embeddedSrcBytes(html) {
  const m = /<img src="([^"]*)"/.exec(html);
  return m ? m[1].length : 0;
}
function imgAttrs(html) {
  const m = /<img ([^>]*)>/.exec(html);
  return m ? m[1].replace(/src="[^"]*"/, 'src="#"') : '';
}

// ---------------------------------------------------------------- backfill 环境
function makeTimers() {
  let seq = 0; const q = [];
  return {
    setTimeout(fn, ms) { const id = ++seq; q.push({ id, fn, ms }); return id; },
    clearTimeout(id) { const i = q.findIndex(t => t.id === id); if (i >= 0) q.splice(i, 1); },
    pending() { return q.length; },
    delays() { return q.map(t => t.ms); },
    async runNext() { const t = q.shift(); if (!t) return false; await t.fn(); return true; },
  };
}
const flushMicro = () => new Promise(r => setImmediate(r));

function makeBackfillEnv(chars, opts) {
  opts = opts || {};
  const timers = makeTimers();
  const state = { generated: 0, updates: [], fullWrites: 0, applyFilter: 0, generatedRefs: [], thumb: opts.thumb || THUMB_IMAGE };
  const ctx = vm.createContext({
    window: { appDataRevision: 0 },
    Set, Math, String, Number, Array, Object, RegExp, Promise, isFinite, JSON,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    allCharacters: chars,
    charDB: {
      // X1：只允许原子写 thumbs；若出现整条覆盖（update）即为回归
      updateThumb(id, expectFirstImage, thumb) {
        state.updates.push({ id: id, expectFirstImage: expectFirstImage, thumb: thumb });
        return Promise.resolve(opts.writeResult || 'ok');
      },
      update(rec) { state.fullWrites++; return Promise.resolve(); },
    },
    applyFilter() { state.applyFilter++; },
    makeCardThumb(ref) {
      state.generated++; state.generatedRefs.push(ref);
      return Promise.resolve(opts.fail ? '' : state.thumb);
    },
  });
  const parts = [
    extractFunction(APP, 'imageRefSig'),
    extractFunction(APP, 'cardThumbOf'),
    extractFunction(APP, 'normalizeImages'),
    'var THUMB_SYNC_WAIT_MS = 250, THUMB_SYNC_MAX_WAIT = 40;',
    'var thumbBackfill = { running: false, revision: -1 };',
    extractFunction(APP, 'syncBusy'),
    extractFunction(APP, 'thumbBackfillCandidates'),
    extractFunction(APP, 'scheduleThumbBackfill'),
    extractFunction(APP, 'runThumbBatch'),
    'globalThis.__bf = { scheduleThumbBackfill, thumbBackfillCandidates, runThumbBatch, thumbBackfill };',
  ];
  vm.runInContext(parts.join('\n'), ctx);
  return { ctx, timers, state, chars };
}

// ---------------------------------------------------------------- 真实 db.js 写入路径环境（X1/W3）
// 用真实 db.js + 假 IndexedDB：写入语义（整条替换 vs 原子读-改-写）必须真实，才能测出 X1。
function makeRealDbEnv() {
  const stores = new Map();
  // 预建 characters（db.js 的 onupgradeneeded 会跳过已存在的 store），便于在首次 open 前 seed 数据。
  stores.set('characters', { keyPath: 'id', rows: new Map() });
  let backupCount = 0;
  const pending = [];
  const soon = fn => setImmediate(fn);

  function open() {
    const req = {};
    soon(() => {
      const db = {
        objectStoreNames: { contains: n => stores.has(n) },
        createObjectStore: (n, o) => { if (!stores.has(n)) stores.set(n, { keyPath: o.keyPath, rows: new Map() }); return {}; },
        transaction: (name) => {
          const meta = stores.get(name);
          const t = { oncomplete: null, onerror: null, onabort: null };
          t.objectStore = () => ({
            get: k => { const r = { result: structuredClone(meta.rows.get(k)) }; soon(() => { if (r.onsuccess) r.onsuccess(); }); return r; },
            put: v => {
              meta.rows.set(v[meta.keyPath], structuredClone(v));
              const r = { result: v[meta.keyPath] };
              soon(() => { if (r.onsuccess) r.onsuccess(); if (t.oncomplete) t.oncomplete(); });
              return r;
            },
            add: v => { const k = v[meta.keyPath] != null ? v[meta.keyPath] : meta.rows.size + 1; v[meta.keyPath] = k; meta.rows.set(k, structuredClone(v)); const r = { result: k }; soon(() => { if (r.onsuccess) r.onsuccess(); }); return r; },
            delete: k => { meta.rows.delete(k); const r = {}; soon(() => { if (r.onsuccess) r.onsuccess(); }); return r; },
            clear: () => { meta.rows.clear(); const r = {}; soon(() => { if (r.onsuccess) r.onsuccess(); }); return r; },
            getAll: () => { const r = { result: [...meta.rows.values()].map(v => structuredClone(v)) }; soon(() => { if (r.onsuccess) r.onsuccess(); }); return r; },
          });
          return t;
        },
      };
      req.result = db;
      if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
      if (req.onsuccess) req.onsuccess();
    });
    return req;
  }

  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    indexedDB: { open },
    navigator: { storage: { persist: async () => true } },
    document: { addEventListener() {}, visibilityState: 'visible' },
    window: { addEventListener() {}, Android: { saveBackup() { backupCount++; } } },
    localStorage: { getItem: () => null, setItem() {} },
    confirm: () => false, alert() {}, location: { reload() {} },
    // db.js 的 scheduleBackup 走这个假定时器；假 IndexedDB 内部用自己的 setImmediate，互不干扰
    setTimeout: (fn) => { pending.push(fn); return pending.length; },
    clearTimeout: () => {},
    structuredClone, setImmediate, Promise, Set, Map, JSON, Date, RegExp,
    Object, Array, String, Number, Math, isFinite, Blob, Error,
  });
  vm.runInContext(DB, ctx);
  vm.runInContext('globalThis.__db = { charDB };', ctx);

  const charRows = () => stores.get('characters').rows;
  return {
    db: ctx.__db,
    seed(rec) { charRows().set(rec.id, structuredClone(rec)); },
    read(id) { return structuredClone(charRows().get(id)); },
    backups: () => backupCount,
    resetBackups() { backupCount = 0; },
    async runTimers() {
      const list = pending.splice(0, pending.length);
      for (const cb of list) { const r = cb(); if (r && r.then) await r; }
    },
  };
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const api = makeCardEnv();
  const checks = [];
  const ok = (id, detail) => checks.push({ id, ok: true, detail });

  // ---------- 1. 缩略图尺寸规则：cover 裁剪后不放大、保持宽高比、不放大源图 ----------
  for (const dpr of [1, 2, 3]) {
    for (const [w, h] of [[3000, 2000], [2000, 3000], [6000, 1200], [1200, 6000], [4000, 4000]]) {
      const t = api.thumbTargetSize(w, h, dpr);
      assert.ok(t.w >= Math.min(w, 88 * dpr) && t.h >= Math.min(h, 64 * dpr),
        `dpr=${dpr} ${w}x${h} → ${t.w}x${t.h} 小于显示需求`);
      // cover 显示盒 88x64 CSS px ⇒ 物理 88dpr x 64dpr；两维都必须够
      if (w * h > 88 * dpr * 64 * dpr) {
        assert.ok(t.w >= 88 * dpr && t.h >= 64 * dpr, `dpr=${dpr} ${w}x${h} 两维不足: ${t.w}x${t.h}`);
      }
      assert.ok(t.w <= w && t.h <= h, '不得放大源图');
      const ar0 = w / h, ar1 = t.w / t.h;
      assert.ok(Math.abs(ar0 - ar1) / ar0 < 0.01, `宽高比漂移过大: ${ar0} vs ${ar1}`);
    }
  }
  const small = api.thumbTargetSize(40, 30, 3);
  assert.equal(small.w, 40, '源图小于显示需求时不得放大(w)');
  assert.equal(small.h, 30, '源图小于显示需求时不得放大(h)');
  ok('thumbTargetSize', '等比降采样；两维均满足 88×64×dpr；不放大源图');

  // ---------- 2. cardThumbOf 只认首图 ----------
  assert.equal(api.cardThumbOf(character({ thumbs: [THUMB_IMAGE] })), THUMB_IMAGE);
  assert.equal(api.cardThumbOf(character({ thumbs: [THUMB_IMAGE, 'x'] })), THUMB_IMAGE);
  assert.equal(api.cardThumbOf(character({ thumbs: [] })), '');
  assert.equal(api.cardThumbOf(character({})), '');
  assert.equal(api.cardThumbOf(character({ thumbs: 'bad' })), '');
  ok('cardThumbOf', '存在则取索引 0；缺失/畸形返回空串');

  // ---------- 3. 卡片优先用 thumbs[0]，缺失回退原图，且其余 UI 完全不变 ----------
  const cFull = character();
  const cThumb = character({ thumbs: [THUMB_IMAGE] });
  const htmlFull = api.cardHTML(cFull, 0);
  const htmlThumb = api.cardHTML(cThumb, 0);
  assert.ok(htmlFull.indexOf(FULL_IMAGE) !== -1, '无缩略图时必须回退原图');
  assert.ok(htmlThumb.indexOf(THUMB_IMAGE) !== -1, '有缩略图时必须用缩略图');
  assert.ok(htmlThumb.indexOf(FULL_IMAGE) === -1, '有缩略图时不得再内嵌原图');
  assert.equal(imgAttrs(htmlThumb), imgAttrs(htmlFull), '<img> 除 src 外的属性必须完全一致');
  assert.equal(htmlThumb.replace(/src="[^"]*"/g, 'src="#"'), htmlFull.replace(/src="[^"]*"/g, 'src="#"'),
    '卡片 HTML 除图片 src 外必须逐字一致（UI 不变）');
  ok('cardHTML', '优先 thumbs[0]，缺失回退原图；除 src 外 HTML 逐字一致');

  // ---------- 4. 图数徽标仍按 images.length ----------
  const multi = character({ images: [FULL_IMAGE, FULL_IMAGE, FULL_IMAGE], thumbs: [THUMB_IMAGE] });
  assert.ok(api.cardHTML(multi, 0).indexOf('共3张') !== -1, '徽标必须按原图数量');
  assert.ok(api.cardHTML(multi, 0).indexOf('共1张') === -1, '徽标不得按缩略图数量');
  assert.equal((api.cardHTML(multi, 0).match(/共\d+张/g) || []).length, 1, '徽标数量不变');
  ok('badge', '图数徽标仍按 images.length，且只出现一次');

  // ---------- 5. D7a 计数门槛：内嵌 base64 字节下降 ≥95%，卡片 HTML < 200 KB ----------
  const fullBytes = embeddedSrcBytes(htmlFull);
  const thumbBytes = embeddedSrcBytes(htmlThumb);
  const drop = 1 - thumbBytes / fullBytes;
  assert.ok(drop >= 0.95, `内嵌 base64 下降不足: ${(drop * 100).toFixed(2)}%`);
  assert.ok(htmlThumb.length < 200 * 1024, `缩略图卡片 HTML 过大: ${htmlThumb.length}`);
  ok('D7a-base64-drop', `内嵌图片字节 ${fullBytes} → ${thumbBytes}（下降 ${(drop * 100).toFixed(2)}%）；卡片 HTML ${htmlThumb.length} B`);

  // ---------- 6. cardSig 随缩略图变化（backfill 完成能触发重渲染） ----------
  const sigFull = api.cardSig(cFull, 0);
  const sigThumb = api.cardSig(cThumb, 0);
  assert.notEqual(sigFull, sigThumb, '缩略图出现后签名必须变化');
  assert.equal(api.cardSig(character({ thumbs: [THUMB_IMAGE] }), 0), sigThumb, '同输入签名稳定');
  ok('cardSig', '签名纳入缩略图，backfill 后可增量重建该卡片');

  // ---------- 7. backfill：异步、分批、不阻塞首屏 ----------
  {
    const chars = [
      character({ id: 1, name: 'A' }),                              // 有首图、无缩略图 → 候选
      character({ id: 2, name: 'B', thumbs: [THUMB_IMAGE] }),        // 已有缩略图 → 跳过
      character({ id: 3, name: 'C', images: [], image_url: '' }),    // 无图 → 跳过
      character({ id: 4, name: 'D', images: ['/api/images/x.png'], image_url: '/api/images/x.png' }), // 非 data URL → 跳过
    ];
    const env = makeBackfillEnv(chars);
    const cand = env.ctx.__bf.thumbBackfillCandidates();
    assert.equal(cand.length, 1, '候选只应有“有 data URL 首图且无缩略图”的角色');
    assert.equal(cand[0].id, 1, '候选角色 id 应为 1');

    env.ctx.__bf.scheduleThumbBackfill();
    assert.equal(env.state.generated, 0, '首屏前不得同步开始生成');
    assert.deepEqual(env.timers.delays(), [300], '首个批次必须延迟到首屏之后');

    await env.timers.runNext();       // 300ms → 第 1 批
    await flushMicro();
    assert.equal(env.state.generated, 1, '每批只生成 1 张');
    assert.equal(env.state.updates.length, 1, '每批原子写 1 次');
    const w0 = env.state.updates[0];
    assert.equal(w0.id, 1, '写入目标 id 正确');
    assert.equal(w0.expectFirstImage, chars[0].images[0], '写入携带首图一致性校验值');
    assert.equal(w0.thumb, THUMB_IMAGE, 'thumbs 只写首图');
    assert.equal(env.state.fullWrites, 0, 'X1：绝不整条覆盖记录（未调用 charDB.update）');
    assert.equal(env.state.applyFilter, 1, '写完刷新一次列表');
    assert.deepEqual(env.timers.delays(), [16], '批次间让出主线程');

    await env.timers.runNext();       // 16ms → 队列结束
    await flushMicro();
    assert.equal(env.state.generated, 1, '候选耗尽后不再生成');
    assert.equal(env.ctx.__bf.thumbBackfill.running, false, '结束后必须复位 running');
    ok('backfill-batching', '延迟 300ms 起步、每批 1 张、批间 16ms 让出；只写首图且不改 images');
  }

  // ---------- 8. backfill：数据版本变化即中止，避免写回陈旧记录 ----------
  {
    const chars = [character({ id: 1 })];
    const env = makeBackfillEnv(chars);
    env.ctx.__bf.scheduleThumbBackfill();
    env.ctx.window.appDataRevision = 7;   // 模拟写入/同步发生
    await env.timers.runNext();
    await flushMicro();
    assert.equal(env.state.generated, 0, '版本变化后不得继续生成');
    assert.equal(env.state.updates.length, 0, '版本变化后不得写回');
    ok('backfill-abort', 'appDataRevision 变化即中止，不写陈旧记录');
  }

  // ---------- 9. 生成失败不写坏字段 ----------
  {
    const chars = [character({ id: 1 })];
    const env = makeBackfillEnv(chars, { fail: true });
    env.ctx.__bf.scheduleThumbBackfill();
    await env.timers.runNext();
    await flushMicro();
    assert.equal(env.state.generated, 1, '失败也走完一次尝试');
    assert.equal(env.state.updates.length, 0, '失败不得写入 thumbs');
    ok('backfill-failure', '生成失败不写坏字段，卡片继续回退原图');
  }

  // ---------- 10. 改图后 thumbs 失效；未改图不清 ----------
  {
    const chars = [character({ id: 1, images: [FULL_IMAGE], image_url: FULL_IMAGE })];
    const ctx = vm.createContext({
      window: { appDataRevision: 0 }, Set, Math, String, Number, Array, Object, RegExp, JSON, Promise,
      allCharacters: chars,
      currentImageUrls: [FULL_IMAGE], currentImageFiles: [],
      API: '/api/characters',
      closeModal() {}, resetImageUpload() {}, markAppDataChanged() {},
      loadCharacters() {}, showToast() {}, setTimeout() {},
      fetch: async (url, init) => { ctx.__sent = init && init.body; return { ok: true }; },
    });
    const parts = [
      extractFunction(APP, 'normalizeImages'),
      extractFunction(APP, 'doSubmitFinal'),
      'globalThis.__submit = doSubmitFinal;',
    ];
    vm.runInContext(parts.join('\n'), ctx);

    // 首图未变 → 不清 thumbs（api-shim 合并旧记录时保留）
    ctx.currentImageUrls = [FULL_IMAGE];
    await ctx.__submit(1, { name: 'x' });
    const kept = JSON.parse(ctx.__sent);
    assert.ok(!('thumbs' in kept), '首图未变时不应清空 thumbs');

    // 首图变了 → 必须清空 thumbs
    ctx.currentImageUrls = [THUMB_IMAGE];
    await ctx.__submit(1, { name: 'x' });
    const cleared = JSON.parse(ctx.__sent);
    assert.deepEqual(cleared.thumbs, [], '首图变化必须清空 thumbs 触发重生成');
    assert.deepEqual(cleared.images, [THUMB_IMAGE], 'images 正常写入新首图');
    ok('image-edit-invalidation', '首图变化才清 thumbs；未变则保留（避免无谓回退）');
  }

  // ---------- 11. 备份剥离 thumbs（真实 db.js 函数） ----------
  {
    const ctx = vm.createContext({ Set, Math, String, Number, Array, Object });
    vm.runInContext(extractFunction(DB, 'stripDerivedThumbs') + '\nglobalThis.__strip = stripDerivedThumbs;', ctx);
    const list = [character({ thumbs: [THUMB_IMAGE] }), character({ id: 2 })];
    const out = ctx.__strip(list);
    assert.ok(!('thumbs' in out[0]), '备份必须剥离 thumbs');
    assert.deepEqual(out[0].images, list[0].images, '备份必须保留原图');
    assert.equal(out[0].name, list[0].name, '备份必须保留其它字段');
    assert.equal(out[1], list[1], '无 thumbs 的记录原样返回');
    ok('backup-strip', '备份剥离 thumbs，原图与其它字段保留');
  }

  // ---------- 12. 导出不含 thumbs ----------
  {
    const ctx = vm.createContext({
      window: {}, Set, Math, String, Number, Array, Object, RegExp, JSON, Date,
      allCharacters: [character({ thumbs: [THUMB_IMAGE] })],
      selectedIds: new Set([1]),
      saveExportFile(json, fn) { ctx.__json = json; },
      cancelExport() {},
    });
    vm.runInContext('var exportMode=true;' + extractFunction(APP, 'confirmExport')
      + '\nglobalThis.__export = confirmExport;', ctx);
    ctx.__export();
    assert.ok(ctx.__json, '导出必须产出 JSON');
    assert.ok(ctx.__json.indexOf('thumbs') === -1, '导出 JSON 不得出现 thumbs');
    assert.ok(ctx.__json.indexOf('data:image') === -1, '导出本就不含图片数据');
    ok('export-no-thumbs', '角色导出 JSON 不含 thumbs（与基线一致，仅文本字段）');
  }

  // ---------- 13. 上传 payload 不含 thumbs（静态守卫 + 字段表核对） ----------
  {
    const bodies = SYNC.match(/const body = \{[\s\S]*?\n      \};/g) || [];
    assert.ok(bodies.length >= 2, '应能定位角色上传 body 字段表');
    for (const b of bodies) assert.ok(!/thumbs/.test(b), '角色上传字段表不得含 thumbs');
    assert.ok(!/JSON\.stringify\(\s*(?:c|record|item\.source)\s*\)/.test(SYNC),
      '上传不得直接整体序列化记录（会带上派生字段）');
    ok('upload-no-thumbs', '上传字段表显式为白名单，不含 thumbs');
  }

  // ---------- 14. D7b 列表渲染耗时代理（非实机） ----------
  {
    const N = 80, WITH_IMG = 17;
    const fullChars = [], thumbChars = [];
    for (let i = 0; i < N; i++) {
      const has = i < WITH_IMG;
      fullChars.push(character({ id: i + 1, name: 'C' + i, images: has ? [FULL_IMAGE] : [], image_url: has ? FULL_IMAGE : '' }));
      thumbChars.push(character({ id: i + 1, name: 'C' + i, images: has ? [FULL_IMAGE] : [], image_url: has ? FULL_IMAGE : '', thumbs: has ? [THUMB_IMAGE] : [] }));
    }
    // 代理口径：只测 cardHTML 的“构建 + 实体化”成本。
    // V8 的字符串拼接是惰性 rope，单看 cardHTML 会得到噪声；这里用 Buffer.byteLength 强制
    // 把 HTML 实体化成字节，模拟浏览器必须处理的字节量（真正的 base64 解码与图片解码不在 Node 内，
    // 因此本项只是**代理指标**，不是实机页面加载耗时）。
    const timeOnce = list => {
      const t0 = process.hrtime.bigint();
      let bytes = 0;
      for (const c of list) bytes += Buffer.byteLength(api.cardHTML(c, c.id));
      return { ms: Number(process.hrtime.bigint() - t0) / 1e6, bytes };
    };
    const median = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    timeOnce(fullChars); timeOnce(thumbChars);   // 1 次预热
    const fullMs = [], thumbMs = [];
    for (let i = 0; i < 5; i++) { fullMs.push(timeOnce(fullChars).ms); thumbMs.push(timeOnce(thumbChars).ms); }
    const bf = timeOnce(fullChars).bytes, bt = timeOnce(thumbChars).bytes;
    const ratio = median(thumbMs) / median(fullMs);
    assert.ok(ratio < 0.9, `缩略图路径应显著更快（ratio=${ratio.toFixed(3)}）`);
    assert.ok(bt < bf * 0.05, `内嵌字节应下降 ≥95%（${bf} → ${bt}）`);
    ok('D7b-proxy', `列表卡片 HTML 构建+实体化中位耗时 ${median(fullMs).toFixed(2)}ms → ${median(thumbMs).toFixed(2)}ms（ratio ${ratio.toFixed(3)}）；`
      + `内嵌字节 ${(bf / 1048576).toFixed(2)} MiB → ${(bt / 1048576).toFixed(2)} MiB；**Node 代理指标，非实机**`);
  }

  // ---------- 15. X2：每张图只解码一次（真实 makeCardThumb + 假 canvas/createImageBitmap） ----------
  {
    const calls = { bitmap: 0, opts: [], draw: [], types: [], closed: 0, alpha: false };
    const ctx2d = {
      imageSmoothingEnabled: false, imageSmoothingQuality: '',
      drawImage(img, x, y, w, h) { calls.draw.push([x, y, w, h]); },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4).fill(255);
        if (calls.alpha) for (let i = 3; i < data.length; i += 4) data[i] = 128;
        return { data };
      },
    };
    const canvas = {
      width: 0, height: 0, getContext: () => ctx2d,
      toDataURL: type => { calls.types.push(type); return 'data:' + type + ';base64,THUMB'; },
    };
    const env = vm.createContext({
      Math, Number, String, Array, Object, RegExp, isFinite, Blob, Promise,
      window: { devicePixelRatio: 2 },
      document: { createElement: () => canvas },
      dataUrlToBlob: () => new Blob([]),
      createImageBitmap: async (blob, options) => {
        calls.bitmap++; calls.opts.push(options || null);
        return { width: 3000, height: 2000, close() { calls.closed++; } };
      },
    });
    vm.runInContext([
      'var CARD_BOX_W = 88, CARD_BOX_H = 64;',
      extractFunction(APP, 'thumbTargetSize'),
      extractFunction(APP, 'thumbCanvasHasAlpha'),
      extractFunction(APP, 'makeCardThumb'),
      'globalThis.__mk = { makeCardThumb, thumbTargetSize };',
    ].join('\n'), env);

    const jpeg = await env.__mk.makeCardThumb(FULL_IMAGE);
    assert.equal(calls.bitmap, 1, 'X2：每张图只能解码一次');
    assert.equal(calls.opts[0], null, 'X2：不得为取宽高再做一次带 resize 的解码');
    const t = env.__mk.thumbTargetSize(3000, 2000, 2);
    assert.deepEqual(calls.draw[0], [0, 0, t.w, t.h], '画布按目标尺寸一次性降采样');
    assert.equal(calls.closed, 1, '解码位图必须释放');
    assert.ok(/^data:image\/jpeg/.test(jpeg), '不透明图用 JPEG');

    calls.alpha = true;
    const png = await env.__mk.makeCardThumb(FULL_IMAGE);
    assert.ok(/^data:image\/png/.test(png), '含透明图用 PNG');
    assert.equal(calls.bitmap, 2, '第二张图同样只解码一次');
    ok('X2-single-decode', '每张图 createImageBitmap=1、无二次 resize 解码、位图释放、透明走 PNG');
  }

  // ---------- 16. X1/W3：真实 db.js 写入路径（原子读-改-写、保留并发修改） ----------
  {
    const env = makeRealDbEnv();
    const rec = character({ id: 1, name: '原名', images: [FULL_IMAGE], image_url: FULL_IMAGE });
    env.seed(rec);

    // 既有事实（非 P05 引入）：scheduleBackup 只挂在从未被任何代码调用的 tx() 上，
    // 所以常规 CRUD 与派生写入都不触发原生备份——备份只在页面隐藏时发生。
    await env.db.charDB.update({ ...rec, name: '改过' });
    await env.runTimers();
    assert.equal(env.backups(), 0, '既有事实：常规 CRUD 不触发原生备份（tx() 无调用点）');

    // 派生写入同样不得引入新的备份触发
    env.resetBackups();
    const r1 = await env.db.charDB.updateThumb(1, FULL_IMAGE, THUMB_IMAGE);
    await env.runTimers();
    assert.equal(r1, 'ok', '首图一致时应写入成功');
    assert.equal(env.backups(), 0, '派生写入不引入新的备份触发');
    const a1 = env.read(1);
    assert.equal(a1.thumbs[0], THUMB_IMAGE, 'thumbs 已写入');
    assert.equal(a1.name, '改过', 'X1：不得改动记录其它字段');
    assert.equal(a1.images[0], FULL_IMAGE, '原图保持不变');

    // X1：生成期间记录被并发修改（同步/编辑）→ 并发改动必须保留，不得被陈旧记录回退
    const cur = env.read(1); delete cur.thumbs; cur.name = '并发改名';
    await env.db.charDB.update(cur);
    env.resetBackups();
    const r2 = await env.db.charDB.updateThumb(1, FULL_IMAGE, 'data:image/jpeg;base64,OLD');
    assert.equal(r2, 'ok', '首图未变仍可写入');
    const a2 = env.read(1);
    assert.equal(a2.name, '并发改名', 'X1：并发修改必须被保留（未被整条覆盖回退）');
    assert.equal(a2.thumbs[0], 'data:image/jpeg;base64,OLD', 'thumbs 写入成功');

    // X1：首图已变（例如刚同步下新图）→ 判为过期，不得写入旧缩略图
    const cur2 = env.read(1); delete cur2.thumbs;
    cur2.images = [THUMB_IMAGE]; cur2.image_url = THUMB_IMAGE;
    await env.db.charDB.update(cur2);
    const r3 = await env.db.charDB.updateThumb(1, FULL_IMAGE, 'data:image/jpeg;base64,STALE');
    assert.equal(r3, 'stale', '首图已变必须判为 stale');
    assert.ok(!env.read(1).thumbs, 'X1：过期缩略图不得写入');
    assert.equal(env.read(1).name, '并发改名', 'stale 分支同样不得改动其它字段');

    const r4 = await env.db.charDB.updateThumb(999, FULL_IMAGE, THUMB_IMAGE);
    assert.equal(r4, 'missing', '记录不存在返回 missing');
    await env.runTimers();
    assert.equal(env.backups(), 0, "派生写入全程不引入备份触发");
    ok('X1-atomic-write', '真实 db.js：原子读-改-写保留并发修改、首图变了不写、不动其它字段、全程不引入备份触发');
  }

  for (const c of checks) console.log('  [ok] ' + c.id + ' — ' + c.detail);
  console.log('[p05] OK：' + checks.length + ' 项计数/行为/不变量门槛通过');
  console.log('[p05] 注意：缩略图像素级输出与实机画质等价、实机页面加载耗时 = UNVERIFIED（无设备/无浏览器）');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
