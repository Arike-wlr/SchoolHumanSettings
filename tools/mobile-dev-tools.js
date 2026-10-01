/**
 * 调试用数据工具（在浏览器控制台里跑）。
 *
 * 配合 tools/mobile-dev-server.py 使用：它会在 index.html 里注入本文件，
 * 页面加载后控制台就有 window.ocDev。
 *
 *   await ocDev.reset()                  // 清空本地库（危险，会二次确认）
 *   await ocDev.load()                   // 从 tools/export-mock-backup.py 产出的 JSON 灌数据
 *   await ocDev.load('/mock.json')       // 指定路径
 *   await ocDev.stats()                  // 看本地/服务器两边各有多少条
 *   await ocDev.seed()                   // 灌一份 20 条的最小样本（开发页面逻辑用）
 *   ocDev.copyBackup()                   // 把当前库导出成备份 JSON 并复制到剪贴板
 *   ocDev.hide() / ocDev.show()          // 收起 / 展开右下角的调试面板
 *
 * 页面打开时本地库若为空会自动 load() 一份测试数据（autoFill），
 * 所以「打开就有东西看」，不用手敲命令。
 */
(function () {
  'use strict';

  var MOCK_URL = '/dev-mock-backup.json';   // 由 mobile-dev-server.py 提供

  function db() {
    if (typeof worldDB === 'undefined') throw new Error('db.js 未加载');
    return { charDB: charDB, worldDB: worldDB, relDB: relDB, docDB: docDB };
  }

  // 逐条写，不要一次性 bulkSet —— 大数组的 bulkInsert 会持有一条长事务，
  // 期间页面上的任何 IndexedDB 读都会排队，看起来像卡死。
  async function writeAll(dbs, data) {
    await dbs.charDB.clear();
    var chars = data.characters || [];
    for (var i = 0; i < chars.length; i++) {
      await dbs.charDB.create(chars[i]);
      if (i % 20 === 0 && typeof yieldToMain === 'function') await yieldToMain();
    }
    await dbs.worldDB.clear();
    var worlds = data.worldBuildings || [];
    for (var j = 0; j < worlds.length; j++) await dbs.worldDB.create(worlds[j]);
    await dbs.relDB.clear();
    var rels = data.relations || [];
    for (var k = 0; k < rels.length; k++) await dbs.relDB.create(rels[k]);
    if (typeof invalidateCharactersShared === 'function') invalidateCharactersShared();
  }

  function afterWrite() {
    if (typeof markAppDataChanged === 'function') markAppDataChanged();
    if (typeof refreshCurrentView === 'function') refreshCurrentView();
  }

  async function reset(skipConfirm) {
    if (!skipConfirm) {
      var n = worldDB ? (await charDB.list()).length : 0;
      if (!confirm('清空本地全部数据？当前有 ' + n + ' 个角色。\n（服务器数据不受影响）')) return false;
    }
    var dbs = db();
    await dbs.charDB.clear();
    await dbs.worldDB.clear();
    await dbs.relDB.clear();
    await dbs.docDB.clear();
    if (typeof invalidateCharactersShared === 'function') invalidateCharactersShared();
    afterWrite();
    console.log('[ocDev] 本地库已清空');
    return true;
  }

  async function load(url) {
    url = url || MOCK_URL;
    var res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('取不到 ' + url + '（HTTP ' + res.status + '）：' +
      '先跑 tools/export-mock-backup.py --out .workbuddy/mock/mock-backup.json');
    var data = await res.json();
    var dbs = db();
    await writeAll(dbs, data);
    buildImageMap(data.characters || []);
    afterWrite();
    var msg = '[ocDev] 已灌入 ' + (data.characters || []).length + ' 角色 / ' +
      (data.worldBuildings || []).length + ' 设定 / ' + (data.relations || []).length + ' 关系';
    console.log(msg);
    return msg;
  }

  /**
   * 建一张 img://<id> → 服务器图片路径 的对照表。
   *
   * 真机上图片经「搬迁」从 data URL 变成 img:// 引用，由原生仓库提供内容；
   * 电脑浏览器里没有原生桥，img:// 就成了死引用。
   *
   * key 用什么：搬迁时 img:// 的 id 就是内容的 sha256，而服务器图片的文件名
   * 恰好也是同一个 sha256（见 sync.js 的上传路径）。所以直接拿文件名当 id 建表，
   * 就能和真机搬迁后的引用对上。
   *
   * 生产环境不加载本文件，__ocDevImgMap 不存在，
   * imageRefToSrcSafe 行为与改动前完全一致。
   */
  function buildImageMap(chars) {
    var map = Object.create(null);
    var seen = 0;
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i] || {};
      var refs = Array.isArray(c.images) ? c.images : [];
      for (var j = 0; j < refs.length; j++) {
        var ref = refs[j];
        if (typeof ref !== 'string' || ref.charAt(0) !== '/') continue;
        var file = ref.split('/').pop();
        if (!/\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(file)) continue;
        var id = file.replace(/\.[a-z0-9]+$/i, '');   // 去掉扩展名 = sha256
        if (map['img://' + id] !== ref) {
          map['img://' + id] = ref;
          seen++;
        }
      }
    }
    window.__ocDevImgMap = map;
    console.log('[ocDev] 图片回退表已建：' + seen + ' 条'
      + (window.__OC_DEV_BASE__ ? '（服务器基址 ' + window.__OC_DEV_BASE__ + '）' : '（同源）'));
  }

  // 灌一份最小样本：开发列表/详情/关系页面逻辑时够用，且跑得快。
  async function seed() {
    var dbs = db();
    var regions = ['华北', '华东', '华南', '西南'];
    var types = ['CP', '朋友', '冤家'];
    var chars = [];
    for (var i = 1; i <= 20; i++) {
      chars.push({
        name: '测试角色' + i,
        alias: '小' + i,
        university: '测试大学' + i,
        region: regions[i % regions.length],
        gender: i % 2 ? '男' : '女',
        birthday: (i % 12 + 1) + '月' + (i % 28 + 1) + '日',
        appearance: '身高 17' + (i % 10) + '，外貌描述占位 ' + i,
        identity_period: (1900 + i) + '-' + (2000 + i),
        birth_time: '',
        setting: '这是第 ' + i + ' 个测试角色的设定正文。'.repeat(i % 5 + 1),
        family: '测试家族' + (i % 4),
        birthplace: '测试出生地',
        status: '存在',
        images: [],
        sort_order: i,
      });
    }
    await writeAll(dbs, { characters: chars });
    // 造 15 条关系
    var rels = [];
    for (var j = 0; j < 15; j++) {
      rels.push({
        from_char_id: (j * 2 % 20) + 1,
        to_char_id: (j * 2 % 20) + 2,
        from_name: '',   // 由关系页按 id 反查，留空即可
        to_name: '',
        relation_type: types[j % types.length],
        description: '测试关系描述 ' + j,
        sort_order: j,
      });
    }
    await dbs.worldDB.clear();
    await dbs.relDB.clear();
    await dbs.worldDB.create({ title: '测试设定A', category: '', main_category: '意识体世界设定', content: '正文A', sort_order: 1 });
    await dbs.worldDB.create({ title: '测试设定B', category: '单人', main_category: '人物背景故事', content: '正文B', sort_order: 2 });
    for (var m = 0; m < rels.length; m++) await dbs.relDB.create(rels[m]);
    if (typeof invalidateCharactersShared === 'function') invalidateCharactersShared();
    afterWrite();
    console.log('[ocDev] 已灌入最小样本：20 角色 / 2 设定 / 15 关系');
  }

  async function stats() {
    var dbs = db();
    var local = {
      characters: (await dbs.charDB.list()).length,
      worldBuildings: (await dbs.worldDB.list()).length,
      relations: (await dbs.relDB.list()).length,
      documents: (await dbs.docDB.list()).length,
    };
    var server = null;
    try {
      if (typeof getServerStats === 'function') server = await getServerStats();
    } catch (e) { /* 未配置服务器 */ }
    var out = { local: local, server: server, serverUrl: (typeof getServerUrl === 'function' ? getServerUrl() : '') };
    console.table({ 本地: local, 服务器: server || '（未连接）' });
    return out;
  }

  async function copyBackup() {
    if (typeof collectBackupData !== 'function') throw new Error('db.js 未提供 collectBackupData');
    var json = await collectBackupData();
    try {
      await navigator.clipboard.writeText(json);
      console.log('[ocDev] 备份 JSON 已复制到剪贴板（' + (json.length / 1024).toFixed(1) + ' KB）');
    } catch (e) {
      window.__ocDevLastBackup = json;   // 剪贴板不可用（非 https）时留个出口
      console.log('[ocDev] 剪贴板不可用，已放到 window.__ocDevLastBackup（' + (json.length / 1024).toFixed(1) + ' KB）');
    }
    return json.length;
  }

  // ---------------- 调试面板（可收起，不挡底部导航） ----------------
  // 曾经用 position:fixed;left:8px;bottom:8px 常驻，正好压在 .bottom-nav 上，
  // 用户点不到导航。现在：
  //   * 默认收起成一个很小的「DEV」圆钮，放在右下角**之上**（bottom 高于导航高度）
  //   * 点开才有完整面板，点「×」收起
  //   * 面板里自带一键「灌数据 / 清空」按钮，不用记命令
  var PANEL_ID = 'oc-dev-dock';
  var NAV_CLEARANCE = 84;      // 底部导航高度 + 余量，保证不压住 nav

  function el(id) { return document.getElementById(id); }

  function setStatus(msg, bad) {
    var s = el('oc-dev-dock-status');
    if (s) {
      s.textContent = msg;
      s.style.color = bad ? '#A32D2D' : '#0C447C';
    }
  }

  function countLine(s) {
    var L = s.local;
    return '本地 ' + L.characters + ' 角色 / ' + L.worldBuildings + ' 设定 / ' + L.relations + ' 关系';
  }

  async function refreshDock() {
    try { setStatus(countLine(await stats())); }
    catch (e) { setStatus('数据：读取失败', true); }
  }

  function buildDock() {
    if (el(PANEL_ID)) return;

    var root = document.createElement('div');
    root.id = PANEL_ID;

    // 圆钮：收起态
    var knob = document.createElement('button');
    knob.id = 'oc-dev-dock-knob';
    knob.type = 'button';
    knob.textContent = 'DEV';
    knob.style.cssText = 'position:fixed;right:10px;bottom:' + NAV_CLEARANCE + 'px;z-index:2147483000;'
      + 'width:46px;height:46px;border-radius:50%;border:1px solid #EF9F27;'
      + 'background:#FAEEDA;color:#633806;font:600 11px/1 system-ui,sans-serif;'
      + 'box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer;';
    knob.title = '调试面板';

    // 面板：展开态
    var panel = document.createElement('div');
    panel.id = 'oc-dev-dock-panel';
    panel.style.cssText = 'position:fixed;right:10px;bottom:' + NAV_CLEARANCE + 'px;z-index:2147483000;'
      + 'width:250px;font:11px/1.6 system-ui,sans-serif;padding:9px 10px;border-radius:10px;'
      + 'background:#FAEEDA;color:#633806;border:1px solid #EF9F27;'
      + 'box-shadow:0 4px 16px rgba(0,0,0,.28);display:none;';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;margin-bottom:6px">'
      + '<b style="flex:1">DEV 调试面板</b>'
      + '<button id="oc-dev-dock-close" type="button" title="收起" '
      + 'style="border:0;background:transparent;color:#633806;font:600 14px/1 system-ui;cursor:pointer;'
      + 'padding:0 2px">×</button></div>'
      + '<div id="oc-dev-dock-status" style="color:#0C447C;margin-bottom:7px">数据：读取中…</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:5px">'
      + '<button id="oc-dev-btn-load" type="button">灌测试数据</button>'
      + '<button id="oc-dev-btn-stats" type="button">刷新条数</button>'
      + '<button id="oc-dev-btn-reset" type="button">清空本地库</button>'
      + '<button id="oc-dev-btn-reload" type="button">重载页面</button>'
      + '</div>'
      + '<div style="margin-top:6px;opacity:.75">控制台里也可用 ocDev.load() / ocDev.seed() / ocDev.reset()</div>';
    // 面板里的按钮统一小样式
    var btnCss = 'font:11px/1 system-ui,sans-serif;padding:5px 8px;border-radius:6px;'
      + 'border:1px solid #EF9F27;background:#fff8ec;color:#633806;cursor:pointer;';
    [].forEach.call(panel.querySelectorAll('button'), function (b) {
      if (b.id !== 'oc-dev-dock-close') b.style.cssText = btnCss;
    });

    knob.onclick = function () { knob.style.display = 'none'; panel.style.display = 'block'; refreshDock(); };
    panel.querySelector('#oc-dev-dock-close').onclick = function () {
      panel.style.display = 'none'; knob.style.display = 'block';
    };
    panel.querySelector('#oc-dev-btn-load').onclick = async function () {
      setStatus('正在灌入…');
      try { await load(); setStatus(countLine(await stats())); }
      catch (e) { setStatus(String(e.message || e).slice(0, 60), true); }
    };
    panel.querySelector('#oc-dev-btn-stats').onclick = refreshDock;
    panel.querySelector('#oc-dev-btn-reset').onclick = async function () {
      if (await reset()) setStatus('已清空本地库');
      else setStatus('已取消');
    };
    panel.querySelector('#oc-dev-btn-reload').onclick = function () { location.reload(); };

    root.appendChild(knob);
    root.appendChild(panel);
    document.body.appendChild(root);
  }

  window.ocDev = {
    reset: reset,
    load: load,
    seed: seed,
    stats: stats,
    copyBackup: copyBackup,
    refreshDock: function () { return refreshDock(); },
    hide: function () { var k = el('oc-dev-dock-knob'), p = el('oc-dev-dock-panel');
      if (k) k.style.display = 'none'; if (p) p.style.display = 'none'; },
    show: function () { buildDock();
      var k = el('oc-dev-dock-knob'); if (k) k.style.display = 'block'; },
    MOCK_URL: MOCK_URL,
  };

  /**
   * 打开就自动灌一份数据（仅当本地库为空时），否则页面看起来是空的。
   * 已经有数据（比如刚刚手动灌过）就不动它，免得覆盖你在测的状态。
   */
  async function autoFill() {
    try {
      if (typeof charDB === 'undefined') return;
      var n = (await charDB.list()).length;
      if (n > 0) return;
      setStatus('本地库为空，正在自动灌入测试数据…');
      var msg = await load();
      console.log('[ocDev] 自动灌入：' + msg);
      setStatus(countLine(await stats()));
    } catch (e) {
      setStatus('自动灌数据失败：' + String(e.message || e).slice(0, 50), true);
      console.warn('[ocDev] 自动灌数据失败：', e);
    }
  }

  function boot() {
    buildDock();
    refreshDock();
    // 先把条数读出来（顺带等 db.js 的就绪），再决定要不要自动灌
    autoFill();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }

  console.log('%c[ocDev] 数据工具已注入', 'color:#0C447C;font-weight:bold',
    '\n  await ocDev.load()       从服务器导出包灌数据',
    '\n  await ocDev.seed()       灌 20 条最小样本',
    '\n  await ocDev.stats()      本地/服务器条数对比',
    '\n  await ocDev.reset()      清空本地库',
    '\n  ocDev.copyBackup()       导出并复制备份 JSON',
    '\n  ocDev.hide() / .show()   收起 / 展开右下角调试面板');
})();
