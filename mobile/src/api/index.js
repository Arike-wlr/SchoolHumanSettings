// API 配置 - 修改此处指向你的后端地址
// 手机和电脑必须在同一WiFi下
// 模拟器运行时改为 10.0.2.2 (Android) 或 localhost (iOS)
const BASE_URL = 'http://192.168.1.175:8000'; // 真机测试

const api = {
  baseURL: BASE_URL,

  setBaseURL(url) {
    this.baseURL = url;
  },

  async request(path, options = {}) {
    const url = `${this.baseURL}${path}`;
    const config = {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };

    if (options.body && !(options.body instanceof FormData)) {
      config.body = JSON.stringify(options.body);
    }
    if (options.body instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    const res = await fetch(url, config);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: '请求失败' }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // ====== 角色 ======
  getCharacters() { return this.request('/api/characters'); },
  getCharacter(id) { return this.request(`/api/characters/${id}`); },
  createCharacter(data) { return this.request('/api/characters', { method: 'POST', body: data }); },
  updateCharacter(id, data) { return this.request(`/api/characters/${id}`, { method: 'PUT', body: data }); },
  deleteCharacter(id) { return this.request(`/api/characters/${id}`, { method: 'DELETE' }); },
  reorderCharacters(items) { return this.request('/api/characters/reorder', { method: 'POST', body: { items } }); },

  // ====== 世界观 ======
  getWorldBuildings(mainCategory = '') {
    const q = mainCategory ? `?main_category=${encodeURIComponent(mainCategory)}` : '';
    return this.request(`/api/world-buildings${q}`);
  },
  getWorldBuilding(id) { return this.request(`/api/world-buildings/${id}`); },
  createWorldBuilding(data) { return this.request('/api/world-buildings', { method: 'POST', body: data }); },
  updateWorldBuilding(id, data) { return this.request(`/api/world-buildings/${id}`, { method: 'PUT', body: data }); },
  deleteWorldBuilding(id) { return this.request(`/api/world-buildings/${id}`, { method: 'DELETE' }); },
  reorderWorldBuildings(items) { return this.request('/api/world-buildings/reorder', { method: 'POST', body: { items } }); },

  // ====== 关系 ======
  getRelations() { return this.request('/api/relations'); },
  createRelation(data) { return this.request('/api/relations', { method: 'POST', body: data }); },
  updateRelation(id, data) { return this.request(`/api/relations/${id}`, { method: 'PUT', body: data }); },
  deleteRelation(id) { return this.request(`/api/relations/${id}`, { method: 'DELETE' }); },
  reorderRelations(items) { return this.request('/api/relations/reorder', { method: 'POST', body: { items } }); },

  // ====== 文档 ======
  getFiles() { return this.request('/api/files'); },

  async uploadFiles(fileUris) {
    const formData = new FormData();
    for (const uri of fileUris) {
      const name = uri.split('/').pop();
      formData.append('files', { uri, name, type: 'application/octet-stream' });
    }
    return this.request('/api/files/upload', { method: 'POST', body: formData });
  },

  deleteFile(name) { return this.request(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' }); },
  viewFile(name) { return this.request(`/api/files/${encodeURIComponent(name)}/view`); },
  getFileUrl(name) { return `${this.baseURL}/api/files/${encodeURIComponent(name)}`; },
  getImageUrl(cacheKey, imgName) {
    return `${this.baseURL}/api/files/images/${encodeURIComponent(cacheKey)}/${encodeURIComponent(imgName)}`;
  },
};

export default api;
