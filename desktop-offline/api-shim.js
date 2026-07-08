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
