// ============================================================
// sync.js - 数据同步逻辑
// 增量同步：只更新变化的部分，不全量覆盖
// ============================================================

// 模块版本号：用于验证手机是否加载了最新代码
const SYNC_VERSION = '抗大抗大越抗越大';

// 版本升级只更新标记，不清空图片缓存；坏映射在实际读取时按 miss 处理并可恢复。
(async () => {
  try {
    const stored = localStorage.getItem('imageCacheVersion');
    if (stored !== SYNC_VERSION) {
      localStorage.setItem('imageCacheVersion', SYNC_VERSION);
      console.log('[sync] 图片缓存版本更新:', stored, '->', SYNC_VERSION);
    }
  } catch (e) { console.warn('[sync] 图片缓存版本标记失败:', e); }
})();

// ============= 图片处理辅助 =============
let _syncInFlight = null;

// 只允许一轮同步同时运行，避免两轮互相覆盖缓存和记录。
function runSyncOnce(operation) {
  if (_syncInFlight) return Promise.reject(new Error('同步正在进行，请等待当前轮结束'));
  _syncInFlight = Promise.resolve().then(operation).finally(() => { _syncInFlight = null; });
  return _syncInFlight;
}

// data URL 转 Blob
function dataUrlToBlob(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (!String(dataUrl || '').startsWith('data:') || comma < 0) throw new Error('图片 data URL 无效');
  const meta = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mimeMatch = meta.match(/^data:([^;]+)/i);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  if (!/;base64/i.test(meta)) {
    const text = decodeURIComponent(b64);
    return new Blob([text], { type: mime });
  }
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Blob 转 data URL
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function imageFailure(message, code, status) {
  const e = new Error(message);
  e.code = code;
  if (status != null) e.status = status;
  return e;
}

function normalizeServerBase(serverUrl) {
  const parsed = new URL(String(serverUrl || ''));
  parsed.hash = '';
  parsed.search = '';
  return parsed.href.replace(/\/$/, '');
}

function resolveServerImageUrl(serverUrl, imageRef) {
  const ref = String(imageRef || '');
  if (/^https?:\/\//i.test(ref)) return new URL(ref).href;
  return new URL(ref, normalizeServerBase(serverUrl) + '/').href;
}

function serverImageRef(fullUrl, serverUrl) {
  const full = new URL(fullUrl);
  const base = new URL(normalizeServerBase(serverUrl) + '/');
  if (full.origin !== base.origin) return full.href;
  return full.pathname + full.search + full.hash;
}

function imageList(record) {
  let imgs = record && record.images;
  if (typeof imgs === 'string') {
    try { imgs = JSON.parse(imgs); } catch (e) { imgs = []; }
  }
  if (!Array.isArray(imgs)) imgs = [];
  return imgs.length > 0 ? imgs.slice() : (record && record.image_url ? [record.image_url] : []);
}

function setImageList(record, images) {
  if (Array.isArray(record.images)) record.images = images.slice();
  else if (images.length) record.images = images.slice();
  if (Object.prototype.hasOwnProperty.call(record, 'image_url')) record.image_url = images[0] || '';
}

function isRemoteImageRef(value) {
  const ref = String(value || '');
  if (!ref) return false;
  if (/^https?:\/\//i.test(ref)) return true;
  return !/^[a-z][a-z\d+.-]*:/i.test(ref);
}

function detectImageMime(bytes, declared) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  const text = new TextDecoder().decode(bytes.subarray(0, 512));
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(text)) return 'image/svg+xml';
  return '';
}

async function normalizeImageBlob(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const mime = detectImageMime(bytes, blob.type);
  if (!mime) throw imageFailure('图片内容无法识别或不是图片', 'IMAGE_DECODE');
  const normalized = new Blob([blob], { type: mime });
  if (mime !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(normalized);
      if (bitmap && bitmap.close) bitmap.close();
    } catch (e) {
      throw imageFailure('图片无法解码', 'IMAGE_DECODE');
    }
  }
  if (mime === 'image/svg+xml' && typeof DOMParser === 'function') {
    const doc = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    if (!doc || doc.querySelector('parsererror')) throw imageFailure('图片无法解码', 'IMAGE_DECODE');
  }
  return normalized;
}

function retryableImageStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function retryableImageError(error) {
  return !error || error.code === 'IMAGE_TIMEOUT' || error.name === 'TypeError' || error.name === 'NetworkError';
}

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// GET 的总预算覆盖 headers 与 body；最多两次，仅重试网络/超时/明确临时状态。
async function fetchImageWithRetry(fullUrl, totalTimeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = totalTimeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const res = await fetch(fullUrl, { signal: controller.signal });
      if (!res.ok) {
        const error = imageFailure(`图片请求失败 (${res.status})`, 'IMAGE_HTTP', res.status);
        if (!retryableImageStatus(res.status) || attempt === 1) throw error;
        lastError = error;
      } else {
        const blob = await res.blob();
        return normalizeImageBlob(blob);
      }
    } catch (error) {
      if (error && error.code === 'IMAGE_DECODE') throw error;
      if (error && error.code === 'IMAGE_HTTP' && !retryableImageStatus(error.status)) throw error;
      lastError = error && error.name === 'AbortError'
        ? imageFailure('图片请求超时', 'IMAGE_TIMEOUT')
        : (error || imageFailure('图片请求失败', 'IMAGE_NETWORK'));
      if (attempt === 1 || !retryableImageError(lastError)) throw lastError;
    } finally {
      clearTimeout(timer);
    }
    const after = totalTimeoutMs - (Date.now() - startedAt);
    if (after <= 0) break;
    await waitFor(Math.min(500, after));
  }
  throw lastError || imageFailure('图片请求超时', 'IMAGE_TIMEOUT');
}

async function runBounded(items, limit, worker) {
  let cursor = 0;
  let stopped = false;
  let firstError = null;
  async function consume() {
    while (!stopped) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (error) {
        if (!firstError) firstError = error;
        stopped = true;
        return;
      }
    }
  }
  const count = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: count }, consume));
  if (firstError) throw firstError;
}

async function canonicalImageDataUrl(dataUrl) {
  return blobToDataUrl(await normalizeImageBlob(dataUrlToBlob(dataUrl)));
}

function cacheServerUrls(record) {
  if (!record) return [];
  const urls = Array.isArray(record.serverUrls) ? record.serverUrls.slice() : [];
  if (record.serverUrl && !urls.includes(record.serverUrl)) urls.unshift(record.serverUrl);
  return urls;
}

// 一轮同步只做一次 imageCache 全表读取，之后所有查询都复用这份引用索引。
async function loadImageCacheIndex() {
  const rows = imageCacheDB.listAll ? await imageCacheDB.listAll() : [];
  const byDataUrl = new Map();
  const byServerUrl = new Map();
  rows.forEach(row => {
    if (row && row.dataUrl) byDataUrl.set(row.dataUrl, row);
    cacheServerUrls(row).forEach(url => byServerUrl.set(url, row));
  });
  return {
    rows,
    byDataUrl,
    byServerUrl,
    // 本轮同步结束：释放索引引用，避免继续持有大图记录。
    release() {
      rows.length = 0;
      byDataUrl.clear();
      byServerUrl.clear();
    },
  };
}

function cacheRecordForData(index, dataUrl) {
  return index && index.byDataUrl ? index.byDataUrl.get(dataUrl) : null;
}

function cacheRecordForServer(index, serverUrl) {
  return index && index.byServerUrl ? index.byServerUrl.get(serverUrl) : null;
}

// ---------- 图片本地化：统一产出"库里存得下的表示" ----------
// 原生图片仓库可用时产出 img:// 引用（字节进文件，IndexedDB 里只留指纹）；
// 不可用时退回规范化 data URL —— 与改造前逐字节一致，既有测试据此继续成立。

async function storeImageBlob(blob) {
  const normalized = await normalizeImageBlob(blob);
  const ref = await imageStorePutBlob(normalized);
  return ref || await blobToDataUrl(normalized);
}

async function storeImageDataUrl(dataUrl) {
  const ref = await imageStorePutDataUrl(dataUrl);
  return ref || await canonicalImageDataUrl(dataUrl);
}

/** 缓存的图片表示 → 确认仓库里真有这张图（img:// 引用要校验文件还在） */
async function ensureStoredImage(ref) {
  const value = String(ref || '');
  if (!value) return null;
  if (isImageRef(value)) return imageRefExists(value) ? value : null;
  if (/^data:/i.test(value)) return await storeImageDataUrl(value);
  return null;
}

/**
 * 这张图是否"只存在于本地"（即需要上传到服务器）：img:// 引用与 data URL 都算。
 * 故意不含 blob: —— 浏览器可能已经 revoke 掉它，上传时取字节会抛错，
 * 进而把整轮同步判为失败；这与改造前的口径（只上传 data URL）一致。
 */
function isLocalOnlyImageRef(ref) {
  const value = String(ref || '');
  if (!value) return false;
  return isImageRef(value) || /^data:/i.test(value);
}

// 把服务器图片转成本地可持久表示（原生环境即 img:// 引用）。
// 任何必要图片失败都会抛错，调用方在核心记录写入前停止。
async function convertServerImagesToDataUrl(characters, serverUrl, onProgress) {
  const base = normalizeServerBase(serverUrl);
  const entries = new Map();
  const storedByRef = new Map();
  for (const c of characters) {
    for (const ref of imageList(c)) {
      if (!ref) continue;
      if (isImageRef(ref)) continue;                 // 已经是本地引用，无需处理
      if (/^data:/i.test(ref)) {
        try { storedByRef.set(ref, await storeImageDataUrl(ref)); }
        catch (e) { throw imageFailure(`图片内容无效：${ref.slice(0, 24)}`, e.code || 'IMAGE_DECODE'); }
        continue;
      }
      if (/^blob:/i.test(ref)) {
        try {
          const response = await fetch(ref);
          if (!response.ok) throw imageFailure(`图片请求失败 (${response.status})`, 'IMAGE_HTTP', response.status);
          storedByRef.set(ref, await storeImageBlob(await response.blob()));
        } catch (e) {
          throw imageFailure(`本地图片读取失败：${ref.slice(0, 40)}`, e.code || 'IMAGE_SOURCE', e.status);
        }
        continue;
      }
      if (!isRemoteImageRef(ref)) throw imageFailure('图片来源不支持: ' + ref, 'IMAGE_SOURCE');
      const fullUrl = resolveServerImageUrl(base, ref);
      const entry = entries.get(fullUrl) || { fullUrl, refs: [] };
      entry.refs.push(ref);
      entries.set(fullUrl, entry);
    }
  }
  if (entries.size === 0) {
    for (const c of characters) setImageList(c, imageList(c).map(ref => storedByRef.has(ref) ? storedByRef.get(ref) : ref));
    return { total: 0, skipped: 0 };
  }
  const cacheIndex = await loadImageCacheIndex();
  const pending = [];
  let skipped = 0;
  for (const entry of entries.values()) {
    const fullUrl = entry.fullUrl;
    const cached = cacheRecordForServer(cacheIndex, fullUrl);
    // 缓存命中也要过一遍 ensureStoredImage：引用对应的文件可能已被清理；
    // 而且旧缓存行里存的是 data URL，这里顺带把它转成引用。
    let stored = null;
    if (cached && cached.dataUrl) {
      try { stored = await ensureStoredImage(cached.dataUrl); }
      catch (e) { stored = null; }                   // 坏缓存只视为 miss，允许 GET 修复。
    }
    if (stored) {
      entry.refs.forEach(ref => storedByRef.set(ref, stored));
      skipped++;
    } else {
      pending.push(entry);
    }
  }
  await runBounded(pending, 2, async (item, index) => {
    onProgress && onProgress(`正在下载图片 (${skipped + index + 1}/${entries.size})...`);
    try {
      const blob = await fetchImageWithRetry(item.fullUrl);
      const stored = await storeImageBlob(blob);
      await imageCacheDB.set(stored, item.fullUrl, cacheIndex.rows);
      item.refs.forEach(ref => storedByRef.set(ref, stored));
    } catch (error) {
      throw imageFailure(`图片下载失败: ${item.refs[0]}（${error.message}）`, error.code || 'IMAGE_DOWNLOAD', error.status);
    }
  });
  if (skipped > 0) onProgress && onProgress(`图片同步：${skipped} 张已缓存，${pending.length} 张需下载`);
  for (const c of characters) {
    const images = imageList(c).map(ref => storedByRef.has(ref) ? storedByRef.get(ref) : ref);
    setImageList(c, images);
  }
  cacheIndex.release();
  return { total: entries.size, skipped };
}

function imageExtension(mime) {
  return mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1].replace('+xml', '');
}

// 上传只做一次 POST；缓存映射复用前先确认当前服务器仍有资源。
// 处理对象是"只在本地存在"的图片：img:// 引用（新形态）与 data URL（旧数据）。
async function verifyUploadImageMappings(characters, serverUrl, cacheIndex) {
  const base = normalizeServerBase(serverUrl);
  const current = new URL(base).origin;
  const staleDataUrls = new Set();   // 元素是本地图片标识：img:// 引用或 data URL
  const localRefs = new Set();
  for (const c of characters) for (const ref of imageList(c)) if (isLocalOnlyImageRef(ref)) localRefs.add(ref);
  for (const localRef of localRefs) {
    const cached = cacheRecordForData(cacheIndex, localRef);
    const candidates = cacheServerUrls(cached).filter(u => /^https?:\/\//i.test(u))
      .map(u => resolveServerImageUrl(base, u)).filter(u => new URL(u).origin === current);
    if (candidates.length === 0) continue;
    let missing = false;
    for (const candidate of candidates) {
      try {
        await fetchImageWithRetry(candidate);
        missing = false;
        break;
      } catch (error) {
        if (error.status === 404) missing = true;
        else throw error;
      }
    }
    if (missing) staleDataUrls.add(localRef);
  }
  return staleDataUrls;
}

async function convertDataUrlImagesToServerUrl(characters, serverUrl, onProgress, cacheIndex) {
  const base = normalizeServerBase(serverUrl);
  cacheIndex = cacheIndex || await loadImageCacheIndex();
  const localRefs = new Set();
  for (const c of characters) for (const ref of imageList(c)) if (isLocalOnlyImageRef(ref)) localRefs.add(ref);
  if (localRefs.size === 0) return;
  const serverRefByLocal = new Map();
  let skipped = 0;
  const failed = [];
  for (const localRef of localRefs) {
    const cached = cacheRecordForData(cacheIndex, localRef);
    let cachedFull = null;
    const current = new URL(base).origin;
    if (cached) {
      for (const serverUrl of cacheServerUrls(cached)) {
        if (!/^https?:\/\//i.test(serverUrl)) continue;
        const candidate = resolveServerImageUrl(base, serverUrl);
        if (new URL(candidate).origin === current) { cachedFull = candidate; break; }
      }
    }
    if (cachedFull) {
      try {
        await fetchImageWithRetry(cachedFull);
        serverRefByLocal.set(localRef, serverImageRef(cachedFull, base));
        skipped++;
        continue;
      } catch (error) {
        if (error.status !== 404) { failed.push(error); continue; }
      }
    }
    onProgress && onProgress(`正在上传图片 (${localRefs.size - failed.length - skipped}/${localRefs.size})...`);
    try {
      // 图片来源可能是 img:// 引用（读文件）或 data URL（就地解码），统一由 imageRefToBlob 处理
      const blob = await normalizeImageBlob(await imageRefToBlob(localRef));
      const formData = new FormData();
      formData.append('file', blob, 'image.' + imageExtension(blob.type));
      const res = await fetch(base + '/api/images/upload', { method: 'POST', body: formData });
      if (!res.ok) throw imageFailure(`图片上传失败 (${res.status})`, 'IMAGE_UPLOAD', res.status);
      const result = await res.json();
      if (!result || typeof result.image_url !== 'string' || !result.image_url) throw imageFailure('图片上传响应缺少 image_url', 'IMAGE_UPLOAD');
      const fullUrl = resolveServerImageUrl(base, result.image_url);
      await imageCacheDB.set(localRef, fullUrl, cacheIndex.rows);
      const stored = cacheIndex.rows.find(row => row.dataUrl === localRef);
      if (stored) {
        cacheIndex.byDataUrl.set(localRef, stored);
        cacheIndex.byServerUrl.set(fullUrl, stored);
      }
      serverRefByLocal.set(localRef, serverImageRef(fullUrl, base));
    } catch (error) {
      console.warn('图片上传失败:', error);
      failed.push(error);
    }
  }
  if (skipped > 0) onProgress && onProgress(`图片同步：${skipped} 张已缓存，${localRefs.size - skipped} 张需上传`);
  for (const c of characters) {
    const images = imageList(c).map(ref => serverRefByLocal.has(ref) ? serverRefByLocal.get(ref) : ref);
    setImageList(c, images);
  }
  if (failed.length > 0) throw new Error(`${failed.length} 张图片上传/校验失败，请检查网络后重试`);
}

// ============= 服务器连通性测试 =============
async function pingServer(url) {
  try {
    const res = await fetch(url + '/api/characters', { method: 'GET', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ============= 增量比较辅助 =============

/**
 * 比较两个数组，计算 source → target 方向的增量变更
 * @param sourceArr 源端数据（同步的来源）
 * @param targetArr 目标端数据（将被更新的一端）
 * @param matchFn (sourceRec, targetRec) => boolean 判断两条记录是否指向同一实体
 * @param isSameFn (sourceRec, targetRec) => boolean 判断内容是否相同（相同则跳过）
 * @param labelFn (rec) => string 返回用于显示的标签
 * @returns {{added: [], deleted: [], modified: []}}
 *   added: 源端有、目标端无 → 目标端需新增
 *   deleted: 目标端有、源端无 → 目标端需删除
 *   modified: 匹配但内容不同 → 目标端需更新
 */
function computeRecordDiff(sourceArr, targetArr, matchFn, isSameFn, labelFn) {
  const added = [], deleted = [], modified = [];
  const matchedTarget = new Set();
  for (const s of sourceArr) {
    let found = -1;
    for (let i = 0; i < targetArr.length; i++) {
      if (matchedTarget.has(i)) continue;
      if (matchFn(s, targetArr[i])) { found = i; break; }
    }
    if (found >= 0) {
      matchedTarget.add(found);
      if (!isSameFn(s, targetArr[found])) {
        modified.push({ source: s, target: targetArr[found], label: labelFn(s) });
      }
    } else {
      added.push({ source: s, label: labelFn(s) });
    }
  }
  for (let i = 0; i < targetArr.length; i++) {
    if (!matchedTarget.has(i)) {
      deleted.push({ target: targetArr[i], label: labelFn(targetArr[i]) });
    }
  }
  return { added, deleted, modified };
}

// 预览只读缓存映射，不下载也不写业务数据；未知图片保守地视为待核验。
async function canonicalizeRecordsForDiff(records, serverUrl, localSide = false, cacheIndex, options) {
  const base = normalizeServerBase(serverUrl);
  const index = cacheIndex || await loadImageCacheIndex();
  const opts = options || {};
  const staleDataUrls = opts.staleDataUrls || new Set();
  function canonicalRef(ref) {
    // 本地图片：img:// 引用（新形态）与 data URL（旧数据）都靠缓存映射折算成服务器地址，
    // 只有这样本地记录与服务器记录才比得出"是不是同一张图"。
    if (isImageRef(ref) || /^data:/i.test(ref)) {
      const cached = cacheRecordForData(index, ref);
      if (opts.trustDataCache !== false && !staleDataUrls.has(ref)) {
        const sameOrigin = cacheServerUrls(cached).find(u => /^https?:\/\//i.test(u)
          && new URL(resolveServerImageUrl(base, u)).origin === new URL(base).origin);
        if (sameOrigin) return resolveServerImageUrl(base, sameOrigin);
      }
      return ref;
    }
    if (isRemoteImageRef(ref)) return localSide ? `local-url:${ref}` : resolveServerImageUrl(base, ref);
    return ref;
  }
  return Promise.all(records.map(async record => {
    const copy = { ...record };
    const images = imageList(record).map(canonicalRef);
    setImageList(copy, images);
    if (Object.prototype.hasOwnProperty.call(record, 'image_url')) copy.image_url = canonicalRef(record.image_url || '');
    return copy;
  }));
}

// 角色内容比较（排除 id/时间戳/sort_order，图片按顺序逐项比较）
function charContentEqual(a, b) {
  const fields = ['alias', 'university', 'region', 'naming_rationale', 'height',
                   'gender', 'birthday', 'appearance', 'identity_period', 'birth_time',
                   'setting', 'family', 'birthplace', 'status'];
  for (const f of fields) {
    if ((a[f] || '') !== (b[f] || '')) return false;
  }
  const aImgs = imageList(a);
  const bImgs = imageList(b);
  if (aImgs.length !== bImgs.length) return false;
  if (!aImgs.every((value, index) => value === bImgs[index])) return false;
  return (a.image_url || '') === (b.image_url || '');
}

// 设定内容比较
function worldContentEqual(a, b) {
  return (a.category || '') === (b.category || '')
      && (a.content || '') === (b.content || '')
      && (a.main_category || '') === (b.main_category || '');
}

// 关系内容比较（只比较 description，from/to/type 是匹配键）
function relContentEqual(a, b) {
  return (a.description || '') === (b.description || '');
}

// 给本地关系补充 from_name / to_name（本地 DB 不存这俩字段）
function enrichRelationsWithNames(relations, characters) {
  const charMap = {};
  characters.forEach(c => { charMap[c.id] = c.name; });
  return relations.map(r => ({
    ...r,
    from_name: r.from_name || charMap[r.from_char_id] || '',
    to_name: r.to_name || charMap[r.to_char_id] || '',
  }));
}

// ============= 从服务器增量下载（只更新变化的部分） =============
async function downloadFromServer(onProgress) {
  const url = getServerUrl();
  if (!url) throw new Error('未配置服务器地址');

  // 1. 并行拉取服务器全量数据
  onProgress && onProgress('正在拉取服务器数据...');
  const [charRes, worldRes, relRes, docListRes] = await Promise.all([
    fetch(url + '/api/characters'),
    fetch(url + '/api/world-buildings'),
    fetch(url + '/api/relations'),
    fetch(url + '/api/files'),
  ]);
  if (!charRes.ok) throw new Error('获取角色失败');
  if (!worldRes.ok) throw new Error('获取世界设定失败');
  if (!relRes.ok) throw new Error('获取关系网失败');
  if (!docListRes.ok) throw new Error('获取文档列表失败');
  const serverChars = await charRes.json();
  const serverWorlds = await worldRes.json();
  const serverRels = await relRes.json();
  const serverDocs = await docListRes.json();

  // 2. 转换服务器图片 URL → data URL（离线可显示）
  if (serverChars.some(c => (c.images && c.images.length) || c.image_url)) {
    await convertServerImagesToDataUrl(serverChars, url, onProgress);
  }

  // 3. 获取本地数据
  const [localChars, localWorlds, localRels, localDocs] = await Promise.all([
    charDB.list(), worldDB.list(), relDB.list(), docDB.list(),
  ]);
  const localRelsNamed = enrichRelationsWithNames(localRels, localChars);

  // 4. 计算增量差异
  const charDiff = computeRecordDiff(serverChars, localChars,
    (s, t) => s.name === t.name, charContentEqual, r => r.name);
  const worldDiff = computeRecordDiff(serverWorlds, localWorlds,
    (s, t) => s.title === t.title, worldContentEqual, r => r.title);
  const relDiff = computeRecordDiff(serverRels, localRelsNamed,
    (s, t) => s.from_name === t.from_name && s.to_name === t.to_name && s.relation_type === t.relation_type,
    relContentEqual, r => `${r.from_name}→${r.to_name}(${r.relation_type})`);

  const charChanges = charDiff.added.length + charDiff.deleted.length + charDiff.modified.length;
  const worldChanges = worldDiff.added.length + worldDiff.deleted.length + worldDiff.modified.length;
  const relChanges = relDiff.added.length + relDiff.deleted.length + relDiff.modified.length;

  // 5. 增量同步角色
  if (charChanges > 0) {
    onProgress && onProgress(`正在同步角色 (${charChanges} 项变更)...`);
    for (const item of charDiff.deleted) await charDB.delete(item.target.id);
    for (const item of charDiff.modified) {
      await charDB.update({ ...item.source, id: item.target.id, sort_order: item.target.sort_order });
    }
    for (const item of charDiff.added) {
      const { id, ...rest } = item.source;
      await charDB.create(rest);
    }
  }

  // 6. 重新获取本地角色，建立 name → localId 映射（关系同步需要）
  const updatedLocalChars = await charDB.list();
  const nameToLocalId = new Map(updatedLocalChars.map(c => [c.name, c.id]));

  // 7. 增量同步世界设定
  if (worldChanges > 0) {
    onProgress && onProgress(`正在同步世界设定 (${worldChanges} 项变更)...`);
    for (const item of worldDiff.deleted) await worldDB.delete(item.target.id);
    for (const item of worldDiff.modified) {
      await worldDB.update({ ...item.source, id: item.target.id, sort_order: item.target.sort_order });
    }
    for (const item of worldDiff.added) {
      const { id, ...rest } = item.source;
      await worldDB.create(rest);
    }
  }

  // 8. 增量同步关系（转换 char_id：server id → local id）
  if (relChanges > 0) {
    onProgress && onProgress(`正在同步关系 (${relChanges} 项变更)...`);
    for (const item of relDiff.deleted) await relDB.delete(item.target.id);
    for (const item of relDiff.modified) {
      const localFromId = nameToLocalId.get(item.source.from_name);
      const localToId = nameToLocalId.get(item.source.to_name);
      if (!localFromId || !localToId) continue;
      const { id, from_name, to_name, ...rest } = item.source;
      await relDB.update({ ...rest, id: item.target.id, from_char_id: localFromId, to_char_id: localToId, sort_order: item.target.sort_order });
    }
    for (const item of relDiff.added) {
      const localFromId = nameToLocalId.get(item.source.from_name);
      const localToId = nameToLocalId.get(item.source.to_name);
      if (!localFromId || !localToId) continue;
      const { id, from_name, to_name, ...rest } = item.source;
      await relDB.create({ ...rest, from_char_id: localFromId, to_char_id: localToId });
    }
  }

  // 9. 文档增量同步（name + size 比较）
  onProgress && onProgress('正在同步文档...');
  const localDocMap = new Map(localDocs.map(d => [d.name, d]));
  const serverDocNames = new Set(serverDocs.map(d => d.name));
  let docDeleted = 0;
  for (const ld of localDocs) {
    if (!serverDocNames.has(ld.name)) { await docDB.delete(ld.name); docDeleted++; }
  }
  const toDownload = serverDocs.filter(sd => {
    const ld = localDocMap.get(sd.name);
    return !ld || ld.size !== sd.size;
  });
  for (let i = 0; i < toDownload.length; i++) {
    const doc = toDownload[i];
    onProgress && onProgress(`正在下载文档 (${i + 1}/${toDownload.length})...`);
    const blobRes = await fetch(url + '/api/files/' + encodeURIComponent(doc.name));
    if (!blobRes.ok) throw new Error('下载文档失败: ' + doc.name);
    const blob = await blobRes.blob();
    await docDB.create({ name: doc.name, blob, size: doc.size, modified: doc.modified });
  }

  onProgress && onProgress('下载完成');
  return {
    characters: updatedLocalChars.length,
    worldBuildings: (await worldDB.list()).length,
    relations: (await relDB.list()).length,
    documents: serverDocs.length,
    documentsSynced: toDownload.length + docDeleted,
    charChanges, worldChanges, relChanges,
  };
}

// ============= 增量上传到服务器（只更新变化的部分） =============
async function uploadToServer(onProgress) {
  const url = getServerUrl();
  if (!url) throw new Error('未配置服务器地址');

  // 1. 读取本地数据
  onProgress && onProgress('正在读取本地数据...');
  const [localChars, localWorlds, localRels, localDocs] = await Promise.all([
    charDB.list(), worldDB.list(), relDB.list(), docDB.list(),
  ]);
  const localRelsNamed = enrichRelationsWithNames(localRels, localChars);

  // 2. 拉取服务器数据（用于比较）
  onProgress && onProgress('正在拉取服务器数据...');
  const [charRes, worldRes, relRes, docListRes] = await Promise.all([
    fetch(url + '/api/characters'),
    fetch(url + '/api/world-buildings'),
    fetch(url + '/api/relations'),
    fetch(url + '/api/files'),
  ]);
  if (!charRes.ok || !worldRes.ok || !relRes.ok || !docListRes.ok) {
    throw new Error('获取服务器数据失败');
  }
  const serverChars = await charRes.json();
  const serverWorlds = await worldRes.json();
  const serverRels = await relRes.json();
  const serverDocs = await docListRes.json();

  // 3. 计算增量差异；比较副本只用于身份判断，写回仍使用原始本地记录。
  const cacheIndex = await loadImageCacheIndex();
  const staleDataUrls = await verifyUploadImageMappings(localChars, url, cacheIndex);
  const comparableLocalChars = await canonicalizeRecordsForDiff(localChars, url, true, cacheIndex, { staleDataUrls });
  const comparableServerChars = await canonicalizeRecordsForDiff(serverChars, url, false, cacheIndex);
  const charDiff = computeRecordDiff(comparableLocalChars, comparableServerChars,
    (s, t) => s.name === t.name, charContentEqual, r => r.name);
  for (const item of [...charDiff.added, ...charDiff.modified]) {
    item.source = localChars.find(c => c.name === item.source.name) || item.source;
  }
  for (const item of [...charDiff.deleted, ...charDiff.modified]) {
    item.target = serverChars.find(c => c.name === item.target.name) || item.target;
  }
  const worldDiff = computeRecordDiff(localWorlds, serverWorlds,
    (s, t) => s.title === t.title, worldContentEqual, r => r.title);
  const relDiff = computeRecordDiff(localRelsNamed, serverRels,
    (s, t) => s.from_name === t.from_name && s.to_name === t.to_name && s.relation_type === t.relation_type,
    relContentEqual, r => `${r.from_name}→${r.to_name}(${r.relation_type})`);

  const charChanges = charDiff.added.length + charDiff.deleted.length + charDiff.modified.length;
  const worldChanges = worldDiff.added.length + worldDiff.deleted.length + worldDiff.modified.length;
  const relChanges = relDiff.added.length + relDiff.deleted.length + relDiff.modified.length;

  // 4. 上传图片（仅对需要同步的角色）
  const charsToUpload = [
    ...charDiff.added.map(i => i.source),
    ...charDiff.modified.map(i => i.source),
  ];
  // 判据必须覆盖 img:// 引用，不能只看 data: 前缀 ——
  // 否则本地新增的图片会被认为"没什么要传的"，永远同步不到服务器。
  const needsImageUpload = charsToUpload.some(c =>
    (Array.isArray(c.images) && c.images.some(isLocalOnlyImageRef)) || isLocalOnlyImageRef(c.image_url));
  if (needsImageUpload) {
    await convertDataUrlImagesToServerUrl(charsToUpload, url, onProgress, cacheIndex);
  }

  // 5. 增量同步角色到服务器
  if (charChanges > 0) {
    onProgress && onProgress(`正在同步角色 (${charChanges} 项变更)...`);
    for (const item of charDiff.deleted) {
      await fetch(url + '/api/characters/' + item.target.id, { method: 'DELETE' });
    }
    for (const item of charDiff.modified) {
      const c = item.source;
      const body = {
        name: c.name, alias: c.alias || '', university: c.university || '',
        region: c.region || '', naming_rationale: c.naming_rationale || '',
        height: c.height || '', gender: c.gender || '', birthday: c.birthday || '',
        appearance: c.appearance || '', identity_period: c.identity_period || '',
        birth_time: c.birth_time || '', setting: c.setting || '', family: c.family || '',
        birthplace: c.birthplace || '', status: c.status || '存在',
        images: Array.isArray(c.images) ? c.images : (c.image_url ? [c.image_url] : []),
      };
      const res = await fetch(url + '/api/characters/' + item.target.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('更新角色失败: ' + c.name);
    }
    for (const item of charDiff.added) {
      const c = item.source;
      const body = {
        name: c.name, alias: c.alias || '', university: c.university || '',
        region: c.region || '', naming_rationale: c.naming_rationale || '',
        height: c.height || '', gender: c.gender || '', birthday: c.birthday || '',
        appearance: c.appearance || '', identity_period: c.identity_period || '',
        birth_time: c.birth_time || '', setting: c.setting || '', family: c.family || '',
        birthplace: c.birthplace || '', status: c.status || '存在',
        image_url: c.image_url || '',
        images: Array.isArray(c.images) ? c.images : (c.image_url ? [c.image_url] : []),
      };
      const res = await fetch(url + '/api/characters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('新增角色失败: ' + c.name);
    }
  }

  // 6. 重新拉取服务器角色，建立 name → serverId 映射（关系同步需要）
  const updatedServerChars = await (await fetch(url + '/api/characters')).json();
  const nameToServerId = new Map(updatedServerChars.map(c => [c.name, c.id]));

  // 7. 增量同步世界设定
  if (worldChanges > 0) {
    onProgress && onProgress(`正在同步世界设定 (${worldChanges} 项变更)...`);
    for (const item of worldDiff.deleted) {
      await fetch(url + '/api/world-buildings/' + item.target.id, { method: 'DELETE' });
    }
    for (const item of worldDiff.modified) {
      const w = item.source;
      const res = await fetch(url + '/api/world-buildings/' + item.target.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: w.title, category: w.category || '', content: w.content || '', main_category: w.main_category || '' }),
      });
      if (!res.ok) throw new Error('更新设定失败: ' + w.title);
    }
    for (const item of worldDiff.added) {
      const w = item.source;
      const res = await fetch(url + '/api/world-buildings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: w.title, category: w.category || '', content: w.content || '', main_category: w.main_category || '' }),
      });
      if (!res.ok) throw new Error('新增设定失败: ' + w.title);
    }
  }

  // 8. 增量同步关系（转换 char_id：local id → server id）
  if (relChanges > 0) {
    onProgress && onProgress(`正在同步关系 (${relChanges} 项变更)...`);
    for (const item of relDiff.deleted) {
      await fetch(url + '/api/relations/' + item.target.id, { method: 'DELETE' });
    }
    for (const item of relDiff.modified) {
      const r = item.source;
      const serverFromId = nameToServerId.get(r.from_name);
      const serverToId = nameToServerId.get(r.to_name);
      if (!serverFromId || !serverToId) continue;
      const res = await fetch(url + '/api/relations/' + item.target.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_char_id: serverFromId, to_char_id: serverToId, relation_type: r.relation_type, description: r.description || '' }),
      });
      if (!res.ok) throw new Error('更新关系失败: ' + r.from_name + '→' + r.to_name);
    }
    for (const item of relDiff.added) {
      const r = item.source;
      const serverFromId = nameToServerId.get(r.from_name);
      const serverToId = nameToServerId.get(r.to_name);
      if (!serverFromId || !serverToId) continue;
      const res = await fetch(url + '/api/relations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_char_id: serverFromId, to_char_id: serverToId, relation_type: r.relation_type, description: r.description || '' }),
      });
      if (!res.ok) throw new Error('新增关系失败: ' + r.from_name + '→' + r.to_name);
    }
  }

  // 9. 文档增量同步（name + size 比较）
  onProgress && onProgress('正在同步文档...');
  const serverDocMap = new Map(serverDocs.map(d => [d.name, d]));
  const localDocNames = new Set(localDocs.map(d => d.name));
  let docDeleted = 0;
  for (const sd of serverDocs) {
    if (!localDocNames.has(sd.name)) {
      await fetch(url + '/api/files/' + encodeURIComponent(sd.name), { method: 'DELETE' });
      docDeleted++;
    }
  }
  const toUpload = localDocs.filter(ld => {
    const sd = serverDocMap.get(ld.name);
    return !sd || sd.size !== ld.size;
  });
  for (let i = 0; i < toUpload.length; i++) {
    const docMeta = toUpload[i];
    onProgress && onProgress(`正在上传文档 (${i + 1}/${toUpload.length})...`);
    const doc = await docDB.get(docMeta.name);
    const formData = new FormData();
    formData.append('files', doc.blob, doc.name);
    const uploadRes = await fetch(url + '/api/files/upload', { method: 'POST', body: formData });
    if (!uploadRes.ok) throw new Error('文档上传失败: ' + docMeta.name);
  }

  onProgress && onProgress('上传完成');
  return {
    characters: localChars.length,
    worldBuildings: localWorlds.length,
    relations: localRels.length,
    documents: localDocs.length,
    documentsSynced: toUpload.length + docDeleted,
    charChanges, worldChanges, relChanges,
  };
}

// ============= 获取服务器统计信息（不下载） =============
async function getServerStats() {
  const url = getServerUrl();
  if (!url) return null;
  try {
    const [charRes, worldRes, relRes, docRes] = await Promise.all([
      fetch(url + '/api/characters'),
      fetch(url + '/api/world-buildings'),
      fetch(url + '/api/relations'),
      fetch(url + '/api/files'),
    ]);
    const characters = await charRes.json();
    const worldBuildings = await worldRes.json();
    const relations = await relRes.json();
    const documents = await docRes.json();
    return { characters: characters.length, worldBuildings: worldBuildings.length, relations: relations.length, documents: documents.length };
  } catch (e) {
    return null;
  }
}

// ============= 获取本地统计 =============
async function getLocalStats() {
  const [characters, worldBuildings, relations, documents] = await Promise.all([
    charDB.list(),
    worldDB.list(),
    relDB.list(),
    docDB.list(),
  ]);
  return { characters: characters.length, worldBuildings: worldBuildings.length, relations: relations.length, documents: documents.length };
}

// ============= 计算同步差异（只读，不修改任何数据） =============
// direction: 'download' (服务器→本地) | 'upload' (本地→服务器)
// 返回各数据类型的 added/deleted/modified 标签列表
async function getSyncDiff(direction) {
  const url = getServerUrl();
  if (!url) throw new Error('未配置服务器地址');

  const [charRes, worldRes, relRes, docRes] = await Promise.all([
    fetch(url + '/api/characters'),
    fetch(url + '/api/world-buildings'),
    fetch(url + '/api/relations'),
    fetch(url + '/api/files'),
  ]);
  if (!charRes.ok || !worldRes.ok || !relRes.ok || !docRes.ok) {
    throw new Error('获取服务器数据失败');
  }
  const serverChars = await charRes.json();
  const serverWorlds = await worldRes.json();
  const serverRels = await relRes.json();
  const serverDocs = await docRes.json();

  const [localChars, localWorlds, localRels, localDocs] = await Promise.all([
    charDB.list(), worldDB.list(), relDB.list(), docDB.list(),
  ]);
  const localRelsNamed = enrichRelationsWithNames(localRels, localChars);

  // 根据方向确定 source 和 target
  const isDownload = direction === 'download';
  // 只用已有缓存证明已知图片相同；未知图片保守列为待核验，不触发下载或业务写入。
  const cacheIndex = await loadImageCacheIndex();
  const comparableServerChars = await canonicalizeRecordsForDiff(serverChars, url, false, cacheIndex);
  // 预览必须与实际执行同一口径。本地图片存的是 data URL，只要能通过本机图片缓存
  // 证明它对应"当前服务器上的同一个 URL"，就不算变更。
  // 这里原先是 { trustDataCache: isDownload }：upload 方向等于把所有本地 data URL
  // 都当成"服务器上没有"，于是每个带图角色每次预览都被报成"✏ 修改"（80 个角色里的那 17 个），
  // 而点确认后执行 uploadToServer 走的是信任缓存的路径，结果一项都不改 —— 纯虚报。
  // 真正"服务器上的图已不在（404）"由执行的 verifyUploadImageMappings 兜底重传。
  const comparableLocalChars = await canonicalizeRecordsForDiff(localChars, url, true, cacheIndex);
  const charDiff = computeRecordDiff(
    isDownload ? comparableServerChars : comparableLocalChars,
    isDownload ? comparableLocalChars : comparableServerChars,
    (s, t) => s.name === t.name, charContentEqual, r => r.name);
  const worldDiff = computeRecordDiff(
    isDownload ? serverWorlds : localWorlds,
    isDownload ? localWorlds : serverWorlds,
    (s, t) => s.title === t.title, worldContentEqual, r => r.title);
  const relDiff = computeRecordDiff(
    isDownload ? serverRels : localRelsNamed,
    isDownload ? localRelsNamed : serverRels,
    (s, t) => s.from_name === t.from_name && s.to_name === t.to_name && s.relation_type === t.relation_type,
    relContentEqual, r => `${r.from_name}→${r.to_name}(${r.relation_type})`);

  // 文档差异
  const localDocMap = new Map(localDocs.map(d => [d.name, d]));
  const serverDocMap = new Map(serverDocs.map(d => [d.name, d]));
  const allDocNames = new Set([...localDocMap.keys(), ...serverDocMap.keys()]);
  const docsAdded = [], docsDeleted = [], docsModified = [];
  for (const name of allDocNames) {
    const ld = localDocMap.get(name);
    const sd = serverDocMap.get(name);
    if (isDownload) {
      if (!ld && sd) docsAdded.push(name);
      else if (ld && !sd) docsDeleted.push(name);
      else if (ld && sd && ld.size !== sd.size) docsModified.push(name);
    } else {
      if (ld && !sd) docsAdded.push(name);
      else if (!ld && sd) docsDeleted.push(name);
      else if (ld && sd && ld.size !== sd.size) docsModified.push(name);
    }
  }

  return {
    direction,
    local: {
      characters: localChars.length,
      worldBuildings: localWorlds.length,
      relations: localRels.length,
      documents: localDocs.length,
    },
    server: {
      characters: serverChars.length,
      worldBuildings: serverWorlds.length,
      relations: serverRels.length,
      documents: serverDocs.length,
    },
    chars: {
      added: charDiff.added.map(i => i.label),
      deleted: charDiff.deleted.map(i => i.label),
      modified: charDiff.modified.map(i => i.label),
    },
    worlds: {
      added: worldDiff.added.map(i => i.label),
      deleted: worldDiff.deleted.map(i => i.label),
      modified: worldDiff.modified.map(i => i.label),
    },
    relations: {
      added: relDiff.added.map(i => i.label),
      deleted: relDiff.deleted.map(i => i.label),
      modified: relDiff.modified.map(i => i.label),
    },
    docs: { added: docsAdded, deleted: docsDeleted, modified: docsModified },
  };
}
