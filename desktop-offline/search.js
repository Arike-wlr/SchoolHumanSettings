// ============================================================
// search.js - 全局搜索组件（自包含，四页共用）
// 引入方式：<script src="search.js"></script>（放在 </body> 前）
// 功能：
//   - 自动在侧边栏注入"全局搜索"入口
//   - 快捷键 / 或 Ctrl+K 打开，Esc 关闭，↑↓ 选择，Enter 跳转
//   - 搜索角色 / 世界观 / 关系 / 文档（调用 /api/search，离线版由
//     api-shim.js 提供同名接口，IndexedDB 本地搜索）
//   - 点击结果跨页跳转并通过 URL 参数定位：
//       角色  → /?char=ID        （打开角色详情）
//       世界观 → /worldview?wb=ID （打开设定详情）
//       关系  → /relations?rel=ID （滚动并高亮该关系）
//       文档  → /documents?doc=名 （打开文档预览）
// 样式全部使用宿主页面 CSS 变量，自动适配各页主题色与深色模式
// ============================================================

(function () {
  if (window.__ocGlobalSearch) return;
  window.__ocGlobalSearch = true;

  // ---------- 样式 ----------
  var CSS = [
    '.gs-overlay{position:fixed;inset:0;background:rgba(20,12,5,.45);backdrop-filter:blur(3px);z-index:5000;',
    'display:none;align-items:flex-start;justify-content:center;padding:9vh 16px 16px;}',
    '.gs-overlay.active{display:flex;}',
    '.gs-panel{width:100%;max-width:640px;max-height:76vh;display:flex;flex-direction:column;',
    'background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);',
    'box-shadow:var(--shadow-lg);overflow:hidden;}',
    '.gs-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border);}',
    '.gs-head .gs-icon{font-size:1.05rem;opacity:.7;}',
    '.gs-head input{flex:1;border:none;outline:none;background:transparent;color:var(--text);',
    'font-size:1.02rem;font-family:var(--font-sans);}',
    '.gs-head input::placeholder{color:var(--text-light);opacity:.6;}',
    '.gs-esc{font-size:.68rem;color:var(--text-light);border:1px solid var(--border);border-radius:6px;',
    'padding:2px 7px;opacity:.75;}',
    '.gs-body{flex:1;overflow-y:auto;padding:8px 10px 12px;}',
    '.gs-empty{padding:36px 16px;text-align:center;color:var(--text-light);font-size:.9rem;}',
    '.gs-group-title{font-size:.72rem;font-weight:600;color:var(--text-light);letter-spacing:.06em;',
    'padding:12px 10px 5px;}',
    '.gs-item{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:var(--radius-sm);',
    'cursor:pointer;border:1px solid transparent;}',
    '.gs-item.active{background:var(--accent-pale);border-color:var(--accent-light);}',
    '.gs-ava{width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;',
    'border:1px solid var(--border);background:var(--accent-pale);}',
    '.gs-ava.gs-ava-ph{display:flex;align-items:center;justify-content:center;font-size:.95rem;',
    'color:var(--accent);font-weight:600;}',
    '.gs-ico{width:36px;height:36px;border-radius:var(--radius-sm);flex-shrink:0;display:flex;',
    'align-items:center;justify-content:center;font-size:1.05rem;background:var(--accent-pale);}',
    '.gs-main{flex:1;min-width:0;}',
    '.gs-title{font-size:.92rem;color:var(--text);font-weight:500;white-space:nowrap;',
    'overflow:hidden;text-overflow:ellipsis;}',
    '.gs-sub{font-size:.76rem;color:var(--text-light);margin-top:2px;white-space:nowrap;',
    'overflow:hidden;text-overflow:ellipsis;}',
    '.gs-sub mark,.gs-title mark{background:transparent;color:var(--accent);font-weight:700;padding:0;}',
    '.gs-badge{flex-shrink:0;font-size:.68rem;color:var(--accent);background:var(--accent-pale);',
    'border-radius:10px;padding:2px 8px;}',
    '.gs-foot{padding:8px 16px;border-top:1px solid var(--border);font-size:.7rem;color:var(--text-light);',
    'display:flex;gap:14px;opacity:.8;}'
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // ---------- DOM ----------
  var overlay = document.createElement('div');
  overlay.className = 'gs-overlay';
  overlay.id = 'gsOverlay';
  overlay.innerHTML =
    '<div class="gs-panel">' +
    '  <div class="gs-head">' +
    '    <span class="gs-icon">🔍</span>' +
    '    <input id="gsInput" type="text" placeholder="搜索角色、世界观、关系、文档…" autocomplete="off">' +
    '    <span class="gs-esc">Esc</span>' +
    '  </div>' +
    '  <div class="gs-body" id="gsBody"><div class="gs-empty">输入关键词，跨页搜索全部设定</div></div>' +
    '  <div class="gs-foot"><span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span><span>/ 唤起</span></div>' +
    '</div>';
  document.body.appendChild(overlay);

  var input = overlay.querySelector('#gsInput');
  var bodyEl = overlay.querySelector('#gsBody');
  var gsItems = [];      // 扁平结果列表 {url, el}
  var gsActive = -1;     // 当前选中索引
  var gsDebounce = null;
  var gsSeq = 0;         // 请求序号，防止乱序响应覆盖

  // ---------- 工具 ----------
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // 高亮匹配片段（先转义再包 mark）
  function hi(snippet, q) {
    var safe = esc(snippet);
    if (!q) return safe;
    var idx = safe.toLowerCase().indexOf(esc(q).toLowerCase());
    if (idx < 0) return safe;
    return safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + q.length) + '</mark>' + safe.slice(idx + q.length);
  }
  function pageUrl(serverPath, fileTarget) {
    return location.protocol === 'file:' ? fileTarget : serverPath;
  }

  // ---------- 打开 / 关闭 ----------
  function openSearch() {
    overlay.classList.add('active');
    setTimeout(function () { input.focus(); input.select(); }, 30);
  }
  function closeSearch() {
    overlay.classList.remove('active');
    input.value = '';
    bodyEl.innerHTML = '<div class="gs-empty">输入关键词，跨页搜索全部设定</div>';
    gsItems = []; gsActive = -1;
  }
  function toggleSearch() {
    overlay.classList.contains('active') ? closeSearch() : openSearch();
  }
  window.__gsToggle = toggleSearch;

  // ---------- 渲染 ----------
  function setActive(idx) {
    if (!gsItems.length) return;
    gsActive = (idx + gsItems.length) % gsItems.length;
    gsItems.forEach(function (it, i) { it.el.classList.toggle('active', i === gsActive); });
    var el = gsItems[gsActive].el;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function go(idx) {
    var it = gsItems[idx];
    if (it) location.href = it.url;
  }

  function render(data, q) {
    var groups = [
      { key: 'characters', label: '角色', icon: '📖', many: data.characters.length > 0 },
      { key: 'worldview', label: '世界观', icon: '🌍' },
      { key: 'relations', label: '关系', icon: '🔗' },
      { key: 'documents', label: '文档', icon: '📄' }
    ];
    var total = data.characters.length + data.worldview.length + data.relations.length + data.documents.length;
    if (!total) {
      bodyEl.innerHTML = '<div class="gs-empty">没有找到与「' + esc(q) + '」相关的内容</div>';
      gsItems = []; gsActive = -1;
      return;
    }
    var html = '';
    gsItems = [];

    // 角色
    if (data.characters.length) {
      html += '<div class="gs-group-title">角色 · ' + data.characters.length + '</div>';
      data.characters.forEach(function (c) {
        var url = pageUrl('/?char=' + c.id, 'index.html?char=' + c.id);
        var sub = [c.university, c.region].filter(Boolean).join(' · ');
        var subHtml = (sub ? esc(sub) + (c.snippet ? ' — ' : '') : '') + (c.snippet ? hi(c.snippet, q) : '');
        var ava = c.image_url
          ? '<img class="gs-ava" src="' + esc(c.image_url) + '" onerror="this.outerHTML=\'<div class=&quot;gs-ava gs-ava-ph&quot;>' + esc((c.name || '?')[0]) + '</div>\'">'
          : '<div class="gs-ava gs-ava-ph">' + esc((c.name || '?')[0]) + '</div>';
        html += '<div class="gs-item" data-url="' + esc(url) + '">' + ava +
          '<div class="gs-main"><div class="gs-title">' + hi(c.name, q) + '</div>' +
          (subHtml ? '<div class="gs-sub">' + subHtml + '</div>' : '') + '</div>' +
          (c.matched_field && c.matched_field !== 'name' ? '<span class="gs-badge">' + esc(c.matched_field) + '</span>' : '') +
          '</div>';
        gsItems.push(null); // 占位，稍后绑定
      });
    }
    // 世界观
    if (data.worldview.length) {
      html += '<div class="gs-group-title">世界观 · ' + data.worldview.length + '</div>';
      data.worldview.forEach(function (w) {
        var url = pageUrl('/worldview?wb=' + w.id, 'worldview.html?wb=' + w.id);
        html += '<div class="gs-item" data-url="' + esc(url) + '">' +
          '<div class="gs-ico">🌍</div>' +
          '<div class="gs-main"><div class="gs-title">' + hi(w.title, q) + '</div>' +
          (w.snippet ? '<div class="gs-sub">' + hi(w.snippet, q) + '</div>' : (w.category ? '<div class="gs-sub">' + esc(w.category) + '</div>' : '')) +
          '</div></div>';
        gsItems.push(null);
      });
    }
    // 关系
    if (data.relations.length) {
      html += '<div class="gs-group-title">关系 · ' + data.relations.length + '</div>';
      data.relations.forEach(function (r) {
        var url = pageUrl('/relations?rel=' + r.id, 'relations.html?rel=' + r.id);
        var title = esc(r.from_name || '?') + ' <span style="opacity:.6">⇄</span> ' + esc(r.to_name || '?');
        html += '<div class="gs-item" data-url="' + esc(url) + '">' +
          '<div class="gs-ico">🔗</div>' +
          '<div class="gs-main"><div class="gs-title">' + title +
          (r.relation_type ? ' <span style="color:var(--accent);font-size:.78rem;">' + esc(r.relation_type) + '</span>' : '') + '</div>' +
          (r.snippet ? '<div class="gs-sub">' + hi(r.snippet, q) + '</div>' : '') +
          '</div></div>';
        gsItems.push(null);
      });
    }
    // 文档（复用 documents 页已有的 ?open= 参数机制）
    if (data.documents.length) {
      html += '<div class="gs-group-title">文档 · ' + data.documents.length + '</div>';
      data.documents.forEach(function (d) {
        var url = pageUrl('/documents?open=' + encodeURIComponent(d.name), 'documents.html?open=' + encodeURIComponent(d.name));
        html += '<div class="gs-item" data-url="' + esc(url) + '">' +
          '<div class="gs-ico">📄</div>' +
          '<div class="gs-main"><div class="gs-title">' + hi(d.name, q) + '</div>' +
          (d.snippet ? '<div class="gs-sub">' + hi(d.snippet, q) + '</div>' : '<div class="gs-sub">' + esc(d.size_display || '') + '</div>') +
          '</div></div>';
        gsItems.push(null);
      });
    }

    bodyEl.innerHTML = html;
    // 绑定扁平列表
    var els = bodyEl.querySelectorAll('.gs-item');
    els.forEach(function (el, i) {
      gsItems[i] = { url: el.getAttribute('data-url'), el: el };
      el.addEventListener('click', function () { location.href = gsItems[i].url; });
      el.addEventListener('mousemove', function () { setActive(i); });
    });
    gsActive = -1;
    setActive(0);
  }

  // ---------- 搜索 ----------
  function doSearch(q) {
    var seq = ++gsSeq;
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (seq !== gsSeq) return; // 已有更新的请求
        render(data, q);
      })
      .catch(function () {
        if (seq !== gsSeq) return;
        bodyEl.innerHTML = '<div class="gs-empty">搜索失败，请重试</div>';
      });
  }
  input.addEventListener('input', function () {
    var q = input.value.trim();
    clearTimeout(gsDebounce);
    if (!q) {
      bodyEl.innerHTML = '<div class="gs-empty">输入关键词，跨页搜索全部设定</div>';
      gsItems = []; gsActive = -1;
      return;
    }
    gsDebounce = setTimeout(function () { doSearch(q); }, 220);
  });

  // ---------- 键盘 ----------
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(gsActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(gsActive - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(gsActive >= 0 ? gsActive : 0); }
  });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (e.key === 'Escape' && overlay.classList.contains('active')) {
      closeSearch();
      return;
    }
    if (typing) return;
    // / 或 Ctrl+K 唤起
    if (e.key === '/' || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
      e.preventDefault();
      openSearch();
    }
  });
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeSearch();
  });

  // ---------- 侧边栏入口注入 ----------
  function injectSidebar() {
    var nav = document.querySelector('.sidebar-nav');
    if (!nav || document.getElementById('globalSearchBtn')) return;
    var btn = document.createElement('a');
    btn.className = 'sidebar-item';
    btn.id = 'globalSearchBtn';
    btn.href = 'javascript:void(0)';
    btn.title = '全局搜索（快捷键 /）';
    btn.innerHTML = '<span class="sidebar-icon">🔍</span><span class="sidebar-text">全局搜索</span>';
    btn.addEventListener('click', openSearch);
    nav.insertBefore(btn, nav.firstChild);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSidebar);
  } else {
    injectSidebar();
  }

  // ---------- ?gs=关键词 自动打开（可分享的搜索链接） ----------
  document.addEventListener('DOMContentLoaded', function () {
    var gs = new URLSearchParams(location.search).get('gs');
    if (gs) {
      openSearch();
      input.value = gs;
      doSearch(gs);
    }
  });
})();
