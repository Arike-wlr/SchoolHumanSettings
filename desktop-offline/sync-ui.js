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

    /* ====== 同步确认界面 ====== */
    .sync-confirm-warn {
      background: #fdf3e7; border: 1px solid #e8c79a; color: #9a6b2f;
      padding: 10px 12px; border-radius: 8px; font-size: .82rem;
      margin-bottom: 14px; line-height: 1.5;
    }
    .sync-diff-section {
      background: var(--bg, #f5f0e8); border-radius: 10px;
      padding: 12px; margin-bottom: 14px;
    }
    .sync-diff-section-title {
      font-size: .78rem; color: var(--text-light, #8a7a6a);
      margin-bottom: 8px; font-weight: 600;
    }
    .sync-diff-row {
      display: flex; align-items: center; gap: 8px;
      font-size: .88rem; padding: 5px 0;
    }
    .sync-diff-row .sync-diff-label { flex: 0 0 64px; color: var(--text, #3d322b); }
    .sync-diff-row .sync-diff-num { font-weight: 600; color: var(--text, #3d322b); min-width: 28px; text-align: center; }
    .sync-diff-row .sync-diff-arrow { color: var(--text-light, #8a7a6a); }
    .sync-diff-row .sync-diff-num.highlight { color: var(--accent, #8b5e3c); }
    .sync-diff-row.changed { background: rgba(196,154,108,.12); border-radius: 6px; padding: 5px 6px; }

    .sync-diff-item {
      display: flex; align-items: flex-start; gap: 8px;
      font-size: .82rem; padding: 6px 0; border-top: 1px dashed var(--border, #e0d6c8);
    }
    .sync-diff-item:first-of-type { border-top: none; }
    .sync-diff-badge {
      flex-shrink: 0; padding: 2px 8px; border-radius: 10px;
      font-size: .76rem; font-weight: 600; white-space: nowrap;
    }
    .sync-diff-item.add .sync-diff-badge { background: #e3f3e8; color: #2f7d4a; }
    .sync-diff-item.del .sync-diff-badge { background: #fce4e4; color: #c0392b; }
    .sync-diff-item.mod .sync-diff-badge { background: #fdf3e7; color: #9a6b2f; }
    .sync-doc-list { flex: 1; line-height: 1.6; word-break: break-all; }
    .sync-doc-name {
      display: inline-block; background: var(--card-bg, #fff);
      border: 1px solid var(--border, #e0d6c8); border-radius: 4px;
      padding: 1px 6px; margin: 2px 4px 2px 0; font-size: .76rem;
    }
    .sync-doc-more { color: var(--text-light, #8a7a6a); font-size: .76rem; margin-left: 4px; }
    .sync-diff-empty { font-size: .82rem; color: var(--text-light, #8a7a6a); text-align: center; padding: 8px 0; }

    .sync-btn-cancel { background: #fff; color: var(--text-light, #8a7a6a); border: 1.5px solid var(--border, #e0d6c8); }
    .sync-btn-confirm { background: var(--accent, #8b5e3c); color: #fff; }
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
    await showSyncConfirm('download');
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
    await showSyncConfirm('upload');
  }
  window.doUpload = doUpload;

  // ============= 同步确认界面 =============
  let pendingSyncAction = null; // 'download' | 'upload'

  function escSync(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function showSyncConfirm(direction) {
    const status = document.getElementById('syncStatus');
    status.textContent = '正在计算差异...';
    status.className = 'sync-status';

    let diff;
    try {
      diff = await getSyncDiff(direction);
    } catch (e) {
      status.textContent = '获取差异失败: ' + e.message;
      status.className = 'sync-status error';
      return;
    }

    pendingSyncAction = direction;
    const isDownload = direction === 'download';
    const targetLabel = isDownload ? '本地' : '电脑';
    const title = isDownload ? '⬇ 从电脑下载' : '⬆ 上传到电脑';

    // 数量对比：被覆盖端 "当前数量 → 将变更为的数量"
    const dims = [
      ['角色', 'characters'],
      ['世界设定', 'worldBuildings'],
      ['关系', 'relations'],
      ['文档', 'documents'],
    ];
    const targetNums = isDownload ? diff.local : diff.server;   // 被覆盖端当前数量
    const sourceNums = isDownload ? diff.server : diff.local;   // 将变成的数量
    let diffRows = '';
    for (const [label, key] of dims) {
      const from = targetNums[key];
      const to = sourceNums[key];
      const changed = from !== to;
      diffRows += `
        <div class="sync-diff-row${changed ? ' changed' : ''}">
          <span class="sync-diff-label">${label}</span>
          <span class="sync-diff-num">${from}</span>
          <span class="sync-diff-arrow">→</span>
          <span class="sync-diff-num${changed ? ' highlight' : ''}">${to}</span>
        </div>`;
    }

    // 文档变更明细
    const docsAdded = diff.docs.added;
    const docsDeleted = diff.docs.deleted;
    const docsModified = diff.docs.modified;
    const totalDocChanges = docsAdded.length + docsDeleted.length + docsModified.length;
    let docChangesHtml = '';
    if (totalDocChanges === 0) {
      docChangesHtml = '<div class="sync-diff-empty">文档无变化</div>';
    } else {
      const formatList = (arr, max) => {
        if (!arr.length) return '';
        const shown = arr.slice(0, max).map(n => `<span class="sync-doc-name">${escSync(n)}</span>`).join('');
        const more = arr.length > max ? `<span class="sync-doc-more">等共 ${arr.length} 个</span>` : '';
        return shown + more;
      };
      const MAX = 5;
      if (docsAdded.length) {
        docChangesHtml += `<div class="sync-diff-item add"><span class="sync-diff-badge">➕ 新增 ${docsAdded.length}</span><div class="sync-doc-list">${formatList(docsAdded, MAX)}</div></div>`;
      }
      if (docsDeleted.length) {
        docChangesHtml += `<div class="sync-diff-item del"><span class="sync-diff-badge">❌ 删除 ${docsDeleted.length}</span><div class="sync-doc-list">${formatList(docsDeleted, MAX)}</div></div>`;
      }
      if (docsModified.length) {
        docChangesHtml += `<div class="sync-diff-item mod"><span class="sync-diff-badge">✏ 修改 ${docsModified.length}</span><div class="sync-doc-list">${formatList(docsModified, MAX)}</div></div>`;
      }
    }

    const html = `
      <div class="sync-modal">
        <div class="sync-title">${title}</div>
        <div class="sync-confirm-warn">⚠ 此操作将覆盖${targetLabel}上的所有数据，不可撤销。请确认以下变更：</div>
        <div class="sync-diff-section">
          <div class="sync-diff-section-title">${targetLabel}数据变化（当前 → 变更后）</div>
          ${diffRows}
        </div>
        <div class="sync-diff-section">
          <div class="sync-diff-section-title">文档变更（共 ${totalDocChanges} 项）</div>
          ${docChangesHtml}
        </div>
        <div class="sync-actions">
          <button class="sync-btn sync-btn-cancel" onclick="cancelSyncConfirm()">取消</button>
          <button class="sync-btn sync-btn-confirm" onclick="executeSyncConfirm()">确认执行</button>
        </div>
      </div>
    `;

    let overlay = document.getElementById('syncConfirmOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sync-overlay';
      overlay.id = 'syncConfirmOverlay';
      overlay.addEventListener('click', function (e) {
        if (e.target === this) cancelSyncConfirm();
      });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = html;
    overlay.classList.add('active');

    status.textContent = '';
    status.className = 'sync-status';
  }

  function cancelSyncConfirm() {
    const overlay = document.getElementById('syncConfirmOverlay');
    if (overlay) overlay.classList.remove('active');
    pendingSyncAction = null;
  }
  window.cancelSyncConfirm = cancelSyncConfirm;

  async function executeSyncConfirm() {
    const direction = pendingSyncAction;
    cancelSyncConfirm();
    if (direction === 'download') await doDownloadExecute();
    else if (direction === 'upload') await doUploadExecute();
  }
  window.executeSyncConfirm = executeSyncConfirm;

  // 实际执行下载（已通过确认界面）
  async function doDownloadExecute() {
    const status = document.getElementById('syncStatus');
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

  // 实际执行上传（已通过确认界面）
  async function doUploadExecute() {
    const status = document.getElementById('syncStatus');
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

  // 初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSyncUI);
  } else {
    initSyncUI();
  }
})();
