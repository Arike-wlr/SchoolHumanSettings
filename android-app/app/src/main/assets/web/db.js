// ============================================================
// db.js - IndexedDB 封装，提供与原后端 API 类似的接口
// 数据全部存在手机本地，离线可用
// ============================================================

const DB_NAME = 'oc_characters_db';
const DB_VERSION = 2;
const STORES = {
  characters: 'characters',       // 角色
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

// 新增（不指定 id，自增）
async function add(storeName, data) {
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

// ----- 角色 -----
const charDB = {
  list: async () => {
    const all = await getAll(STORES.characters);
    return all.sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
  },
  get: (id) => getById(STORES.characters, id),
  create: (data) => add(STORES.characters, data),
  update: (data) => put(STORES.characters, data),
  delete: (id) => del(STORES.characters, id),
  clear: () => clearStore(STORES.characters),
  bulkSet: (items) => bulkInsert(STORES.characters, items),
};

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
  // 通过 dataUrl 查找已缓存的服务器URL
  async getByDataUrl(dataUrl) {
    const all = await getAll(STORES.imageCache);
    const h = imageHash(dataUrl);
    return all.find(c => c.hash === h);
  },
  // 通过 serverUrl 查找已缓存的 dataUrl
  async getByServerUrl(serverUrl) {
    const all = await getAll(STORES.imageCache);
    return all.find(c => c.serverUrl === serverUrl);
  },
  // 存入缓存
  async set(dataUrl, serverUrl) {
    if (!dataUrl || !serverUrl) return;
    const existing = await this.getByDataUrl(dataUrl);
    if (existing) {
      existing.serverUrl = serverUrl;
      await put(STORES.imageCache, existing);
    } else {
      await put(STORES.imageCache, { hash: imageHash(dataUrl), dataUrl, serverUrl });
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
    characters: chars,
    worldBuildings: worlds,
    relations: rels,
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
