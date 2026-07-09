// ============================================================
// sync.js - 数据同步逻辑
// 支持从服务器下载（覆盖本地）和上传到服务器（覆盖服务器）
// ============================================================

// 版本升级时自动清空图片缓存，避免复用已失效的 serverUrl
const SYNC_VERSION = '抗大抗大越抗越大';
(async () => {
  try {
    const stored = localStorage.getItem('imageCacheVersion');
    if (stored !== SYNC_VERSION) {
      await imageCacheDB.clear();
      localStorage.setItem('imageCacheVersion', SYNC_VERSION);
      console.log('[sync] 图片缓存已清空（版本升级）:', stored, '->', SYNC_VERSION);
    }
  } catch (e) { console.warn('[sync] 清空缓存失败:', e); }
})();

// ============= 图片处理辅助 =============
// data URL 转 Blob
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)[1] || 'image/png';
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

// 判断是否为服务器URL（非 data URL）
function isServerUrl(u) {
  return u && !u.startsWith('data:') && !u.startsWith('blob:');
}

// 把服务器URL图片转成 base64 data URL（下载时用，跳过已缓存的）
async function convertServerImagesToDataUrl(characters, serverUrl, onProgress) {
  const urlSet = new Set();
  for (const c of characters) {
    const imgs = Array.isArray(c.images) ? c.images : (c.image_url ? [c.image_url] : []);
    for (const u of imgs) {
      if (isServerUrl(u)) urlSet.add(u);
    }
  }
  if (urlSet.size === 0) return;
  const cache = new Map();
  let i = 0;
  let skipped = 0;
  for (const imgPath of urlSet) {
    i++;
    // 先查本地缓存
    const cached = await imageCacheDB.getByServerUrl(imgPath);
    if (cached && cached.dataUrl) {
      cache.set(imgPath, cached.dataUrl);
      skipped++;
      continue;
    }
    onProgress && onProgress(`正在下载图片 (${i-skipped}/${urlSet.size-skipped})...`);
    try {
      const fullUrl = imgPath.startsWith('http') ? imgPath : (serverUrl + imgPath);
      const res = await fetch(fullUrl);
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        cache.set(imgPath, dataUrl);
        // 存入缓存
        await imageCacheDB.set(dataUrl, imgPath);
      }
    } catch (e) {
      console.warn('图片下载失败:', imgPath, e);
    }
  }
  if (skipped > 0) onProgress && onProgress(`图片同步：${skipped} 张已缓存，${urlSet.size - skipped} 张需下载`);
  // 替换角色数据中的URL
  for (const c of characters) {
    if (Array.isArray(c.images)) {
      c.images = c.images.map(u => cache.get(u) || u);
    }
    if (c.image_url && cache.has(c.image_url)) {
      c.image_url = cache.get(c.image_url);
    }
  }
}

// 把 base64 data URL 图片上传到服务器换为 URL（上传时用，跳过已缓存的）
// 上传成功后回写本地 DB，避免下次重复上传
async function convertDataUrlImagesToServerUrl(characters, serverUrl, onProgress) {
  const dataUrlSet = new Set();
  for (const c of characters) {
    const imgs = Array.isArray(c.images) ? c.images : (c.image_url ? [c.image_url] : []);
    for (const u of imgs) {
      if (u && u.startsWith('data:')) dataUrlSet.add(u);
    }
  }
  if (dataUrlSet.size === 0) return;
  const cache = new Map();
  let i = 0;
  let skipped = 0;
  const failed = [];
  for (const dataUrl of dataUrlSet) {
    i++;
    // 先查本地缓存：该 dataUrl 是否已上传过
    const cached = await imageCacheDB.getByDataUrl(dataUrl);
    if (cached && cached.serverUrl) {
      cache.set(dataUrl, cached.serverUrl);
      skipped++;
      continue;
    }
    onProgress && onProgress(`正在上传图片 (${i-skipped}/${dataUrlSet.size-skipped})...`);
    try {
      const blob = dataUrlToBlob(dataUrl);
      const formData = new FormData();
      formData.append('file', blob, 'image.png');
      const res = await fetch(serverUrl + '/api/images/upload', { method: 'POST', body: formData });
      if (res.ok) {
        const r = await res.json();
        cache.set(dataUrl, r.image_url);
        // 存入缓存
        await imageCacheDB.set(dataUrl, r.image_url);
      } else {
        failed.push(dataUrl);
      }
    } catch (e) {
      console.warn('图片上传失败:', e);
      failed.push(dataUrl);
    }
  }
  if (skipped > 0) onProgress && onProgress(`图片同步：${skipped} 张已缓存，${dataUrlSet.size - skipped} 张需上传`);
  // 只在内存中替换 data URL → serverUrl（用于 POST 给服务器）
  // 不回写本地 DB：本地始终保留 data URL，确保离线时能显示图片
  // 去重靠 imageCacheDB 缓存，不会重复上传
  for (const c of characters) {
    if (Array.isArray(c.images)) {
      c.images = c.images.map(u => cache.has(u) ? cache.get(u) : u);
    }
    if (c.image_url && cache.has(c.image_url)) {
      c.image_url = cache.get(c.image_url);
    }
  }
  // 有图片上传失败时抛错，避免把超大 base64 塞进 replace-all 导致更难诊断的失败
  if (failed.length > 0) {
    throw new Error(`${failed.length} 张图片上传失败，请检查网络后重试`);
  }
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

// ============= 从服务器下载（覆盖本地） =============
// 步骤：拉取服务器三类数据全量替换 → 文档按 name+size 增量同步
async function downloadFromServer(onProgress) {
  const url = getServerUrl();
  if (!url) throw new Error('未配置服务器地址');

  onProgress && onProgress('正在拉取角色数据...');
  const charRes = await fetch(url + '/api/characters');
  if (!charRes.ok) throw new Error('获取角色失败');
  const characters = await charRes.json();

  // 下载图片转 base64（离线可显示）
  if (characters.some(c => (c.images && c.images.length) || c.image_url)) {
    await convertServerImagesToDataUrl(characters, url, onProgress);
  }

  onProgress && onProgress('正在拉取世界设定数据...');
  const worldRes = await fetch(url + '/api/world-buildings');
  if (!worldRes.ok) throw new Error('获取世界设定失败');
  const worldBuildings = await worldRes.json();

  onProgress && onProgress('正在拉取关系网数据...');
  const relRes = await fetch(url + '/api/relations');
  if (!relRes.ok) throw new Error('获取关系网失败');
  const relations = await relRes.json();

  onProgress && onProgress('正在拉取文档列表...');
  const docListRes = await fetch(url + '/api/files');
  if (!docListRes.ok) throw new Error('获取文档列表失败');
  const serverDocs = await docListRes.json();
  const localDocs = await docDB.list();
  const localMap = new Map(localDocs.map(d => [d.name, d]));

  onProgress && onProgress('正在写入本地数据库...');
  await charDB.clear();
  await charDB.bulkSet(characters);
  await worldDB.clear();
  await worldDB.bulkSet(worldBuildings);
  await relDB.clear();
  await relDB.bulkSet(relations);

  // 文档增量同步：本地不存在 或 size 不同 才下载；本地多余文档则删除
  const serverNames = new Set(serverDocs.map(d => d.name));
  let deletedCount = 0;
  for (const ld of localDocs) {
    if (!serverNames.has(ld.name)) {
      await docDB.delete(ld.name);
      deletedCount++;
    }
  }
  const toDownload = serverDocs.filter(sd => {
    const ld = localMap.get(sd.name);
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
    characters: characters.length,
    worldBuildings: worldBuildings.length,
    relations: relations.length,
    documents: serverDocs.length,
    documentsSynced: toDownload.length + deletedCount,
  };
}

// ============= 上传到服务器（覆盖服务器） =============
// 步骤：读取本地全部数据 → 调用服务器批量替换接口 → 上传文档
async function uploadToServer(onProgress) {
  const url = getServerUrl();
  if (!url) throw new Error('未配置服务器地址');

  onProgress && onProgress('正在读取本地数据...');
  const characters = await charDB.list();
  const worldBuildings = await worldDB.list();
  const relations = await relDB.list();
  const localDocs = await docDB.list();

  // 上传 base64 图片到服务器换为 URL
  if (characters.some(c => (c.images && c.images.some(u => u && u.startsWith('data:'))) || (c.image_url && c.image_url.startsWith('data:')))) {
    await convertDataUrlImagesToServerUrl(characters, url, onProgress);
  }

  onProgress && onProgress('正在上传数据...');
  const res = await fetch(url + '/api/sync/replace-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characters, worldBuildings, relations }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '上传失败');
  }
  const data = await res.json();

  // 上传文档：先删除服务器上多余的文件，再仅上传新增/变更的文档（name+size 比较）
  onProgress && onProgress('正在同步文档...');
  const serverDocRes = await fetch(url + '/api/files');
  const serverDocs = await serverDocRes.json();
  const serverMap = new Map(serverDocs.map(d => [d.name, d]));
  const localNames = new Set(localDocs.map(d => d.name));

  // 删除服务器上本地不存在的文件
  let deletedCount = 0;
  for (const sd of serverDocs) {
    if (!localNames.has(sd.name)) {
      await fetch(url + '/api/files/' + encodeURIComponent(sd.name), { method: 'DELETE' });
      deletedCount++;
    }
  }

  // 仅上传：服务器不存在 或 size 不同
  const toUpload = localDocs.filter(ld => {
    const sd = serverMap.get(ld.name);
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
    characters: characters.length,
    worldBuildings: worldBuildings.length,
    relations: relations.length,
    documents: localDocs.length,
    documentsSynced: toUpload.length + deletedCount,
    server: data,
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
