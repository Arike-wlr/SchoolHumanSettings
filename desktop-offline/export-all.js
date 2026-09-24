// ============================================================
// export-all.js - 全局导出组件（自包含，四页共用）
// 引入方式：<script src="export-all.js"></script>（放在 </body> 前）
// 功能：
//   - 在侧边栏注入"📦 导出全部"入口
//   - 一键把 角色 + 世界观 + 关系 汇总导出到一个 JSON 文件
//   - 各分区的字段与内容与各页"选择导出"完全一致（复用同一套字段映射）
//   - 数据来自 /api/characters、/api/world-buildings、/api/relations
//     （离线版由 api-shim.js 提供同名接口）
// ============================================================

(function () {
  if (window.__ocExportAll) return;
  window.__ocExportAll = true;

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

  function exportAllData() {
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
  window.exportAllData = exportAllData;

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
    btn.addEventListener('click', exportAllData);
    nav.appendChild(btn);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSidebar);
  } else {
    injectSidebar();
  }
})();
