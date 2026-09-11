// P02 generation 2：只使用隔离内存假服务和合成图片，不触碰真实服务器/数据库。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const syncSource = fs.readFileSync(path.join(root, 'android-app/app/src/main/assets/web/sync.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'android-app/app/src/main/assets/web/db.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'android-app/app/src/main/assets/web/app.js'), 'utf8');
const PNG_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_URL = 'data:image/png;base64,' + PNG_DATA;

function response(status, bytes = Buffer.from([]), type = 'image/png') {
  return { ok: status >= 200 && status < 300, status, blob: async () => new Blob([bytes], { type }) };
}

function makeCache(initial = []) {
  const rows = initial.map(x => ({ ...x, serverUrls: x.serverUrls || (x.serverUrl ? [x.serverUrl] : []) }));
  const calls = { listAll: 0, writes: 0 };
  return {
    calls, rows,
    listAll: async () => { calls.listAll++; return rows.map(x => ({ ...x, serverUrls: x.serverUrls.slice() })); },
    set: async (dataUrl, serverUrl, known) => {
      calls.writes++;
      const list = known || rows;
      let row = list.find(x => x.dataUrl === dataUrl);
      if (!row) { row = { hash: String(dataUrl.length) + '_test_' + list.length, dataUrl, serverUrl, serverUrls: [serverUrl] }; list.push(row); }
      row.serverUrls = row.serverUrls || (row.serverUrl ? [row.serverUrl] : []);
      if (!row.serverUrls.includes(serverUrl)) row.serverUrls.push(serverUrl);
      row.serverUrl = row.serverUrl || row.serverUrls[0];
    },
    clear: async () => { calls.clear = (calls.clear || 0) + 1; rows.length = 0; },
  };
}

function makeSync(fetchImpl, cache = makeCache(), extras = {}) {
  const context = vm.createContext({
    console, URL, Map, Set, Blob, FormData, AbortController, TextDecoder, FileReader: class {
      readAsDataURL(blob) { blob.arrayBuffer().then(b => { this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`; this.onload(); }, this.onerror); }
    },
    atob, btoa, setTimeout, clearTimeout, fetch: fetchImpl, imageCacheDB: cache,
    localStorage: { getItem: () => 'current', setItem: () => {} }, window: {}, navigator: {}, document: {},
    createImageBitmap: async () => ({ close() {} }), ...extras,
  });
  vm.runInContext(syncSource, context);
  return { context, cache };
}

function makeIdbContext() {
  const stores = new Map();
  let clearCalls = 0;
  function open() {
    const req = {};
    setTimeout(() => {
      const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore: (name, opts) => { stores.set(name, { keyPath: opts.keyPath, rows: new Map() }); return {}; },
        transaction: (name, mode) => {
          const t = { objectStore: () => {
            const meta = stores.get(name);
            return {
              getAll: () => request([...meta.rows.values()]),
              get: key => request(meta.rows.get(key)),
              put: value => { if (name === 'imageCache' && !value.hash) throw new Error('missing key'); meta.rows.set(value[meta.keyPath], structuredClone(value)); return request(value[meta.keyPath], t); },
              add: value => { const key = value[meta.keyPath] || meta.rows.size + 1; meta.rows.set(key, structuredClone(value)); return request(key, t); },
              delete: key => { meta.rows.delete(key); return request(undefined, t); },
              clear: () => { if (name === 'imageCache') clearCalls++; meta.rows.clear(); return request(undefined, t); },
            };
          } };
          return t;
        },
      };
      req.result = db;
      if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
  function request(value, tx) {
    const req = { result: value };
    setTimeout(() => { if (req.onsuccess) req.onsuccess(); if (tx && tx.oncomplete) tx.oncomplete(); }, 0);
    return req;
  }
  const document = { addEventListener() {} };
  const context = vm.createContext({ console, URL, Map, Set, Blob, TextDecoder, structuredClone, setTimeout, clearTimeout,
    navigator: { storage: { persist: async () => true } }, document, window: { addEventListener() {} }, localStorage: { getItem: () => 'old', setItem() {} },
    indexedDB: { open }, confirm: () => false, location: { reload() {} }, alert() {}, setTimeout, clearTimeout });
  vm.runInContext(dbSource, context);
  vm.runInContext('globalThis.__imageCacheDB = imageCacheDB;', context);
  return { context, stores, get clearCalls() { return clearCalls; } };
}

async function main() {
  // R01：真实 db.js imageCache 方法保留同图多服务器映射，并按完整值查找。
  const idb = makeIdbContext();
  await idb.context.__imageCacheDB.set(PNG_URL, 'http://a:8000/api/images/a.png');
  await idb.context.__imageCacheDB.set(PNG_URL, 'http://b:8000/api/images/b.png');
  const rows = await idb.context.__imageCacheDB.listAll();
  assert.equal(rows.length, 1);
  assert.deepEqual(new Set(rows[0].serverUrls), new Set(['http://a:8000/api/images/a.png', 'http://b:8000/api/images/b.png']));
  assert.equal((await idb.context.__imageCacheDB.getByServerUrl('http://b:8000/api/images/b.png')).dataUrl, PNG_URL);
  // 同一 hash 的不同完整值也不能互相覆盖（保持 v2 keyPath，不做迁移）。
  const collision = new Map();
  let collisionPair = null;
  for (let i = 0; i < 200000 && !collisionPair; i++) {
    const value = 'data:image/png;base64,' + i.toString(36).padStart(5, '0');
    const hash = idb.context.imageHash(value);
    if (collision.has(hash)) collisionPair = [collision.get(hash), value];
    else collision.set(hash, value);
  }
  const pair = collisionPair;
  assert.ok(pair, '应找到合成 hash 碰撞样本');
  await idb.context.__imageCacheDB.set(pair[0], 'http://a:8000/api/images/collision-a.png');
  await idb.context.__imageCacheDB.set(pair[1], 'http://a:8000/api/images/collision-b.png');
  assert.equal((await idb.context.__imageCacheDB.getByDataUrl(pair[0])).dataUrl, pair[0]);
  assert.equal((await idb.context.__imageCacheDB.getByDataUrl(pair[1])).dataUrl, pair[1]);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(idb.clearCalls, 0, '版本标记不应清空 imageCache');

  // R02/R03：可解码图片成功；坏缓存按 miss 恢复；data/blob 必须先转成 data URL。
  let networkCalls = 0;
  const cache = makeCache([{ hash: 'bad', dataUrl: 'data:image/png;base64,YQ==', serverUrl: 'http://server/api/images/recover.png' }]);
  const sync = makeSync(async url => { networkCalls++; return response(200, Buffer.from(Uint8Array.from(Buffer.from(PNG_DATA, 'base64')))); }, cache);
  const recovered = [{ images: ['/api/images/recover.png'] }];
  await sync.context.convertServerImagesToDataUrl(recovered, 'http://server');
  assert.equal(networkCalls, 1);
  assert.match(recovered[0].images[0], /^data:image\/png;base64,/);
  const localBlob = new Blob([Buffer.from(PNG_DATA, 'base64')], { type: 'image/png' });
  const blobSync = makeSync(async url => url.startsWith('blob:') ? response(200, await localBlob.arrayBuffer(), 'image/png') : response(404), makeCache(), { fetch: async url => url.startsWith('blob:') ? response(200, await localBlob.arrayBuffer(), 'image/png') : response(404) });
  const blobRec = [{ images: ['blob:isolated'] }];
  await blobSync.context.convertServerImagesToDataUrl(blobRec, 'http://server');
  assert.match(blobRec[0].images[0], /^data:image\/png;base64,/);
  await assert.rejects(sync.context.convertServerImagesToDataUrl([{ images: ['data:image/png;base64,YQ=='] }], 'http://server'), /图片内容无效/);

  // R02：失败后等待在途任务收尾，且不再调度新任务。
  const lifecycle = makeSync(async () => response(200, Buffer.from(PNG_DATA, 'base64')), makeCache());
  let started = 0, finished = 0, writesAfterFailure = 0;
  await assert.rejects(lifecycle.context.runBounded([1, 2, 3, 4], 2, async (item) => {
    started++;
    if (item === 2) { await new Promise(r => setTimeout(r, 5)); throw new Error('fail'); }
    await new Promise(r => setTimeout(r, 20));
    finished++;
    if (item === 1 || item === 3) writesAfterFailure++;
  }));
  assert.equal(started, 2);
  assert.equal(finished, 1);
  assert.equal(writesAfterFailure, 1);

  // R01/R04：预览只加载一次完整缓存快照；cover 字段独立参与比较。
  const previewCache = makeCache([{ hash: 'x', dataUrl: PNG_URL, serverUrl: 'http://server/api/images/a.png' }]);
  const preview = makeSync(async () => response(200, Buffer.from(PNG_DATA, 'base64')), previewCache);
  const index = await preview.context.loadImageCacheIndex();
  const many = Array.from({ length: 80 }, (_, i) => ({ name: String(i), images: [PNG_URL], image_url: PNG_URL }));
  await preview.context.canonicalizeRecordsForDiff(many, 'http://server', true, index);
  assert.equal(previewCache.calls.listAll, 1);
  assert.equal(preview.context.charContentEqual({ images: [PNG_URL], image_url: 'cover-a' }, { images: [PNG_URL], image_url: 'cover-b' }), false);

  // R03：上传前能识别 404 映射为 stale，比较不会被旧映射压成零变化。
  const staleCache = makeCache([{ hash: 'x', dataUrl: PNG_URL, serverUrl: 'http://server/api/images/old.png' }]);
  const stale = makeSync(async url => url.endsWith('old.png') ? response(404) : response(200, Buffer.from(PNG_DATA, 'base64')), staleCache);
  const staleIndex = await stale.context.loadImageCacheIndex();
  const staleSet = await stale.context.verifyUploadImageMappings([{ images: [PNG_URL] }], 'http://server', staleIndex);
  assert.equal(staleSet.has(PNG_URL), true);
  const localComparable = await stale.context.canonicalizeRecordsForDiff([{ images: [PNG_URL], image_url: PNG_URL }], 'http://server', true, staleIndex, { staleDataUrls: staleSet });
  const serverComparable = await stale.context.canonicalizeRecordsForDiff([{ images: ['/api/images/old.png'], image_url: '/api/images/old.png' }], 'http://server', false, staleIndex);
  assert.equal(stale.context.charContentEqual(localComparable[0], serverComparable[0]), false);

  // C09：执行真实文档加载入口，两次结果乱序时旧结果不得覆盖新结果。
  let rendered = null;
  let fileCall = 0;
  const docsContext = vm.createContext({
    API: '/api/files', loadGeneration: 0, window: { appDataRevision: 0 },
    fetch: async () => {
      fileCall++;
      if (fileCall === 1) await new Promise(r => setTimeout(r, 20));
      return { json: async () => [fileCall === 1 ? 'old' : 'new'] };
    },
    renderFiles: files => { rendered = files; }, showToast() {},
  });
  const loadStart = appSource.indexOf('  function loadFiles() {');
  const loadEnd = appSource.indexOf('  function renderFiles(files)', loadStart);
  vm.runInContext(appSource.slice(loadStart, loadEnd), docsContext);
  const firstLoad = docsContext.loadFiles();
  const secondLoad = docsContext.loadFiles();
  await Promise.all([firstLoad, secondLoad]);
  await new Promise(r => setTimeout(r, 40));
  assert.deepEqual(rendered, ['new']);

  console.log(JSON.stringify({ checks: 9, imageCacheRows: (await idb.context.__imageCacheDB.listAll()).length, previewCacheReads: previewCache.calls.listAll, networkRecoveryCalls: networkCalls }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
