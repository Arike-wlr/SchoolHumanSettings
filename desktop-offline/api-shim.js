// ============================================================
// api-shim.js - 离线 fetch 拦截器
// 拦截所有 /api/* 的相对路径请求，路由到 IndexedDB
// 全 URL (http://...) 的请求不受影响（用于同步功能）
// ============================================================

const _originalFetch = window.fetch;

window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input?.url || '');

  // 只拦截相对路径的 /api/ 请求（离线模式）
  // 全 URL（http/https 开头）走原始 fetch（同步用）
  if (!url.startsWith('/') || !url.includes('/api/')) {
    return _originalFetch(input, init);
  }

  return handleApiRequest(url, init);
};

// ============================================================
// 请求路由
// ============================================================
async function handleApiRequest(url, init) {
  const method = (init?.method || 'GET').toUpperCase();
  const body = init?.body;

  // 分离路径和查询参数
  const [path, queryString] = url.split('?');
  const queryParams = new URLSearchParams(queryString || '');

  try {
    // ---- 角色 ----
    if (path === '/api/characters' && method === 'GET') {
      return makeResponse(await charDB.list());
    }
    if (path === '/api/characters' && method === 'POST') {
      const data = JSON.parse(body);
      delete data.id;
      const id = await charDB.create(data);
      const created = { ...data, id };
      return makeResponse(created, 200);
    }
    let m = path.match(/^\/api\/characters\/(\d+)$/);
    if (m) {
      const id = parseInt(m[1]);
      if (method === 'GET') return makeResponse(await charDB.get(id));
      if (method === 'PUT') {
        const data = JSON.parse(body);
        data.id = id;
        // 合并旧数据，保留 sort_order/family 等未传字段
        const old = await charDB.get(id);
        const merged = { ...(old || {}), ...data, id };
        await charDB.update(merged);
        return makeResponse(merged);
      }
      if (method === 'DELETE') {
        await charDB.delete(id);
        return makeResponse({ message: '删除成功' });
      }
    }
    if (path === '/api/characters/reorder' && method === 'POST') {
      const data = JSON.parse(body);
      await persistReorder(STORES.characters, data.items);
      return makeResponse({ message: 'ok' });
    }

    // ---- 世界设定 ----
    if (path.startsWith('/api/world-buildings')) {
      if (path === '/api/world-buildings' && method === 'GET') {
        const mainCat = queryParams.get('main_category') || '';
        return makeResponse(await worldDB.list(mainCat));
      }
      if (path === '/api/world-buildings' && method === 'POST') {
        const data = JSON.parse(body);
        delete data.id;
        const id = await worldDB.create(data);
        return makeResponse({ ...data, id });
      }
      m = path.match(/^\/api\/world-buildings\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === 'GET') return makeResponse(await worldDB.get(id));
        if (method === 'PUT') {
          const data = JSON.parse(body);
          data.id = id;
          const old = await worldDB.get(id);
          const merged = { ...(old || {}), ...data, id };
          await worldDB.update(merged);
          return makeResponse(merged);
        }
        if (method === 'DELETE') {
          await worldDB.delete(id);
          return makeResponse({ message: '删除成功' });
        }
      }
      if (path === '/api/world-buildings/reorder' && method === 'POST') {
        const data = JSON.parse(body);
        await persistReorder(STORES.worldBuildings, data.items);
        return makeResponse({ message: 'ok' });
      }
    }

    // ---- 关系 ----
    if (path.startsWith('/api/relations')) {
      if (path === '/api/relations' && method === 'GET') {
        const rels = await relDB.list();
        // 补充 from_name / to_name
        const chars = await charDB.list();
        const charMap = {};
        chars.forEach(c => { charMap[c.id] = c.name; });
        rels.forEach(r => {
          r.from_name = charMap[r.from_char_id] || '';
          r.to_name = charMap[r.to_char_id] || '';
        });
        return makeResponse(rels);
      }
      if (path === '/api/relations' && method === 'POST') {
        const data = JSON.parse(body);
        delete data.id;
        const id = await relDB.create(data);
        return makeResponse({ ...data, id });
      }
      m = path.match(/^\/api\/relations\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === 'GET') return makeResponse(await relDB.get(id));
        if (method === 'PUT') {
          const data = JSON.parse(body);
          data.id = id;
          const old = await relDB.get(id);
          const merged = { ...(old || {}), ...data, id };
          await relDB.update(merged);
          return makeResponse(merged);
        }
        if (method === 'DELETE') {
          await relDB.delete(id);
          return makeResponse({ message: '删除成功' });
        }
      }
      if (path === '/api/relations/reorder' && method === 'POST') {
        const data = JSON.parse(body);
        await persistReorder(STORES.relations, data.items);
        return makeResponse({ message: 'ok' });
      }
    }

    // ---- 文档 ----
    if (path.startsWith('/api/files')) {
      if (path === '/api/files' && method === 'GET') {
        return makeResponse(await docDB.list());
      }
      if (path === '/api/files/upload' && method === 'POST') {
        // FormData 上传
        const formData = body;
        const files = formData.getAll('files');
        const uploaded = [];
        for (const file of files) {
          if (!file.name) continue;
          await docDB.create({
            name: file.name,
            blob: file,
            size: file.size,
            modified: new Date().toISOString().replace('T', ' ').slice(0, 19),
          });
          uploaded.push(file.name);
        }
        return makeResponse({ message: `已上传 ${uploaded.length} 个文件`, files: uploaded });
      }
      // /api/files/{name}/view
      m = path.match(/^\/api\/files\/(.+)\/view$/);
      if (m && method === 'GET') {
        const name = decodeURIComponent(m[1]);
        const doc = await docDB.get(name);
        if (!doc) return makeResponse({ detail: '文件不存在' }, 404);
        const ext = name.split('.').pop().toLowerCase();
        if (ext === 'txt' || ext === 'md') {
          const text = await doc.blob.text();
          return makeResponse({
            name: doc.name,
            type: ext === 'md' ? 'markdown' : 'text',
            content: text,
            cache_key: null,
          });
        }
        // docx / pdf 等不支持离线解析
        return makeResponse({
          name: doc.name,
          type: ext,
          content: '⚠️ 离线模式不支持查看此格式，请同步到电脑后查看',
          cache_key: null,
        });
      }
      // /api/files/{name} (GET 下载 / DELETE 删除)
      m = path.match(/^\/api\/files\/(.+)$/);
      if (m) {
        const name = decodeURIComponent(m[1]);
        if (method === 'GET') {
          const doc = await docDB.get(name);
          if (!doc) return makeResponse({ detail: '文件不存在' }, 404);
          // 返回 Blob
          return makeResponse(doc.blob, 200, doc.blob.type);
        }
        if (method === 'DELETE') {
          await docDB.delete(name);
          return makeResponse({ message: `已删除 ${name}` });
        }
      }
    }

    // ---- 总览统计（口径必须与 server/backend.py 的 /api/stats 一致）----
    if (path === '/api/stats' && method === 'GET') {
      return makeResponse(await computeStats());
    }

    // ---- 全局搜索 ----
    if (path === '/api/search' && method === 'GET') {
      const q = (queryParams.get('q') || '').trim().toLowerCase();
      const empty = { characters: [], worldview: [], relations: [], documents: [] };
      if (!q) return makeResponse(empty);
      const MAX = 20;
      const snip = (text) => {
        if (!text) return '';
        const flat = String(text).replace(/\s+/g, ' ').trim();
        const pos = flat.toLowerCase().indexOf(q);
        if (pos < 0) return flat.slice(0, 48);
        const start = Math.max(0, pos - 18), end = Math.min(flat.length, pos + q.length + 30);
        return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
      };
      const hit = (v) => String(v || '').toLowerCase().includes(q);

      // 角色
      const chars = await charDB.list();
      const characters = [];
      for (const c of chars) {
        const fields = ['name','university','region','naming_rationale','appearance','setting','birthplace','family','birthday','gender','status'];
        let matched_field = '', snippet = '';
        for (const f of fields) {
          if (hit(c[f])) { if (!matched_field) matched_field = f; if (!snippet) snippet = snip(c[f]); }
        }
        if (matched_field) {
          characters.push({ id: c.id, name: c.name, university: c.university || '', region: c.region || '',
            gender: c.gender || '', image_url: (Array.isArray(c.images) && c.images[0]) || c.image_url || '',
            matched_field, snippet });
        }
        if (characters.length >= MAX) break;
      }

      // 世界观
      const worlds = await worldDB.list('');
      const worldview = worlds.filter(w => hit(w.title) || hit(w.category) || hit(w.main_category) || hit(w.content))
        .slice(0, MAX)
        .map(w => ({ id: w.id, title: w.title, category: w.category || '', main_category: w.main_category || '',
          snippet: snip(w.content) }));

      // 关系
      const rels = await relDB.list();
      const cmap = {}; chars.forEach(c => { cmap[c.id] = c.name; });
      const relations = [];
      for (const r of rels) {
        const fn = cmap[r.from_char_id] || '', tn = cmap[r.to_char_id] || '';
        if (hit(r.relation_type) || hit(r.description) || hit(fn) || hit(tn)) {
          relations.push({ id: r.id, from_name: fn, to_name: tn, relation_type: r.relation_type || '', snippet: snip(r.description) });
        }
        if (relations.length >= MAX) break;
      }

      // 文档（文件名 + txt/md 正文）
      const docs = await docDB.list();
      const documents = [];
      for (const d of docs) {
        let snippet = '';
        const ext = (d.name.split('.').pop() || '').toLowerCase();
        if (ext === 'txt' || ext === 'md') {
          try {
            const full = await docDB.get(d.name);
            if (full && full.blob && full.blob.size < 2 * 1024 * 1024) {
              const text = await full.blob.text();
              if (text.toLowerCase().includes(q)) snippet = snip(text);
            }
          } catch (e) { /* 忽略读取失败 */ }
        }
        if (hit(d.name) || snippet) documents.push({ name: d.name, size_display: d.size_display || '', modified: d.modified || '', snippet });
        if (documents.length >= MAX) break;
      }

      return makeResponse({ characters, worldview, relations, documents });
    }

    // ---- 图片上传（离线：转 base64 data URL 直接存角色 images 数组）----
    if (path === '/api/images/upload' && method === 'POST') {
      const formData = body;
      const file = formData.get('file');
      if (!file) return makeResponse({ detail: '未找到文件' }, 400);
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      return makeResponse({ image_url: dataUrl });
    }

    // 未匹配的 API
    console.warn('[api-shim] 未匹配的请求:', path, method);
    return makeResponse({ detail: '离线模式不支持此操作' }, 404);

  } catch (e) {
    console.error('[api-shim] 错误:', e);
    return makeResponse({ detail: '离线操作失败: ' + e.message }, 500);
  }
}

// ============================================================
// 构造 mock Response
// ============================================================
function makeResponse(data, status = 200, contentType) {
  const ok = status >= 200 && status < 300;
  const headers = new Headers();
  if (contentType) headers.set('Content-Type', contentType);
  else if (data instanceof Blob) headers.set('Content-Type', data.type || 'application/octet-stream');
  else headers.set('Content-Type', 'application/json');

  let bodyStr;
  if (data instanceof Blob) {
    bodyStr = data;
  } else if (typeof data === 'string') {
    bodyStr = data;
  } else {
    bodyStr = JSON.stringify(data);
  }

  return new Response(bodyStr, { status, headers, ok });
}

// ============================================================
// 排序持久化辅助函数
// ============================================================
async function persistReorder(storeName, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    for (const item of items) {
      const getReq = store.get(item.id);
      getReq.onsuccess = () => {
        if (getReq.result) {
          getReq.result.sort_order = item.sort_order;
          store.put(getReq.result);
        }
      };
    }
  });
}

// ============================================================
// 总览统计（离线版）
// 口径与 server/backend.py 的 GET /api/stats 完全一致：
//   - 空字段归「未填写」；性别归 男/女/其他/未填写 四桶；
//   - 存在状态空值归「存在」；
//   - 家族按 ; ； , ， 、 / | 换行 拆分；
//   - 关系度按两端计次（自环算 1），配对按无向去重；
//   - 不解析 birth_time / birthday（自由文本）。
// ============================================================
var STATS_TOP_N = 12;
var STATS_RANK_N = 10;
var STATS_WORLD_RANK_N = 10;   // 「最长的世界观条目」榜单条数
var STATS_MAX_CROSS = 400;
var STATS_MIN_REGION = 3;   // 地区凝聚力/设定厚度：至少这么多条关系才上榜

// 角色图片数组归一化（与 app.js 的 normalizeImages 同义）
// 返回 {array}；兼容 images 是 JSON 字符串、为空但有 image_url 的情况。
function statsNormalizeImages(c) {
  var imgs = c && c.images;
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs); } catch (e) { imgs = []; } }
  if (!Array.isArray(imgs)) imgs = [];
  if (imgs.length === 0 && c && c.image_url) imgs = [c.image_url];
  return imgs;
}

function statsBucket(value, emptyLabel) {
  var v = (value == null ? '' : String(value)).trim();
  return v ? v : (emptyLabel || '未填写');
}

function statsGender(value) {
  var v = (value == null ? '' : String(value)).trim();
  if (!v) return '未填写';
  if (v === '男' || v === '男性' || v === 'M' || v === 'm' || v === 'male' || v === 'Male') return '男';
  if (v === '女' || v === '女性' || v === 'F' || v === 'f' || v === 'female' || v === 'Female') return '女';
  return '其他';
}

function statsSplitMulti(value) {
  if (!value) return [];
  return String(value).split(/[;；,，、/|\\\r\n]+/)
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return !!s; });
}

// 计数字典 → [{name, count}]，count 降序、同名升序；topN>0 时截断
function statsPairs(counter, topN) {
  var items = Object.keys(counter).map(function(k) { return [k, counter[k]]; });
  items.sort(function(a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); });
  if (topN > 0) items = items.slice(0, topN);
  return items.map(function(kv) { return { name: kv[0], count: kv[1] }; });
}

function statsBump(counter, key) {
  counter[key] = (counter[key] || 0) + 1;
}

function statsFormatSize(size) {
  var units = ['B', 'KB', 'MB', 'GB'];
  for (var i = 0; i < units.length; i++) {
    if (size < 1024) return units[i] === 'B' ? size + ' B' : size.toFixed(1) + ' ' + units[i];
    size /= 1024;
  }
  return size.toFixed(1) + ' TB';
}

// 保留 1 位小数。
// 注意：不能用 Math.round(x*10)/10 —— JS 是「四舍五入（远离零）」，Python 内置 round()
// 是「银行家舍入（四舍六入五成双）」，恰好落在 .x5 的值上两者会差 1 个末位
// （实测：cohesion 31.25 → JS 31.3 / Py 31.2）。后端已改用 decimal 无关的
// _round1() 做同样的「远离零」舍入，两边保持一致。
function statsRound1(x) {
  var v = Number(x) || 0;
  return (v < 0 ? -Math.round(-v * 10) : Math.round(v * 10)) / 10;
}

// 取整（保留 0 位小数）。同样要显式写「远离零」，理由同 statsRound1。
function statsRound0(x) {
  var v = Number(x) || 0;
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

// 字数统计：按「码点」计数，与后端 Python 的 len() 一致。
// 直接用 str.length 会把 emoji 等代理对算成 2 个，字数会和后端对不上。
function statsCharCount(str) {
  return Array.from(String(str == null ? '' : str)).length;
}

async function computeStats() {
  var chars = await charDB.list();
  var worlds = await worldDB.list('');
  var rels = await relDB.list();
  var docs = await docDB.list();

  // ---------- 角色 ----------
  var regionC = {}, genderC = {}, statusC = {}, familyC = {}, uniC = {};
  var imageTotal = 0, withImage = 0, withFace = 0;

  // 地区维度（凝聚力 / 设定厚度）
  var regionTotalRel = {}, regionInsideRel = {}, regionSettingSum = {}, regionCharCount = {};

  // 完整度体检
  var COMPLETENESS_FIELDS = [
    ['university', '代表高校'], ['region', '地区'], ['naming_rationale', '取名依据'],
    ['gender', '性别'], ['birthday', '生日'], ['height', '身高'], ['appearance', '外貌'],
    ['identity_period', '身份时间'], ['birth_time', '诞生时间'], ['birthplace', '诞生地'],
    ['setting', '设定描述'], ['family', '家族'], ['alias', '别名'],
    ['images', '图片'], ['face_crop', '人脸头像']
  ];

  chars.forEach(function(c) {
    statsBump(regionC, statsBucket(c.region));
    statsBump(genderC, statsGender(c.gender));
    var st = (c.status == null ? '' : String(c.status)).trim() || '存在';
    statsBump(statusC, st);
    var uni = (c.university == null ? '' : String(c.university)).trim();
    if (uni) statsBump(uniC, uni);
    statsSplitMulti(c.family).forEach(function(f) { statsBump(familyC, f); });

    var imgs = statsNormalizeImages(c);
    if (imgs.length) { withImage++; imageTotal += imgs.length; }
    if (c.face_crop && String(c.face_crop).trim()) withFace++;

    // 地区聚合
    var reg = statsBucket(c.region);
    regionSettingSum[reg] = (regionSettingSum[reg] || 0) + statsCharCount(c.setting);
    regionCharCount[reg] = (regionCharCount[reg] || 0) + 1;
  });

  // ---------- 世界设定 ----------
  var mainC = {}, contentChars = 0, longestEntry = null, worldRank = [];
  worlds.forEach(function(w) {
    statsBump(mainC, statsBucket(w.main_category, '未分类'));
    var n = statsCharCount(w.content);
    contentChars += n;
    var title = w.title || '';
    // 带 id 才能让统计页榜单直达世界观详情页（worldview.html?wb=ID）
    worldRank.push({ title: title, chars: n, id: w.id });
    if (!longestEntry || n > longestEntry.chars) longestEntry = { title: title, chars: n };
  });
  // 按字数降序取前 N（同字数比标题，与后端 sort key 一致；id 不参与排序）
  worldRank.sort(function(a, b) {
    if (b.chars !== a.chars) return b.chars - a.chars;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
  var worldLongestList = worldRank.slice(0, STATS_WORLD_RANK_N);

  // ---------- 关系 ----------
  var nameById = {}, regionById = {};
  chars.forEach(function(c) {
    nameById[c.id] = c.name || ('#' + c.id);
    regionById[c.id] = statsBucket(c.region);
  });

  var typeC = {}, degree = {}, pairCount = {}, crossC = {};
  var directedSeen = {}, selfLoop = 0, noType = 0;

  rels.forEach(function(r) {
    var rt = (r.relation_type == null ? '' : String(r.relation_type)).trim();
    if (rt) statsBump(typeC, rt); else noType++;

    var a = r.from_char_id, b = r.to_char_id;
    if (a === b) selfLoop++;
    var p = (a || 0) <= (b || 0) ? a + '\u0000' + b : b + '\u0000' + a;
    pairCount[p] = (pairCount[p] || 0) + 1;
    directedSeen[a + '\u0000' + b] = 1;

    degree[a] = (degree[a] || 0) + 1;
    if (a !== b) degree[b] = (degree[b] || 0) + 1;

    var ra = regionById[a], rb = regionById[b];
    if (ra && rb) {
      regionTotalRel[ra] = (regionTotalRel[ra] || 0) + 1;
      if (ra !== rb) regionTotalRel[rb] = (regionTotalRel[rb] || 0) + 1;
      else regionInsideRel[ra] = (regionInsideRel[ra] || 0) + 1;
      var rk = ra <= rb ? ra + '\u0000' + rb : rb + '\u0000' + ra;
      statsBump(crossC, rk);
    }
  });

  // 互惠关系：A→B 且 B→A 同时存在
  var mutualKeys = {};
  Object.keys(directedSeen).forEach(function(k) {
    var parts = k.split('\u0000');
    var a = parts[0], b = parts[1];
    if (a === b) return;
    if (directedSeen[b + '\u0000' + a]) {
      var mk = a <= b ? a + '\u0000' + b : b + '\u0000' + a;
      mutualKeys[mk] = 1;
    }
  });

  var dupPairs = 0;
  Object.keys(pairCount).forEach(function(k) { if (pairCount[k] > 1) dupPairs += pairCount[k] - 1; });
  var explicitPairs = Object.keys(pairCount).length;   // 手写关系去重配对数（并入家族前）

  // ---------- 家族关系：同家族的任意两人也算一条关系（只并入计数）----------
  // 只影响关系度 / 去重对数 / 地区矩阵 / 连通性 / 凝聚力 / 人均，
  // **不影响**关系网页面展示，也不计入 total / 未标类型 / 重复 / 自环 / 互惠。
  var famMap = {};
  chars.forEach(function(c) {
    statsSplitMulti(c.family).forEach(function(f) {
      (famMap[f] = famMap[f] || []).push(c.id);
    });
  });

  var famPairSeen = {};
  Object.keys(famMap).forEach(function(f) {
    var ids = famMap[f].slice().sort(function(a, b) { return a - b; });
    // 去重
    var uniq = [];
    ids.forEach(function(id) { if (uniq.indexOf(id) < 0) uniq.push(id); });
    for (var i = 0; i < uniq.length; i++) {
      for (var j = i + 1; j < uniq.length; j++) {
        famPairSeen[uniq[i] + '\u0000' + uniq[j]] = 1;
      }
    }
  });

  var familyPairs = Object.keys(famPairSeen).length;
  var familyNewPairs = 0;
  Object.keys(famPairSeen).forEach(function(pk) {
    if (pairCount[pk]) return;          // 已有手写关系，不重复计入计数
    familyNewPairs++;
    var parts = pk.split('\u0000');
    var a = parseInt(parts[0], 10), b = parseInt(parts[1], 10);
    pairCount[pk] = (pairCount[pk] || 0) + 1;
    degree[a] = (degree[a] || 0) + 1;
    degree[b] = (degree[b] || 0) + 1;
    var ra = regionById[a], rb = regionById[b];
    if (ra && rb) {
      regionTotalRel[ra] = (regionTotalRel[ra] || 0) + 1;
      if (ra !== rb) regionTotalRel[rb] = (regionTotalRel[rb] || 0) + 1;
      else regionInsideRel[ra] = (regionInsideRel[ra] || 0) + 1;
      var rk = ra <= rb ? ra + '\u0000' + rb : rb + '\u0000' + ra;
      statsBump(crossC, rk);
    }
  });

  var degreeIds = Object.keys(degree);
  var rank = degreeIds.map(function(id) {
    return { id: parseInt(id, 10), name: nameById[id] || ('#' + id), degree: degree[id] };
  }).sort(function(a, b) {
    return b.degree - a.degree || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }).slice(0, STATS_RANK_N);

  var connectedSet = {};
  degreeIds.forEach(function(id) { connectedSet[id] = 1; });
  var isolated = chars.filter(function(c) { return !connectedSet[c.id]; })
    .slice(0, STATS_RANK_N)
    .map(function(c) { return { id: c.id, name: c.name || '', region: c.region || '' }; });

  var crossList = Object.keys(crossC).map(function(k) {
    var parts = k.split('\u0000');
    return { from: parts[0], to: parts[1], count: crossC[k] };
  }).sort(function(a, b) {
    // 与后端一致：count 降序，同 count 按 (from\u0000to) 原始键升序
    if (b.count !== a.count) return b.count - a.count;
    var ka = a.from + '\u0000' + a.to, kb = b.from + '\u0000' + b.to;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }).slice(0, STATS_MAX_CROSS);

  // ---------- 地区凝聚力 + 设定厚度 ----------
  var regionList = Object.keys(regionTotalRel).filter(function(r) {
    return regionTotalRel[r] >= STATS_MIN_REGION;
  }).map(function(r) {
    var total = regionTotalRel[r];
    var inside = regionInsideRel[r] || 0;
    var nChars = regionCharCount[r] || 0;
    return {
      name: r,
      characters: nChars,
      total: total,
      inside: inside,
      outside: total - inside,
      cohesion: total ? statsRound1(inside / total * 100) : 0,
      avg_setting: nChars ? statsRound0((regionSettingSum[r] || 0) / nChars) : 0
    };
  });
  regionList.sort(function(a, b) {
    return b.cohesion - a.cohesion || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });

  // ---------- 设定完整度体检 ----------
  var completeness = [], missingMap = {};
  COMPLETENESS_FIELDS.forEach(function(pair) {
    var field = pair[0], label = pair[1];
    var filled = 0, missingNames = [];
    chars.forEach(function(c) {
      var ok;
      if (field === 'images') ok = statsNormalizeImages(c).length > 0;
      else if (field === 'face_crop') ok = !!(c.face_crop && String(c.face_crop).trim());
      else ok = !!(c[field] != null && String(c[field]).trim());
      if (ok) filled++; else missingNames.push(c.name || ('#' + c.id));
    });
    var total = chars.length || 1;
    completeness.push({
      field: field, label: label,
      filled: filled, missing: chars.length - filled,
      pct: statsRound1(filled / total * 100)
    });
    if (missingNames.length) missingMap[field] = missingNames.slice(0, STATS_RANK_N);
  });

  var labelMap = {};
  COMPLETENESS_FIELDS.forEach(function(p) { labelMap[p[0]] = p[1]; });
  var avgPct = completeness.length
    ? statsRound1(completeness.reduce(function(a, b) { return a + b.pct; }, 0) / completeness.length)
    : 0;

  // ---------- 家族规模 ----------
  var familyWith = chars.filter(function(c) {
    return c.family != null && String(c.family).trim();
  }).length;

  // ---------- 角色之最 ----------
  var typeKinds = {};
  rels.forEach(function(r) {
    var rt = (r.relation_type == null ? '' : String(r.relation_type)).trim();
    if (!rt) return;
    [r.from_char_id, r.to_char_id].forEach(function(cid) {
      if (!typeKinds[cid]) typeKinds[cid] = {};
      typeKinds[cid][rt] = 1;
    });
  });

  function topBy(scoreFn, limit) {
    var scored = [];
    chars.forEach(function(c) {
      var s = scoreFn(c);
      if (s) scored.push({ c: c, s: s });
    });
    scored.sort(function(x, y) {
      if (y.s !== x.s) return y.s - x.s;
      var xn = x.c.name || '', yn = y.c.name || '';
      return xn < yn ? -1 : xn > yn ? 1 : 0;
    });
    return scored.slice(0, limit || STATS_RANK_N).map(function(p) {
      return {
        id: p.c.id, name: p.c.name || '', region: p.c.region || '',
        university: p.c.university || '', value: p.s
      };
    });
  }

  var settingDist = [
    ['≥1000 字', function(n) { return n >= 1000; }],
    ['500–999 字', function(n) { return n >= 500 && n < 1000; }],
    ['200–499 字', function(n) { return n >= 200 && n < 500; }],
    ['1–199 字', function(n) { return n > 0 && n < 200; }],
    ['未填写', function(n) { return n === 0; }]
  ].map(function(pair) {
    var cnt = chars.filter(function(c) { return pair[1](statsCharCount(c.setting)); }).length;
    return { name: pair[0], count: cnt };
  }).filter(function(x) { return x.count > 0 || x.name === '未填写'; });

  var highlights = {
    longest_setting: topBy(function(c) { return statsCharCount(c.setting); }),
    most_relations: topBy(function(c) { return degree[c.id] || 0; }),
    richest_types: topBy(function(c) { return Object.keys(typeKinds[c.id] || {}).length; }),
    most_images: topBy(function(c) { return statsNormalizeImages(c).length; }),
    most_family: topBy(function(c) { return statsSplitMulti(c.family).length; })
  };

  // ---------- 文档 ----------
  var docBytes = 0;
  docs.forEach(function(d) { docBytes += (d.size || 0); });

  var now = new Date();
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var generatedAt = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

  return {
    generated_at: generatedAt,
    characters: {
      total: chars.length,
      with_image: withImage,
      no_image: chars.length - withImage,
      image_total: imageTotal,
      with_face_crop: withFace,
      region: statsPairs(regionC, STATS_TOP_N),
      gender: statsPairs(genderC),
      status: statsPairs(statusC),
      family: statsPairs(familyC, STATS_TOP_N),
      university: statsPairs(uniC, STATS_TOP_N)
    },
    worldview: {
      total: worlds.length,
      content_chars: contentChars,
      main_category: statsPairs(mainC),
      longest: (longestEntry && longestEntry.chars) ? longestEntry : null
    },
    relations: {
      total: rels.length,
      explicit_total: rels.length,
      family_pairs: familyPairs,
      family_new_pairs: familyNewPairs,
      unique_pairs: Object.keys(pairCount).length,
      explicit_pairs: explicitPairs,
      self_loop: selfLoop,
      dup_pairs: dupPairs,
      no_type: noType,
      mutual_pairs: Object.keys(mutualKeys).length,
      connected_characters: degreeIds.length,
      isolated_characters: chars.length - degreeIds.length,
      types: statsPairs(typeC),
      top_degree: rank,
      isolated: isolated,
      cross_region: crossList
    },
    regions: regionList,
    completeness: {
      fields: completeness,
      avg_pct: avgPct,
      missing: missingMap,
      label_map: labelMap
    },
    families: {
      families: Object.keys(familyC).length,
      with_family: familyWith,
      without_family: chars.length - familyWith,
      list: statsPairs(familyC, STATS_TOP_N)
    },
    highlights: {
      items: highlights,
      world_longest: (longestEntry && longestEntry.chars) ? longestEntry : null,
      world_longest_list: worldLongestList,
      setting_distribution: settingDist,
      total_setting_chars: chars.reduce(function(a, c) { return a + statsCharCount(c.setting); }, 0)
    },
    documents: {
      total: docs.length,
      size_display: statsFormatSize(docBytes),
      size_bytes: docBytes
    },
    images: {
      files: imageTotal,
      size_display: ''
    }
  };
}


