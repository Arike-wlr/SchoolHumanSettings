// ============================================================
// sync-ui.js - 同步界面（注入到每个移动页面）
// 在页面顶部添加同步按钮和同步 Modal
// ============================================================

(function () {
  // 注入 CSS
  const style = document.createElement('style');
  style.textContent = `
    .sync-fab {
      position: fixed; right: 14px; bottom: 72px; z-index: 100;
      width: 48px; height: 48px; border-radius: 50%;
      background: var(--accent, #8b5e3c); color: #fff;
      border: none; font-size: 1.3rem; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,.2);
      display: flex; align-items: center; justify-content: center;
    }
    .sync-fab:active { transform: scale(.92); }
    .sync-overlay {
      display: none; position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,.4);
    }
    .sync-overlay.active { display: flex; align-items: flex-end; }
    .sync-modal {
      background: var(--card-bg, #fffef9); width: 100%;
      border-radius: 16px 16px 0 0; padding: 20px 16px 24px;
      max-height: 80vh; overflow-y: auto;
    }
    .sync-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 16px; text-align: center; color: var(--text, #3d2b1f); }
    .sync-server-row { display: flex; gap: 8px; margin-bottom: 16px; }
    .sync-server-input {
      flex: 1; padding: 10px 12px; border: 1.5px solid var(--border, #e0d6c8);
      border-radius: 8px; font-size: .9rem; background: #fff; color: var(--text, #3d2b1f);
    }
    .sync-server-input:focus { outline: none; border-color: var(--accent-light, #c49a6c); }
    .sync-btn-test { padding: 10px 14px; background: #fff; border: 1.5px solid var(--accent, #8b5e3c); border-radius: 8px; color: var(--accent, #8b5e3c); font-size: .85rem; cursor: pointer; white-space: nowrap; }
    .sync-btn-test:active { transform: scale(.96); }
    .sync-stats { background: var(--bg, #f5f0e8); border-radius: 10px; padding: 12px; margin-bottom: 16px; }
    .sync-stats-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: .85rem; }
    .sync-stats-row:last-child { margin-bottom: 0; }
    .sync-stats-label { color: var(--text-light, #8a7a6a); }
    .sync-stats-val { font-weight: 600; color: var(--text, #3d2b1f); }
    .sync-actions { display: flex; gap: 10px; }
    .sync-btn {
      flex: 1; padding: 14px; border: none; border-radius: 10px;
      font-size: .95rem; font-weight: 500; cursor: pointer;
    }
    .sync-btn:active { transform: scale(.97); }
    .sync-btn-download { background: var(--accent, #8b5e3c); color: #fff; }
    .sync-btn-upload { background: #fff; color: var(--accent, #8b5e3c); border: 1.5px solid var(--accent, #8b5e3c); }
    .sync-btn-close { background: transparent; color: var(--text-light, #8a7a6a); border: none; font-size: .9rem; padding: 8px; cursor: pointer; margin-top: 8px; width: 100%; }
    .sync-status { text-align: center; font-size: .85rem; color: var(--text-light, #8a7a6a); margin: 10px 0; min-height: 20px; }
    .sync-status.error { color: var(--danger, #c44b4b); }
    .sync-status.success { color: #4a8c5a; }
  `;
  document.head.appendChild(style);

  // 等待 DOM 就绪
  function initSyncUI() {
    // 创建 FAB 按钮
    const fab = document.createElement('button');
    fab.className = 'sync-fab';
    fab.innerHTML = '☁';
    fab.title = '数据同步';
    fab.onclick = openSyncModal;
    document.body.appendChild(fab);

    // 创建同步 Modal
    const overlay = document.createElement('div');
    overlay.className = 'sync-overlay';
    overlay.id = 'syncOverlay';
    overlay.innerHTML = `
      <div class="sync-modal">
        <div class="sync-title">☁ 数据同步</div>
        <div class="sync-server-row">
          <input type="text" class="sync-server-input" id="syncServerInput"
                 placeholder="电脑IP:端口 (如 192.168.1.175:8000)"
                 value="${getServerUrl() || ''}">
          <button class="sync-btn-test" onclick="testServer()">测试</button>
        </div>
        <div class="sync-stats" id="syncStats">
          <div class="sync-stats-row"><span class="sync-stats-label">本地角色</span><span class="sync-stats-val" id="localCharCount">-</span></div>
          <div class="sync-stats-row"><span class="sync-stats-label">本地设定</span><span class="sync-stats-val" id="localWorldCount">-</span></div>
          <div class="sync-stats-row"><span class="sync-stats-label">本地关系</span><span class="sync-stats-val" id="localRelCount">-</span></div>
          <div class="sync-stats-row"><span class="sync-stats-label">本地文档</span><span class="sync-stats-val" id="localDocCount">-</span></div>
          <div class="sync-stats-row"><span class="sync-stats-label">服务器</span><span class="sync-stats-val" id="serverStatus">未连接</span></div>
        </div>
        <div class="sync-status" id="syncStatus"></div>
        <div class="sync-actions">
          <button class="sync-btn sync-btn-download" onclick="doDownload()">⬇ 从电脑下载</button>
          <button class="sync-btn sync-btn-upload" onclick="doUpload()">⬆ 上传到电脑</button>
        </div>
        <button class="sync-btn-close" onclick="closeSyncModal()">关闭</button>
      </div>
    `;
    overlay.addEventListener('click', function (e) {
      if (e.target === this) closeSyncModal();
    });
    document.body.appendChild(overlay);
  }

  function openSyncModal() {
    document.getElementById('syncOverlay').classList.add('active');
    loadLocalStats();
  }
  function closeSyncModal() {
    document.getElementById('syncOverlay').classList.remove('active');
  }
  window.closeSyncModal = closeSyncModal;

  async function loadLocalStats() {
    try {
      const stats = await getLocalStats();
      document.getElementById('localCharCount').textContent = stats.characters;
      document.getElementById('localWorldCount').textContent = stats.worldBuildings;
      document.getElementById('localRelCount').textContent = stats.relations;
      document.getElementById('localDocCount').textContent = stats.documents;
    } catch (e) { /* ignore */ }
  }

  async function testServer() {
    const input = document.getElementById('syncServerInput').value.trim();
    const status = document.getElementById('syncStatus');
    const serverStatus = document.getElementById('serverStatus');
    if (!input) {
      status.textContent = '请输入服务器地址';
      status.className = 'sync-status error';
      return;
    }
    const url = setServerUrl(input);
    status.textContent = '正在连接...';
    status.className = 'sync-status';
    const ok = await pingServer(url);
    if (ok) {
      status.textContent = '连接成功';
      status.className = 'sync-status success';
      serverStatus.textContent = '已连接';
      serverStatus.style.color = '#4a8c5a';
    } else {
      status.textContent = '连接失败，请检查地址和网络';
      status.className = 'sync-status error';
      serverStatus.textContent = '未连接';
      serverStatus.style.color = '';
    }
  }
  window.testServer = testServer;

  async function doDownload() {
    const input = document.getElementById('syncServerInput').value.trim();
    const status = document.getElementById('syncStatus');
    if (!input) {
      status.textContent = '请先输入服务器地址';
      status.className = 'sync-status error';
      return;
    }
    setServerUrl(input);
    status.textContent = '正在下载...';
    status.className = 'sync-status';
    try {
      const result = await downloadFromServer(msg => { status.textContent = msg; });
      const docSync = result.documentsSynced != null ? `（同步 ${result.documentsSynced} 个）` : '';
      status.textContent = `下载完成：${result.characters} 角色、${result.worldBuildings} 设定、${result.relations} 关系、${result.documents} 文档${docSync}`;
      status.className = 'sync-status success';
      loadLocalStats();
      // 刷新当前页面数据
      if (typeof loadData === 'function') loadData();
    } catch (e) {
      status.textContent = '下载失败: ' + e.message;
      status.className = 'sync-status error';
    }
  }
  window.doDownload = doDownload;

  async function doUpload() {
    const input = document.getElementById('syncServerInput').value.trim();
    const status = document.getElementById('syncStatus');
    if (!input) {
      status.textContent = '请先输入服务器地址';
      status.className = 'sync-status error';
      return;
    }
    setServerUrl(input);
    if (!confirm('上传将覆盖电脑上的所有数据，确定继续？')) return;
    status.textContent = '正在上传...';
    status.className = 'sync-status';
    try {
      const result = await uploadToServer(msg => { status.textContent = msg; });
      const docSync = result.documentsSynced != null ? `（同步 ${result.documentsSynced} 个）` : '';
      status.textContent = `上传完成：${result.characters} 角色、${result.worldBuildings} 设定、${result.relations} 关系、${result.documents} 文档${docSync}`;
      status.className = 'sync-status success';
    } catch (e) {
      status.textContent = '上传失败: ' + e.message;
      status.className = 'sync-status error';
    }
  }
  window.doUpload = doUpload;

  // 初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSyncUI);
  } else {
    initSyncUI();
  }
})();
