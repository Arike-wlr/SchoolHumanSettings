// ============================================================
// export-all.js - 全局导出组件（自包含，四页共用）
// 引入方式：<script src="export-all.js"></script>（放在 </body> 前）
// 功能：
//   - 在侧边栏注入"📦 导出全部"入口
//   - 点击后先弹确认框（确定 / 取消），确认后才真正导出
//   - 把 角色 + 世界观 + 关系 汇总导出到一个 JSON 文件
//   - 各分区的字段与内容与各页"选择导出"完全一致（复用同一套字段映射）
//   - 数据来自 /api/characters、/api/world-buildings、/api/relations
//     （离线版由 api-shim.js 提供同名接口）
// ============================================================

(function () {
  if (window.__ocExportAll) return;
  window.__ocExportAll = true;

  // ---------- 确认框样式（自包含，随组件注入一次） ----------
  function injectStyle() {
    if (document.getElementById('exportAllStyle')) return;
    var style = document.createElement('style');
    style.id = 'exportAllStyle';
    style.textContent =
      '.ea-overlay {' +
      '  display: none; position: fixed; inset: 0; z-index: 10000;' +
      '  background: rgba(0,0,0,.45);' +
      '  align-items: center; justify-content: center; padding: 20px;' +
      '}' +
      '.ea-overlay.active { display: flex; }' +
      '.ea-modal {' +
      '  background: var(--card-bg, #fffef9); color: var(--text, #3d322b);' +
      '  width: 100%; max-width: 380px;' +
      '  border: 1px solid var(--border, #e0d5c7);' +
      '  border-radius: var(--radius, 14px);' +
      '  box-shadow: var(--shadow-lg, 0 8px 40px rgba(60,40,20,.12));' +
      '  padding: 22px 20px 18px;' +
      '  animation: eaPop .18s ease-out;' +
      '}' +
      '@keyframes eaPop { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }' +
      '.ea-title {' +
      '  font-size: 1.05rem; font-weight: 600; margin-bottom: 10px; text-align: center;' +
      '  font-family: var(--font-serif, Georgia, serif);' +
      '}' +
      '.ea-msg { font-size: .88rem; color: var(--text-light, #8c7b6e); line-height: 1.65; text-align: center; }' +
      '.ea-msg .ea-strong { color: var(--accent, #8b5e3c); font-weight: 600; }' +
      '.ea-actions { display: flex; gap: 10px; margin-top: 20px; }' +
      '.ea-btn {' +
      '  flex: 1; padding: 11px; border-radius: var(--radius-sm, 8px);' +
      '  font-size: .92rem; font-weight: 500; cursor: pointer;' +
      '  font-family: inherit; transition: var(--transition, .25s);' +
      '}' +
      '.ea-btn:active { transform: scale(.97); }' +
      '.ea-btn-cancel { background: transparent; color: var(--text-light, #8c7b6e); border: 1.5px solid var(--border, #e0d5c7); }' +
      '.ea-btn-cancel:hover { background: var(--accent-pale, #f0e4d4); }' +
      '.ea-btn-confirm { background: var(--accent, #8b5e3c); color: #fff; border: 1.5px solid var(--accent, #8b5e3c); }' +
      '.ea-btn-confirm:hover { filter: brightness(1.08); }' +
      'html[data-theme="dark"] .ea-overlay { background: rgba(0,0,0,.62); }';
    document.head.appendChild(style);
  }

  // 字段映射（与各页单独导出保持一致）
  function mapChar(c) {
    return {
      姓名: c.name, 别名: c.alias || '', 代表高校: c.university || '', 地区: c.region || '',
      诞生地: c.birthplace || '', 存在状态: c.status || '存在', 性别: c.gender || '', 身高: c.height || '',
      生日: c.birthday || '', 外貌: c.appearance || '', 身份存在时间: c.identity_period || '',
      诞生时间: c.birth_time || '', 取名依据: c.naming_rationale || '', 设定: c.setting || ''
    };
  }
  function mapWorld(e) {
    return { 标题: e.title, 大类: e.main_category || '', 分类: e.category || '', 内容: e.content || '' };
  }
  function mapRel(r) {
    return { 角色A: r.from_name || '', 角色B: r.to_name || '', 关系类型: r.relation_type || '', 关系描述: r.description || '' };
  }
  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'success');
  }

  // ---------- 真正的导出动作 ----------
  function doExport() {
    Promise.all([
      fetch('/api/characters').then(function (r) { return r.json(); }),
      fetch('/api/world-buildings').then(function (r) { return r.json(); }),
      fetch('/api/relations').then(function (r) { return r.json(); })
    ]).then(function (arr) {
      var chars = arr[0] || [], worlds = arr[1] || [], rels = arr[2] || [];
      var out = {
        角色: chars.map(mapChar),
        世界观: worlds.map(mapWorld),
        关系: rels.map(mapRel)
      };
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '高校拟人OC_全量导出_' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('已导出全部数据（' + chars.length + ' 角色 / ' + worlds.length + ' 世界观 / ' + rels.length + ' 关系）');
    }).catch(function () {
      toast('导出失败，请重试', 'error');
    });
  }

  // ---------- 关闭确认框 ----------
  function closeConfirm() {
    var ov = document.getElementById('exportAllOverlay');
    if (ov) ov.classList.remove('active');
  }
  window.closeExportAllConfirm = closeConfirm;

  // ---------- 打开确认框（用户点确定后才导出） ----------
  function openConfirm() {
    injectStyle();
    var overlay = document.getElementById('exportAllOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'ea-overlay';
      overlay.id = 'exportAllOverlay';
      // 点遮罩空白处 = 取消
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeConfirm();
      });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML =
      '<div class="ea-modal" role="dialog" aria-modal="true" aria-labelledby="eaTitle">' +
      '  <div class="ea-title" id="eaTitle">导出全部数据</div>' +
      '  <div class="ea-msg">将把 <span class="ea-strong">角色</span>、<span class="ea-strong">世界观</span>、' +
      '    <span class="ea-strong">关系</span> 汇总导出为一个 JSON 文件。<br>是否继续？</div>' +
      '  <div class="ea-actions">' +
      '    <button type="button" class="ea-btn ea-btn-cancel" id="eaCancelBtn">取消</button>' +
      '    <button type="button" class="ea-btn ea-btn-confirm" id="eaConfirmBtn">确定导出</button>' +
      '  </div>' +
      '</div>';
    overlay.classList.add('active');

    document.getElementById('eaCancelBtn').addEventListener('click', closeConfirm);
    document.getElementById('eaConfirmBtn').addEventListener('click', function () {
      closeConfirm();
      doExport();
    });
  }
  window.openExportAllConfirm = openConfirm;

  // Esc 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeConfirm();
  });

  // 向后兼容：原全局函数名保持可用（现在走确认框）
  window.exportAllData = openConfirm;

  // ---------- 侧边栏入口注入 ----------
  function injectSidebar() {
    var nav = document.querySelector('.sidebar-nav');
    if (!nav || document.getElementById('globalExportBtn')) return;
    var btn = document.createElement('a');
    btn.className = 'sidebar-item';
    btn.id = 'globalExportBtn';
    btn.href = 'javascript:void(0)';
    btn.title = '导出全部数据（角色+世界观+关系）到一个文件';
    btn.innerHTML = '<span class="sidebar-icon">📦</span><span class="sidebar-text">导出全部</span>';
    btn.addEventListener('click', openConfirm);
    nav.appendChild(btn);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSidebar);
  } else {
    injectSidebar();
  }
})();
