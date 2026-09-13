// P01 baseline only. This fixture intentionally records the pre-fix behavior;
// it must not be used as the post-fix acceptance suite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const web = path.join(root, 'android-app/app/src/main/assets/web');
// sync.js 依赖 image-store.js 的引用判定/取字节函数；无 window.Android 时退化为原样 data URL。
const STORE = fs.readFileSync(path.join(web, 'image-store.js'), 'utf8');

function loadSync(overrides = {}) {
  const context = vm.createContext({
    console,
    URL,
    Map,
    Set,
    Blob,
    atob,
    btoa,
    TextEncoder,
    Uint8Array,
    structuredClone,
    localStorage: { getItem: () => '抗大抗大越抗越大' },
    imageCacheDB: {
      getByServerUrl: async () => null,
      getByDataUrl: async () => null,
      set: async () => {},
      clear: async () => {},
    },
    fetch: async () => ({ ok: false, status: 404 }),
    ...overrides,
  });
  vm.runInContext(STORE, context);
  vm.runInContext(fs.readFileSync(path.join(web, 'sync.js'), 'utf8'), context);
  return context;
}

async function main() {
  const sync = loadSync();

  // F1: equal image counts suppress replacement and reorder changes.
  const old = { name: 'fixture', images: ['data:image/png;base64,b2xk'] };
  const replacement = { name: 'fixture', images: ['data:image/png;base64,bmV3'] };
  const reordered = {
    name: 'fixture',
    images: ['data:image/png;base64,b', 'data:image/png;base64,a'],
  };
  const originalOrder = {
    name: 'fixture',
    images: ['data:image/png;base64,a', 'data:image/png;base64,b'],
  };
  assert.equal(sync.charContentEqual(old, replacement), true);
  assert.equal(sync.charContentEqual(originalOrder, reordered), true);
  console.log('F1 baseline: same-count replacement and reorder are reported unchanged.');

  // F1: a failed conversion leaves a relative URL that is unsafe on file-origin WebView.
  const records = [{ name: 'fixture', images: ['/api/images/missing.png'] }];
  await sync.convertServerImagesToDataUrl(records, 'http://fixture.invalid');
  assert.equal(records[0].images[0], '/api/images/missing.png');
  const fileOrigin = new URL(records[0].images[0], 'file:///android_asset/web/index.html').href;
  assert.equal(fileOrigin, 'file:///api/images/missing.png');
  console.log('F1 baseline: 404 is swallowed; retained URL resolves to ' + fileOrigin + '.');

  // A later cached success still cannot repair the old record because count-only diff wins.
  sync.imageCacheDB.getByServerUrl = async () => ({ dataUrl: 'data:image/png;base64,cmVwYWlyZWQ=' });
  const repaired = structuredClone(records);
  await sync.convertServerImagesToDataUrl(repaired, 'http://fixture.invalid');
  const diff = sync.computeRecordDiff(
    repaired,
    records,
    (a, b) => a.name === b.name,
    sync.charContentEqual,
    a => a.name,
  );
  assert.equal(diff.modified.length, 0);
  console.log('F1 baseline: later successful conversion still produces zero modified records.');

  // F2/F3/F4 source-level baseline counters; these are observations, not performance claims.
  const syncSource = fs.readFileSync(path.join(web, 'sync.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(web, 'sync-ui.js'), 'utf8');
  const dbSource = fs.readFileSync(path.join(web, 'db.js'), 'utf8');
  const counters = {
    syncFetchCalls: (syncSource.match(/\bfetch\s*\(/g) || []).length,
    sessionStorageFullSerializations: (appSource.match(/sessionStorage\.setItem\([^\n]*JSON\.stringify/g) || []).length,
    listInnerHtmlWrites: (appSource.match(/grid\.innerHTML\s*=/g) || []).length,
    cacheGetAllReferences: (dbSource.match(/getAll\(/g) || []).length,
    graphFixedSteps: (appSource.match(/it\s*<\s*300/g) || []).length,
    uiGlobalLoadDataCall: /typeof loadData\s*===\s*['"]function['"]/.test(uiSource),
  };
  assert.equal(counters.uiGlobalLoadDataCall, true);
  console.log('BASELINE_COUNTERS ' + JSON.stringify(counters));

  // Image corpus header inventory is intentionally summarized; no image bytes are logged.
  let png = 0;
  let jpeg = 0;
  let totalBytes = 0;
  for (const name of fs.readdirSync(path.join(root, 'server/images'))) {
    const bytes = fs.readFileSync(path.join(root, 'server/images', name));
    totalBytes += bytes.length;
    if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) png++;
    else if (bytes[0] === 0xff && bytes[1] === 0xd8) jpeg++;
  }
  console.log('IMAGE_HEADERS ' + JSON.stringify({ png, jpeg, totalBytes }));
  console.log('P01 baseline probe passed.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
