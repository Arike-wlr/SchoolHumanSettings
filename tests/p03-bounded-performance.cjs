// P03 gate：隔离验证 D4/D5 计数门槛，并做同一样本的前后性能比较。
// 只使用内存假 DOM / 假 IndexedDB / 假 fetch / 合成图片；不触碰真实 server、真实数据库、
// 真实浏览器、真机，也不执行任何真实同步、删除、覆盖操作。
// 所有耗时都是 Node 侧数字，不是实机测量（D5/D6 的实机部分属 P04）。
//
// 前后对比基线：tests/baseline-p03/（P03 开工前工作树版本的哈希固定快照）。

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const WEB = path.join(root, 'android-app/app/src/main/assets/web');
const BASE = path.join(root, 'tests/baseline-p03');

const readText = p => fs.readFileSync(p, 'utf8');
const LIVE = {
  app: readText(path.join(WEB, 'app.js')),
  db: readText(path.join(WEB, 'db.js')),
  sync: readText(path.join(WEB, 'sync.js')),
  shim: readText(path.join(WEB, 'api-shim.js')),
};
const BASELINE = {
  app: readText(path.join(BASE, 'app.js')),
  db: readText(path.join(BASE, 'db.js')),
  sync: readText(path.join(BASE, 'sync.js')),
  shim: readText(path.join(BASE, 'api-shim.js')),
};

const CHAR_SECTION = '// ======================== 角色设定';
const WORLD_SECTION = '// ======================== 世界设定';
const REL_SECTION = '// ======================== 关系网';

const PNG_HEAD = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const SAMPLE_CHARS = 80;
const SAMPLE_IMAGES = 25;
const IMAGE_BYTES = Math.max(1024, Number(process.env.P03_IMAGE_KB || 64) * 1024);

console.log('[p03] 样本：' + SAMPLE_CHARS + ' 角色 / ' + SAMPLE_IMAGES + ' 张合成原图，每张约 ' +
  (IMAGE_BYTES / 1024) + ' KiB（Node 侧缩小样本；合同 88 MiB 实机样本属 P04）');

// ---------------------------------------------------------------- 合成样本
function pngBytes(tag, size) {
  const head = PNG_HEAD;
  const tail = Buffer.alloc(Math.max(0, size - head.length));
  tail.fill(0x5a);
  Buffer.from(String(tag)).copy(tail, 0);
  return Buffer.concat([head, tail]);
}
function dataUrlFor(i) {
  return 'data:image/png;base64,' + pngBytes('img-' + i, IMAGE_BYTES).toString('base64');
}
const SAMPLE_DATA_URLS = Array.from({ length: SAMPLE_IMAGES }, (_, i) => dataUrlFor(i));

function makeCharacters(count) {
  count = count || SAMPLE_CHARS;
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: '角色' + (i + 1),
    alias: '别名' + i,
    university: '高校' + i,
    region: '地区' + (i % 6),
    naming_rationale: '', height: '170', gender: (i % 2) ? '女' : '男', birthday: '01-01',
    appearance: '', identity_period: '', birth_time: '', birthplace: '', status: '存在',
    setting: '设定文本'.repeat(16), family: '家族' + (i % 8), sort_order: i,
    images: i < SAMPLE_IMAGES ? [SAMPLE_DATA_URLS[i]] : [],
    image_url: i < SAMPLE_IMAGES ? SAMPLE_DATA_URLS[i] : '',
  }));
}
function makeRelations(count) {
  return Array.from({ length: count || 50 }, (_, i) => ({
    id: i + 1,
    from_char_id: (i % 80) + 1,
    to_char_id: ((i * 7 + 3) % 80) + 1,
    from_name: '角色' + ((i % 80) + 1),
    to_name: '角色' + (((i * 7 + 3) % 80) + 1),
    relation_type: ['CP', '朋友', '师生', '冤家', '亲属'][i % 5],
    description: '关系描述' + i,
    sort_order: i,
  }));
}

// ---------------------------------------------------------------- 假 DOM
function makeDom() {
  const stats = { innerHTMLWrites: 0, htmlChars: 0, elementCreations: 0, replaceChild: 0 };
  const byId = new Map();

  function El(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.dataset = {};
    this.style = { display: '' };
    this.value = '';
    this.href = '';
    this.clientWidth = 360;
    this.clientHeight = 300;
    this.offsetHeight = 40;
    this.selfWrites = 0;
    this.selfHtmlChars = 0;
    this.selfTextWrites = 0;
    this.selfReplaceChild = 0;
    this._html = '';
    this._text = '';
    const set = new Set();
    this.classList = {
      add: c => set.add(c),
      remove: c => set.delete(c),
      contains: c => set.has(c),
      toggle: (c, on) => { const want = (on === undefined) ? !set.has(c) : !!on; if (want) set.add(c); else set.delete(c); return want; },
    };
    const self = this;
    Object.defineProperty(this, 'textContent', {
      get: () => self._text,
      set: v => { self._text = String(v); self.selfTextWrites++; },
    });
    Object.defineProperty(this, 'innerHTML', {
      get: () => self._html,
      set: v => {
        v = String(v);
        stats.innerHTMLWrites++; stats.htmlChars += v.length;
        self.selfWrites++; self.selfHtmlChars += v.length;
        self._html = v;
        self.children.forEach(c => { c.parentNode = null; });
        self.children = [];
        if (!v.trim()) return;
        // 单根近似：列表/卡片 HTML 都只有一个根元素，够用且不解析子树。
        const m = /^<\s*([a-zA-Z][\w-]*)/.exec(v.trim());
        if (!m) return;
        stats.elementCreations++;
        const root = new El(m[1]);
        root._html = v;
        const head = v.slice(0, v.indexOf('>') + 1);
        const attrRe = /([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"/g;
        let a;
        while ((a = attrRe.exec(head))) root.attrs[a[1]] = a[2];
        root.parentNode = self;
        self.children.push(root);
      },
    });
  }
  El.prototype.getAttribute = function (k) { return (k in this.attrs) ? this.attrs[k] : null; };
  El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
  El.prototype.addEventListener = function () {};
  El.prototype.removeEventListener = function () {};
  El.prototype.appendChild = function (n) { n.parentNode = this; this.children.push(n); return n; };
  El.prototype.insertBefore = function (n, ref) {
    if (n.parentNode) {
      const i = n.parentNode.children.indexOf(n);
      if (i >= 0) n.parentNode.children.splice(i, 1);
    }
    n.parentNode = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(n); else this.children.splice(at, 0, n);
    return n;
  };
  El.prototype.replaceChild = function (n, old) {
    const i = this.children.indexOf(old);
    if (i >= 0) { this.children[i] = n; n.parentNode = this; old.parentNode = null; this.selfReplaceChild++; stats.replaceChild++; }
    return old;
  };
  El.prototype.removeChild = function (n) {
    const i = this.children.indexOf(n);
    if (i >= 0) { this.children.splice(i, 1); n.parentNode = null; }
    return n;
  };
  El.prototype.querySelectorAll = function () { return []; };
  El.prototype.querySelector = function () { return null; };
  El.prototype.closest = function () { return null; };
  El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  El.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, width: 120, height: 40, bottom: 40, right: 120 }; };
  El.prototype.cloneNode = function () { return new El(this.tagName); };
  El.prototype.getContext = function () { return fakeCtx; };
  El.prototype.setAttributeNS = function (k, v) { this.attrs[k] = String(v); };
  Object.defineProperty(El.prototype, 'firstChild', { get() { return this.children[0] || null; } });
  Object.defineProperty(El.prototype, 'firstElementChild', { get() { return this.children[0] || null; } });
  Object.defineProperty(El.prototype, 'nextSibling', {
    get() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; },
  });

  const ctxCalls = { clearRect: 0, fillText: 0, arc: 0, fill: 0, stroke: 0, moveTo: 0, lineTo: 0 };
  const fakeCtx = {
    canvas: null,
    measureText: t => ({ width: String(t).length * 6 }),
    setTransform() {}, save() {}, restore() {}, translate() {}, scale() {},
    beginPath() {}, closePath() {}, setLineDash() {}, fillRect() {}, lineTo() { ctxCalls.lineTo++; },
    moveTo() { ctxCalls.moveTo++; },
    arc() { ctxCalls.arc++; }, fill() { ctxCalls.fill++; }, stroke() { ctxCalls.stroke++; },
    fillText() { ctxCalls.fillText++; },
    clearRect() { ctxCalls.clearRect++; },
  };

  const document = {
    readyState: 'complete',
    body: new El('body'),
    head: new El('head'),
    documentElement: new El('html'),
    getElementById(id) { if (!byId.has(id)) byId.set(id, new El('div')); return byId.get(id); },
    createElement(tag) { stats.elementCreations++; return new El(tag); },
    createDocumentFragment() { return new El('div'); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  return { document, byId, stats, ctxCalls, el: id => document.getElementById(id) };
}

// ---------------------------------------------------------------- 假时钟 / 定时器
function makeTimers() {
  let clock = 0, nowCalls = 0, seq = 0, cleared = 0;
  const pending = new Map();
  const order = [];
  const api = {
    now() { nowCalls++; clock++; return clock; },
    clockValue() { return clock; },
    nowCalls() { return nowCalls; },
    cleared() { return cleared; },
    setTimeout(fn, delay) { const id = ++seq; pending.set(id, { fn, delay: delay || 0, seq: id, tag: 'app' }); return id; },
    clearTimeout(id) { if (pending.has(id)) { pending.delete(id); cleared++; } },
    setInterval() { return 0; },
    clearInterval() {},
    pendingSize() { return pending.size; },
    pendingIds() { return [...pending.keys()]; },
    peek(id) { return pending.get(id); },
    add(tag, fn) { const id = ++seq; pending.set(id, { fn, delay: 0, seq: id, tag }); return id; },
    drain(maxRounds) {
      maxRounds = maxRounds || 100000;
      let rounds = 0;
      while (pending.size && rounds < maxRounds) {
        rounds++;
        const next = [...pending.entries()].sort((a, b) => (a[1].delay - b[1].delay) || (a[1].seq - b[1].seq))[0];
        const [id, t] = next;
        pending.delete(id);
        const before = clock;
        t.fn();
        order.push({ tag: t.tag, delta: clock - before });
      }
      return rounds;
    },
    order,
  };
  return api;
}

const flush = async (times) => {
  for (let i = 0; i < (times || 3); i++) await new Promise(r => setImmediate(r));
};
const median = arr => {
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function bench(label, fn, runs) {
  runs = runs || 5;
  const times = [];
  return (async () => {
    await fn();                       // 1 次预热
    for (let i = 0; i < runs; i++) {
      const t0 = process.hrtime.bigint();
      await fn();
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return { label, runs, medianMs: Number(median(times).toFixed(3)), samplesMs: times.map(t => Number(t.toFixed(3))) };
  })();
}

// ---------------------------------------------------------------- 假 IndexedDB（真实 db.js 使用）
function makeIdb() {
  const stores = new Map();
  const calls = { getAll: {}, get: {}, put: {}, clear: {} };
  const bump = (kind, name) => { calls[kind][name] = (calls[kind][name] || 0) + 1; };
  let clearCalls = 0;

  function open() {
    const req = {};
    setImmediate(() => {
      const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore: (name, opts) => { stores.set(name, { keyPath: opts.keyPath, rows: new Map() }); return {}; },
        transaction: (nameOrNames, mode) => {
          // P06：支持多 store 事务（角色写入与派生投影同事务）与 getAllKeys；
          // 请求完成后触发 oncomplete，供 db.js 的"以事务提交为准"路径使用。
          const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
          const t = { oncomplete: null, onerror: null, onabort: null };
          const reqFor = value => {
            const r = { result: value };
            setImmediate(() => { if (r.onsuccess) r.onsuccess(); if (t.oncomplete) t.oncomplete(); });
            return r;
          };
          t.objectStore = (which) => {
            const name = which || names[0];
            const meta = stores.get(name);
            return {
              getAll: () => { bump('getAll', name); return reqFor([...meta.rows.values()].map(v => structuredClone(v))); },
              getAllKeys: () => reqFor([...meta.rows.keys()]),
              get: key => { bump('get', name); const v = meta.rows.get(key); return reqFor(v === undefined ? undefined : structuredClone(v)); },
              put: value => { bump('put', name); meta.rows.set(value[meta.keyPath], structuredClone(value)); return reqFor(value[meta.keyPath]); },
              add: value => { bump('put', name); const key = value[meta.keyPath] || meta.rows.size + 1; meta.rows.set(key, structuredClone(value)); return reqFor(key); },
              delete: key => { meta.rows.delete(key); return reqFor(undefined); },
              clear: () => { if (name === 'imageCache') clearCalls++; meta.rows.clear(); return reqFor(undefined); },
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
  function request(value) {
    const req = { result: value };
    setImmediate(() => { if (req.onsuccess) req.onsuccess(); });
    return req;
  }

  function load(which) {
    const document = { addEventListener() {}, visibilityState: 'visible' };
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      URL, Map, Set, Blob, TextDecoder, structuredClone, setTimeout, clearTimeout, setImmediate, Promise,
      navigator: { storage: { persist: async () => true } },
      document, window: { addEventListener() {} },
      localStorage: { getItem: () => 'old', setItem() {} },
      indexedDB: { open }, confirm: () => false, location: { reload() {} }, alert() {},
    });
    vm.runInContext((which === 'live' ? LIVE : BASELINE).db, ctx);
    vm.runInContext('globalThis.__db = { imageCacheDB, charDB, worldDB, relDB, docDB, imageHash, openDB,' +
      ' listCharactersShared: (typeof listCharactersShared === "function" ? listCharactersShared : null) };', ctx);
    return {
      ctx,
      db: ctx.__db,
      stores,
      clearCalls: () => clearCalls,
      count: (kind, name) => calls[kind][name] || 0,
      async seed(name, rows) {
        await ctx.__db.openDB();
        const meta = stores.get(name);
        rows.forEach(r => meta.rows.set(r[meta.keyPath], structuredClone(r)));
      },
    };
  }
  return { load };
}

// ---------------------------------------------------------------- sync.js 隔离环境（真实 sync.js）
function makeSyncContext(idb, fetchImpl) {
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    URL, Map, Set, Blob, FormData, AbortController, TextDecoder, Promise, Uint8Array, Array,
    FileReader: class {
      readAsDataURL(blob) {
        blob.arrayBuffer().then(b => {
          this.result = 'data:' + blob.type + ';base64,' + Buffer.from(b).toString('base64');
          this.onload();
        }, this.onerror);
      }
    },
    atob, btoa, setTimeout, clearTimeout, setImmediate,
    fetch: fetchImpl,
    imageCacheDB: idb.db.imageCacheDB,
    localStorage: { getItem: () => 'current', setItem() {} },
    window: {}, navigator: {}, document: { addEventListener() {} },
    createImageBitmap: async () => ({ close() {} }),
  });
  vm.runInContext(LIVE.sync, ctx);
  return ctx;
}
const imageResponse = bytes => ({ ok: true, status: 200, blob: async () => new Blob([bytes], { type: 'image/png' }) });

// ---------------------------------------------------------------- api-shim 隔离环境（真实 db.js + api-shim.js）
function makeApiHarness(which, rows) {
  const jsonStats = { stringify: 0, parse: 0 };
  const countingJSON = {
    stringify: v => { jsonStats.stringify++; return JSON.stringify(v); },
    parse: s => { jsonStats.parse++; return JSON.parse(s); },
  };
  const win = { fetch: () => { throw new Error('真实 fetch 不应被调用'); }, addEventListener() {}, removeEventListener() {} };
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Headers, Response, Request, Blob, URL, URLSearchParams, Map, Set, TextDecoder, structuredClone,
    atob, btoa, setTimeout, clearTimeout, setImmediate, Promise, JSON: countingJSON,
    FileReader: class { readAsDataURL() { this.onload(); } },
    window: win,
    navigator: { storage: { persist: async () => true } },
    document: { addEventListener() {}, visibilityState: 'visible' },
    localStorage: { getItem: () => 'old', setItem() {} },
    confirm: () => false, location: { reload() {} }, alert() {},
  });
  const stores = new Map();
  const calls = { getAll: {}, get: {}, put: {} };
  const bump = (kind, name) => { calls[kind][name] = (calls[kind][name] || 0) + 1; };
  function request(value) {
    const req = { result: value };
    setImmediate(() => { if (req.onsuccess) req.onsuccess(); });
    return req;
  }
  function open() {
    const req = {};
    setImmediate(() => {
      const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore: (name, opts) => { stores.set(name, { keyPath: opts.keyPath, rows: new Map() }); return {}; },
        transaction: nameOrNames => {
          // P06：支持多 store 事务（角色写入与派生投影同事务）与 getAllKeys/oncomplete。
          const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
          const t = { oncomplete: null, onerror: null, onabort: null };
          const reqFor = value => {
            const r = { result: value };
            setImmediate(() => { if (r.onsuccess) r.onsuccess(); if (t.oncomplete) t.oncomplete(); });
            return r;
          };
          t.objectStore = (which) => {
            const name = which || names[0];
            const meta = stores.get(name);
            return {
              getAll: () => { bump('getAll', name); return reqFor([...meta.rows.values()].map(v => structuredClone(v))); },
              getAllKeys: () => reqFor([...meta.rows.keys()]),
              get: key => { bump('get', name); const v = meta.rows.get(key); return reqFor(v === undefined ? undefined : structuredClone(v)); },
              put: value => { bump('put', name); meta.rows.set(value[meta.keyPath], structuredClone(value)); return reqFor(value[meta.keyPath]); },
              add: value => { bump('put', name); const key = value[meta.keyPath] || meta.rows.size + 1; meta.rows.set(key, structuredClone(value)); return reqFor(key); },
              delete: key => { meta.rows.delete(key); return reqFor(undefined); },
              clear: () => { meta.rows.clear(); return reqFor(undefined); },
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
  ctx.indexedDB = { open };
  vm.runInContext((which === 'live' ? LIVE : BASELINE).db, ctx);
  vm.runInContext((which === 'live' ? LIVE : BASELINE).shim, ctx);
  return {
    win,
    jsonStats,
    count: (kind, name) => calls[kind][name] || 0,
    async seed(name, rows) {
      await ctx.openDB();
      const meta = stores.get(name);
      rows.forEach(r => meta.rows.set(r[meta.keyPath], structuredClone(r)));
    },
  };
}

// ---------------------------------------------------------------- app.js 视图隔离环境
function makeAppHarness(which, options) {
  options = options || {};
  const source = (which === 'live' ? LIVE : BASELINE).app;
  const head = source.slice(0, source.indexOf(CHAR_SECTION));
  const indexModule = source.slice(source.indexOf(CHAR_SECTION), source.indexOf(WORLD_SECTION));
  const dom = makeDom();
  const timers = makeTimers();
  const net = { calls: 0 };
  const storage = { setItem: 0, getItem: 0, bytes: 0 };
  let characters = options.characters || makeCharacters();
  const fetchImpl = async () => {
    net.calls++;
    return { ok: true, json: async () => characters.map(c => ({ ...c })) };
  };
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    document: dom.document,
    window: { appDataRevision: 0, addEventListener() {}, devicePixelRatio: 1 },
    Map, Set, JSON, Math, Object, Array, String, Number, Promise, RegExp, Date,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    performance: { now: () => timers.now() },
    fetch: fetchImpl,
    sessionStorage: {
      getItem: () => { storage.getItem++; return null; },
      setItem: (k, v) => { storage.setItem++; storage.bytes += String(v).length; },
      removeItem() {},
    },
    localStorage: { getItem: () => '', setItem() {} },
    navigator: {}, location: { protocol: 'file:' },
  });
  vm.runInContext(head + indexModule, ctx);
  const grid = dom.el('charGrid');
  // htmlChars/creations 统计"这一轮构建了多少 HTML / 节点"，对整表重建与增量复用都可比。
  const metrics = () => ({
    fetch: net.calls,
    htmlChars: dom.stats.htmlChars,
    creations: dom.stats.elementCreations,
    containerWrites: grid.selfWrites,
    containerChars: grid.selfHtmlChars,
    nodeReplaces: grid.selfReplaceChild,
  });
  const delta = (a, b) => {
    const out = {};
    for (const k of Object.keys(a)) out[k] = a[k] - b[k];
    return out;
  };
  return {
    ctx,
    dom,
    timers,
    net,
    storage,
    grid,
    setCharacters: c => { characters = c; },
    metrics,
    async visit(forceReload) {
      const before = metrics();
      if (forceReload) ctx.VM.index.refresh(); else { ctx.VM.index.init(); }
      await flush();
      return delta(metrics(), before);
    },
    async refresh() {
      const before = metrics();
      ctx.VM.index.refresh();
      await flush();
      return delta(metrics(), before);
    },
  };
}

// ---------------------------------------------------------------- 关系图隔离环境
function makeGraphHarness(which) {
  const source = (which === 'live' ? LIVE : BASELINE).app;
  const head = source.slice(0, source.indexOf(CHAR_SECTION));
  const relModule = source.slice(source.indexOf(REL_SECTION));
  const dom = makeDom();
  const timers = makeTimers();
  const characters = makeCharacters();
  const relations = makeRelations();
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    document: dom.document,
    window: { appDataRevision: 0, addEventListener() {}, devicePixelRatio: 1 },
    Map, Set, JSON, Math, Object, Array, String, Number, Promise, RegExp, Date,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    performance: { now: () => timers.now() },
    fetch: async url => ({
      ok: true,
      json: async () => String(url).indexOf('/api/relations') !== -1 ? relations : characters,
    }),
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => '', setItem() {} },
    navigator: {}, location: { protocol: 'file:' },
  });
  vm.runInContext(head + relModule, ctx);
  return { ctx, dom, timers, draws: () => dom.ctxCalls.clearRect };
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const report = { sample: { characters: SAMPLE_CHARS, images: SAMPLE_IMAGES, imageKiB: IMAGE_BYTES / 1024 }, checks: [], counts: {}, perf: [] };
  const ok = (id, detail) => { report.checks.push({ id, ok: true, detail }); };

  // ---------- 0. 基线快照哈希（保证前后对比不是同一份代码）
  const manifest = readText(path.join(BASE, 'MANIFEST.txt'));
  for (const f of ['app.js', 'db.js', 'sync.js', 'api-shim.js', 'sync-ui.js']) {
    const line = manifest.split('\n').find(l => l.trim().startsWith(f + ' '));
    assert.ok(line, 'MANIFEST 缺少 ' + f);
    const want = /sha256=([0-9a-f]{64})/.exec(line)[1];
    const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(BASE, f))).digest('hex');
    assert.equal(got, want, '基线快照哈希不符: ' + f);
  }
  assert.notEqual(LIVE.app, BASELINE.app, '基线快照与当前 app.js 相同');
  assert.notEqual(LIVE.db, BASELINE.db, '基线快照与当前 db.js 相同');
  ok('baselineSnapshot', '5 个基线文件哈希匹配 MANIFEST，且与当前实现不同');

  // ---------- 1/2. 角色页：未变更返回 0 查询 0 重建；变更后只重建变化的节点
  const live = makeAppHarness('live');
  const first = await live.visit(false);
  assert.equal(first.fetch, 1, '首次进入应恰好查询一次');
  assert.ok(first.htmlChars > 0 && live.grid.children.length > 0, '首次进入应渲染列表');
  const revisit = await live.visit(true);      // 同版本回访
  assert.equal(revisit.fetch, 0, '未变更回访不应再查询角色');
  assert.equal(revisit.containerWrites, 0, '未变更回访不应重建列表容器');
  assert.equal(revisit.htmlChars, 0, '未变更回访不应重建任何卡片 HTML');
  assert.equal(revisit.creations, 0, '未变更回访不应新建任何节点');
  live.ctx.markAppDataChanged();               // 版本变化但数据相同（例如同步后无变更）
  const sameData = await live.refresh();
  assert.equal(sameData.fetch, 1, '版本变化后应重新查询');
  assert.equal(sameData.htmlChars, 0, '数据未变化时不应重建列表 DOM');
  assert.equal(sameData.creations, 0, '数据未变化时不应新建节点');
  const next = makeCharacters();
  next[7].setting = '被修改过的设定文本';      // 只改一个不影响分组的字段
  live.setCharacters(next);
  live.ctx.markAppDataChanged();
  const oneChange = await live.refresh();
  assert.equal(oneChange.fetch, 1, '数据变化后应重新查询');
  assert.equal(oneChange.nodeReplaces, 1, '只有变化的那个卡片节点被重建，实际 ' + oneChange.nodeReplaces);
  assert.ok(oneChange.htmlChars > 0 && oneChange.htmlChars < first.htmlChars / 10,
    '变更重建的 HTML 量应远小于整表重建');
  const next2 = makeCharacters();
  next2[7].setting = '被修改过的设定文本';
  next2[7].region = '新地区';                  // 改组会同时更新对应分区标题
  live.setCharacters(next2);
  live.ctx.markAppDataChanged();
  const groupChange = await live.refresh();
  assert.ok(groupChange.nodeReplaces <= 3,
    '改组只应重建受影响的卡片与分区标题，实际 ' + groupChange.nodeReplaces);
  ok('unchangedRevisitZeroWork', JSON.stringify({ revisit, sameData, oneChange }));
  report.counts.unchangedRevisit = revisit;
  report.counts.singleRecordChange = oneChange;

  // 3. 搜索防抖：连续输入只渲染一次
  const countEl = live.dom.el('charCount');
  const beforeSearch = countEl.selfTextWrites;
  live.dom.el('indexSearchInput').value = '角色';
  live.ctx.VM.index.onSearch();
  live.ctx.VM.index.onSearch();
  live.ctx.VM.index.onSearch();
  assert.equal(countEl.selfTextWrites, beforeSearch, '防抖窗口内不应渲染');
  live.timers.drain();
  assert.equal(countEl.selfTextWrites, beforeSearch + 1, '连续输入只应触发一次渲染，实际 ' + (countEl.selfTextWrites - beforeSearch));
  ok('searchDebounce', '3 次连续输入 → 1 次渲染');
  report.counts.searchDebounceRenders = countEl.selfTextWrites - beforeSearch;

  // 4. sessionStorage 不再序列化角色记录
  assert.equal(live.storage.setItem, 0, 'live 实现不应再写 sessionStorage');
  const baselineApp = makeAppHarness('baseline');
  await baselineApp.visit(false);
  await baselineApp.visit(true);
  assert.ok(baselineApp.storage.setItem > 0, '基线实现应写 sessionStorage（对照）');
  ok('noSessionStorageSerialization', JSON.stringify({ liveSetItem: live.storage.setItem, baselineSetItem: baselineApp.storage.setItem }));
  report.counts.sessionStorage = { live: live.storage.setItem, baseline: baselineApp.storage.setItem };

  // ---------- 5. imageCache：每轮最多一次全表读取；无索引时按主键 get 定位
  const idbLive = makeIdb().load('live');
  const downloadCount = { n: 0 };
  const syncCtx = makeSyncContext(idbLive, async () => { downloadCount.n++; return imageResponse(pngBytes('dl-' + downloadCount.n, IMAGE_BYTES)); });
  const charsForSync = [
    { name: 'A', images: SAMPLE_DATA_URLS.slice(0, 13).map((_, i) => '/api/images/a' + i + '.png') },
    { name: 'B', images: SAMPLE_DATA_URLS.slice(13).map((_, i) => '/api/images/b' + i + '.png') },
  ];
  const getAllBefore = idbLive.count('getAll', 'imageCache');
  await syncCtx.convertServerImagesToDataUrl(charsForSync, 'http://server');
  const getAllAfter = idbLive.count('getAll', 'imageCache');
  assert.equal(getAllAfter - getAllBefore, 1, '一轮下载最多一次 imageCache 全表读取，实际 ' + (getAllAfter - getAllBefore));
  assert.ok(charsForSync.every(c => c.images.every(u => /^data:image\/png;base64,/.test(u))), '图片应转成可持久 data URL');
  assert.equal(charsForSync[0].images.length, 13);
  const rows = await idbLive.db.imageCacheDB.listAll();
  assert.equal(rows.length, SAMPLE_IMAGES, '缓存行数应等于图片数，实际 ' + rows.length);

  const getAllBefore2 = idbLive.count('getAll', 'imageCache');
  const getBefore = idbLive.count('get', 'imageCache');
  const probe = SAMPLE_DATA_URLS[0];
  const stored = await idbLive.db.imageCacheDB.set(probe, 'http://server/api/images/probe-1.png');
  await idbLive.db.imageCacheDB.set(probe, 'http://server/api/images/probe-2.png');
  const probeRec = await idbLive.db.imageCacheDB.getByDataUrl(probe);
  const setLookupExtraGetAll = idbLive.count('getAll', 'imageCache') - getAllBefore2;
  assert.equal(setLookupExtraGetAll, 0, '按 dataUrl 写入/查找不应读全表');
  assert.ok(idbLive.count('get', 'imageCache') > getBefore, '应按主键 get 定位');
  assert.deepEqual(new Set(probeRec.serverUrls), new Set(['http://server/api/images/probe-1.png', 'http://server/api/images/probe-2.png']));
  assert.equal(probeRec.dataUrl, probe, '完整值校验：命中同一原图');
  const freshRows = await idbLive.db.imageCacheDB.listAll();   // 测试自查用的一次全表读取
  const probeRow = freshRows.find(r => r.dataUrl === probe);
  assert.ok(probeRow, '按 dataUrl 写入后应能被列出');
  assert.equal(probeRow.hash, probeRec.hash, '主键查找与全表列出结果一致');
  assert.equal(freshRows.length, SAMPLE_IMAGES + 1);
  ok('imageCacheRoundSingleGetAll', JSON.stringify({ getAllPerRound: getAllAfter - getAllBefore, rows: rows.length, setLookupExtraGetAll }));
  report.counts.imageCache = { getAllPerRound: getAllAfter - getAllBefore, rows: rows.length, setLookupExtraGetAll, verifyListAll: 1 };

  // ---------- 6. 关系名称补全共享本轮角色读取；写入后失效
  const api = makeApiHarness('live');
  await api.seed('characters', makeCharacters());
  await api.seed('relations', makeRelations().map(r => ({ id: r.id, from_char_id: r.from_char_id, to_char_id: r.to_char_id, relation_type: r.relation_type, description: r.description, sort_order: r.sort_order })));
  const charGetAllBefore = api.count('getAll', 'characters');
  const [charRes, relRes] = await Promise.all([api.win.fetch('/api/characters'), api.win.fetch('/api/relations')]);
  const relsRead = await relRes.json();
  const charsRead = await charRes.json();
  assert.equal(api.count('getAll', 'characters') - charGetAllBefore, 1, '并发的角色/关系请求应共享一次角色全表读取');
  assert.equal(charsRead.length, SAMPLE_CHARS);
  assert.ok(relsRead.every(r => r.from_name && r.to_name), '关系应补全角色名称');
  assert.equal(relsRead[0].from_name, '角色' + ((0 % 80) + 1));
  const afterWrite = api.count('getAll', 'characters');
  await api.win.fetch('/api/characters', { method: 'POST', body: JSON.stringify({ name: '新角色' }) });
  const fresh = await (await api.win.fetch('/api/characters')).json();
  assert.equal(api.count('getAll', 'characters') - afterWrite, 1, '写入后共享读取失效，下一次读取重新读表');
  assert.equal(fresh.length, SAMPLE_CHARS + 1);
  ok('sharedCharacterRead', JSON.stringify({ concurrentGetAll: 1, afterWriteGetAll: 1 }));
  report.counts.sharedCharacterRead = { concurrent: 1, afterWrite: 1 };

  // ---------- 7. 延迟序列化响应与读者隔离
  const api2 = makeApiHarness('live');
  await api2.seed('characters', makeCharacters());
  const jsonBefore = { ...api2.jsonStats };
  const res = await api2.win.fetch('/api/characters');
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  const list = await res.json();
  assert.equal(list.length, SAMPLE_CHARS);
  const lazyRead = { stringifyDelta: api2.jsonStats.stringify - jsonBefore.stringify, parseDelta: api2.jsonStats.parse - jsonBefore.parse };
  assert.equal(lazyRead.stringifyDelta, 0, 'json() 不应再整表 stringify');
  assert.equal(lazyRead.parseDelta, 0, 'json() 不应再整表 parse');
  const text = await res.text();
  assert.equal(JSON.parse(text).length, SAMPLE_CHARS);
  const blob = await res.blob();
  assert.ok(blob.size > 0 && blob.type === 'application/json');
  assert.equal((await res.json()).length, SAMPLE_CHARS);
  const cloned = res.clone();
  assert.equal((await cloned.json()).length, SAMPLE_CHARS);
  // 读者修改返回值不得污染存储对象
  list[0].name = '被读者改坏的名字';
  list.push({ id: 9999, name: '凭空多出来的角色' });
  const freshRes = await (await api2.win.fetch('/api/characters')).json();
  assert.equal(freshRes.length, SAMPLE_CHARS, '读者修改不应影响存储');
  assert.equal(freshRes[0].name, '角色1', '读者修改不应改写存储记录');
  ok('lazyJsonResponse', JSON.stringify({ jsonRead: lazyRead, blobBytes: blob.size,
    textStringify: api2.jsonStats.stringify - jsonBefore.stringify - lazyRead.stringifyDelta }));
  report.counts.lazyJson = { jsonRead: lazyRead, bytes: blob.size };

  // ---------- 8. 图片下载并发：两等长延迟出现重叠且并发 ≤ 2
  const syncCtx2 = makeSyncContext(idbLive, async () => imageResponse(pngBytes('x', 2048)));
  const t0 = Date.now();
  const spans = [];
  let active = 0, maxActive = 0, overlapped = false;
  await syncCtx2.runBounded([0, 1, 2, 3, 4], 2, async i => {
    active++;
    maxActive = Math.max(maxActive, active);
    if (active > 1) overlapped = true;      // 两个等长延迟任务同时在场即出现重叠
    const s = Date.now() - t0;
    await new Promise(r => setTimeout(r, 30));
    spans.push({ i, s, e: Date.now() - t0 });
    active--;
  });
  assert.equal(maxActive, 2, '并发上限应为 2，实际 ' + maxActive);
  assert.ok(overlapped, '两个等长延迟图应出现实际重叠');
  ok('boundedConcurrencyOverlap', JSON.stringify({ maxActive, overlapped, spans }));
  report.counts.overlap = maxActive;

  // ---------- 9. 关系图：先设 edges / 分块让出 / heartbeat / 取消 / 隐藏页暂停恢复
  const graphSrc = LIVE.app.slice(LIVE.app.indexOf('function graphInit()'), LIVE.app.indexOf('function graphReset()'));
  assert.ok(graphSrc.indexOf('gEdges = allRelations.map') > -1 &&
    graphSrc.indexOf('gEdges = allRelations.map') < graphSrc.indexOf('startLayout()'),
    'graphInit 必须在本轮布局前设置 edges');

  const graph = makeGraphHarness('live');
  const callsBeforeLayout = graph.timers.nowCalls();
  graph.ctx.VM.relations.init();
  await flush();
  const firstChunkNowCalls = graph.timers.nowCalls() - callsBeforeLayout;
  assert.ok(firstChunkNowCalls >= 2 && firstChunkNowCalls <= 12,
    '首个同步块应只跑有限步（约 8ms 预算），nowMs 调用=' + firstChunkNowCalls);
  assert.ok(graph.timers.pendingSize() > 0, '布局应让出事件循环并排队下一块');
  assert.equal(graph.timers.order.length, 0, '尚未执行任何排队回调');

  const drawsBeforeDrain = graph.draws();
  const hb = { ranAtChunk: -1, drawsWhenRan: -1 };
  graph.timers.add('heartbeat', () => {
    hb.ranAtChunk = graph.timers.order.filter(o => o.tag === 'app').length;
    hb.drawsWhenRan = graph.draws();
  });
  graph.timers.drain(10000);
  const chunks = graph.timers.order.filter(o => o.tag === 'app');
  const stepsPerChunk = chunks.map(c => c.delta - 1);
  const firstChunkSteps = firstChunkNowCalls - 1;       // 首个同步块不在定时器队列里
  const totalSteps = firstChunkSteps + stepsPerChunk.reduce((a, b) => a + b, 0);
  assert.ok(hb.ranAtChunk > 0, 'heartbeat 应在布局执行期间运行');
  assert.equal(hb.drawsWhenRan, drawsBeforeDrain, 'heartbeat 运行时布局尚未完成');
  assert.ok(chunks.length > 10, '应分成多个块执行，实际 ' + chunks.length);
  assert.ok(firstChunkSteps >= 1 && firstChunkSteps <= 10, '首个同步块步数应受预算限制，实际 ' + firstChunkSteps);
  // 末尾块可能是余数；其余每块都应受约 8ms 预算限制。
  assert.ok(stepsPerChunk.slice(0, -1).every(s => s >= 6 && s <= 10),
    '每块应受约 8ms 预算限制，实际 ' + JSON.stringify(stepsPerChunk.slice(0, 5)));
  assert.ok(stepsPerChunk[stepsPerChunk.length - 1] >= 1, '末尾块应执行剩余步数');
  assert.equal(totalSteps, 300, '总步数应保持 300，实际 ' + totalSteps);
  assert.equal(graph.draws() - drawsBeforeDrain, 1, '布局完成后绘制一次');
  ok('graphChunkedHeartbeat', JSON.stringify({ chunks: chunks.length, totalSteps, hbAtChunk: hb.ranAtChunk, stepsPerChunkSample: stepsPerChunk.slice(0, 3) }));
  report.counts.graph = { chunks: chunks.length, totalSteps, heartbeatAtChunk: hb.ranAtChunk, stepsPerChunk: stepsPerChunk[0] };

  // 取消：旧 generation 的在途块被清除且不再执行
  graph.ctx.VM.relations.graphReset();
  await flush();
  const pendingId = graph.timers.pendingIds()[0];
  const staleFn = graph.timers.peek(pendingId).fn;
  const drawsAtCancel = graph.draws();
  graph.ctx.VM.relations.graphReset();          // 新 generation 取消旧 generation（并同步跑自己的首块）
  const nowAfterCancel = graph.timers.nowCalls();
  assert.equal(graph.timers.peek(pendingId), undefined, '旧 generation 的定时器应被清除');
  staleFn();                                     // 手动执行被取消的旧块
  assert.equal(graph.timers.nowCalls(), nowAfterCancel, '被取消的旧块不得再执行布局步');
  assert.equal(graph.timers.pendingIds().length, 1, '只应保留新 generation 的在途块');
  graph.timers.drain(10000);
  assert.equal(graph.draws(), drawsAtCancel + 1, '新 generation 应分块完成并绘制一次');
  ok('graphCancelGeneration', 'cancelledChunkNoOp=true clearedTimers=' + graph.timers.cleared());

  // 隐藏页不持续布局；重新进入恢复
  graph.ctx.VM.relations.graphReset();
  await flush();
  const drawsBeforeHide = graph.draws();
  graph.dom.el('view-relations').style.display = 'none';
  graph.timers.drain(10000);
  assert.equal(graph.timers.pendingSize(), 0, '隐藏页不应继续排队布局块');
  assert.equal(graph.draws(), drawsBeforeHide, '隐藏页不应完成并绘制');
  graph.dom.el('view-relations').style.display = '';
  graph.ctx.VM.relations.refresh();              // 同版本返回：不重新查询，恢复布局
  await flush();
  graph.timers.drain(10000);
  assert.equal(graph.draws(), drawsBeforeHide + 1, '重新进入应恢复并完成正确布局');
  ok('graphHiddenPauseResume', 'paused=true resumedAndCompleted=true');
  report.counts.graphPauseResume = { drawsBeforeHide, afterResume: graph.draws() };

  // ---------- 10. 同一样本 5 次（1 预热）性能比较
  const perfLive = makeAppHarness('live');
  const perfBase = makeAppHarness('baseline');
  report.perf.push(await bench('列表首次渲染 80 卡（基线）', async () => { const h = makeAppHarness('baseline'); await h.visit(false); }));
  report.perf.push(await bench('列表首次渲染 80 卡（当前）', async () => { const h = makeAppHarness('live'); await h.visit(false); }));
  await perfBase.visit(false); await perfLive.visit(false);
  report.perf.push(await bench('未变更回访渲染（基线）', async () => { await perfBase.refresh(); }));
  report.perf.push(await bench('未变更回访渲染（当前）', async () => { await perfLive.refresh(); }));

  // imageCache 定位 ×25
  const idbBaseLookup = makeIdb().load('baseline');
  const idbLiveLookup = makeIdb().load('live');
  const cacheRows = SAMPLE_DATA_URLS.map((u, i) => ({ hash: 'h' + i, dataUrl: u, serverUrl: 'http://server/api/images/i' + i + '.png', serverUrls: ['http://server/api/images/i' + i + '.png'] }));
  await idbBaseLookup.seed('imageCache', cacheRows);
  await idbLiveLookup.seed('imageCache', cacheRows);
  const lookupAll = async (idb) => { for (const u of SAMPLE_DATA_URLS) await idb.db.imageCacheDB.getByDataUrl(u); };
  report.perf.push(await bench('imageCache 按 dataUrl 定位 ×25（基线 listAll+find）', () => lookupAll(idbBaseLookup)));
  report.perf.push(await bench('imageCache 按 dataUrl 定位 ×25（当前主键 get）', () => lookupAll(idbLiveLookup)));
  const baseLookupGetAll = idbBaseLookup.count('getAll', 'imageCache');
  const liveLookupGetAll = idbLiveLookup.count('getAll', 'imageCache');
  assert.equal(liveLookupGetAll, 0, '当前实现按 dataUrl 定位不应读全表');
  assert.ok(baseLookupGetAll >= 6, '基线实现每次定位都读全表');
  report.counts.cacheLookupGetAll = { baseline: baseLookupGetAll, live: liveLookupGetAll };

  // api-shim 响应传递 80 角色
  const apiBase = makeApiHarness('baseline');
  const apiLive = makeApiHarness('live');
  await apiBase.seed('characters', makeCharacters());
  await apiLive.seed('characters', makeCharacters());
  report.perf.push(await bench('角色列表响应传递 80 条（基线 stringify+parse）', async () => {
    const r = await apiBase.win.fetch('/api/characters');
    await r.json();
    return r;
  }));
  report.perf.push(await bench('角色列表响应传递 80 条（当前延迟序列化）', async () => {
    const r = await apiLive.win.fetch('/api/characters');
    await r.json();
    return r;
  }));
  report.counts.responseJson = { baselineStringify: apiBase.jsonStats.stringify, liveStringify: apiLive.jsonStats.stringify };
  assert.ok(apiBase.jsonStats.stringify >= 6, '基线响应应整表 stringify');
  assert.equal(apiLive.jsonStats.stringify, 0, '当前响应不应整表 stringify');

  // 关系图 300 步布局
  await bench('关系图 300 步（基线 阻塞+每步 find/拆家族）', async () => {
    const g = makeGraphHarness('baseline');
    g.ctx.VM.relations.refresh();
    await flush();
    g.timers.drain(10000);
  }).then(r => report.perf.push(r));
  await bench('关系图 300 步（当前 预索引+分块）', async () => {
    const g = makeGraphHarness('live');
    g.ctx.VM.relations.refresh();
    await flush();
    g.timers.drain(10000);
  }).then(r => report.perf.push(r));

  for (const p of report.perf) {
    const base = report.perf.find(x => x.label.indexOf('基线') !== -1 && x.label.split('（')[0] === p.label.split('（')[0]);
    if (base && p !== base) p.ratioToBaseline = Number((p.medianMs / base.medianMs).toFixed(3));
  }
  const perfOf = prefix => {
    const base = report.perf.find(p => p.label.indexOf(prefix) === 0 && p.label.indexOf('基线') !== -1);
    const liveP = report.perf.find(p => p.label.indexOf(prefix) === 0 && p.label.indexOf('当前') !== -1);
    assert.ok(base && liveP, '缺少性能样本: ' + prefix);
    return Number((liveP.medianMs / base.medianMs).toFixed(3));
  };
  report.ratios = {
    firstRender: perfOf('列表首次渲染 80 卡'),
    unchangedRevisit: perfOf('未变更回访渲染'),
    cacheLookup: perfOf('imageCache 按 dataUrl 定位 ×25'),
    responseTransfer: perfOf('角色列表响应传递 80 条'),
    graphLayout: perfOf('关系图 300 步'),
  };
  // 同一样本 5 次中位数口径：结构上确定改善的项要求达到合同同量级的 30% 改善目标；
  // 首次渲染允许基本持平但不允许明显回退。
  assert.ok(report.ratios.unchangedRevisit <= 0.1, '未变更回访耗时应降至基线 10% 以内，实际 ' + report.ratios.unchangedRevisit);
  assert.ok(report.ratios.cacheLookup <= 0.7, '缓存定位耗时应改善 ≥30%，实际 ' + report.ratios.cacheLookup);
  assert.ok(report.ratios.responseTransfer <= 0.7, '列表响应传递耗时应改善 ≥30%，实际 ' + report.ratios.responseTransfer);
  assert.ok(report.ratios.graphLayout <= 0.7, '图布局耗时应改善 ≥30%，实际 ' + report.ratios.graphLayout);
  assert.ok(report.ratios.firstRender <= 1.25, '首次渲染不得明显回退，实际 ' + report.ratios.firstRender);
  ok('perfMedians', JSON.stringify(report.ratios));

  console.log(JSON.stringify(report, null, 2));
  console.log('[p03] OK：' + report.checks.length + ' 项计数/行为门槛通过');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
