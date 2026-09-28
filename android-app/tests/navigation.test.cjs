// Run: NODE_PATH=<path to playwright packages> node --test android-app/tests/navigation.test.cjs
// Uses an isolated browser profile and synthetic IndexedDB records, never user data.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../app/src/main/assets/web');
let server, browser, context, page, errors, url;
before(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + server.address().port;
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  browser = await chromium.launch({ headless: true, executablePath: process.env.NAV_BROWSER || (fs.existsSync(edge) ? edge : undefined) });
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 412, height: 820 } });
  page = await context.newPage(); errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(async () => {
    for (let i = 1; i <= 32; i++) await charDB.create({ name: '测试角色' + i, university: '测试学校', region: i % 2 ? '甲区' : '乙区', setting: '长设定。'.repeat(120), images: [], family: '测试家族' });
    await worldDB.create({ title: '测试世界', main_category: '意识体世界设定', category: '分类甲', content: '世界设定。'.repeat(300) + '\n[[测试文档.txt|文档入口]]' });
    await worldDB.create({ title: '测试故事', main_category: '人物背景故事', category: '', content: '故事内容' });
    await relDB.create({ from_char_id: 1, to_char_id: 2, relation_type: '朋友', description: '关系测试' });
    const blob = new Blob(['文档内容。'.repeat(300)], { type: 'text/plain' });
    await docDB.create({ name: '测试文档.txt', blob, size: blob.size, modified: new Date().toISOString() });
    markAppDataChanged();
  });
});
afterEach(async () => { await context.close(); assert.deepEqual(errors, [], 'no uncaught application errors'); });
async function ready() { await page.waitForFunction(() => !AppNavigation.isBusy()); }
async function back() { const result = await page.evaluate(() => AppNavigation.back()); await ready(); return result; }
async function active(id) { return page.locator('#' + id).evaluate(el => el.classList.contains('active')); }
async function view() { return page.evaluate(() => currentView); }

test('main navigation returns in visit order and ignores duplicate destinations', async () => {
  await page.evaluate(async () => { await navigateTo('index'); await navigateTo('index'); await navigateTo('worldview'); await navigateTo('documents'); });
  assert.equal(await back(), 'handled'); assert.equal(await view(), 'worldview');
  await back(); assert.equal(await view(), 'index');
  await back(); assert.equal(await view(), 'home');
  assert.equal(await back(), 'root');
});
test('character detail returns to the original filter and scroll position', async () => {
  await page.evaluate(async () => { await navigateTo('index'); VM.index.selectRegion('甲区'); window.scrollTo(0, 780); });
  const y = await page.evaluate(() => scrollY);
  await page.evaluate(() => VM.index.openDetailModal(1));
  await back();
  assert.equal(await active('indexDetailOverlay'), false);
  assert.equal(await page.evaluate(() => VM.index.captureNavigation().region), '甲区');
  assert.ok(Math.abs((await page.evaluate(() => scrollY)) - y) < 3);
});
test('search result and query return after visiting a detail', async () => {
  await page.click('.home-search'); await page.fill('#gsInput', '测试角色');
  await page.waitForFunction(() => document.querySelectorAll('.gs-item').length > 0);
  const resultCount = await page.locator('.gs-item').count();
  await page.locator('.gs-item').first().click();
  await page.waitForFunction(() => document.getElementById('indexDetailOverlay').classList.contains('active'));
  await back();
  assert.equal(await active('gsOverlay'), true);
  assert.equal(await page.inputValue('#gsInput'), '测试角色');
  assert.equal(await page.locator('.gs-item').count(), resultCount);
  await back(); assert.equal(await view(), 'home'); assert.equal(await back(), 'root');
});
test('stats → world detail → document returns directly through the actual sources', async () => {
  await page.evaluate(async () => { await navigateTo('stats'); window.scrollTo(0, 900); await openWorldDetailFromStats(1); });
  await page.evaluate(() => { document.getElementById('worldDetailBody').scrollTop = 200; return VM.worldview.openDocFromLink('测试文档.txt'); });
  assert.equal(await view(), 'documents'); assert.equal(await active('docViewerOverlay'), true);
  await back(); assert.equal(await view(), 'worldview'); assert.equal(await active('worldDetailOverlay'), true);
  await back(); assert.equal(await view(), 'stats'); assert.ok((await page.evaluate(() => scrollY)) > 850);
  await back(); assert.equal(await view(), 'home');
});
test('editing from a stats detail saves before returning and retains the stats source', async () => {
  await page.evaluate(async () => { await navigateTo('stats'); await openCharDetailFromStats(1); await VM.index.detailEdit(); });
  await page.fill('#indexName', '保存后的名字');
  await back();
  assert.equal(await active('indexDetailOverlay'), true);
  assert.equal(await page.textContent('#indexDetailName'), '保存后的名字');
  assert.equal(await page.evaluate(async () => (await charDB.get(1)).name), '保存后的名字');
  await back(); assert.equal(await view(), 'stats');
});
test('invalid edits stay open and explicit cancel discards them', async () => {
  await page.evaluate(async () => { await navigateTo('index'); await VM.index.openEditModal(1); });
  await page.fill('#indexName', ''); await back();
  assert.equal(await active('indexModalOverlay'), true);
  await page.evaluate(() => cancelEditIndex()); await ready();
  assert.equal(await active('indexModalOverlay'), false);
  assert.equal(await page.evaluate(async () => (await charDB.get(1)).name), '测试角色1');
});
test('save failure keeps the form and its changes', async () => {
  await page.evaluate(async () => {
    await navigateTo('worldview'); await VM.worldview.openEditModal(1);
    const original = window.fetch;
    window.fetch = (input, options) => options && options.method === 'PUT' ? Promise.resolve(new Response('{}', { status: 500 })) : original(input, options);
  });
  await page.fill('#worldTitle', '未保存的标题'); await back();
  assert.equal(await active('worldModalOverlay'), true); assert.equal(await page.inputValue('#worldTitle'), '未保存的标题');
});
test('document picker back preserves the parent draft; choosing a link preserves inserted text', async () => {
  await page.evaluate(async () => { await navigateTo('worldview'); await VM.worldview.openEditModal(1); await VM.worldview.insertDocLink(); });
  await back(); assert.equal(await active('worldModalOverlay'), true); assert.equal(await active('worldDocLinkOverlay'), false);
  await page.evaluate(async () => { await VM.worldview.insertDocLink(); VM.worldview.pickDocLink('测试文档.txt'); }); await ready();
  assert.ok((await page.inputValue('#worldContent')).includes('[[测试文档.txt|测试文档.txt]]'));
});
test('pending detail cannot reopen after back', async () => {
  await page.evaluate(async () => {
    await navigateTo('index'); const original = window.fetch;
    window.fetch = async (input, options) => { if (input === '/api/characters/1') await new Promise(r => setTimeout(r, 200)); return original(input, options); };
    VM.index.openDetailModal(1);
  });
  await back(); await page.waitForTimeout(300);
  assert.equal(await view(), 'index'); assert.equal(await active('indexDetailOverlay'), false);
  await back(); assert.equal(await view(), 'home');
});
test('export selection returns one step without leaving the list', async () => {
  await page.evaluate(async () => { await navigateTo('index'); await VM.index.enterExportMode(); });
  await back(); assert.equal(await view(), 'index');
  assert.equal(await page.evaluate(() => document.body.classList.contains('export-mode')), false);
  await back(); assert.equal(await view(), 'home');
});
test('relation graph position and focus survive navigation', async () => {
  await page.evaluate(async () => { await navigateTo('relations'); VM.relations.graphZoom(1.5); VM.relations.setGFocus(1); });
  const prior = await page.evaluate(() => VM.relations.captureNavigation());
  await page.evaluate(() => navigateTo('index')); await back();
  const state = await page.evaluate(() => VM.relations.captureNavigation());
  for (const field of ['scale', 'x', 'y', 'focus']) assert.equal(state[field], prior[field]);
});
test('rapid back during restoration does not skip the source', async () => {
  await page.evaluate(async () => { await navigateTo('index'); await VM.index.openDetailModal(1); });
  const results = await page.evaluate(() => [AppNavigation.back(), AppNavigation.back(), AppNavigation.back()]);
  assert.deepEqual(results, ['handled', 'busy', 'busy']); await ready(); assert.equal(await view(), 'index');
});
test('back while an editor loads returns without submitting stale form fields', async () => {
  await page.evaluate(async () => {
    await navigateTo('index'); const original = window.fetch; window.putCount = 0;
    window.fetch = async (input, options) => {
      if (options && options.method === 'PUT') window.putCount++;
      if (input === '/api/characters/1') await new Promise(r => setTimeout(r, 180));
      return original(input, options);
    };
    VM.index.openEditModal(1);
  });
  await back(); await page.waitForTimeout(250);
  assert.equal(await active('indexModalOverlay'), false);
  assert.equal(await page.evaluate(() => putCount), 0);
  assert.equal(await view(), 'index');
});
test('unchanged new form closes without creating a record', async () => {
  await page.evaluate(async () => { await navigateTo('worldview'); await VM.worldview.openCreateModal(); });
  await back();
  assert.equal(await active('worldModalOverlay'), false);
  assert.equal(await page.evaluate(async () => (await worldDB.list()).length), 2);
});
test('returning from a document skips a deleted world detail', async () => {
  await page.evaluate(async () => {
    await navigateTo('stats'); await openWorldDetailFromStats(1); await VM.worldview.openDocFromLink('测试文档.txt');
    await worldDB.delete(1); markAppDataChanged();
  });
  await back(); assert.equal(await view(), 'stats'); assert.equal(await active('worldDetailOverlay'), false);
  await back(); assert.equal(await view(), 'home');
});
test('face crop cancels one layer and preserves the editor draft', async () => {
  await page.evaluate(async () => {
    await navigateTo('index'); await VM.index.openEditModal(1);
    document.getElementById('indexName').value = '仍在编辑';
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
    await FaceCrop.open({ src: canvas.toDataURL(), onCancel: () => { window.cropCancelled = (window.cropCancelled || 0) + 1; } });
  });
  assert.equal(await active('faceCropOverlay'), true);
  await back(); assert.equal(await active('faceCropOverlay'), false); assert.equal(await active('indexModalOverlay'), true);
  assert.equal(await page.inputValue('#indexName'), '仍在编辑'); assert.equal(await page.evaluate(() => cropCancelled), 1);
});
test('saving in progress consumes repeated back events without duplicate writes', async () => {
  await page.evaluate(async () => {
    await navigateTo('relations'); await VM.relations.openEditModal(1);
    document.getElementById('relDesc').value = '保存中的关系';
    const original = window.fetch; window.putCount = 0;
    window.fetch = async (input, options) => {
      if (options && options.method === 'PUT') { window.putCount++; await new Promise(r => setTimeout(r, 200)); }
      return original(input, options);
    };
  });
  const result = await page.evaluate(() => [AppNavigation.back(), AppNavigation.back(), AppNavigation.back()]);
  assert.deepEqual(result, ['handled', 'busy', 'busy']); await ready();
  assert.equal(await page.evaluate(() => putCount), 1); assert.equal(await active('relModalOverlay'), false);
});
test('exit waits for backup completion and reports a backup failure', async () => {
  const result = await page.evaluate(async () => {
    window.exitReplies = [];
    window.Android = { resetBackExit() {}, finishNavigationExit: (id, ready) => exitReplies.push([id, ready]) };
    window.flushBackupForExit = () => new Promise(resolve => { window.finishTestBackup = resolve; });
    const pending = AppNavigation.prepareExit(1);
    const whileSaving = [AppNavigation.back(), exitReplies.length];
    finishTestBackup(); await pending;
    window.flushBackupForExit = () => Promise.reject(new Error('disk failure'));
    await AppNavigation.prepareExit(2);
    return { whileSaving, replies: exitReplies };
  });
  assert.deepEqual(result, { whileSaving: ['busy', 0], replies: [[1, true], [2, false]] });
});
test('pending sync blocks exit and backup writers are serialized', async () => {
  const result = await page.evaluate(async () => {
    window.exitReplies = []; window.backupOrder = [];
    window.Android = { resetBackExit() {}, finishNavigationExit: (id, ready) => exitReplies.push([id, ready]) };
    const sync = runSyncOnce(() => new Promise(resolve => { window.finishTestSync = resolve; }));
    await Promise.resolve(); await AppNavigation.prepareExit(1); finishTestSync(); await sync;
    let writing = 0;
    window.writeBackupToNativeNow = async () => {
      backupOrder.push(++writing); await new Promise(resolve => setTimeout(resolve, 30)); writing--;
    };
    await Promise.all([writeBackupToNative(), writeBackupToNative(), flushBackupForExit()]);
    return { replies: exitReplies, order: backupOrder };
  });
  assert.deepEqual(result, { replies: [[1, false]], order: [1, 1, 1] });
});
test('the same page keeps distinct filter states at different points in history', async () => {
  await page.evaluate(async () => {
    await navigateTo('index'); VM.index.selectRegion('甲区');
    await navigateTo('worldview'); await navigateTo('index'); VM.index.selectRegion('乙区'); await navigateTo('documents');
  });
  await back(); assert.equal(await page.evaluate(() => VM.index.captureNavigation().region), '乙区');
  await back(); assert.equal(await view(), 'worldview');
  await back(); assert.equal(await page.evaluate(() => VM.index.captureNavigation().region), '甲区');
});
test('world story details and new forms use the correct category', async () => {
  await page.evaluate(async () => { await navigateTo('stats'); await openWorldDetailFromStats(2); });
  assert.equal(await page.evaluate(() => VM.worldview.getMainCategory()), '人物背景故事');
  await back(); assert.equal(await view(), 'stats');
  await page.evaluate(async () => { await navigateTo('worldview'); await VM.worldview.selectMainCategory('人物背景故事'); await VM.worldview.openCreateModal(); });
  assert.equal(await page.inputValue('#worldMainCategoryInput'), '人物背景故事');
});
test('family changes save on back, while explicit cancel discards them', async () => {
  await page.evaluate(async () => { await navigateTo('relations'); await VM.relations.openFamilyModal(); });
  await page.locator('.fam-row-input').first().fill('新家族');
  await back();
  assert.equal(await active('relFamilyOverlay'), false);
  assert.equal(await page.evaluate(async () => (await charDB.get(1)).family), '新家族');
  await page.evaluate(() => VM.relations.openFamilyModal());
  await page.locator('.fam-row-input').first().fill('不保存');
  await page.evaluate(() => VM.relations.closeFamilyModal(true)); await ready();
  assert.equal(await page.evaluate(async () => (await charDB.get(1)).family), '新家族');
});
test('sync confirmation and its parent close separately', async () => {
  await page.click('.sync-fab');
  await page.evaluate(() => {
    const empty = () => ({ added: [], deleted: [], modified: [] });
    window.getSyncDiff = async () => ({ local: {}, server: {}, chars: empty(), worlds: empty(), relations: empty(), docs: empty() });
  });
  await page.fill('#syncServerInput', '127.0.0.1:1');
  await page.evaluate(() => doDownload());
  assert.equal(await active('syncConfirmOverlay'), true);
  await back(); assert.equal(await active('syncOverlay'), true); assert.equal(await active('syncConfirmOverlay'), false);
  await back(); assert.equal(await active('syncOverlay'), false); assert.equal(await back(), 'root');
});
test('cancelled sync preview does not reappear when its request finishes', async () => {
  await page.click('.sync-fab'); await page.fill('#syncServerInput', '127.0.0.1:1');
  await page.evaluate(() => {
    const empty = () => ({ added: [], deleted: [], modified: [] });
    window.getSyncDiff = async () => { await new Promise(r => setTimeout(r, 180)); return { local: {}, server: {}, chars: empty(), worlds: empty(), relations: empty(), docs: empty() }; };
    doDownload();
  });
  await back(); await page.waitForTimeout(250);
  assert.equal(await active('syncOverlay'), true);
  assert.equal(await page.locator('#syncConfirmOverlay.active').count(), 0);
  await back(); assert.equal(await back(), 'root');
});
test('an offline write still in progress prevents exit even after navigation', async () => {
  const result = await page.evaluate(async () => {
    window.exitReplies = [];
    window.Android = { resetBackExit() {}, finishNavigationExit: (id, ready) => exitReplies.push([id, ready]) };
    const original = charDB.create;
    charDB.create = async data => { await new Promise(resolve => { window.finishWrite = resolve; }); return original(data); };
    const pending = fetch('/api/characters', { method: 'POST', body: JSON.stringify({ name: '延迟保存' }) });
    await AppNavigation.prepareExit(1);
    finishWrite(); await pending;
    window.flushBackupForExit = () => Promise.resolve();
    await AppNavigation.prepareExit(2);
    return exitReplies;
  });
  assert.deepEqual(result, [[1, false], [2, true]]);
});
