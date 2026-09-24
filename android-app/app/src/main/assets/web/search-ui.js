// ============================================================
// search-ui.js - Android 端全局搜索（SPA 内嵌）
// 入口：首页搜索框 onclick="openGlobalSearch()"
// 数据：/api/search（离线由 api-shim.js 从 IndexedDB 本地检索）
// 跳转（应用内）：
//   角色   → 切到角色页并打开详情
//   世界观 → 切到世界观页并打开详情
//   关系   → 切到关系页并滚动高亮该关系
//   文档   → 切到文档页并打开预览
// 样式见 app.css（.home-search / .gs-* / .rel-focus），随主题自动适配
// ============================================================

(function () {
  if (window.__ocMobileSearch) return;
  window.__ocMobileSearch = true;

  var overlay = null, input = null, bodyEl = null;
  var gsItems = [];      // [{ el, go }]
  var gsActive = -1;
  var gsDebounce = null;
  var gsSeq = 0;         // 请求序号，防止乱序响应覆盖

  // ---------- 工具 ----------
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function hi(snippet, q) {
    var safe = esc(snippet);
    if (!q) return safe;
    var idx = safe.toLowerCase().indexOf(esc(q).toLowerCase());
    if (idx < 0) return safe;
    return safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + q.length) + '</mark>' + safe.slice(idx + q.length);
  }
  function avaHtml(c) {
    var src = '';
    try { src = (typeof safeImageSrc === 'function') ? safeImageSrc(c.image_url) : (c.image_url || ''); } catch (e) { src = ''; }
    if (src) return '<img class="gs-ava" src="' + esc(src) + '" alt="">';
    return '<div class="gs-ava gs-ava-ph">' + esc((c.name || '?').charAt(0)) + '</div>';
  }

  // ---------- DOM ----------
  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'gs-overlay';
    overlay.id = 'gsOverlay';
    overlay.innerHTML =
      '<div class="gs-panel">' +
      '  <div class="gs-head">' +
      '    <span class="gs-icon">🔍</span>' +
      '    <input id="gsInput" type="text" placeholder="搜索角色、世界观、关系、文档…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
      '    <button class="gs-close" type="button" aria-label="关闭">✕</button>' +
      '  </div>' +
      '  <div class="gs-body" id="gsBody"><div class="gs-empty">输入关键词，搜索全部设定</div></div>' +
      '</div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('#gsInput');
    bodyEl = overlay.querySelector('#gsBody');

    overlay.querySelector('.gs-close').addEventListener('click', closeGlobalSearch);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeGlobalSearch(); });

    input.addEventListener('input', function () {
      var q = input.value.trim();
      clearTimeout(gsDebounce);
      if (!q) {
        bodyEl.innerHTML = '<div class="gs-empty">输入关键词，搜索全部设定</div>';
        gsItems = []; gsActive = -1;
        return;
      }
      gsDebounce = setTimeout(function () { doSearch(q); }, 220);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(gsActive + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(gsActive - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (gsItems.length) gsItems[(gsActive >= 0 ? gsActive : 0)].go(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('active')) closeGlobalSearch();
    });
  }

  function openGlobalSearch() {
    build();
    overlay.classList.add('active');
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  }
  function closeGlobalSearch() {
    if (!overlay) return;
    overlay.classList.remove('active');
    input.value = '';
    bodyEl.innerHTML = '<div class="gs-empty">输入关键词，搜索全部设定</div>';
    gsItems = []; gsActive = -1;
  }
  window.openGlobalSearch = openGlobalSearch;
  window.closeGlobalSearch = closeGlobalSearch;

  function setActive(idx) {
    if (!gsItems.length) return;
    gsActive = (idx + gsItems.length) % gsItems.length;
    gsItems.forEach(function (it, i) { it.el.classList.toggle('active', i === gsActive); });
    var el = gsItems[gsActive].el;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  // ---------- 搜索 ----------
  function doSearch(q) {
    var seq = ++gsSeq;
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (data) { if (seq !== gsSeq) return; render(data, q); })
      .catch(function () { if (seq !== gsSeq) return; bodyEl.innerHTML = '<div class="gs-empty">搜索失败，请重试</div>'; });
  }

  // ---------- 跳转 ----------
  function jump(kind, payload) {
    closeGlobalSearch();
    try {
      if (kind === 'char') { navigateTo('index'); VM.index.handleCardClick(payload.id); }
      else if (kind === 'wb') { navigateTo('worldview'); VM.worldview.handleCardClick(payload.id); }
      else if (kind === 'rel') { navigateTo('relations'); VM.relations.focusRelation(payload.id); }
      else if (kind === 'doc') { navigateTo('documents'); VM.documents.openViewer(encodeURIComponent(payload.name)); }
    } catch (e) { console.warn('[search] 跳转失败', e); }
  }

  // ---------- 渲染 ----------
  function render(data, q) {
    var total = data.characters.length + data.worldview.length + data.relations.length + data.documents.length;
    if (!total) {
      bodyEl.innerHTML = '<div class="gs-empty">没有找到与「' + esc(q) + '」相关的内容</div>';
      gsItems = []; gsActive = -1;
      return;
    }
    var html = '';
    var reg = []; // 与 .gs-item 顺序一致的跳转元数据

    // 角色
    if (data.characters.length) {
      html += '<div class="gs-group-title">角色 · ' + data.characters.length + '</div>';
      data.characters.forEach(function (c) {
        var sub = [c.university, c.region].filter(Boolean).join(' · ');
        var subHtml = (sub ? esc(sub) : '') + (c.snippet ? (sub ? ' — ' : '') + hi(c.snippet, q) : '');
        html += '<div class="gs-item">' + avaHtml(c) +
          '<div class="gs-main"><div class="gs-title">' + hi(c.name, q) + '</div>' +
          (subHtml ? '<div class="gs-sub">' + subHtml + '</div>' : '') + '</div>' +
          (c.matched_field && c.matched_field !== 'name' ? '<span class="gs-badge">' + esc(c.matched_field) + '</span>' : '') +
          '</div>';
        reg.push({ kind: 'char', id: c.id });
      });
    }
    // 世界观
    if (data.worldview.length) {
      html += '<div class="gs-group-title">世界观 · ' + data.worldview.length + '</div>';
      data.worldview.forEach(function (w) {
        html += '<div class="gs-item"><div class="gs-ico">🌍</div>' +
          '<div class="gs-main"><div class="gs-title">' + hi(w.title, q) + '</div>' +
          (w.snippet ? '<div class="gs-sub">' + hi(w.snippet, q) + '</div>' : (w.category ? '<div class="gs-sub">' + esc(w.category) + '</div>' : '')) +
          '</div></div>';
        reg.push({ kind: 'wb', id: w.id });
      });
    }
    // 关系
    if (data.relations.length) {
      html += '<div class="gs-group-title">关系 · ' + data.relations.length + '</div>';
      data.relations.forEach(function (r) {
        var title = esc(r.from_name || '?') + ' <span style="opacity:.6">⇄</span> ' + esc(r.to_name || '?') +
          (r.relation_type ? ' <span style="color:var(--accent);font-size:.76rem;">' + esc(r.relation_type) + '</span>' : '');
        html += '<div class="gs-item"><div class="gs-ico">🔗</div>' +
          '<div class="gs-main"><div class="gs-title">' + title + '</div>' +
          (r.snippet ? '<div class="gs-sub">' + hi(r.snippet, q) + '</div>' : '') + '</div></div>';
        reg.push({ kind: 'rel', id: r.id });
      });
    }
    // 文档
    if (data.documents.length) {
      html += '<div class="gs-group-title">文档 · ' + data.documents.length + '</div>';
      data.documents.forEach(function (d) {
        html += '<div class="gs-item"><div class="gs-ico">📄</div>' +
          '<div class="gs-main"><div class="gs-title">' + hi(d.name, q) + '</div>' +
          (d.snippet ? '<div class="gs-sub">' + hi(d.snippet, q) + '</div>' : '<div class="gs-sub">' + esc(d.size_display || '') + '</div>') +
          '</div></div>';
        reg.push({ kind: 'doc', name: d.name });
      });
    }

    bodyEl.innerHTML = html;
    var els = bodyEl.querySelectorAll('.gs-item');
    gsItems = [];
    Array.prototype.forEach.call(els, function (el, i) {
      var meta = reg[i];
      var item = { el: el, go: function () { jump(meta.kind, meta); } };
      el.addEventListener('click', item.go);
      gsItems.push(item);
    });
    gsActive = -1;
  }

  // ---------- ?gs=关键词 预填打开 ----------
  document.addEventListener('DOMContentLoaded', function () {
    try {
      var gs = new URLSearchParams(location.search).get('gs');
      if (gs) { openGlobalSearch(); input.value = gs; doSearch(gs); }
    } catch (e) {}
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
