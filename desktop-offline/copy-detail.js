/* ============================================================
 * copy-detail.js —— 详情弹窗「复制」按钮
 * 给带 data-copy 属性的弹层自动注入一个「📋 复制」按钮，
 * 点击后把该弹窗上的全部内容提取为纯文本写入剪贴板。
 * 覆盖：角色详情 / 世界观详情 / 关系（编辑/信息）/ 文档预览
 * 样式全部走宿主页面 CSS 变量，深浅色自动适配。
 * 服务器版与离线版共用同一文件。
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 样式 ----------
  var STYLE =
    '.oc-copy-btn{display:inline-flex;align-items:center;gap:5px;cursor:pointer;' +
    'font-family:var(--font-sans,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif);' +
    'font-size:.82rem;font-weight:500;line-height:1;padding:8px 14px;' +
    'border-radius:8px;border:1px solid var(--border,#ddd);background:var(--card-bg,#fff);' +
    'color:var(--text,#333);transition:all .18s ease;white-space:nowrap;-webkit-tap-highlight-color:transparent;}' +
    '.oc-copy-btn:hover{border-color:var(--accent,#8b5e3c);color:var(--accent,#8b5e3c);background:var(--accent-pale,#f0e4d4);}' +
    '.oc-copy-btn:active{transform:translateY(1px);}' +
    '.oc-copy-btn .oc-copy-ico{font-size:.95rem;line-height:1;}' +
    '.oc-copy-btn.oc-copied{border-color:#2e9e5b;color:#2e9e5b;background:transparent;}' +
    '.oc-copy-toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%) translateY(10px);' +
    'background:rgba(28,18,8,.92);color:#fff;font-size:.82rem;padding:9px 18px;border-radius:20px;' +
    'z-index:99999;opacity:0;pointer-events:none;transition:all .25s ease;' +
    'font-family:var(--font-sans,sans-serif);box-shadow:0 4px 18px rgba(0,0,0,.25);max-width:82vw;}' +
    '.oc-copy-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}' +
    '@media (prefers-reduced-motion: reduce){.oc-copy-toast{transition:none;}}';

  function injectStyle() {
    if (document.getElementById('oc-copy-style')) return;
    var s = document.createElement('style');
    s.id = 'oc-copy-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // ---------- 轻提示 ----------
  var toastTimer = null;
  function toast(msg, type) {
    if (typeof window.showToast === 'function') {
      try { window.showToast(msg, type); return; } catch (e) { /* 落到自带 toast */ }
    }
    var el = document.getElementById('oc-copy-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'oc-copy-toast';
      el.className = 'oc-copy-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  // ---------- 剪贴板 ----------
  // 同步 execCommand 优先：在用户手势同一 tick 内执行，桌面与 Android WebView 均最稳
  function syncCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    if (syncCopy(text)) return Promise.resolve();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { return navigator.clipboard.writeText(text); } catch (e) { /* 落到失败 */ }
    }
    return Promise.reject(new Error('copy unavailable'));
  }

  // ---------- 工具 ----------
  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function txtKeep(el) { return el ? (el.textContent || '').trim() : ''; }

  function fieldValue(field) {
    if (!field) return '';
    if (field.tagName === 'SELECT') {
      var opt = field.options[field.selectedIndex];
      return opt ? (opt.textContent || '').trim() : '';
    }
    return (field.value || '').trim();
  }

  // 按块级元素拆分文本（兼容 docx 渲染出的嵌套 HTML），纯文本则原样保留换行
  var BLOCK_SEL = 'p, div, h1, h2, h3, h4, h5, h6, li, tr, section, article';
  function blockText(el) {
    if (!el.querySelector || !el.querySelector(BLOCK_SEL)) {
      return (el.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\s+$/, '').replace(/^\s+/, '');
    }
    var parts = [];
    Array.prototype.forEach.call(el.childNodes, function (n) {
      if (n.nodeType === 3) {
        var t = (n.textContent || '').trim();
        if (t) parts.push(t);
      } else if (n.nodeType === 1) {
        var sub = blockText(n);
        if (sub) parts.push(sub);
      }
    });
    return parts.join('\n');
  }

  // ---------- 从弹窗 DOM 提取文本 ----------
  function extract(modal) {
    var out = [];
    var hasTitleLine = false;

    // 标题
    var titleEl = modal.querySelector('.detail-header h2, .modal-header h2, .modal-title, .viewer-header h2');
    if (titleEl) {
      var title = txt(titleEl);
      if (title) { out.push(title); hasTitleLine = true; }
    }

    // 1) 详情区块（角色 / 世界观）
    var sections = modal.querySelectorAll('.detail-section');
    if (sections.length) {
      Array.prototype.forEach.call(sections, function (sec) {
        var label = txt(sec.querySelector('.detail-label'));
        var val = txtKeep(sec.querySelector('.detail-value'));
        if (label) out.push(label + '：' + (val || '（未填写）'));
      });
      return joinOut(out, hasTitleLine);
    }

    // 2) 表单字段（关系 编辑弹窗）
    var form = modal.querySelector('form');
    if (form) {
      var rows = form.querySelectorAll('.form-group');
      Array.prototype.forEach.call(rows, function (g) {
        if (g.querySelector('.form-group')) return; // 跳过嵌套父级
        var lab = g.querySelector('.form-label');
        var fld = g.querySelector('select, textarea, input:not([type=hidden]):not([type=file])');
        if (!lab || !fld) return;
        var label = txt(lab).replace(/[*＊]/g, '').trim();
        var val = fieldValue(fld);
        if (label && val) out.push(label + '：' + val);
      });
      return joinOut(out, hasTitleLine);
    }

    // 3) 键值行（关系页 角色信息，Android infoRow 提供的 .oc-kv）
    var kvs = modal.querySelectorAll('.oc-kv');
    if (kvs.length) {
      Array.prototype.forEach.call(kvs, function (kv) {
        var kids = kv.children;
        if (kids.length >= 2) {
          var label = txt(kids[0]);
          var val = txtKeep(kids[1]);
          if (label && val) out.push(label + '：' + val);
        }
      });
      return joinOut(out, hasTitleLine);
    }

    // 4) 信息表格（关系页 角色信息）
    var trs = modal.querySelectorAll('table tr');
    if (trs.length) {
      Array.prototype.forEach.call(trs, function (tr) {
        var cells = tr.querySelectorAll('td, th');
        if (cells.length >= 2) {
          var label = txt(cells[0]);
          var val = txtKeep(cells[1]);
          if (label && val) out.push(label + '：' + val);
        }
      });
      return joinOut(out, hasTitleLine);
    }

    // 5) 文档正文（预览）：逐元素取 textContent，避免 CSS 缩进混入、保留 txt 原始换行
    var vbody = modal.querySelector('.viewer-body, .doc-viewer-body, [id="docViewerBody"]');
    if (vbody) {
      var parts = [];
      var kids = vbody.children;
      if (kids.length) {
        Array.prototype.forEach.call(kids, function (el) {
          var cls = el.className || '';
          if (/viewer-loading|doc-empty/.test(cls)) return;
          var t = blockText(el);
          if (!t) return;
          if (/doc-heading/.test(cls) && parts.length && parts[parts.length - 1] !== '') parts.push('');
          parts.push(t);
        });
      } else {
        var only = (vbody.textContent || '').trim();
        if (only) parts.push(only);
      }
      if (parts.length) out.push(parts.join('\n'));
      return joinOut(out, hasTitleLine);
    }

    return out.join('\n').trim();
  }

  function joinOut(out, hasTitleLine) {
    var text = out.join('\n').trim();
    return text;
  }

  // ---------- 注入按钮 ----------
  function injectInto(overlay) {
    if (!overlay || overlay.dataset.ocCopyReady === '1') return;
    var modal = overlay.querySelector('.detail-modal, .modal, .viewer-modal');
    if (!modal) return;
    var footer = modal.querySelector('.detail-footer, .modal-footer, .viewer-footer');
    if (!footer) return;

    overlay.dataset.ocCopyReady = '1';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'oc-copy-btn';
    btn.setAttribute('aria-label', '复制本页内容');
    btn.innerHTML = '<span class="oc-copy-ico">📋</span><span class="oc-copy-label">复制</span>';

    btn.addEventListener('click', function () {
      var text = extract(modal);
      if (!text) { toast('本页没有可复制的内容', 'error'); return; }
      copyText(text).then(function () {
        var ico = btn.querySelector('.oc-copy-ico');
        var lab = btn.querySelector('.oc-copy-label');
        btn.classList.add('oc-copied');
        if (ico) ico.textContent = '✓';
        if (lab) lab.textContent = '已复制';
        toast('已复制到剪贴板', 'success');
        setTimeout(function () {
          btn.classList.remove('oc-copied');
          if (ico) ico.textContent = '📋';
          if (lab) lab.textContent = '复制';
        }, 1600);
      }).catch(function () {
        toast('复制失败，请手动选择复制', 'error');
      });
    });

    // 放在页脚最前（页脚为 flex-end 布局，按钮会排在“关闭/编辑”左侧）
    footer.insertBefore(btn, footer.firstChild);
  }

  function injectAll() {
    injectStyle();
    var targets = document.querySelectorAll('[data-copy]');
    Array.prototype.forEach.call(targets, injectInto);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAll);
  } else {
    injectAll();
  }

  // 供其它脚本/测试调用
  window.OCCopy = { extract: extract, copy: copyText };
})();
