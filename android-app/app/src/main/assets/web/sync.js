// ============================================================
// sync.js - 数据同步逻辑
// 增量同步：只更新变化的部分，不全量覆盖
// ============================================================

// 模块版本号：用于验证手机是否加载了最新代码
const SYNC_VERSION = '抗大抗大越抗越大';

// 版本升级时自动清空图片缓存，避免复用已失效的 serverUrl
// （服务器文件可能已被清理，旧缓存指向不存在的文件）
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
  // 有图片上传失败时抛错，避免后续同步步骤出现更难诊断的失败
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

// 角色内容比较（排除 id/时间戳/sort_order/images格式差异）
function charContentEqual(a, b) {
  const fields = ['alias', 'university', 'region', 'naming_rationale', 'height',
                   'gender', 'birthday', 'appearance', 'identity_period', 'birth_time',
                   'setting', 'family', 'birthplace', 'status'];
  for (const f of fields) {
    if ((a[f] || '') !== (b[f] || '')) return false;
  }
  // 图片只比较数量（data URL vs server URL 无法直接比较内容）
  const aImgs = Array.isArray(a.images) ? a.images : (a.image_url ? [a.image_url] : []);
  const bImgs = Array.isArray(b.images) ? b.images : (b.image_url ? [b.image_url] : []);
  if (aImgs.length !== bImgs.length) return false;
  return true;
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

  // 3. 计算增量差异
  const charDiff = computeRecordDiff(localChars, serverChars,
    (s, t) => s.name === t.name, charContentEqual, r => r.name);
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
  if (charsToUpload.some(c => (c.images && c.images.some(u => u && u.startsWith('data:'))) || (c.image_url && c.image_url.startsWith('data:')))) {
    await convertDataUrlImagesToServerUrl(charsToUpload, url, onProgress);
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
  const charDiff = computeRecordDiff(
    isDownload ? serverChars : localChars,
    isDownload ? localChars : serverChars,
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
