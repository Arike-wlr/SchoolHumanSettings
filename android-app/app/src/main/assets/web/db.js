// ============================================================
// db.js - IndexedDB 封装，提供与原后端 API 类似的接口
// 数据全部存在手机本地，离线可用
// ============================================================

const DB_NAME = 'oc_characters_db';
const DB_VERSION = 3;
const STORES = {
  characters: 'characters',       // 角色（原图 images/image_url 原样存储）
  characterLite: 'characterLite', // 角色列表/关系页的轻量读取投影（纯派生数据，可删可重建，见 D006）
  worldBuildings: 'worldBuildings', // 世界设定
  relations: 'relations',         // 关系
  documents: 'documents',         // 文档（存 Blob）
  imageCache: 'imageCache',       // 图片缓存（增量同步用）
};
const SERVER_KEY = 'sync_server_url';  // 服务器地址存储 key

let _db = null;

// ===== 数据持久化加固 =====
// 1) 请求"持久化存储"权限：在 Android WebView 中标记为持久后，
//    系统/ROM 的自动清理和存储压力清理会更倾向跳过该站点的 IndexedDB，
//    降低数据被无故清空的风险。
(function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }
})();

// 2) 页面切后台/退出时触发一次无害只读事务，
//    促使 WebView 尽快把尚未落盘的 IndexedDB 写入 flush 到磁盘，
//    避免用户编辑完直接切后台/杀进程导致最后的写入丢失。
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && _db) {
    try {
      _db.transaction(STORES.characters, 'readonly').objectStore(STORES.characters).getAll();
    } catch (e) { /* ignore */ }
  }
});

// 打开数据库
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.characters)) {
        db.createObjectStore(STORES.characters, { keyPath: 'id', autoIncrement: true });
      }
      // P06：轻量投影 store（只新增，不动既有 store/keyPath/数据；不迁移、不重写角色记录）
      if (!db.objectStoreNames.contains(STORES.characterLite)) {
        db.createObjectStore(STORES.characterLite, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.worldBuildings)) {
        db.createObjectStore(STORES.worldBuildings, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.relations)) {
        db.createObjectStore(STORES.relations, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.documents)) {
        db.createObjectStore(STORES.documents, { keyPath: 'name' }); // 用文件名作 key
      }
      if (!db.objectStoreNames.contains(STORES.imageCache)) {
        db.createObjectStore(STORES.imageCache, { keyPath: 'hash' }); // 用 dataUrl hash 作 key
      }
    };
  });
}

// 通用：事务包装
async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    t.oncomplete = () => {
      resolve(result);
      // 写操作完成后自动触发原生文件备份（防抖合并）
      if (mode === 'readwrite') scheduleBackup();
    };
    t.onerror = () => reject(t.error);
    const r = fn(store);
    if (r) r.onsuccess = () => { result = r.result; };
  });
}

// ============= 通用 CRUD =============

// 获取全部
async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// 获取单个
async function getById(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 只取主键（不物化记录值）：投影读取靠它找出缺投影的角色，避免全表读取原图字节。
async function getAllKeys(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ============= P06：角色轻量投影（派生数据，可删可重建） =============
// 列表只需要文本字段 + 首图缩略图 + 图数；关系页只需要 id/name/学校/家族。
// 投影把这两页的读取从"物化全部原图 base64"降到"只读所需字段"，而 images/image_url
// 仍原样留在 characters 里，详情/导出/同步/备份一律走原图（D006）。
// 本表必须覆盖**列表路径消费方的字段全集**（cardHTML/cardSig/applyFilter/confirmExport；
// 见 CONTRACT rev10 的 F9），否则导出等产物会静默丢字段（首轮漏 birthplace 的教训）；
// 由 tests/p06-read-projection.cjs 的 Gate ⑧ 机器守卫。
const LITE_TEXT_FIELDS = ['name', 'alias', 'university', 'region', 'birthplace', 'gender', 'status', 'height',
  'birthday', 'appearance', 'identity_period', 'birth_time', 'naming_rationale', 'setting', 'family'];

// 与 app.js 的 normalizeImages 同规则：images 数组长度；为空时看 image_url。
function liteImageRefs(record) {
  let imgs = record ? record.images : null;
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs); } catch (e) { imgs = []; } }
  if (!Array.isArray(imgs)) imgs = [];
  if (imgs.length === 0 && record && record.image_url) imgs = [record.image_url];
  return imgs;
}

// 与 app.js 的 imageRefSig 同公式（O(1)：长度 + 头尾），供"首图是否变化"判断。
function liteFirstRefSig(ref) {
  const s = String(ref || '');
  return s.length + '\u0001' + s.slice(0, 24) + '\u0001' + s.slice(-16);
}

// 由完整角色记录构造投影记录；文本字段保持"存在性"（不补空串），保证导出与基线一致。
function buildCharacterLite(record) {
  if (!record || record.id === undefined || record.id === null) return null;
  const refs = liteImageRefs(record);
  const first = refs[0] || '';
  const thumbs = (Array.isArray(record.thumbs) && record.thumbs[0]) ? [record.thumbs[0]] : [];
  const isDataUrl = /^data:/i.test(first);
  const lite = {
    id: record.id,
    sort_order: record.sort_order,
    images_count: refs.length,
    firstRefSig: liteFirstRefSig(first),
    firstRef: (!isDataUrl && first) ? first : '',   // 短引用可直接给卡片；data URL 由读路径按需补
    needsOriginal: !!(isDataUrl && thumbs.length === 0),
    thumbs,
  };
  for (const f of LITE_TEXT_FIELDS) {
    if (f in record) lite[f] = record[f];
  }
  return lite;
}

// 投影批量补写：同一事务内先查再写，只补"仍缺投影"的记录，
// 避免用读取期间已过期的投影覆盖并发写入产生的新投影。
async function putCharacterLiteIfAbsent(list) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let written = 0;
    const t = db.transaction(STORES.characterLite, 'readwrite');
    const store = t.objectStore(STORES.characterLite);
    t.oncomplete = () => resolve(written);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('投影写入事务中止'));
    for (const lite of list) {
      const req = store.get(lite.id);
      req.onsuccess = () => {
        if (req.result) return;   // 已有投影（可能来自更新的写入）：不动
        store.put(lite);
        written++;
      };
    }
  });
}

// 投影读取 + 自愈：不物化 characters 全量值（只用 getAllKeys + 必要的单条 get）；
// 缺投影的记录即时投影并落库，旧数据无需重写、无需重新同步。
function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

async function readCharacterLiteAll(options) {
  const needFirstRef = !(options && options.needFirstRef === false);   // names 投影不需要原图引用
  const liteAll = await getAll(STORES.characterLite);
  const byId = new Map();
  liteAll.forEach(r => { if (r && r.id !== undefined && r.id !== null) byId.set(r.id, r); });
  const keys = await getAllKeys(STORES.characters);
  const missing = keys.filter(k => !byId.has(k));
  const repaired = [];
  for (let i = 0; i < missing.length; i++) {
    const record = await getById(STORES.characters, missing[i]);
    const lite = record ? buildCharacterLite(record) : null;
    if (lite) { byId.set(lite.id, lite); repaired.push(lite); }
    if ((i + 1) % 8 === 0) await yieldToMain();   // 分批让出主线程，不长时间占用
  }
  if (repaired.length) await putCharacterLiteIfAbsent(repaired);
  if (needFirstRef) {
    // 缺缩略图的 data URL 首图：按记录补一次原图引用，保证卡片回退原图（UI 与基线一致）。
    for (const lite of byId.values()) {
      if (!lite.needsOriginal) continue;
      const record = await getById(STORES.characters, lite.id);
      if (record) lite.firstRef = firstImageRefOf(record);
    }
  }
  return [...byId.values()].sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
}

// 投影只读入口（派生数据；整体清空后由读路径自愈重建 —— 回滚/恢复路径）
const charLiteDB = {
  listAll: () => getAll(STORES.characterLite),
  clear: () => clearStore(STORES.characterLite),
};

// ============= 角色写入：源记录与派生投影在同一事务内维护 =============
// 投影是派生数据；写入必须与源记录同事务，且只写派生 store，绝不整条覆盖源记录。

async function addCharacter(data) {
  invalidateCharactersShared();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORES.characters, STORES.characterLite], 'readwrite');
    const liteStore = t.objectStore(STORES.characterLite);
    let newId;
    t.oncomplete = () => resolve(newId);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('角色新增事务中止'));
    const req = t.objectStore(STORES.characters).add(data);
    req.onsuccess = () => {
      newId = req.result;                                       // 自增 id 由请求结果回填
      const lite = buildCharacterLite({ ...data, id: newId });
      if (lite) liteStore.put(lite);
    };
  });
}

async function putCharacter(data) {
  invalidateCharactersShared();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORES.characters, STORES.characterLite], 'readwrite');
    const liteStore = t.objectStore(STORES.characterLite);
    let key;
    t.oncomplete = () => resolve(key);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('角色更新事务中止'));
    const req = t.objectStore(STORES.characters).put(data);
    req.onsuccess = () => {
      key = req.result;
      const lite = buildCharacterLite(data);
      if (lite) liteStore.put(lite);
    };
  });
}

async function delCharacter(id) {
  invalidateCharactersShared();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORES.characters, STORES.characterLite], 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('角色删除事务中止'));
    t.objectStore(STORES.characters).delete(id);
    t.objectStore(STORES.characterLite).delete(id);
  });
}

async function clearCharacters() {
  invalidateCharactersShared();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORES.characters, STORES.characterLite], 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('角色清空事务中止'));
    t.objectStore(STORES.characters).clear();
    t.objectStore(STORES.characterLite).clear();
  });
}

async function bulkInsertCharacters(items) {
  invalidateCharactersShared();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORES.characters, STORES.characterLite], 'readwrite');
    const cStore = t.objectStore(STORES.characters);
    const liteStore = t.objectStore(STORES.characterLite);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('角色批量写入事务中止'));
    for (const item of items) {
      // 保留原 id
      cStore.put(item);
      const lite = buildCharacterLite(item);   // 无 id 的条目交给读路径自愈
      if (lite) liteStore.put(lite);
    }
  });
}

// ============= 通用 CRUD（角色走上面的同事务版本；其它 store 保持原语义） =============

// 新增（不指定 id，自增）
async function add(storeName, data) {
  if (storeName === STORES.characters) return addCharacter(data);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const req = t.objectStore(storeName).add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 更新（必须有 id）
async function put(storeName, data) {
  if (storeName === STORES.characters) return putCharacter(data);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const req = t.objectStore(storeName).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 删除
async function del(storeName, id) {
  if (storeName === STORES.characters) return delCharacter(id);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const req = t.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// 清空 store（用于同步覆盖）
async function clearStore(storeName) {
  if (storeName === STORES.characters) return clearCharacters();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const req = t.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// 批量插入（同步用）
async function bulkInsert(storeName, items) {
  if (storeName === STORES.characters) return bulkInsertCharacters(items);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    for (const item of items) {
      // 保留原 id
      store.put(item);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// ============= 业务 API =============

// ============= 派生缩略图的原子写入 =============
// 缩略图是派生缓存，写入只允许改 thumbs、绝不整条覆盖记录——
// 整条覆盖会回退并发的同步/编辑写入（data loss）。因此这里在同一事务内做 read-modify-write，
// 不经过 put() 的整条替换；也不引入任何原生备份触发。
// （既有事实：scheduleBackup 只挂在从未被调用的 tx() 上，常规 CRUD 本就不触发备份，
//   备份只在页面隐藏时通过 visibilitychange 发生。）
function firstImageRefOf(record) {
  if (!record) return '';
  let imgs = record.images;
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs); } catch (e) { imgs = []; } }
  if (!Array.isArray(imgs)) imgs = [];
  if (imgs.length === 0 && record.image_url) return record.image_url;
  return imgs[0] || '';
}

// 仅当记录当前首图仍等于生成缩略图时所用的引用时才写入 thumbs（否则视为过期）。
// 返回 'ok' | 'stale' | 'missing'。
// 同一事务内同步更新轻量投影的 thumbs/needsOriginal（只改字段；投影不存在则不创建，等读路径自愈）。
async function updateCharacterThumb(id, expectFirstImage, thumb) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORES.characters, STORES.characterLite], 'readwrite');
    const store = t.objectStore(STORES.characters);
    const liteStore = t.objectStore(STORES.characterLite);
    const syncLite = () => {
      const liteReq = liteStore.get(id);
      liteReq.onsuccess = () => {
        const lite = liteReq.result;
        if (!lite) return;                    // 缺投影交给读路径自愈
        lite.thumbs = [thumb];
        lite.needsOriginal = false;
        liteStore.put(lite);
      };
    };
    t.oncomplete = () => resolve('ok');       // 以事务提交为准
    t.onerror = () => reject(t.error || new Error('缩略图事务失败'));
    t.onabort = () => reject(t.error || new Error('缩略图事务中止'));
    const req = store.get(id);
    req.onerror = () => reject(req.error || new Error('读取角色失败'));
    req.onsuccess = () => {
      const record = req.result;
      if (!record) return resolve('missing');
      // 生成期间记录被并发修改（同步/编辑）且首图已变：不得写入，交由后续 backfill 重生成。
      if (firstImageRefOf(record) !== expectFirstImage) return resolve('stale');
      if (Array.isArray(record.thumbs) && record.thumbs[0]) { syncLite(); return; }   // 已有：只补齐投影
      record.thumbs = [thumb];
      const putReq = store.put(record);
      putReq.onerror = () => reject(putReq.error || new Error('写入缩略图失败'));
      syncLite();
    };
  });
}

// ----- 角色 -----
const charDB = {
  list: async () => {
    const all = await getAll(STORES.characters);
    return all.sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
  },
  get: (id) => getById(STORES.characters, id),
  create: (data) => add(STORES.characters, data),
  update: (data) => put(STORES.characters, data),
  updateThumb: (id, expectFirstImage, thumb) => updateCharacterThumb(id, expectFirstImage, thumb),
  delete: (id) => del(STORES.characters, id),
  clear: () => clearStore(STORES.characters),
  bulkSet: (items) => bulkInsert(STORES.characters, items),
};

// ============= 同一轮共享的角色读取 =============
// 同一轮并发请求（例如关系页同时取 /api/relations 与 /api/characters）只做一次角色全量读取，
// 关系名称补全复用这份读取；读取结束后立即释放共享引用，任何角色写入都会使它失效。
let _sharedCharList = null;
function listCharactersShared() {
  if (!_sharedCharList) {
    _sharedCharList = charDB.list().finally(function () { _sharedCharList = null; });
  }
  return _sharedCharList;
}
// 同一轮共享的轻量投影读取（list / names 各自只做一次）；结束后立即释放引用，
// 任何角色写入都会使它失效（与 _sharedCharList 同一套语义）。
let _sharedCharLite = { list: null, names: null };
function listCharactersLiteShared(shape) {
  const key = shape === 'names' ? 'names' : 'list';
  if (!_sharedCharLite[key]) {
    _sharedCharLite[key] = readCharacterLiteAll({ needFirstRef: key === 'list' })
      .then(function (list) {
        if (key === 'names') {
          return list.map(function (c) {
            return { id: c.id, name: c.name, university: c.university, family: c.family };
          });
        }
        return list;
      })
      .finally(function () { _sharedCharLite[key] = null; });
  }
  return _sharedCharLite[key];
}

function invalidateCharactersShared() { _sharedCharList = null; _sharedCharLite = { list: null, names: null }; }

// ----- 世界设定 -----
const worldDB = {
  list: async (mainCategory) => {
    const all = await getAll(STORES.worldBuildings);
    const sorted = all.sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
    if (mainCategory) return sorted.filter(e => e.main_category === mainCategory);
    return sorted;
  },
  get: (id) => getById(STORES.worldBuildings, id),
  create: (data) => add(STORES.worldBuildings, data),
  update: (data) => put(STORES.worldBuildings, data),
  delete: (id) => del(STORES.worldBuildings, id),
  clear: () => clearStore(STORES.worldBuildings),
  bulkSet: (items) => bulkInsert(STORES.worldBuildings, items),
};

// ----- 关系 -----
const relDB = {
  list: async () => {
    const all = await getAll(STORES.relations);
    return all.sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
  },
  get: (id) => getById(STORES.relations, id),
  create: (data) => add(STORES.relations, data),
  update: (data) => put(STORES.relations, data),
  delete: (id) => del(STORES.relations, id),
  clear: () => clearStore(STORES.relations),
  bulkSet: (items) => bulkInsert(STORES.relations, items),
};

// ----- 文档（用文件名作 key，存 {name, blob, size, modified}） -----
const docDB = {
  list: async () => {
    const all = await getAll(STORES.documents);
    return all.map(d => ({
      name: d.name,
      size: d.size,
      size_display: formatSizeLocal(d.size),
      modified: d.modified,
    }));
  },
  get: (name) => getById(STORES.documents, name),
  create: (data) => put(STORES.documents, data),  // put 覆盖同名
  delete: (name) => del(STORES.documents, name),
  clear: () => clearStore(STORES.documents),
};

function formatSizeLocal(size) {
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (size < 1024) return unit === 'B' ? `${size} B` : `${size.toFixed(1)} ${unit}`;
    size /= 1024;
  }
  return `${size.toFixed(1)} TB`;
}

// ============= 服务器地址管理 =============

function getServerUrl() {
  return localStorage.getItem(SERVER_KEY) || '';
}

function setServerUrl(url) {
  if (url && !url.startsWith('http')) {
    url = 'http://' + url;
  }
  // 去掉末尾的 /
  if (url && url.endsWith('/')) url = url.slice(0, -1);
  localStorage.setItem(SERVER_KEY, url);
  return url;
}

function hasServer() {
  return !!getServerUrl();
}

// ============= 图片缓存（增量同步用） =============
// 缓存 dataUrl → serverUrl 的映射，避免重复上传/下载同一张图片

// 计算 dataUrl 的 hash：djb2 变种，遍历整个字符串，碰撞率远低于只取头尾
function imageHash(dataUrl) {
  if (!dataUrl) return '';
  let hash = 5381;
  const len = dataUrl.length;
  for (let i = 0; i < len; i++) {
    hash = ((hash * 33) ^ dataUrl.charCodeAt(i)) >>> 0;
  }
  return len + '_' + hash.toString(36);
}

const imageCacheDB = {
  // 只读快照：同步预览/执行的一轮流程共享这一份完整值索引。
  async listAll() {
    const all = await getAll(STORES.imageCache);
    return all.map(c => {
      const urls = Array.isArray(c.serverUrls) ? c.serverUrls.slice() : [];
      if (c.serverUrl && !urls.includes(c.serverUrl)) urls.unshift(c.serverUrl);
      return { ...c, serverUrl: c.serverUrl || urls[0] || '', serverUrls: urls };
    });
  },
  // 通过 dataUrl 查找已缓存的服务器URL。
  // hash 只是索引，完整 dataUrl 才是身份，且允许同一原图对应多个服务器地址。
  // 用现有主键 get 逐级校验（hash 碰撞时按 _N 后缀），不为一两张图做全表读取。
  async lookupByDataUrl(dataUrl) {
    if (!dataUrl) return null;
    const baseHash = imageHash(dataUrl);
    let key = baseHash;
    let suffix = 0;
    for (;;) {
      const record = await getById(STORES.imageCache, key);
      if (!record) return null;
      if (record.dataUrl === dataUrl) {
        const urls = Array.isArray(record.serverUrls) ? record.serverUrls.slice() : [];
        if (record.serverUrl && !urls.includes(record.serverUrl)) urls.unshift(record.serverUrl);
        return { ...record, serverUrl: record.serverUrl || urls[0] || '', serverUrls: urls };
      }
      key = baseHash + '_' + (++suffix);
      if (suffix > 1000) return null;
    }
  },
  // 通过 dataUrl 查找（兼容入口，等价于主键校验查找）
  async getByDataUrl(dataUrl) {
    return this.lookupByDataUrl(dataUrl);
  },
  // 通过 serverUrl 查找已缓存的 dataUrl
  async getByServerUrl(serverUrl) {
    const all = await this.listAll();
    return all.find(c => c.serverUrl === serverUrl || (Array.isArray(c.serverUrls) && c.serverUrls.includes(serverUrl)));
  },
  // 存入缓存：本轮已有完整值索引时只用内存索引；没有索引时用主键 get 链定位，不读全表。
  async set(dataUrl, serverUrl, knownRecords) {
    if (!dataUrl || !serverUrl) return;
    if (Array.isArray(knownRecords)) {
      const existing = knownRecords.find(c => c.dataUrl === dataUrl);
      if (existing) {
        const urls = Array.isArray(existing.serverUrls) ? existing.serverUrls.slice() : [];
        if (existing.serverUrl && !urls.includes(existing.serverUrl)) urls.unshift(existing.serverUrl);
        if (!urls.includes(serverUrl)) urls.push(serverUrl);
        existing.serverUrls = urls;
        existing.serverUrl = existing.serverUrl || urls[0] || serverUrl;
        await put(STORES.imageCache, existing);
        return existing;
      }
      const baseHash = imageHash(dataUrl);
      let key = baseHash;
      let suffix = 0;
      while (knownRecords.some(c => c.hash === key && c.dataUrl !== dataUrl)) key = baseHash + '_' + (++suffix);
      const record = { hash: key, dataUrl, serverUrl, serverUrls: [serverUrl] };
      await put(STORES.imageCache, record);
      knownRecords.push(record);
      return record;
    }
    const baseHash = imageHash(dataUrl);
    let key = baseHash;
    let suffix = 0;
    for (;;) {
      const record = await getById(STORES.imageCache, key);
      if (!record) {
        const created = { hash: key, dataUrl, serverUrl, serverUrls: [serverUrl] };
        await put(STORES.imageCache, created);
        return created;
      }
      if (record.dataUrl === dataUrl) {
        const urls = Array.isArray(record.serverUrls) ? record.serverUrls.slice() : [];
        if (record.serverUrl && !urls.includes(record.serverUrl)) urls.unshift(record.serverUrl);
        if (!urls.includes(serverUrl)) urls.push(serverUrl);
        record.serverUrls = urls;
        record.serverUrl = record.serverUrl || urls[0] || serverUrl;
        await put(STORES.imageCache, record);
        return record;
      }
      key = baseHash + '_' + (++suffix);
      if (suffix > 1000) throw new Error('图片缓存 hash 冲突过多');
    }
  },
  // 清空缓存
  clear: () => clearStore(STORES.imageCache),
};

// ============= 原生文件备份（防数据丢失的双保险） =============
// IndexedDB 在"系统存储空间不足被自动清理 / ROM 清理不常用 App 数据"时可能被清空。
// 这里把核心数据（角色/世界/关系）定期写入 App 私有目录 files/data_backup.json，
// 该目录不会被系统"清理缓存"影响；下次启动若检测到 IndexedDB 为空，可一键恢复。

let _backupTimer = null;

// 收集当前全部核心数据
async function collectBackupData() {
  const [chars, worlds, rels] = await Promise.all([
    getAll(STORES.characters),
    getAll(STORES.worldBuildings),
    getAll(STORES.relations),
  ]);
  return JSON.stringify({
    version: 1,
    savedAt: Date.now(),
    characters: stripDerivedThumbs(chars),
    worldBuildings: worlds,
    relations: rels,
  });
}

// 派生缩略图（thumbs）不进备份：与恢复语义无关，只增体积；恢复后由渲染侧 backfill 重新生成。
function stripDerivedThumbs(list) {
  return list.map(c => {
    if (!c || !c.thumbs) return c;
    const copy = { ...c };
    delete copy.thumbs;
    return copy;
  });
}

// 防抖保存备份（连续写操作 1.5s 内合并为一次）
function scheduleBackup() {
  if (!window.Android || !window.Android.saveBackup) return;
  if (_backupTimer) clearTimeout(_backupTimer);
  _backupTimer = setTimeout(async () => {
    _backupTimer = null;
    try {
      window.Android.saveBackup(await collectBackupData());
    } catch (e) { /* 备份失败不打断主流程 */ }
  }, 1500);
}

// 页面切后台时立即备份，确保退出前数据已落盘
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && window.Android && window.Android.saveBackup) {
    if (_backupTimer) { clearTimeout(_backupTimer); _backupTimer = null; }
    collectBackupData().then(function (json) {
      try { window.Android.saveBackup(json); } catch (e) { }
    });
  }
});

// 启动恢复检查：IndexedDB 为空但存在原生备份时，询问用户是否恢复
async function checkAndRestoreBackup() {
  if (!window.Android || !window.Android.hasBackup || !window.Android.loadBackup) return;
  try {
    if (!window.Android.hasBackup()) return;
    const chars = await getAll(STORES.characters);
    if (chars.length > 0) return; // 有数据就不打扰
    const json = window.Android.loadBackup();
    if (!json) return;
    const data = JSON.parse(json);
    const list = data.characters || [];
    if (!list.length) return;
    const when = data.savedAt ? new Date(data.savedAt).toLocaleString() : '未知时间';
    const ok = confirm('检测到本地备份（' + list.length + ' 个角色，备份于 ' + when + '）。\n\n当前数据为空，是否恢复？');
    if (!ok) return;
    await clearStore(STORES.characters);
    await bulkInsert(STORES.characters, list);
    if (data.worldBuildings && data.worldBuildings.length) {
      await clearStore(STORES.worldBuildings);
      await bulkInsert(STORES.worldBuildings, data.worldBuildings);
    }
    if (data.relations && data.relations.length) {
      await clearStore(STORES.relations);
      await bulkInsert(STORES.relations, data.relations);
    }
    alert('已从备份恢复 ' + list.length + ' 个角色！');
    location.reload(); // 重新加载页面，让各视图从 IndexedDB 拉取数据
  } catch (e) { /* 备份损坏等情况静默跳过 */ }
}

// 页面加载完成后执行恢复检查（此时各视图已初始化，若有备份则恢复后刷新）
window.addEventListener('load', function () {
  setTimeout(checkAndRestoreBackup, 500);
});
