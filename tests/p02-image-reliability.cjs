// P02 isolated regression suite. Uses fake responses and an in-memory cache;
// it never reaches the real backend, IndexedDB, images, or APK.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'android-app/app/src/main/assets/web/sync.js');
// 图片字节仓库：sync.js 依赖它的 isImageRef / imageRefToBlob 等；
// 无原生接口时它整体退化为原样 data URL，行为与改造前一致。
const STORE = fs.readFileSync(path.join(root, 'android-app/app/src/main/assets/web/image-store.js'), 'utf8');
const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const JPEG = Buffer.from('ffd8ffe000000000ffd9', 'hex');

function fileReader() {
  return class FakeFileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buffer => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload();
      }).catch(error => this.onerror(error));
    }
  };
}

function response(status, bytes, type) {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => new Blob([bytes], { type }),
  };
}

function makeContext(fetchImpl, cacheStore, cacheWrites = [], extras = {}) {
  const cache = {
    // 一轮同步只读取一次全表（与 db.js 的 imageCacheDB.listAll 对齐）；
    // 返回行带 serverUrls，供 sync.js 的引用索引建映射。
    listAll: async () => [...cacheStore.values()].map(item => ({ dataUrl: item.dataUrl, serverUrl: item.serverUrl, serverUrls: [item.serverUrl] })),
    getByServerUrl: async url => cacheStore.get(url) || null,
    getByDataUrl: async dataUrl => [...cacheStore.values()].find(item => item.dataUrl === dataUrl) || null,
    set: async (dataUrl, serverUrl) => {
      cacheWrites.push({ dataUrl, serverUrl });
      cacheStore.set(serverUrl, { dataUrl, serverUrl });
    },
    clear: async () => {},
  };
  const context = vm.createContext({
    console,
    URL,
    Map,
    Set,
    Blob,
    FormData,
    AbortController,
    TextDecoder,
    structuredClone,
    atob,
    setTimeout,
    clearTimeout,
    FileReader: fileReader(),
    localStorage: { getItem: () => '抗大抗大越抗越大' },
    imageCacheDB: cache,
    fetch: fetchImpl,
    ...extras,
  });
  vm.runInContext(STORE, context);
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
  return { context, cache, cacheWrites };
}

async function main() {
  const calls = new Map();
  const cacheStore = new Map();
  const { context: sync } = makeContext(async url => {
    calls.set(url, (calls.get(url) || 0) + 1);
    return response(200, PNG, 'image/png');
  }, cacheStore);

  assert.equal(sync.charContentEqual(
    { name: 'same', images: ['data:image/png;base64,YQ=='] },
    { name: 'same', images: ['data:image/png;base64,Yg=='] },
  ), false);
  assert.equal(sync.charContentEqual(
    { name: 'same', images: ['data:image/png;base64,YQ==', 'data:image/png;base64,Yg=='] },
    { name: 'same', images: ['data:image/png;base64,Yg==', 'data:image/png;base64,YQ=='] },
  ), false);

  const records = [{ name: 'fallback', images: [], image_url: '/api/images/a.png' }];
  await sync.convertServerImagesToDataUrl(records, 'http://server-a:8000');
  assert.match(records[0].image_url, /^data:image\/png;base64,/);
  assert.equal(records[0].images.length, 1);
  assert.equal(calls.get('http://server-a:8000/api/images/a.png'), 1);
  const secondRound = [{ name: 'fallback', images: ['/api/images/a.png'] }];
  await sync.convertServerImagesToDataUrl(secondRound, 'http://server-a:8000');
  assert.equal(calls.get('http://server-a:8000/api/images/a.png'), 1);

  let failedCalls = 0;
  const failedContext = makeContext(async () => {
    failedCalls++;
    return response(404, Buffer.from('<html>missing</html>'), 'text/html');
  }, new Map());
  const failedRecords = [{ name: 'missing', images: ['/api/images/missing.png'] }];
  await assert.rejects(
    failedContext.context.convertServerImagesToDataUrl(failedRecords, 'http://server-a:8000'),
    /图片下载失败/,
  );
  assert.equal(failedCalls, 1);
  assert.equal(failedRecords[0].images[0], '/api/images/missing.png');

  // A required image failure happens before any core record write.
  const writes = [];
  const emptyDb = () => ({ list: async () => [], create: async item => writes.push(['create', item]), update: async item => writes.push(['update', item]), delete: async id => writes.push(['delete', id]) });
  const apiContext = makeContext(async url => {
    if (url.endsWith('/api/characters')) return { ok: true, status: 200, json: async () => [{ name: 'server', images: ['/api/images/missing.png'] }] };
    if (url.endsWith('/api/world-buildings')) return { ok: true, status: 200, json: async () => [] };
    if (url.endsWith('/api/relations')) return { ok: true, status: 200, json: async () => [] };
    if (url.endsWith('/api/files')) return { ok: true, status: 200, json: async () => [] };
    return response(404, Buffer.from('missing'), 'text/plain');
  }, new Map(), [], {
    getServerUrl: () => 'http://server-a:8000',
    charDB: emptyDb(),
    worldDB: emptyDb(),
    relDB: emptyDb(),
    docDB: emptyDb(),
  });
  await assert.rejects(apiContext.context.downloadFromServer(), /图片下载失败/);
  assert.equal(writes.length, 0);

  let attempts = 0;
  let active = 0;
  let peak = 0;
  const retryContext = makeContext(async url => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (url.endsWith('/retry.png') && attempts++ === 0) return response(503, Buffer.from('busy'), 'text/plain');
    if (url.endsWith('/bad.png')) return response(404, Buffer.from('missing'), 'text/plain');
    if (url.endsWith('/jpeg.png')) return response(200, JPEG, 'image/png');
    return response(200, PNG, 'image/png');
  }, new Map());
  const retryRecords = [{ name: 'r', images: ['/api/images/retry.png', '/api/images/jpeg.png', '/api/images/retry.png'] }];
  await retryContext.context.convertServerImagesToDataUrl(retryRecords, 'http://server-b:8000');
  assert.equal(peak <= 2, true);
  assert.equal(attempts, 2);
  assert.match(retryRecords[0].images[1], /^data:image\/jpeg;base64,/);

  let malformedCalls = 0;
  const malformedContext = makeContext(async () => {
    malformedCalls++;
    return response(200, Buffer.from('<html>not an image</html>'), 'image/png');
  }, new Map());
  await assert.rejects(
    malformedContext.context.convertServerImagesToDataUrl([{ images: ['/api/images/html.png'] }], 'http://server-a:8000'),
    /无法识别/,
  );
  assert.equal(malformedCalls, 1);

  let originCalls = 0;
  const originContext = makeContext(async () => {
    originCalls++;
    return response(200, PNG, 'image/png');
  }, new Map());
  await originContext.context.convertServerImagesToDataUrl([{ images: ['/api/images/shared.png'] }], 'http://server-a:8000');
  await originContext.context.convertServerImagesToDataUrl([{ images: ['/api/images/shared.png'] }], 'http://server-b:8000');
  assert.equal(originCalls, 2);

  const cacheWrites = retryContext.cacheWrites;
  assert.equal(cacheWrites.every(item => /^https?:\/\//.test(item.serverUrl)), true);
  const a = await retryContext.context.canonicalizeRecordsForDiff(
    [{ images: ['/api/images/retry.png'] }],
    'http://server-a:8000',
  );
  const b = await retryContext.context.canonicalizeRecordsForDiff(
    [{ images: ['/api/images/retry.png'] }],
    'http://server-b:8000',
  );
  assert.notEqual(a[0].images[0], b[0].images[0]);
  const unsafeLocal = await retryContext.context.canonicalizeRecordsForDiff(
    [{ images: ['/api/images/retry.png'] }],
    'http://server-b:8000',
    true,
  );
  assert.notEqual(unsafeLocal[0].images[0], b[0].images[0]);

  const cacheFailure = makeContext(async () => response(200, PNG, 'image/png'), new Map());
  cacheFailure.cache.set = async () => { throw new Error('cache full'); };
  const cacheFailureRecords = [{ name: 'cache-failure', images: ['/api/images/a.png'] }];
  await assert.rejects(cacheFailure.context.convertServerImagesToDataUrl(cacheFailureRecords, 'http://server-a:8000'), /图片下载失败/);
  assert.equal(cacheFailureRecords[0].images[0], '/api/images/a.png');

  let guardRelease;
  const first = sync.runSyncOnce(() => new Promise(resolve => { guardRelease = resolve; }));
  await assert.rejects(sync.runSyncOnce(async () => {}), /同步正在进行/);
  guardRelease();
  await first;

  const appSource = fs.readFileSync(path.join(root, 'android-app/app/src/main/assets/web/app.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(root, 'android-app/app/src/main/assets/web/sync-ui.js'), 'utf8');
  assert.match(appSource, /function refreshCurrentView\(\)/);
  assert.match(appSource, /generation !== loadGeneration/);
  assert.match(uiSource, /runSyncOnce\(\(\) => downloadFromServer/);
  assert.match(uiSource, /refreshCurrentView\(\)/);
  assert.doesNotMatch(uiSource, /typeof loadData === ['"]function['"]/);
  console.log(JSON.stringify({
    retryAttempts: attempts,
    peakImageConcurrency: peak,
    failed404Attempts: failedCalls,
    cacheWrites: cacheWrites.length,
    cacheKeysAreFullUrls: cacheWrites.every(item => /^https?:\/\//.test(item.serverUrl)),
    originSeparatedTransfers: originCalls,
    malformedImageAttempts: malformedCalls,
    unsafeLocalReferenceDoesNotSuppressRepair: true,
  }));
  console.log('P02 image reliability probe passed.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
