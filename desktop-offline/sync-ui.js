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

    /* 可点击的变更标签 chip —— 点开后看具体哪里变了 */
    .sync-chip {
      display: inline-block; background: var(--card-bg, #fff);
      border: 1px solid var(--border, #e0d6c8); border-radius: 4px;
      padding: 2px 8px; margin: 2px 4px 2px 0; font-size: .76rem;
      cursor: pointer; color: var(--text, #3d2b1f); transition: background .15s;
    }
    .sync-chip:hover { background: #f0e8d8; }
    .sync-chip.active { background: var(--accent, #8b5e3c); color: #fff; border-color: var(--accent, #8b5e3c); }
    .sync-chip:focus { outline: 2px solid var(--accent-light, #c49a6c); outline-offset: 1px; }

    /* 变更详情面板：显示某条记录在源/目标两侧的具体字段差异 */
    .sync-detail-panel {
      margin-top: 10px; background: var(--card-bg, #fff);
      border: 1px solid var(--border, #e0d6c8); border-radius: 8px;
      padding: 10px; font-size: .8rem;
    }
    .sync-detail-panel-empty {
      font-size: .8rem; color: var(--text-light, #8a7a6a);
      text-align: center; padding: 12px 0;
    }
    .sync-detail-title {
      font-weight: 600; color: var(--text, #3d2b1f);
      margin-bottom: 8px; font-size: .85rem;
    }
    .sync-field-row {
      display: grid; grid-template-columns: 78px 1fr 12px 1fr;
      align-items: start; gap: 6px; padding: 4px 0;
      border-top: 1px dashed var(--border, #e0d6c8);
    }
    .sync-field-row:first-of-type { border-top: none; }
    .sync-field-name { color: var(--text-light, #8a7a6a); font-size: .76rem; }
    .sync-field-val {
      word-break: break-all; white-space: pre-wrap;
      color: var(--text, #3d2b1f); font-size: .8rem;
      max-height: 8em; overflow-y: auto;
    }
    .sync-field-val.empty { color: var(--text-light, #8a7a6a); font-style: italic; max-height: none; overflow: visible; }
    .sync-field-arrow { color: var(--text-light, #8a7a6a); text-align: center; }
    .sync-field-row.changed .sync-field-val { background: #fdf3e7; border-radius: 3px; padding: 2px 4px; }
    .sync-field-side { font-size: .7rem; color: var(--text-light, #8a7a6a); margin-bottom: 4px; font-weight: 600; }

    /* 单块执行按钮 */
    .sync-block-actions {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px;
    }
    .sync-btn-block {
      padding: 10px; border: 1.5px solid var(--accent, #8b5e3c);
      background: #fff; color: var(--accent, #8b5e3c);
      border-radius: 8px; font-size: .82rem; font-weight: 500; cursor: pointer;
    }
    .sync-btn-block:disabled { opacity: .4; cursor: not-allowed; }
    .sync-btn-block:active:not(:disabled) { transform: scale(.97); }
    .sync-btn-block.all { background: var(--accent, #8b5e3c); color: #fff; grid-column: span 2; }
    .sync-btn-block:disabled.all { opacity: .5; }
    .sync-block-row {
      background: var(--bg, #f5f0e8); border-radius: 10px;
      padding: 10px 12px; margin-bottom: 10px;
    }
    .sync-block-row-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; margin-bottom: 6px;
    }
    .sync-block-row-title {
      font-size: .82rem; color: var(--text, #3d2b1f); font-weight: 600;
    }
    .sync-block-row-count {
      font-size: .74rem; color: var(--text-light, #8a7a6a);
    }
    .sync-block-row-count.has-changes { color: var(--accent, #8b5e3c); font-weight: 600; }

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
  // 缓存当前 diff，chip 的点击处理函数从这里取详情。
  let _currentSyncDiff = null;

  // 各 block 的字段定义（用于详情面板按字段比对）。
  // 字段顺序即显示顺序。空数组表示只展示标签（如文档目前只比 size）。
  const SYNC_BLOCK_FIELDS = {
    chars: ['alias', 'university', 'region', 'naming_rationale', 'height',
            'gender', 'birthday', 'appearance', 'identity_period', 'birth_time',
            'setting', 'family', 'birthplace', 'status', 'image_url', 'images'],
    worlds: ['category', 'content', 'main_category'],
    relations: ['from_name', 'to_name', 'relation_type', 'description'],
    docs: ['size'],
  };
  const SYNC_BLOCK_LABEL = { chars: '角色', worlds: '世界设定', relations: '关系', docs: '文档' };

  function escSync(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 把任意值转成可显示字符串。data: URL 太长，截短一下；其他长字段保留全文，
  // 由 CSS 限高 + 滚动展示，避免看不到"哪里变了"。
  function displayVal(v) {
    if (v == null) return '';
    if (Array.isArray(v)) {
      if (v.length === 0) return '';
      // 图片数组：每行一张图，便于用户阅读。
      return v.map(x => {
        if (typeof x !== 'string') return String(x);
        if (/^data:/i.test(x)) return '[图片 data: ' + x.length + ' 字符]';
        return x;
      }).join('\n');
    }
    if (typeof v === 'string') {
      if (/^data:/i.test(v)) return '[图片 data: ' + v.length + ' 字符]';
      return v;
    }
    return String(v);
  }

  // 渲染某条记录的字段级差异。source/target 任一可为 null。
  function renderFieldDiff(source, target, fields) {
    const allKeys = fields.length ? fields : Array.from(new Set([
      ...Object.keys(source || {}),
      ...Object.keys(target || {}),
    ]));
    let rows = '';
    for (const k of allKeys) {
      const sv = source ? source[k] : undefined;
      const tv = target ? target[k] : undefined;
      const sStr = displayVal(sv);
      const tStr = displayVal(tv);
      const changed = (source && target) && (sStr !== tStr);
      rows += `
        <div class="sync-field-row${changed ? ' changed' : ''}">
          <span class="sync-field-name">${escSync(k)}</span>
          <span class="sync-field-val${source && (sv == null || sStr === '') ? ' empty' : ''}">${escSync(sStr)}</span>
          <span class="sync-field-arrow">→</span>
          <span class="sync-field-val${target && (tv == null || tStr === '') ? ' empty' : ''}">${escSync(tStr)}</span>
        </div>`;
    }
    if (!rows) return '<div class="sync-detail-panel-empty">无字段可显示</div>';
    const sides = `
      <div style="display:grid;grid-template-columns:78px 1fr 12px 1fr;gap:6px;margin-bottom:6px;">
        <span></span>
        <span class="sync-field-side">${source ? '源端' : '—'}</span>
        <span></span>
        <span class="sync-field-side">${target ? '目标' : '—'}</span>
      </div>`;
    return sides + rows;
  }

  // 选中某个 chip 时把详情面板内容填进去。
  // changeType: 'added' | 'deleted' | 'modified'，idx 是该数组中的下标。
  function showItemDetail(direction, blockKey, changeType, idx) {
    const panel = document.getElementById('syncDetailPanel');
    if (!panel || !_currentSyncDiff) return;
    const block = _currentSyncDiff[blockKey] || {};
    const detailArr = (block.details && block.details[changeType]) || [];
    const item = detailArr[idx];
    if (!item) {
      panel.innerHTML = '<div class="sync-detail-panel-empty">无详情</div>';
      return;
    }
    // 高亮当前 chip、取消其他高亮。
    document.querySelectorAll('.sync-chip.active').forEach(el => el.classList.remove('active'));
    const chipId = `chip-${blockKey}-${changeType}-${idx}`;
    const chip = document.getElementById(chipId);
    if (chip) chip.classList.add('active');

    const typeLabel = changeType === 'added' ? '新增' : (changeType === 'deleted' ? '删除' : '修改');
    const fields = SYNC_BLOCK_FIELDS[blockKey] || [];
    const fieldHtml = renderFieldDiff(item.source, item.target, fields);
    panel.innerHTML = `
      <div class="sync-detail-title">${SYNC_BLOCK_LABEL[blockKey] || blockKey} · ${typeLabel}：${escSync(item.label)}</div>
      ${fieldHtml}
    `;
  }
  window.showItemDetail = showItemDetail;

  // 渲染一个 block 的 chips（added/deleted/modified），每个 chip 可点击。
  function formatChips(blockKey, changes) {
    const added = changes.added || [];
    const deleted = changes.deleted || [];
    const modified = changes.modified || [];
    const total = added.length + deleted.length + modified.length;
    if (total === 0) return '<div class="sync-diff-empty">无变化</div>';
    let html = '';
    if (added.length) {
      html += `<div class="sync-diff-item add"><span class="sync-diff-badge">➕ 新增 ${added.length}</span><div class="sync-doc-list">`;
      added.forEach((label, i) => {
        html += `<span class="sync-chip" id="chip-${blockKey}-added-${i}" onclick="showItemDetail('${_currentSyncDiff.direction}','${blockKey}','added',${i})" tabindex="0">${escSync(label)}</span>`;
      });
      html += `</div></div>`;
    }
    if (deleted.length) {
      html += `<div class="sync-diff-item del"><span class="sync-diff-badge">❌ 删除 ${deleted.length}</span><div class="sync-doc-list">`;
      deleted.forEach((label, i) => {
        html += `<span class="sync-chip" id="chip-${blockKey}-deleted-${i}" onclick="showItemDetail('${_currentSyncDiff.direction}','${blockKey}','deleted',${i})" tabindex="0">${escSync(label)}</span>`;
      });
      html += `</div></div>`;
    }
    if (modified.length) {
      html += `<div class="sync-diff-item mod"><span class="sync-diff-badge">✏ 修改 ${modified.length}</span><div class="sync-doc-list">`;
      modified.forEach((label, i) => {
        html += `<span class="sync-chip" id="chip-${blockKey}-modified-${i}" onclick="showItemDetail('${_currentSyncDiff.direction}','${blockKey}','modified',${i})" tabindex="0">${escSync(label)}</span>`;
      });
      html += `</div></div>`;
    }
    return html;
  }

  // 渲染单个 block 的整行（标题 + 数量 + chips + 执行此块按钮）
  function formatBlockRow(blockKey, changes) {
    const added = (changes.added || []).length;
    const deleted = (changes.deleted || []).length;
    const modified = (changes.modified || []).length;
    const total = added + deleted + modified;
    return `
      <div class="sync-block-row">
        <div class="sync-block-row-head">
          <span class="sync-block-row-title">${SYNC_BLOCK_LABEL[blockKey]}变更</span>
          <span class="sync-block-row-count${total > 0 ? ' has-changes' : ''}">共 ${total} 项</span>
        </div>
        ${formatChips(blockKey, changes)}
        <div class="sync-block-actions">
          <button class="sync-btn-block" onclick="executeSyncConfirm('${blockKey}')"${total === 0 ? ' disabled' : ''}>仅同步${SYNC_BLOCK_LABEL[blockKey]}</button>
        </div>
      </div>`;
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
    _currentSyncDiff = diff;
    _currentSyncDiff.direction = direction;
    const isDownload = direction === 'download';
    const targetLabel = isDownload ? '本地' : '电脑';
    const title = isDownload ? '⬇ 从电脑下载' : '⬆ 上传到电脑';

    // 数量对比
    const dims = [
      ['角色', 'characters'],
      ['世界设定', 'worldBuildings'],
      ['关系', 'relations'],
      ['文档', 'documents'],
    ];
    const targetNums = isDownload ? diff.local : diff.server;
    const sourceNums = isDownload ? diff.server : diff.local;
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

    const charTotal = (diff.chars.added.length + diff.chars.deleted.length + diff.chars.modified.length);
    const worldTotal = (diff.worlds.added.length + diff.worlds.deleted.length + diff.worlds.modified.length);
    const relTotal = (diff.relations.added.length + diff.relations.deleted.length + diff.relations.modified.length);
    const docTotal = (diff.docs.added.length + diff.docs.deleted.length + diff.docs.modified.length);
    const allTotal = charTotal + worldTotal + relTotal + docTotal;

    const html = `
      <div class="sync-modal">
        <div class="sync-title">${title}</div>
        <div class="sync-confirm-warn">ℹ 增量同步：只更新以下变化的部分，不会覆盖未变更的数据。${allTotal === 0 ? '当前无变更，无需同步。' : `共 ${allTotal} 项变更，可点击下面每个标签查看具体哪里变了。`}</div>
        <div class="sync-diff-section">
          <div class="sync-diff-section-title">${targetLabel}数据数量（当前 → 变更后）</div>
          ${diffRows}
        </div>
        ${formatBlockRow('chars', diff.chars)}
        ${formatBlockRow('worlds', diff.worlds)}
        ${formatBlockRow('relations', diff.relations)}
        ${formatBlockRow('docs', diff.docs)}
        <div class="sync-detail-panel" id="syncDetailPanel">
          <div class="sync-detail-panel-empty">点击上方任意变更标签可查看具体字段差异</div>
        </div>
        <div class="sync-actions">
          <button class="sync-btn sync-btn-cancel" onclick="cancelSyncConfirm()">取消</button>
          <button class="sync-btn sync-btn-confirm" onclick="executeSyncConfirm('all')"${allTotal === 0 ? ' disabled style="opacity:.5"' : ''}>全部执行</button>
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
    _currentSyncDiff = null;
  }
  window.cancelSyncConfirm = cancelSyncConfirm;

  // blockKey: 'chars' | 'worlds' | 'relations' | 'docs' | 'all' | undefined（兼容旧调用）
  async function executeSyncConfirm(blockKey) {
    const direction = pendingSyncAction;
    let scope = null;
    if (blockKey && blockKey !== 'all') {
      scope = scopeFromKeys([blockKey]);
    }
    cancelSyncConfirm();
    if (direction === 'download') await doDownloadExecute(scope, blockKey);
    else if (direction === 'upload') await doUploadExecute(scope, blockKey);
  }
  window.executeSyncConfirm = executeSyncConfirm;

  // 实际执行下载；scope 为 null 表示全量（向后兼容）。
  async function doDownloadExecute(scope, blockKey) {
    const status = document.getElementById('syncStatus');
    const label = blockKey && blockKey !== 'all' ? `仅下载${SYNC_BLOCK_LABEL[blockKey]}` : '下载';
    status.textContent = `正在${label}...`;
    status.className = 'sync-status';
    try {
      const result = await downloadFromServer(msg => { status.textContent = msg; }, scope);
      const chg = result.charChanges + result.worldChanges + result.relChanges;
      const chgMsg = chg > 0 ? `，更新 ${chg} 项变更（角色${result.charChanges}/设定${result.worldChanges}/关系${result.relChanges}）` : '，数据已最新';
      const docSync = result.documentsSynced != null ? `，文档同步 ${result.documentsSynced} 个` : '';
      const pending = result.pending && (result.pending.chars + result.pending.worlds + result.pending.rels);
      const pendingMsg = pending > 0 ? `（仍有 ${pending} 项未选块变更未同步）` : '';
      status.textContent = `${label}完成：${result.characters} 角色、${result.worldBuildings} 设定、${result.relations} 关系、${result.documents} 文档${chgMsg}${docSync}${pendingMsg}`;
      status.className = 'sync-status success';
      loadLocalStats();
      // 刷新当前页面数据
      if (typeof loadData === 'function') loadData();
    } catch (e) {
      status.textContent = `${label}失败: ` + e.message;
      status.className = 'sync-status error';
    }
  }

  // 实际执行上传；scope 为 null 表示全量（向后兼容）。
  async function doUploadExecute(scope, blockKey) {
    const status = document.getElementById('syncStatus');
    const label = blockKey && blockKey !== 'all' ? `仅上传${SYNC_BLOCK_LABEL[blockKey]}` : '上传';
    status.textContent = `正在${label}...`;
    status.className = 'sync-status';
    try {
      const result = await uploadToServer(msg => { status.textContent = msg; }, scope);
      const chg = result.charChanges + result.worldChanges + result.relChanges;
      const chgMsg = chg > 0 ? `，更新 ${chg} 项变更（角色${result.charChanges}/设定${result.worldChanges}/关系${result.relChanges}）` : '，数据已最新';
      const docSync = result.documentsSynced != null ? `，文档同步 ${result.documentsSynced} 个` : '';
      const pending = result.pending && (result.pending.chars + result.pending.worlds + result.pending.rels);
      const pendingMsg = pending > 0 ? `（仍有 ${pending} 项未选块变更未同步）` : '';
      status.textContent = `${label}完成：${result.characters} 角色、${result.worldBuildings} 设定、${result.relations} 关系、${result.documents} 文档${chgMsg}${docSync}${pendingMsg}`;
      status.className = 'sync-status success';
    } catch (e) {
      status.textContent = `${label}失败: ` + e.message;
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
