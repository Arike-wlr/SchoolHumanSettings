// ============================================================
// db.js - IndexedDB 封装，提供与原后端 API 类似的接口
// 数据全部存在手机本地，离线可用
// ============================================================

const DB_NAME = 'oc_characters_db';
const DB_VERSION = 1;
const STORES = {
  characters: 'characters',       // 角色
  worldBuildings: 'worldBuildings', // 世界设定
  relations: 'relations',         // 关系
  documents: 'documents',         // 文档（存 Blob）
};
const SERVER_KEY = 'sync_server_url';  // 服务器地址存储 key

let _db = null;

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
    t.oncomplete = () => resolve(result);
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
