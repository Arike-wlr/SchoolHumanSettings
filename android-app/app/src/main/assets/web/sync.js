// ============================================================
// sync.js - 数据同步逻辑
// 支持从服务器下载（覆盖本地）和上传到服务器（覆盖服务器）
// ============================================================

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
// 步骤：拉取服务器三类数据 → 清空本地 → 批量写入
async function downloadFromServer(onProgress) {
  const url = getServerUrl();
  if (!url) throw new Error('未配置服务器地址');

  onProgress && onProgress('正在拉取角色数据...');
  const charRes = await fetch(url + '/api/characters');
  if (!charRes.ok) throw new Error('获取角色失败');
  const characters = await charRes.json();

  onProgress && onProgress('正在拉取世界设定数据...');
  const worldRes = await fetch(url + '/api/world-buildings');
  if (!worldRes.ok) throw new Error('获取世界设定失败');
  const worldBuildings = await worldRes.json();

  onProgress && onProgress('正在拉取关系网数据...');
  const relRes = await fetch(url + '/api/relations');
  if (!relRes.ok) throw new Error('获取关系网失败');
  const relations = await relRes.json();

  onProgress && onProgress('正在写入本地数据库...');
  await charDB.clear();
  await charDB.bulkSet(characters);
  await worldDB.clear();
  await worldDB.bulkSet(worldBuildings);
  await relDB.clear();
  await relDB.bulkSet(relations);

  onProgress && onProgress('下载完成');
  return { characters: characters.length, worldBuildings: worldBuildings.length, relations: relations.length };
}

// ============= 上传到服务器（覆盖服务器） =============
// 步骤：读取本地全部数据 → 调用服务器批量替换接口
async function uploadToServer(onProgress) {
  const url = getServerUrl();
  if (!url) throw new Error('未配置服务器地址');

  onProgress && onProgress('正在读取本地数据...');
  const characters = await charDB.list();
  const worldBuildings = await worldDB.list();
  const relations = await relDB.list();

  onProgress && onProgress('正在上传到服务器...');
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

  onProgress && onProgress('上传完成');
  return { characters: characters.length, worldBuildings: worldBuildings.length, relations: relations.length, server: data };
}

// ============= 获取服务器统计信息（不下载） =============
async function getServerStats() {
  const url = getServerUrl();
  if (!url) return null;
  try {
    const [charRes, worldRes, relRes] = await Promise.all([
      fetch(url + '/api/characters'),
      fetch(url + '/api/world-buildings'),
      fetch(url + '/api/relations'),
    ]);
    const characters = await charRes.json();
    const worldBuildings = await worldRes.json();
    const relations = await relRes.json();
    return { characters: characters.length, worldBuildings: worldBuildings.length, relations: relations.length };
  } catch (e) {
    return null;
  }
}

// ============= 获取本地统计 =============
async function getLocalStats() {
  const [characters, worldBuildings, relations] = await Promise.all([
    charDB.list(),
    worldDB.list(),
    relDB.list(),
  ]);
  return { characters: characters.length, worldBuildings: worldBuildings.length, relations: relations.length };
}
