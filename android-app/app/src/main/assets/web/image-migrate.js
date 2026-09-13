/* ============================================================
   image-migrate.js —— 把存量 base64 图片搬进本地图片仓库

   一次性（但写坏可重跑）的搬迁：遍历角色记录，把 images / image_url 里的
   data URL 逐个写进文件仓库，记录改存 img:// 引用，随后作废该记录的轻量投影
   （读路径会用新引用自愈重建）。图片缓存里那份重复的 base64 副本一并搬走。

   搬迁必须扛得住"搬到一半被杀掉"：
     · 逐条处理，任一时刻内存里只持有一条记录，绝不整表物化
       （尤其不能用 imageCacheDB.listAll()，那会把全库图片读进内存）；
     · 每张图落盘都是"临时文件 + 改名"，不会留下半个文件；
     · 每条记录一次事务写完，中断只影响当前这一条，下次启动接着来；
     · 内容寻址天然幂等 —— 重复搬同一张图只会命中"文件已存在"。

   注意：这里的遍历是"读取-判断-可能重写"，迁移完成后再次运行只是空转
   （记录里已经没有 data URL），所以它对恢复备份、导入 JSON 这类
   "又进来一批老数据"的场景是自愈的，不依赖任何标记的准确性。
   ============================================================ */

var IMGREF_MIGRATED_KEY = 'imageRefMigratedVersion';
var IMGREF_MIGRATION_VERSION = '1';
var _imageMigrationRunning = null;

function imageMigrationDone() {
  try { return localStorage.getItem(IMGREF_MIGRATED_KEY) === IMGREF_MIGRATION_VERSION; }
  catch (e) { return false; }
}

// 恢复备份 / 导入 JSON 之后调用：那批数据可能又带着 base64，需要重新过一遍。
function clearImageMigrationFlag() {
  try { localStorage.removeItem(IMGREF_MIGRATED_KEY); } catch (e) { }
}

/** 这条记录的图片字段里是否还有需要搬迁的 data URL */
function needsImageRefMigration(record) {
  if (!record) return false;
  const list = liteImageRefs(record);
  for (let i = 0; i < list.length; i++) {
    if (isDataImageUrl(list[i])) return true;
  }
  return isDataImageUrl(record.image_url);
}

/**
 * 原子读-改-写：在同一个事务里重新读取记录，只替换图片字段。
 * 重新读取是必要的 —— 搬迁期间用户可能编辑了这条记录，拿旧快照整条覆盖会吃掉他的修改。
 * 顺带作废轻量投影（它的 firstRef/thumbs 还指向旧形态），由读路径重建。
 */
function applyImageRefMigration(id, mapped) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction([STORES.characters, STORES.characterLite], 'readwrite');
    const store = t.objectStore(STORES.characters);
    const liteStore = t.objectStore(STORES.characterLite);
    let changed = 0;
    t.oncomplete = () => resolve(changed);
    t.onerror = () => reject(t.error || new Error('图片迁移事务失败'));
    t.onabort = () => reject(t.error || new Error('图片迁移事务中止'));
    const req = store.get(id);
    req.onerror = () => reject(req.error || new Error('读取角色失败'));
    req.onsuccess = () => {
      const record = req.result;
      if (!record) return;
      const rewriteOne = (u) => (typeof u === 'string' && mapped.has(u)) ? mapped.get(u) : u;
      let dirty = false;
      // images 字段单独处理：不能把 image_url 折进来写回 images，那会改变记录形状
      if (typeof record.images === 'string') {
        let parsed = [];
        try { parsed = JSON.parse(record.images); } catch (e) { parsed = []; }
        if (Array.isArray(parsed)) {
          const next = parsed.map(rewriteOne);
          if (next.some((v, i) => v !== parsed[i])) { record.images = JSON.stringify(next); dirty = true; }
        }
      } else if (Array.isArray(record.images)) {
        const next = record.images.map(rewriteOne);
        if (next.some((v, i) => v !== record.images[i])) { record.images = next; dirty = true; }
      }
      if (typeof record.image_url === 'string') {
        const nextUrl = rewriteOne(record.image_url);
        if (nextUrl !== record.image_url) { record.image_url = nextUrl; dirty = true; }
      }
      if (!dirty) return;
      store.put(record);
      liteStore.delete(id);   // 投影作废；下次列表读取会用新引用重建
      changed = 1;
    };
  }));
}

/**
 * 图片缓存里的 dataUrl 也是**整份 base64 副本**（和角色记录里那份完全重复）。
 * 不搬走它，存储占用只能减半。key 是不透明主键，只改值、不动 key，
 * 否则会破坏"缓存 → 服务器地址"的既有映射。
 */
async function migrateImageCacheRows(onProgress) {
  const keys = await getAllKeys(STORES.imageCache);
  let migrated = 0;
  for (let i = 0; i < keys.length; i++) {
    const row = await getById(STORES.imageCache, keys[i]);
    if (row && isDataImageUrl(row.dataUrl)) {
      const stored = await imageStorePutDataUrl(row.dataUrl);
      if (stored && stored !== row.dataUrl) {
        const next = {};
        for (const k in row) next[k] = row[k];
        next.dataUrl = stored;
        try { await put(STORES.imageCache, next); migrated++; } catch (e) { }
      }
    }
    if ((i + 1) % 8 === 0) await yieldToMain();
  }
  return migrated;
}

/**
 * 主入口。options.force 为真时忽略"已完成"标记强制重扫（诊断入口用）。
 * 仓库不可用时直接跳过：那是桌面/测试环境，本来就维持 data URL 形态。
 */
function migrateImagesToStore(options) {
  const opts = options || {};
  if (!imageStoreAvailable()) return Promise.resolve({ skipped: true, reason: 'no-store' });
  if (!opts.force && imageMigrationDone()) return Promise.resolve({ skipped: true, reason: 'done' });
  if (_imageMigrationRunning) return _imageMigrationRunning;

  _imageMigrationRunning = (async () => {
    let records = 0, images = 0, failed = 0;
    const keys = await getAllKeys(STORES.characters);
    let lastTick = 0;
    for (let i = 0; i < keys.length; i++) {
      try {
        const record = await getById(STORES.characters, keys[i]);
        if (record && needsImageRefMigration(record)) {
          const mapped = new Map();
          const list = liteImageRefs(record);
          for (let j = 0; j < list.length; j++) {
            const ref = list[j];
            if (!isDataImageUrl(ref)) continue;
            const stored = await imageStorePutDataUrl(ref);
            if (stored && stored !== ref) { mapped.set(ref, stored); images++; }
          }
          if (mapped.size > 0) {
            records += await applyImageRefMigration(keys[i], mapped);
          }
        }
      } catch (e) {
        failed++;   // 单条失败不中断整体：先把能搬的搬完，下次启动继续
      }
      // 进度提示做节流，避免每条记录都刷一次 toast
      const now = Date.now();
      if (opts.onProgress && now - lastTick > 1500) {
        lastTick = now;
        opts.onProgress(`正在优化图片存储 (${i + 1}/${keys.length})...`);
      }
      if ((i + 1) % 8 === 0) await yieldToMain();   // 分批让出主线程，别把界面卡死
    }

    let cacheRows = 0;
    try { cacheRows = await migrateImageCacheRows(opts.onProgress); } catch (e) { failed++; }

    // 全部成功才记标记；有失败就留待下次启动重试（重跑是幂等的）。
    if (failed === 0) {
      try { localStorage.setItem(IMGREF_MIGRATED_KEY, IMGREF_MIGRATION_VERSION); } catch (e) { }
    }
    return { records, images, cacheRows, failed, total: keys.length };
  })().finally(() => { _imageMigrationRunning = null; });

  return _imageMigrationRunning;
}

// 启动后在后台跑：先让首屏渲染出来，再开始搬。用户改数据也不受影响
// （每条记录都是事务内重读后只改图片字段）。
function runImageMigrationInBackground() {
  if (!imageStoreAvailable()) return;
  if (imageMigrationDone()) return;
  migrateImagesToStore({
    onProgress: function (msg) {
      try { if (typeof showToast === 'function') showToast(msg); } catch (e) { }
    }
  }).then(function (result) {
    if (!result || result.skipped) return;
    if (result.failed > 0) {
      try { showToast(`${result.failed} 条记录暂未优化，下次启动会重试`, 'error'); } catch (e) { }
      return;
    }
    if (result.records > 0 || result.cacheRows > 0) {
      try { showToast(`图片已转为本地文件（${result.images} 张），存储占用已下降`); } catch (e) { }
      try { if (typeof refreshHome === 'function') refreshHome(); } catch (e) { }
    }
  }).catch(function (e) {
    console.warn('[image-migrate] 迁移失败:', e);
  });
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('load', function () {
    setTimeout(runImageMigrationInBackground, 800);
  });
}
