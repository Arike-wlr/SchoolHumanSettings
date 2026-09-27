/* ============================================================
   全局工具函数
   ============================================================ */
 function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

/* ============================================================
   主题切换
   ============================================================ */
function applyTheme(theme) {
  var html = document.documentElement;
  if (theme === 'dark') html.setAttribute('data-theme', 'dark');
  else html.removeAttribute('data-theme');
  var icon = document.getElementById('themeIcon');
  var label = document.getElementById('themeLabel');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  if (label) label.textContent = theme === 'dark' ? '浅色模式' : '深色模式';
}
function toggleTheme() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var next = isDark ? 'light' : 'dark';
  try { localStorage.setItem('oc-theme', next); } catch(e) {}
  applyTheme(next);
  // 关系图谱是 canvas 绘制，切换后需重绘以更新网格与标签底色
  try { if (window.VM && VM.relations && VM.relations.graphRedraw) VM.relations.graphRedraw(); } catch(e) {}
}
// 读取当前主题下的 CSS 变量值（供 canvas 绘制使用）
function themeVar(name, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch(e) { return fallback; }
}
document.addEventListener('DOMContentLoaded', function () {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  // Esc 关闭「导出全部」确认框（桌面习惯；手机端主要是点取消/遮罩）
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeExportAllConfirm();
  });
});
 function safeImageSrc(src) {
   // img:// 引用是本地图片仓库的内容指纹，这里换算成 WebView 能直接加载的 https 地址
   // （由原生 WebViewAssetLoader 从磁盘流式提供，字节不经过 JS 堆）；
   // data:/blob:/https 原样放行，其余一律拒绝。所有渲染路径都从这里出去。
   return imageRefToSrcSafe(String(src || '').trim());
 }
 function imageRepairHint() { return '<div class="image-repair-hint">图片不可用，请重新同步</div>'; }
function showToast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' '+type : '');
  setTimeout(function() { t.classList.remove('show'); }, 2200);
}
function saveExportFile(jsonStr, fileName, msg) {
  if (typeof Android !== 'undefined' && Android.saveFile) {
    var blob = new Blob([jsonStr], {type: 'application/json'});
    var reader = new FileReader();
    reader.onloadend = function() { Android.saveFile(reader.result, fileName); };
    reader.readAsDataURL(blob);
    showToast('请选择保存位置', 'success');
  } else {
    var blob = new Blob([jsonStr], {type: 'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast(msg, 'success');
  }
}

// 导出字段映射（与各页单独导出保持一致；全局导出复用同一套，保证内容完全相同）
function mapCharExport(c) {
  return { 姓名: c.name, 别名: c.alias || '', 代表高校: c.university || '', 地区: c.region || '', 诞生地: c.birthplace || '', 存在状态: c.status || '存在', 性别: c.gender || '', 身高: c.height || '', 生日: c.birthday || '', 外貌: c.appearance || '', 身份存在时间: c.identity_period || '', 诞生时间: c.birth_time || '', 取名依据: c.naming_rationale || '', 设定: c.setting || '' };
}
function mapWorldExport(e) {
  return { 标题: e.title, 大类: e.main_category || '', 分类: e.category || '', 内容: e.content || '' };
}
function mapRelExport(r) {
  return { 角色A: r.from_name || '', 角色B: r.to_name || '', 关系类型: r.relation_type || '', 关系描述: r.description || '' };
}

// 全局导出：角色 + 世界观 + 关系 汇总到一个 JSON 文件（各分区内容与单独导出完全一致）
// 点击「导出全部」先弹确认框，用户点「确定导出」才真正下载（与桌面端一致）
function openExportAllConfirm() {
  var ov = document.getElementById('exportAllOverlay');
  if (ov) ov.classList.add('active');
}
function closeExportAllConfirm() {
  var ov = document.getElementById('exportAllOverlay');
  if (ov) ov.classList.remove('active');
}
function confirmExportAll() {
  closeExportAllConfirm();
  exportAllData();
}
window.openExportAllConfirm = openExportAllConfirm;
window.closeExportAllConfirm = closeExportAllConfirm;
window.confirmExportAll = confirmExportAll;

// 点遮罩空白处 = 取消（Esc 由全局 keydown 处理）
(function () {
  var ov = document.getElementById('exportAllOverlay');
  if (ov) ov.addEventListener('click', function (e) { if (e.target === ov) closeExportAllConfirm(); });
})();

// 兼容旧调用名：现在走确认框（index.html 的按钮 onclick 也已改为 openExportAllConfirm）
function exportAllData() {
  Promise.all([
    fetch('/api/characters').then(function(r) { return r.json(); }),
    fetch('/api/world-buildings').then(function(r) { return r.json(); }),
    fetch('/api/relations').then(function(r) { return r.json(); })
  ]).then(function(arr) {
    var chars = arr[0] || [], worlds = arr[1] || [], rels = arr[2] || [];
    var out = {
      角色: chars.map(mapCharExport),
      世界观: worlds.map(mapWorldExport),
      关系: rels.map(mapRelExport)
    };
    var fn = '高校拟人OC_全量导出_' + new Date().toISOString().slice(0, 10) + '.json';
    saveExportFile(JSON.stringify(out, null, 2), fn, '已导出全部数据（' + chars.length + ' 角色 / ' + worlds.length + ' 世界观 / ' + rels.length + ' 关系）');
  }).catch(function() { showToast('导出失败', 'error'); });
}
/* ============================================================
   视图间共享的内存数据（不再向 sessionStorage 序列化记录）
   序列化含原图的角色记录既慢又会产生重复副本；改为保留内存引用，
   由 window.appDataRevision（写入/同步后自增）判定是否仍然有效。
   ============================================================ */
var _sharedCharacters = { revision: -1, shape: null, data: null };
// shape：'list' = 列表投影（含全部文本字段）、'names' = 关系页 names 投影（只有 id/name/学校/家族）。
// list 记录可满足 names 的需求；names 记录**不得**被列表复用（否则列表缺文本字段）。
function _putSharedCharacters(data, revision, shape) { _sharedCharacters = { revision: revision, shape: shape || 'list', data: data }; }
function _getSharedCharacters(revision, shape) {
  if (!_sharedCharacters.data || _sharedCharacters.revision !== revision) return null;
  if (_sharedCharacters.shape === shape) return _sharedCharacters.data;
  if (shape === 'names' && _sharedCharacters.shape === 'list') return _sharedCharacters.data;
  return null;
}

/* ============================================================
   列表 DOM 复用：按稳定 key 复用节点，只重建内容变化的节点；
   数据不变时整个列表 DOM 保持不变，不做整表重建。
   ============================================================ */
function nodeFromHTML(html) {
  var holder = document.createElement('div');
  holder.innerHTML = html;
  return holder.firstElementChild;
}
function renderKeyedList(container, items) {
  var existing = {};
  var i;
  for (i = 0; i < container.children.length; i++) {
    var old = container.children[i];
    var oldKey = old.getAttribute && old.getAttribute('data-key');
    if (oldKey) existing[oldKey] = old;
  }
  var kept = [];
  var cursor = container.firstChild;
  for (i = 0; i < items.length; i++) {
    var item = items[i];
    var node = existing[item.key];
    if (!node) {
      node = nodeFromHTML(item.html());
    } else if (node.getAttribute('data-sig') !== item.sig) {
      var fresh = nodeFromHTML(item.html());
      container.replaceChild(fresh, node);
      // 旧节点已被移出容器：游标若正指向它，必须跟着挪到新节点上。
      // 否则下面的 insertBefore 会拿一个"已不在容器里"的节点当参照物，
      // 抛 NotFoundError，整次重渲染在第一张变化的卡片上就中断（后面的卡片全部保持旧样子）。
      if (cursor === node) cursor = fresh;
      node = fresh;
    }
    node.setAttribute('data-key', item.key);
    node.setAttribute('data-sig', item.sig);
    kept.push(node);
    if (node !== cursor) container.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  var keepKeys = {};
  for (i = 0; i < kept.length; i++) keepKeys[kept[i].getAttribute('data-key')] = true;
  var remaining = Array.prototype.slice.call(container.children);
  for (i = 0; i < remaining.length; i++) {
    if (!keepKeys[remaining[i].getAttribute('data-key')]) container.removeChild(remaining[i]);
  }
}
// 图片引用签名：不逐字比较可能上百 KB 的原图 data URL，只用长度+头尾判断是否变化。
function imageRefSig(ref) {
  var s = String(ref || '');
  return s.length + '\u0001' + s.slice(0, 24) + '\u0001' + s.slice(-16);
}

/* ============================================================
   卡片缩略图（派生缓存，见 D004）
   列表卡片只显示 images[0]，且显示盒仅 88×64 CSS px。直接内嵌原图 base64
   会把上百 MiB 文本塞进 DOM 并触发全分辨率解码。这里按“显示盒 × devicePixelRatio”
   等比降采样，保证 cover 裁剪后无需放大；原图 images 原样保留供详情/导出/同步。
   ============================================================ */
var CARD_BOX_W = 88, CARD_BOX_H = 64;

// 缩略图基准尺寸：统一按「大屏档」128×92 生成。
// 原因：缩略图是按 ref 持久化进 IndexedDB 的派生缓存，横竖屏切换时 ref 不变、
// 不会重新生成。若按当前视口选档，pad 上会拿到手机档 88×64 再被放大而变糊。
// 采用大屏档后，手机端只是在 88×64 显示盒里缩小显示（不会糊），一份缓存两端通用。
function cardBoxSize() { return { w: 128, h: 92 }; }

// 目标尺寸：两维都不小于显示物理像素（cover 后不放大）；源图更小则不放大。
function thumbTargetSize(w, h, dpr) {
  var box = cardBoxSize();
  var s = Math.max((box.w * dpr) / w, (box.h * dpr) / h);
  if (!isFinite(s) || s <= 0 || s > 1) s = 1;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

// 缩略图是否含透明通道（决定 PNG/JPEG）；取不到像素时保守用 PNG。
function thumbCanvasHasAlpha(ctx, w, h) {
  try {
    var d = ctx.getImageData(0, 0, w, h).data;
    for (var i = 3; i < d.length; i += 4) { if (d[i] < 255) return true; }
    return false;
  } catch (e) { return true; }
}

// 由 img:// 引用 / data URL / Blob 生成卡片缩略图 data URL；失败返回空串（调用方回退原图）。
async function makeCardThumb(source) {
  // 老 WebView 无 createImageBitmap：不生成缩略图，卡片继续用原图（行为不变，仅无收益）。
  if (typeof createImageBitmap !== 'function') return '';
  // 引用形态的图片去仓库取字节（原生直接读盘），data URL 就地解码。
  // 无论哪种都只解码一次，p05 的"每张图 createImageBitmap=1"约束依旧成立。
  var blob = (source instanceof Blob) ? source
    : (isImageRef(source) ? await imageRefToBlob(source) : dataUrlToBlob(source));
  var bmp = null;
  try {
    // 每张图只解码一次：直接由已解码位图让画布降采样，不再为取宽高做第二次全分辨率解码。
    bmp = await createImageBitmap(blob);
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    var t = thumbTargetSize(bmp.width, bmp.height, dpr);
    var canvas = document.createElement('canvas');
    canvas.width = t.w; canvas.height = t.h;
    var ctx = canvas.getContext('2d');
    if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, t.w, t.h);
    return thumbCanvasHasAlpha(ctx, t.w, t.h)
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.92);
  } catch (e) {
    return '';
  } finally {
    if (bmp && bmp.close) bmp.close();
  }
}

// 首图缩略图（并行数组，本阶段只填 index 0）。
function cardThumbOf(c) {
  if (!c || !Array.isArray(c.thumbs)) return '';
  return (typeof c.thumbs[0] === 'string' && c.thumbs[0]) ? c.thumbs[0] : '';
}

/* ============================================================
   导航
   ============================================================ */
var currentView = 'home';
var viewInited = { home: true, index: false, worldview: false, relations: false, documents: false, stats: false };

function navigateTo(name) {
  if (currentView === name) return;
  document.getElementById('view-' + currentView).style.display = 'none';
  document.getElementById('view-' + name).style.display = '';
  currentView = name;

  var nav = document.getElementById('bottomNav');
  if (name === 'home') {
    nav.style.display = 'none';
    document.body.classList.add('home-active');
  } else {
    nav.style.display = '';
    document.body.classList.remove('home-active');
    document.querySelectorAll('#bottomNav .nav-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.view === name);
    });
  }

  // home 是静态视图，没有对应的 VM 模块，这里必须容错：
  // 否则每次返回首页都会抛 "Cannot read properties of undefined (reading 'refresh')"。
  if (!viewInited[name]) {
    viewInited[name] = true;
    if (VM[name] && VM[name].init) VM[name].init();
  } else if (VM[name] && VM[name].refresh) {
    VM[name].refresh();
  }
}

/* ============================================================
   视图模块 VM
   ============================================================ */
var VM = {};

// 同步完成后只刷新当前视图；进入其它视图时仍沿用其既有 refresh 入口。
function refreshCurrentView() {
  if (VM[currentView] && VM[currentView].refresh) VM[currentView].refresh();
}
function markAppDataChanged() { window.appDataRevision = (window.appDataRevision || 0) + 1; }

// ======================== 角色设定 ========================
VM.index = (function() {
  var API = '/api/characters';
  var deleteTargetId = null;
  var allCharacters = [];
  var activeRegion = '全部';
  var currentImageUrls = [];
  var currentImageFiles = [];
  var currentFaceCrop = '';   // 当前表单的取脸参数（字符串 JSON；'' = 未取脸）
  var exportMode = false;
  var selectedIds = new Set();
  var detailCharId = null;
  var detailImages = [];
  var detailImageIdx = 0;
  var editReturnToDetail = null;   // 从卡片详情进入编辑时记下 id，保存/取消后回到该卡片
  // 从统计页榜单点进来的：记下来源视图名，关掉详情弹窗后切回该视图
  // （Android 是单页应用，不走 URL，只能靠内存里传这个标记，与 [[文档]] 链接的返回语义一致）。
  var detailReturnView = null;
  var loadGeneration = 0;
  var loadedRevision = -1;   // 已加载完成的数据版本（同版本返回不再查询/重绘）
  var loadingRevision = -1;  // 同版本请求在途标记，避免重复发起
  var regionTabsSig = null;

  function normalizeImages(c) {
    var imgs = c.images;
    if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs); } catch (e) { imgs = []; } }
    if (!Array.isArray(imgs)) imgs = [];
    if (imgs.length === 0 && c.image_url) imgs = [c.image_url];
    return imgs;
  }

  // 列表渲染用的图片引用视图（P06）：
  // - 完整记录（单条 GET / 默认全量接口）走 normalizeImages；
  // - 轻量投影没有 images，用 images_count + firstRef 复现等价视图：
  //   长度 = 真实图片数（徽标“共N张”用），[0] = 可用的首图引用
  //   （有缩略图时用缩略图，缺失时由投影读路径补原图引用）。
  // 详情/编辑/导出/同步仍一律使用完整记录与原图。
  function listImageRefs(c) {
    if (!c) return [];
    if (Array.isArray(c.images)) return normalizeImages(c);
    var n = (typeof c.images_count === 'number' && c.images_count > 0) ? c.images_count : 0;
    if (n === 0) return [];
    var out = new Array(n);
    // [0] 必须是"卡片可用的首图引用"：优先原始引用（缩略图缺失时由读路径补），
    // 其次缩略图 —— cardHTML 用 [0] 判断"是否有图"，用 thumbs[0] 决定实际 src。
    out[0] = c.firstRef || (Array.isArray(c.thumbs) ? (c.thumbs[0] || '') : '');
    for (var i = 1; i < n; i++) out[i] = '';
    return out;
  }

  function handleImageUpload(event) {
    var files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    var added = false;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.type.startsWith('image/')) { showToast('文件 '+file.name+' 不是图片，已跳过', 'error'); continue; }
      if (file.size > 20*1024*1024) { showToast('图片 '+file.name+' 超过20MB，已跳过', 'error'); continue; }
      currentImageFiles.push({ file: file, previewUrl: URL.createObjectURL(file) });
      added = true;
    }
    renderImagePreview();
    event.target.value = '';
    // 还从未取过脸时，直接为第一张图打开圈选浮层，减少一次点击。
    if (added && !(window.FaceCrop && FaceCrop.parse(currentFaceCrop))) {
      setTimeout(function () { cropImageFace(0); }, 80);
    }
  }

  function renderImagePreview() {
    var grid = document.getElementById('indexImagePreviewGrid');
    var items = [];
    for (var i = 0; i < currentImageUrls.length; i++) items.push({ url: currentImageUrls[i], index: i });
    for (var j = 0; j < currentImageFiles.length; j++) items.push({ url: currentImageFiles[j].previewUrl, index: currentImageUrls.length+j });
    if (items.length === 0) { grid.style.display = 'none'; grid.innerHTML = ''; return; }
    var fc = window.FaceCrop ? FaceCrop.parse(currentFaceCrop) : null;
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(72px, 1fr))';
    grid.style.gap = '8px';
    grid.innerHTML = items.map(function(it) {
      var isFace = fc && fc.img === it.index;
      var badge = isFace ? '<span style="position:absolute;left:2px;bottom:2px;background:var(--accent,#8b5e3c);color:#fff;font-size:.62rem;padding:1px 6px;border-radius:8px;pointer-events:none;">人脸</span>' : '';
      return '<div style="position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;border:2px solid '+(isFace?'var(--accent,#8b5e3c)':'var(--border)')+';cursor:pointer;" onclick="VM.index.cropImageFace('+it.index+')">' +
        (safeImageSrc(it.url) ? '<img src="'+safeImageSrc(it.url)+'" alt="预览" style="width:100%;height:100%;object-fit:cover;">' : imageRepairHint()) +
        badge +
        '<button type="button" onclick="event.stopPropagation();VM.index.removeImageItem('+it.index+')" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(0,0,0,0.6);color:#fff;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;">✕</button></div>';
    }).join('');
  }

  // 圈选人脸：对指定图片打开取脸浮层，确认后把参数记进 currentFaceCrop。
  function cropImageFace(index) {
    if (!window.FaceCrop) { showToast('取脸组件未加载', 'error'); return; }
    var uc = currentImageUrls.length;
    var src, ref;
    if (index < uc) { ref = currentImageUrls[index]; src = safeImageSrc(ref); }
    else { ref = currentImageFiles[index - uc].previewUrl; src = ref; }
    if (!src) { showToast('该图片不可用，无法取脸', 'error'); return; }
    var preset = FaceCrop.parse(currentFaceCrop);
    FaceCrop.open({
      src: src,
      crop: (preset && preset.img === index) ? preset : null,
      onConfirm: function(c) {
        c.img = index;
        currentFaceCrop = FaceCrop.stringify(c);
        renderImagePreview();
        showToast('已圈选人脸', 'success');
      }
    });
  }

  function removeImageItem(index) {
    var uc = currentImageUrls.length;
    if (index < uc) { currentImageUrls.splice(index, 1); }
    else { var fi = index - uc; URL.revokeObjectURL(currentImageFiles[fi].previewUrl); currentImageFiles.splice(fi, 1); }
    // 删除图片后修正 face_crop：被删的正是取脸图则清空；在其之前的图被删则下标前移。
    var fc = window.FaceCrop ? FaceCrop.parse(currentFaceCrop) : null;
    if (fc) {
      if (fc.img === index) currentFaceCrop = '';
      else if (fc.img > index) { fc.img--; currentFaceCrop = FaceCrop.stringify(fc); }
    }
    renderImagePreview();
  }

  function resetImageUpload() {
    currentImageFiles.forEach(function(item) { URL.revokeObjectURL(item.previewUrl); });
    currentImageUrls = []; currentImageFiles = []; currentFaceCrop = '';
    var grid = document.getElementById('indexImagePreviewGrid');
    grid.style.display = 'none'; grid.innerHTML = '';
    document.getElementById('indexImage').value = '';
  }

  var _detailView = null;

  // 结构只创建一次；切换图片只更新主图 src、计数与缩略图选中态。
  function renderDetailImage() {
    var imgs = detailImages;
    var wrap = document.getElementById('indexDetailImage');
    _detailView = null;
    if (!imgs || imgs.length===0) { wrap.style.display='none'; wrap.innerHTML=''; return; }
    var btn='width:32px;height:32px;border-radius:50%;border:1px solid var(--border);background:var(--bg);cursor:pointer;font-size:18px;line-height:1;color:var(--text);flex-shrink:0;';
    // 左右按钮常驻 DOM：切换时只改可见性，绝不能把目标索引写死进 onclick——
    // 结构不再重建，写死索引会让"翻到第二张后按钮依旧指向第 2 张"，表现就是翻不动。
    var prev='<button id="indexDetailPrev" onclick="VM.index.detailImageStep(-1)" style="'+btn+'" title="上一张">‹</button>';
    var next='<button id="indexDetailNext" onclick="VM.index.detailImageStep(1)" style="'+btn+'" title="下一张">›</button>';
    var multi=imgs.length>1;
    var cnt=multi?'<div id="indexDetailCounter" style="font-size:0.75rem;color:var(--text-light);margin-top:4px;"></div>':'';
    var thumbs=multi?imgs.map(function(u,i){var src=safeImageSrc(u);return src?'<img data-thumb="'+i+'" src="'+src+'" onclick="VM.index.detailImageGo('+i+')" style="width:42px;height:42px;object-fit:cover;border-radius:4px;cursor:pointer;border:2px solid transparent;">':'<div data-thumb="'+i+'" class="image-repair-hint" onclick="VM.index.detailImageGo('+i+')" style="cursor:pointer;">图片不可用</div>';}).join(''):'';
    wrap.innerHTML='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'+prev+'<div style="flex:1;text-align:center;min-width:0;">'+
      '<img id="indexDetailMain" style="max-width:100%;max-height:240px;border-radius:6px;object-fit:contain;display:none;">'+
      '<div id="indexDetailHint" class="image-repair-hint" style="display:none;">图片不可用，请重新同步</div>'+cnt+'</div>'+next+'</div>'+
      (thumbs?'<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">'+thumbs+'</div>':'');
    wrap.style.display='block';
    _detailView={imgs:imgs,main:document.getElementById('indexDetailMain'),hint:document.getElementById('indexDetailHint'),counter:document.getElementById('indexDetailCounter'),thumbs:multi?wrap.querySelectorAll('[data-thumb]'):[],prev:document.getElementById('indexDetailPrev'),next:document.getElementById('indexDetailNext')};
    updateDetailImage();
  }

  function updateDetailImage() {
    if (!_detailView) return;
    var idx = detailImageIdx;
    var src = safeImageSrc(_detailView.imgs[idx]);
    if (src) { _detailView.main.src = src; _detailView.main.style.display=''; _detailView.hint.style.display='none'; }
    else { _detailView.main.removeAttribute('src'); _detailView.main.style.display='none'; _detailView.hint.style.display=''; }
    if (_detailView.counter) _detailView.counter.textContent = (idx+1)+' / '+_detailView.imgs.length;
    // 用 visibility 而非 display：保持两侧占位宽度，切换时主图不会左右跳动。
    if (_detailView.prev) _detailView.prev.style.visibility = idx > 0 ? 'visible' : 'hidden';
    if (_detailView.next) _detailView.next.style.visibility = idx < _detailView.imgs.length - 1 ? 'visible' : 'hidden';
    for (var i = 0; i < _detailView.thumbs.length; i++) {
      var el = _detailView.thumbs[i];
      if (el.tagName === 'IMG') el.style.borderColor = (i === idx) ? 'var(--primary)' : 'transparent';
    }
  }

  function detailImageGo(idx) { if (idx>=0 && idx<detailImages.length) { detailImageIdx=idx; updateDetailImage(); } }

  // 相对翻页：按钮只传 ±1，边界在这里兜住（到头时按钮已隐藏，越界也直接返回）。
  function detailImageStep(delta) {
    var next = detailImageIdx + delta;
    if (next < 0 || next >= detailImages.length) return;
    detailImageIdx = next;
    updateDetailImage();
  }

  function groupByRegion(chars) {
    var g = {};
    for (var i=0;i<chars.length;i++) { var c=chars[i], r=c.region||'未分类'; if (!g[r]) g[r]=[]; g[r].push(c); }
    return g;
  }

  function buildRegionTabs() {
    var ct=document.getElementById('regionTabs');
    var g=groupByRegion(allCharacters);
    var ordered=Object.entries(g).filter(function(e){return e[1].length>0;}).sort(function(a,b){return b[1].length-a[1].length;}).map(function(e){return e[0];});
    var h='<button class="region-tab'+(activeRegion==='全部'?' active':'')+'" data-region="全部" onclick="VM.index.selectRegion(\'全部\')">全部<span class="tab-count">'+allCharacters.length+'</span></button>';
    for (var i=0;i<ordered.length;i++) { var r=ordered[i]; h+='<button class="region-tab'+(activeRegion===r?' active':'')+'" data-region="'+esc(r)+'" onclick="VM.index.selectRegion(\''+esc(r)+'\')">'+esc(r)+'<span class="tab-count">'+g[r].length+'</span></button>'; }
    var sig=activeRegion+'\u0001'+h;
    if (sig===regionTabsSig) return;   // 未变化：保留现有 tab DOM
    regionTabsSig=sig;
    ct.innerHTML=h;
  }

  function selectRegion(r) {
    activeRegion=r;
    document.querySelectorAll('.region-tab').forEach(function(t){t.classList.remove('active');});
    var tab=document.querySelector('.region-tab[data-region="'+r+'"]');
    if(tab)tab.classList.add('active');
    applyFilter();
  }

  var searchTimer = null;
  function onSearch() {
    var v=document.getElementById('indexSearchInput').value.trim();
    document.getElementById('indexSearchWrap').classList.toggle('has-value', v.length>0);
    if(searchTimer)clearTimeout(searchTimer);
    searchTimer=setTimeout(function(){searchTimer=null;applyFilter();},120);   // 输入防抖，避免每个字符都重建列表
  }
  function clearSearch() {
    document.getElementById('indexSearchInput').value='';
    document.getElementById('indexSearchWrap').classList.remove('has-value');
    if(searchTimer){clearTimeout(searchTimer);searchTimer=null;}
    applyFilter();
  }

  function applyFilter() {
    var sv=document.getElementById('indexSearchInput').value.trim().toLowerCase();
    var f=allCharacters;
    if (activeRegion!=='全部') f=f.filter(function(c){return c.region===activeRegion;});
    if (sv) f=f.filter(function(c){return (c.university||'').toLowerCase().indexOf(sv)!==-1||(c.name||'').toLowerCase().indexOf(sv)!==-1;});
    renderGrid(f);
    if(exportMode)updateExportButtons();
  }

  function cardHTML(c, gIdx) {
    var gc=c.gender==='男'?'male':c.gender==='女'?'female':'other';
    var st=c.status||'存在';
    var sb=st!=='存在'?'<span class="status-badge'+(st==='普通人'?' ordinary':'')+' perished">'+st+'</span>':'';
    var cx=st==='已消逝'?' perished':st==='普通人'?' ordinary':'';
    var t=c.setting||'';
    var tp=t.length>80?t.substring(0,80)+'…':t;
    var ni=listImageRefs(c);
    var ic=ni.length, cu=ni[0]||'';
    var cv=cardThumbOf(c)||cu;   // 优先派生缩略图；缺失时回退原图（行为不变）
    var ph='';
    if(cu&&cu.trim()!==''){
      var bd=ic>1?'<span style="position:absolute;right:2px;bottom:2px;background:rgba(0,0,0,0.65);color:#fff;font-size:10px;padding:1px 4px;border-radius:7px;line-height:1.3;">共'+ic+'张</span>':'';
      ph='<div style="flex-shrink:0;width:var(--card-thumb-w,88px);position:relative;align-self:stretch;margin-right:4px;margin-top:4px;min-height:var(--card-thumb-h,64px);"><div style="width:100%;height:100%;border-radius:4px;overflow:hidden;border:1px solid var(--border);background:#f8f9fa;">'+(safeImageSrc(cv)?'<img src="'+safeImageSrc(cv)+'" alt="'+esc(c.name)+'" loading="lazy" style="width:100%;height:100%;object-fit:cover;">':imageRepairHint())+'</div>'+bd+'</div>';
    }
    var tf='';
    if(c.alias) tf+='<div class="field-row"><span class="field-label">别名</span><span class="field-value">'+esc(c.alias)+'</span></div>';
    if(c.height) tf+='<div class="field-row"><span class="field-label">身高</span><span class="field-value">'+esc(c.height)+'</span></div>';
    if(c.birthday) tf+='<div class="field-row"><span class="field-label">生日</span><span class="field-value">'+esc(c.birthday)+'</span></div>';
    var ec=selectedIds.has(c.id)?'checked':'';
    var es=selectedIds.has(c.id)?' selected':'';
    return '<div class="card'+cx+es+'" data-drag-id="'+c.id+'" data-drag-idx="'+(gIdx!==undefined?gIdx:0)+'" onclick="VM.index.handleCardClick('+c.id+')">'+
      '<input type="checkbox" class="card-check" '+ec+' onclick="event.stopPropagation();VM.index.toggleCardSelect('+c.id+',this.checked)" title="选择导出">'+
      '<div style="display:flex;gap:10px;align-items:stretch;"><div style="flex:1;min-width:0;"><div class="card-header">'+
      '<button class="sort-btn" title="上移" onclick="event.stopPropagation();VM.index.moveCharUp('+c.id+');return false;">↑</button>'+
      '<button class="sort-btn" title="下移" onclick="event.stopPropagation();VM.index.moveCharDown('+c.id+');return false;">↓</button>'+
      '<span class="card-name">'+esc(c.name)+'</span>'+(c.university?'<span class="uni-tag">'+esc(c.university)+'</span>':'')+(c.gender?'<span class="gender-badge '+gc+'">'+esc(c.gender)+'</span>':'')+sb+
      '</div><div class="card-fields">'+tf+'</div></div>'+ph+'</div>'+
      (tp?'<div class="setting-preview">'+esc(tp)+'</div>':'')+
      '<div class="card-actions"><button class="btn-action" onclick="event.stopPropagation();VM.index.openEditModal('+c.id+')">编辑</button><button class="btn-action danger" onclick="event.stopPropagation();VM.index.openDeleteModal('+c.id+',\''+esc(c.name)+'\')">删除</button></div></div>';
  }

  // 卡片签名：覆盖 cardHTML 用到的全部字段，签名相同就不重建该节点。
  function cardSig(c, gIdx) {
    var imgs = listImageRefs(c);
    var imgSig = '';
    for (var i = 0; i < imgs.length; i++) imgSig += imageRefSig(imgs[i]) + '|';
    return [c.id, gIdx, c.name, c.alias, c.university, c.region, c.gender, c.status, c.height, c.birthday,
      c.setting, c.appearance, c.identity_period, c.birth_time, c.naming_rationale,
      imgSig, imageRefSig(cardThumbOf(c)), (exportMode && selectedIds.has(c.id)) ? 'sel' : ''].join('\u0001');
  }

  function renderGrid(chars) {
    var grid=document.getElementById('charGrid');
    var empty=document.getElementById('indexEmptyState');
    var nr=document.getElementById('indexNoResult');
    var cnt=document.getElementById('charCount');
    var sv=document.getElementById('indexSearchInput').value.trim();
    cnt.textContent=(sv||activeRegion!=='全部')?chars.length+'/'+allCharacters.length:allCharacters.length;
    if(allCharacters.length===0){renderKeyedList(grid,[]);empty.style.display='block';nr.style.display='none';return;}
    empty.style.display='none';
    if(chars.length===0&&(sv||activeRegion!=='全部')){renderKeyedList(grid,[]);nr.style.display='block';return;}
    nr.style.display='none';
    var im={};
    for(var i=0;i<allCharacters.length;i++){im[allCharacters[i].id]=i;}
    var items=[];
    function pushCard(c){
      items.push({key:'c:'+c.id,sig:cardSig(c,im[c.id]),html:(function(c){return function(){return cardHTML(c,im[c.id]);};})(c)});
    }
    if(activeRegion==='全部'&&!sv){
      var g=groupByRegion(chars);
      var ord=Object.entries(g).filter(function(e){return e[1].length>0;}).sort(function(a,b){return b[1].length-a[1].length;}).map(function(e){return e[0];});
      for(var k=0;k<ord.length;k++){
        var r=ord[k];
        items.push({key:'d:'+r,sig:'d'+r+g[r].length,html:(function(r,len){return function(){return '<div class="region-divider">'+esc(r)+' · '+len+'位</div>';};})(r,g[r].length)});
        g[r].forEach(pushCard);
      }
    } else {
      chars.forEach(pushCard);
    }
    renderKeyedList(grid,items);
  }

  // ---- 首图缩略图 backfill（D004）----
  // 异步、分批、不阻塞首屏：等首屏渲染完成后再逐张生成，批次间让出主线程。
  // 期间卡片回退原图（行为不变）；只处理“有首图、缺首图缩略图”的角色，且只生成首图。
  var thumbBackfill = { running: false, revision: -1 };

  function thumbBackfillCandidates() {
    var out = [];
    for (var i = 0; i < allCharacters.length; i++) {
      var c = allCharacters[i];
      if (cardThumbOf(c)) continue;
      // img:// 引用也要纳入：它的卡片 src 指向的是**原图**（引用很短，投影直接给卡片），
      // 不生成缩略图就会让每张卡片都加载整张原图，长列表下解码内存会炸 —— 正是本次要治的病。
      if (/^data:image\//i.test(listImageRefs(c)[0] || '') || isImageRef(listImageRefs(c)[0])) out.push(c);
    }
    return out;
  }

  function scheduleThumbBackfill() {
    if (thumbBackfill.running) return;
    var queue = thumbBackfillCandidates();
    if (queue.length === 0) return;
    thumbBackfill.running = true;
    thumbBackfill.revision = window.appDataRevision || 0;
    setTimeout(function () { runThumbBatch(queue, 0); }, 300);   // 首屏先画出来再开工
  }

  // 同步进行中避让：`_syncInFlight` 是 sync.js 的顶层 let（跨脚本全局词法绑定，不在 window 上），
  // 用防御式引用；取不到就当作“未同步中”，正确性由 updateThumb 的原子读-改-写兜底。
  function syncBusy() {
    try { return (typeof _syncInFlight !== 'undefined') && !!_syncInFlight; } catch (e) { return false; }
  }
  var THUMB_SYNC_WAIT_MS = 250, THUMB_SYNC_MAX_WAIT = 40;   // 最多让路约 10s，避免同步异常时无限等待

  function runThumbBatch(queue, index, waited) {
    // 数据版本变了（写入/同步）：放弃本轮，避免把陈旧记录写回。
    if ((window.appDataRevision || 0) !== thumbBackfill.revision) { thumbBackfill.running = false; return; }
    if (index >= queue.length) { thumbBackfill.running = false; return; }
    // 页面已不可见（切后台/退出）：立刻停下解码与写库。
    // 应用退到后台后 WebView 仍会跑定时器，这里不停就会在"用户以为已经退出"的时候
    // 继续 createImageBitmap 解码原图 + 写 IndexedDB，正好和退出备份撞在一起把内存顶爆。
    // 未生成的首图缩略图不丢，下次进入时 scheduleThumbBackfill 会重新排队。
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      thumbBackfill.running = false;
      return;
    }
    if (syncBusy() && (waited || 0) < THUMB_SYNC_MAX_WAIT) {
      setTimeout(function () { runThumbBatch(queue, index, (waited || 0) + 1); }, THUMB_SYNC_WAIT_MS);
      return;
    }
    var c = queue[index];
    var ref = listImageRefs(c)[0] || '';
    makeCardThumb(ref).then(function (thumb) {
      if (!thumb || (window.appDataRevision || 0) !== thumbBackfill.revision) return;
      // 原子读-改-写：只改 thumbs，且仅当记录当前首图未变；绝不整条覆盖（否则会回退并发同步/编辑）。
      return charDB.updateThumb(c.id, ref, thumb).then(function (result) {
        if (result === 'ok') { c.thumbs = [thumb]; applyFilter(); }
      });
    }).catch(function () { /* 单张失败不打断，卡片继续用原图 */ }).then(function () {
      setTimeout(function () { runThumbBatch(queue, index + 1, 0); }, 16);   // 批次间让出主线程
    });
  }

  function loadCharacters(force) {
    var revision = window.appDataRevision || 0;
    // 未变更返回：同版本数据已经加载过，直接沿用内存数据与现有 DOM。
    if (!force && loadedRevision === revision) {
      document.getElementById('indexLoadingState').style.display = 'none';
      return;
    }
    if (!force && loadingRevision === revision) return;   // 同版本请求已在途
    loadingRevision = revision;
    var generation = ++loadGeneration;
    // P06：列表只需要"列表字段 + 首图缩略图 + 图数"，显式请求轻量投影。
    fetch(API + '?projection=list').then(function(r){return r.json();}).then(function(data){
      if (generation !== loadGeneration || revision !== (window.appDataRevision || 0)) return;
      loadingRevision = -1;
      allCharacters = data;
      loadedRevision = revision;
      _putSharedCharacters(allCharacters, revision, 'list');
      document.getElementById('indexLoadingState').style.display = 'none';
      buildRegionTabs();
      applyFilter();
      scheduleThumbBackfill();   // 首屏已渲染，异步补首图缩略图
    }).catch(function(){
      if (generation !== loadGeneration || revision !== (window.appDataRevision || 0)) return;
      loadingRevision = -1;
      document.getElementById('indexLoadingState').style.display='none';
      if(loadedRevision !== revision)showToast('加载失败，请确认后端已启动','error');
    });
  }

  function openCreateModal() {
    editReturnToDetail = null;
    document.getElementById('indexModalTitle').textContent='添加新角色';
    document.getElementById('indexSubmitBtn').textContent='确认添加';
    document.getElementById('indexEditId').value='';
    document.getElementById('indexCharForm').reset();
    resetImageUpload();
    document.getElementById('indexModalOverlay').classList.add('active');
  }

  function openEditModal(id) {
    fetch(API+'/'+id).then(function(r){return r.json();}).then(function(c){
      document.getElementById('indexModalTitle').textContent='编辑角色';
      document.getElementById('indexSubmitBtn').textContent='保存修改';
      document.getElementById('indexEditId').value=c.id;
      document.getElementById('indexName').value=c.name;
      document.getElementById('indexAlias').value=c.alias||'';
      document.getElementById('indexUniversity').value=c.university||'';
      document.getElementById('indexRegion').value=c.region||'';
      document.getElementById('indexNamingRationale').value=c.naming_rationale||'';
      document.getElementById('indexHeight').value=c.height||'';
      document.getElementById('indexGender').value=c.gender||'';
      document.getElementById('indexBirthday').value=c.birthday||'';
      document.getElementById('indexAppearance').value=c.appearance||'';
      document.getElementById('indexIdentityPeriod').value=c.identity_period||'';
      document.getElementById('indexBirthTime').value=c.birth_time||'';
      document.getElementById('indexBirthplace').value=c.birthplace||'';
      document.getElementById('indexStatus').value=c.status||'存在';
      document.getElementById('indexSetting').value=c.setting||'';
      resetImageUpload();
      currentImageUrls=normalizeImages(c);
      currentFaceCrop=c.face_crop||'';
      renderImagePreview();
      document.getElementById('indexModalOverlay').classList.add('active');
    }).catch(function(){showToast('获取数据失败','error');});
  }

  var _autoSaveInProgress = false;
  function doSubmitFinal(editId, data) {
    // currentImageUrls 已含新图上传后的完整顺序？—— 否：新图 URL 在 data.newUrls，
    // 这里把它拼到 currentImageUrls 之后，与 renderImagePreview 的下标口径一致。
    var allImages=currentImageUrls.concat(data.newUrls||[]);
    if(allImages.length>0){data.images=allImages;data.image_url=allImages[0];}
    else{data.images=[];data.image_url='';}
    // 取脸参数：下标基于 allImages；取脸图已被删除或越界则清空。
    var fc = window.FaceCrop ? FaceCrop.parse(currentFaceCrop) : null;
    if (fc && fc.img < allImages.length) data.face_crop = FaceCrop.stringify(fc);
    else data.face_crop = '';
    delete data.newUrls;
    // 首图变了才清派生缩略图：api-shim 的 PUT 会合并旧记录，不清会留下陈旧缩略图；
    // 首图没变则保留，避免只改文字字段时卡片短暂回退原图。
    if(editId){
      var prev=null;
      for(var pi=0;pi<allCharacters.length;pi++){if(String(allCharacters[pi].id)===String(editId)){prev=allCharacters[pi];break;}}
      // 首图是否变化用 O(1) 签名比较：投影记录带 firstRefSig，完整记录回退到现算（P06）。
      if(prev){
        var prevSig=prev.firstRefSig||imageRefSig(normalizeImages(prev)[0]||'');
        if(prevSig!==imageRefSig(allImages[0]||''))data.thumbs=[];
      }
    }
    var url=editId?API+'/'+editId:API;
    var method=editId?'PUT':'POST';
    fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){
      if(!r.ok)throw new Error();
      _autoSaveInProgress = true;
      closeModal();resetImageUpload();markAppDataChanged();loadCharacters();
      showToast(editId?'已更新':'已创建','success');
      // 从卡片详情进入的编辑：保存后回到卡片详情，而不是退到列表
      if (editReturnToDetail) {
        var backId = editReturnToDetail;
        editReturnToDetail = null;
        openDetailModal(backId);
      }
      setTimeout(function(){ _autoSaveInProgress = false; }, 800);
    }).catch(function(){showToast('操作失败','error');});
  }

  function submitForm(e) {
    e.preventDefault();
    var form=document.getElementById('indexCharForm');
    if(!form.checkValidity()){form.reportValidity();return;}
    var editId=document.getElementById('indexEditId').value;
    var data={
      name:document.getElementById('indexName').value.trim(),
      alias:document.getElementById('indexAlias').value.trim(),
      university:document.getElementById('indexUniversity').value.trim(),
      region:document.getElementById('indexRegion').value.trim(),
      naming_rationale:document.getElementById('indexNamingRationale').value.trim(),
      height:document.getElementById('indexHeight').value.trim(),
      gender:document.getElementById('indexGender').value,
      birthday:document.getElementById('indexBirthday').value.trim(),
      appearance:document.getElementById('indexAppearance').value.trim(),
      identity_period:document.getElementById('indexIdentityPeriod').value.trim(),
      birth_time:document.getElementById('indexBirthTime').value.trim(),
      birthplace:document.getElementById('indexBirthplace').value.trim(),
      status:document.getElementById('indexStatus').value,
      setting:document.getElementById('indexSetting').value.trim(),
    };
    if(currentImageFiles.length===0){doSubmitFinal(editId,data);return;}
    // nu 按下标填充而非 push：上传完成顺序不定，push 会让 newUrls 顺序与
    // currentImageFiles 不一致，取脸参数里的下标就会错位到别的图。
    var nu=new Array(currentImageFiles.length),pending=currentImageFiles.length,hasErr=false;
    currentImageFiles.forEach(function(item,idx){
      var fd=new FormData();fd.append('file',item.file);
      fetch('/api/images/upload',{method:'POST',body:fd}).then(function(r){if(r.ok)return r.json();throw new Error();}).then(function(r){nu[idx]=r.image_url;}).catch(function(){hasErr=true;}).finally(function(){
        pending--;
        if(pending===0){
          if(hasErr){showToast('图片上传失败，请重试','error');return;}
          data.newUrls=nu;
          doSubmitFinal(editId,data);
        }
      });
    });
  }

  function openDeleteModal(id,name) {
    deleteTargetId=id;
    document.getElementById('indexDeleteName').textContent=name;
    document.getElementById('indexDeleteOverlay').classList.add('active');
  }
  function closeDeleteModal(){document.getElementById('indexDeleteOverlay').classList.remove('active');deleteTargetId=null;}
  function confirmDelete(){
    if(!deleteTargetId)return;
    fetch(API+'/'+deleteTargetId,{method:'DELETE'}).then(function(){
      closeDeleteModal();markAppDataChanged();loadCharacters();showToast('已删除','success');
    }).catch(function(){showToast('删除失败','error');});
  }
  function closeModal(){
    // 默认行为：直接关闭不保存
    document.getElementById('indexModalOverlay').classList.remove('active');
  }

  function closeModalAutoSave(){
    // ✕ 按钮和点击遮罩时调用：表单有效则自动保存
    if (_autoSaveInProgress) {
      _autoSaveInProgress = false;
      document.getElementById('indexModalOverlay').classList.remove('active');
      return;
    }
    var form=document.getElementById('indexCharForm');
    if (form.checkValidity()) {
      submitForm({preventDefault:function(){}});
      setTimeout(function(){
        document.getElementById('indexModalOverlay').classList.remove('active');
      }, 500);
      return;
    }
    document.getElementById('indexModalOverlay').classList.remove('active');
  }

  function cancelEdit() {
    _autoSaveInProgress = false;
    // 从卡片详情进入的编辑，取消后回到该卡片（与保存行为一致）
    var backId = editReturnToDetail;
    editReturnToDetail = null;
    document.getElementById('indexModalOverlay').classList.remove('active');
    if (backId) openDetailModal(backId);
  }
  window.cancelEditIndex = cancelEdit;
  window.closeModalAutoSaveIndex = closeModalAutoSave;

  function openDetailModal(id, returnView){
    detailReturnView = returnView || null;   // 传 'stats' 表示「从统计页跳来」，关掉详情要回去
    fetch(API+'/'+id).then(function(r){return r.json();}).then(function(c){
      detailCharId=c.id;
      document.getElementById('indexDetailName').textContent=c.name;
      detailImages=normalizeImages(c);detailImageIdx=0;renderDetailImage();
      var body='';
      if(c.university)body+=detailSection('代表高校',c.university);
      if(c.alias)body+=detailSection('别名',c.alias);
      if(c.region)body+=detailSection('地区',c.region);
      if(c.birthplace)body+=detailSection('诞生地',c.birthplace);
      var st=c.status||'存在';
      if(st!=='存在')body+=detailSection('存在状态',st);
      body+='<div class="detail-info-row">';
      if(c.height)body+=detailSection('身高',c.height);
      if(c.gender)body+=detailSection('性别',c.gender);
      if(c.birthday)body+=detailSection('生日',c.birthday);
      body+='</div>';
      if(c.appearance)body+=detailSection('外貌',c.appearance);
      if(c.identity_period)body+=detailSection('身份存在时间',c.identity_period);
      if(c.birth_time)body+=detailSection('诞生时间',c.birth_time);
      if(c.naming_rationale)body+=detailSection('取名依据',c.naming_rationale);
      if(c.setting)body+=detailSection('设定',c.setting);
      document.getElementById('indexDetailBody').innerHTML=body;
      document.getElementById('indexDetailOverlay').classList.add('active');
    }).catch(function(){showToast('获取详情失败','error');});
  }

  function detailSection(label,value){return '<div class="detail-section"><div class="detail-label">'+label+'</div><div class="detail-value">'+esc(value)+'</div></div>';}
  function closeDetailModal(){
    document.getElementById('indexDetailOverlay').classList.remove('active');
    detailCharId=null;
    // 从统计页点进来的：关掉详情 = 这次跳转结束，切回统计页（像 [[文档]] 链接那样关掉就跳回去）
    var rv=detailReturnView;detailReturnView=null;
    if(rv)navigateTo(rv);
  }
  // 注意：切去编辑框不算「关闭详情」，先清掉返回意图，别把用户弹回统计页
  function detailEdit(){if(detailCharId){var id=detailCharId;editReturnToDetail=id;detailReturnView=null;closeDetailModal();openEditModal(id);}}

  // 导出
  function updateExportButtons(){
    var btn=document.getElementById('indexConfirmExportBtn');
    if(!btn)return;
    btn.disabled=selectedIds.size===0;
    btn.textContent=selectedIds.size>0?'确认导出 ('+selectedIds.size+')':'确认导出';
  }
  function enterExportMode(){exportMode=true;selectedIds.clear();document.body.classList.add('export-mode');applyFilter();}
  function cancelExport(){exportMode=false;selectedIds.clear();document.body.classList.remove('export-mode');applyFilter();}
  function handleCardClick(id){
    if(exportMode){
      var cb=document.querySelector('#charGrid .card[data-drag-id="'+id+'"] .card-check');
      if(cb){cb.checked=!cb.checked;toggleCardSelect(id,cb.checked);}
      return;
    }
    openDetailModal(id);
  }
  function toggleCardSelect(id,checked){
    if(checked)selectedIds.add(id);else selectedIds.delete(id);
    var card=document.querySelector('#charGrid .card[data-drag-id="'+id+'"]');
    if(card)card.classList.toggle('selected',checked);
    updateExportButtons();
  }
  // 只把勾选态刷到已有 DOM 上，不整表重建：卡片含 base64 缩略图，全选时重建会明显卡顿。
  function syncSelectionToDom(){
    document.querySelectorAll('#charGrid .card[data-drag-id]').forEach(function(card){
      var on=selectedIds.has(parseInt(card.dataset.dragId,10));
      card.classList.toggle('selected',on);
      var cb=card.querySelector('.card-check');if(cb)cb.checked=on;
    });
    updateExportButtons();
  }
  function toggleSelectAll(){
    var cards=document.querySelectorAll('#charGrid .card[data-drag-id]');
    if(cards.length===0)return;
    var vi=[];cards.forEach(function(c){vi.push(parseInt(c.dataset.dragId,10));});
    var as=vi.every(function(id){return selectedIds.has(id);});
    if(as){vi.forEach(function(id){selectedIds.delete(id);});}
    else{vi.forEach(function(id){selectedIds.add(id);});}
    syncSelectionToDom();
  }
  function confirmExport(){
    if(selectedIds.size===0)return;
    var sel=allCharacters.filter(function(c){return selectedIds.has(c.id);});
    var ed=sel.map(mapCharExport);
    var js=JSON.stringify(ed,null,2);
    var fn='高校拟人OC_'+sel.length+'位角色_'+new Date().toISOString().slice(0,10)+'.json';
    saveExportFile(js,fn,'已导出 '+sel.length+' 位角色');
    cancelExport();
  }

  // 触控拖拽
  var td=false,tdEl=null,tdGhost=null,tdIdx=-1;
  var tdSY=0,tdSX=0,tdCY=0,tdTimer=null,tdList=null;

  function tdCreateGhost(){
    if(!tdEl)return;
    var r=tdEl.getBoundingClientRect();
    tdGhost=tdEl.cloneNode(true);
    tdGhost.style.cssText='position:fixed;z-index:9999;width:'+r.width+'px;left:'+r.left+'px;top:'+(tdCY-r.height/2)+'px;opacity:0.94;transform:scale(1.03);box-shadow:0 8px 28px rgba(0,0,0,.2);pointer-events:none;transition:none;border-radius:12px;background:#fffef9;';
    var h=tdGhost.querySelector('.drag-handle');if(h)h.remove();
    document.body.appendChild(tdGhost);
    tdEl.classList.add('dragging');
  }

  function tdFindTarget(y){
    var bi=tdIdx,bd=Infinity;
    tdList.querySelectorAll('[data-drag-id]:not(.dragging)').forEach(function(item){
      var r=item.getBoundingClientRect(),mid=r.top+r.height/2,d=Math.abs(y-mid);
      if(d<bd){bd=d;bi=parseInt(item.dataset.dragIdx);}
    });
    return bd<40?bi:tdIdx;
  }

  function tdSwap(a,b){if(a===b)return;var i=allCharacters.splice(a,1)[0];allCharacters.splice(b,0,i);}

  function initTouchDrag(){
    tdList=document.getElementById('charGrid');
    if(!tdList)return;
    tdList.addEventListener('touchstart',function(e){
      var h=e.target.closest('.drag-handle');if(!h)return;
      var c=h.closest('[data-drag-id]');if(!c)return;
      tdEl=c;tdIdx=parseInt(c.dataset.dragIdx);
      tdSX=e.touches[0].clientX;tdSY=e.touches[0].clientY;tdCY=tdSY;
      tdTimer=setTimeout(function(){td=true;tdCreateGhost();if(navigator.vibrate)navigator.vibrate(10);},400);
    },{passive:false});
    tdList.addEventListener('touchmove',function(e){
      if(!td){
        if(tdTimer&&(Math.abs(e.touches[0].clientY-tdSY)>8||Math.abs(e.touches[0].clientX-tdSX)>8)){clearTimeout(tdTimer);tdTimer=null;tdEl=null;tdIdx=-1;}
        return;
      }
      e.preventDefault();
      tdCY=e.touches[0].clientY;
      if(tdGhost)tdGhost.style.top=(tdCY-tdGhost.offsetHeight/2)+'px';
      var edge=70;
      if(tdCY<edge)window.scrollBy(0,-6);
      else if(tdCY>window.innerHeight-edge)window.scrollBy(0,6);
      var ni=tdFindTarget(tdCY);
      if(ni!==tdIdx){tdSwap(tdIdx,ni);tdIdx=ni;applyFilter();
        var nc=tdList.querySelector('[data-drag-idx="'+tdIdx+'"]');
        if(nc){tdEl=nc;tdEl.classList.add('dragging');}
        if(tdGhost){tdGhost.remove();tdCreateGhost();}
      }
    },{passive:false});
    tdList.addEventListener('touchend',tdEndDrag);tdList.addEventListener('touchcancel',tdEndDrag);
  }

  function tdEndDrag(){
    clearTimeout(tdTimer);tdTimer=null;
    if(td){td=false;if(tdGhost){tdGhost.remove();tdGhost=null;}if(tdEl){tdEl.classList.remove('dragging');tdEl=null;}saveCharOrder();applyFilter();}
    tdEl=null;tdIdx=-1;
  }

  function saveCharOrder() {
    fetch(API + '/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: allCharacters.map(function(c, i) { return { id: c.id, sort_order: i }; }) }) }).catch(function() {});
    markAppDataChanged();   // 顺序已变：其它视图下次进入时重新取数据
  }

  function moveCharUp(id){
    var idx=allCharacters.findIndex(function(c){return c.id===id;});
    if(idx<=0)return;
    var t=allCharacters[idx-1];allCharacters[idx-1]=allCharacters[idx];allCharacters[idx]=t;
    saveCharOrder();applyFilter();
  }
  function moveCharDown(id){
    var idx=allCharacters.findIndex(function(c){return c.id===id;});
    if(idx<0||idx>=allCharacters.length-1)return;
    var t=allCharacters[idx+1];allCharacters[idx+1]=allCharacters[idx];allCharacters[idx]=t;
    saveCharOrder();applyFilter();
  }

  document.getElementById('indexDeleteOverlay').addEventListener('click',function(e){if(e.target===this)closeDeleteModal();});
  document.getElementById('indexDetailOverlay').addEventListener('click',function(e){if(e.target===this)closeDetailModal();});

  function init(){initTouchDrag();loadCharacters();}

  return {
    init:init, refresh:loadCharacters,
    onSearch:onSearch, clearSearch:clearSearch, selectRegion:selectRegion,
    openCreateModal:openCreateModal, openEditModal:openEditModal, submitForm:submitForm,
    openDeleteModal:openDeleteModal, closeDeleteModal:closeDeleteModal, confirmDelete:confirmDelete,
    closeModal:closeModal, closeDetailModal:closeDetailModal, detailEdit:detailEdit,
    // 供统计页榜单直接打开某角色详情（统计页 → 角色卡片）
    openDetailModal:openDetailModal,
    handleImageUpload:handleImageUpload, removeImageItem:removeImageItem, detailImageGo:detailImageGo, detailImageStep:detailImageStep,
    cropImageFace:cropImageFace,
    handleCardClick:handleCardClick,
    enterExportMode:enterExportMode, cancelExport:cancelExport,
    toggleCardSelect:toggleCardSelect, toggleSelectAll:toggleSelectAll, confirmExport:confirmExport,
    moveCharUp:moveCharUp, moveCharDown:moveCharDown
  };
})();

// ======================== 世界设定 ========================
VM.worldview = (function() {
  var API = '/api/world-buildings';
  var MAIN_CATS = ['意识体世界设定', '人物背景故事'];
  var allEntries = [];
  var activeMainCategory = '意识体世界设定';
  var activeCategory = '全部';
  var deleteTargetId = null;
  var detailEntryId = null;
  var editReturnToDetail = null;   // 从卡片详情进入编辑时记下 id，保存/取消后回到该卡片
  // 从统计页榜单点进来的：关掉详情弹窗后切回该视图（与 VM.index 同款返回语义）
  var detailReturnView = null;
  // 从世界观详情的 [[文档]] 链接跳到文档页时，记下来源条目与文档名，
  // 用户关掉文档查看器后据此切回「刚刚在看的那条设定」。
  var docReturnTo = null;
  var docReturnDocName = '';
  var selectedIds = new Set();
  var exportMode = false;
  var _autoSaveInProgress = false;
  var loadGeneration = 0;
  var loadedKey = null;    // "大类@数据版本"：同一版本同一大类返回时不重新查询/重绘
  var loadingKey = null;

  // 触控拖拽
  var _tdEnabled = false, _tdEl = null, _tdGhost = null, _tdIdx = -1;
  var _tdStartY = 0, _tdStartX = 0, _tdCurY = 0, _tdTimer = null, _tdListEl = null;

  function loadEntries(force) {
    var revision = window.appDataRevision || 0;
    var key = activeMainCategory + '@' + revision;
    if (!force && loadedKey === key) {
      document.getElementById('worldLoadingState').style.display = 'none';
      return;
    }
    if (!force && loadingKey === key) return;
    loadingKey = key;
    var generation = ++loadGeneration;
    var q = activeMainCategory ? '?main_category=' + encodeURIComponent(activeMainCategory) : '';
    fetch(API + q).then(function(r) { return r.json(); }).then(function(data) {
      if (generation !== loadGeneration || revision !== (window.appDataRevision || 0)) return;
      loadingKey = null;
      allEntries = data;
      loadedKey = key;
      document.getElementById('worldLoadingState').style.display = 'none';
      var currentIds = new Set();
      allEntries.forEach(function(e) { currentIds.add(e.id); });
      selectedIds.forEach(function(id) { if (!currentIds.has(id)) selectedIds.delete(id); });
      buildCatTabs();
      applyFilter();
      updateEmptyText();
    }).catch(function() {
      if (generation !== loadGeneration || revision !== (window.appDataRevision || 0)) return;
      loadingKey = null;
      document.getElementById('worldLoadingState').style.display = 'none';
      if (loadedKey !== key) showToast('加载失败', 'error');
    });
  }

  function updateEmptyText() {
    document.getElementById('worldEmptyText').textContent = (activeMainCategory === '人物背景故事') ? '还没有人物背景故事' : '还没有世界设定';
  }

  function selectMainCategory(mainCat) {
    activeMainCategory = mainCat;
    activeCategory = '全部';
    document.querySelectorAll('#view-worldview .main-cat-tab').forEach(function(t) { t.classList.remove('active'); });
    var tab = document.querySelector('#view-worldview .main-cat-tab[data-main="' + mainCat + '"]');
    if (tab) tab.classList.add('active');
    document.getElementById('worldSearchInput').value = '';
    document.getElementById('worldSearchWrap').classList.remove('has-value');
    document.getElementById('catTabs').style.display = (mainCat === '人物背景故事') ? 'none' : '';
    loadEntries();
  }

  function buildCatTabs() {
    var container = document.getElementById('catTabs');
    var groups = {};
    for (var i = 0; i < allEntries.length; i++) {
      var e = allEntries[i];
      var cat = e.category || '未分类';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(e);
    }
    var ordered = Object.entries(groups).sort(function(a, b) { return b[1].length - a[1].length; });
    var html = '<button class="cat-tab active" data-cat="全部" onclick="VM.worldview.selectCategory(\'全部\')">全部<span class="tab-count">' + allEntries.length + '</span></button>';
    for (var i = 0; i < ordered.length; i++) {
      var cat = ordered[i][0], list = ordered[i][1];
      html += '<button class="cat-tab" data-cat="' + esc(cat) + '" onclick="VM.worldview.selectCategory(\'' + esc(cat) + '\')">' + esc(cat) + '<span class="tab-count">' + list.length + '</span></button>';
    }
    container.innerHTML = html;
    var dl = document.getElementById('worldCatList');
    if (dl) dl.innerHTML = ordered.map(function(e) { return '<option value="' + esc(e[0]) + '">'; }).join('');
  }

  function selectCategory(cat) {
    activeCategory = cat;
    document.querySelectorAll('#view-worldview .cat-tab').forEach(function(t) { t.classList.remove('active'); });
    var tab = document.querySelector('#view-worldview .cat-tab[data-cat="' + cat + '"]');
    if (tab) tab.classList.add('active');
    applyFilter();
  }

  var searchTimer = null;
  function onSearch() {
    var val = document.getElementById('worldSearchInput').value.trim();
    document.getElementById('worldSearchWrap').classList.toggle('has-value', val.length > 0);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function() { searchTimer = null; applyFilter(); }, 120);   // 输入防抖
  }

  function clearSearch() {
    document.getElementById('worldSearchInput').value = '';
    document.getElementById('worldSearchWrap').classList.remove('has-value');
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    applyFilter();
  }

  function applyFilter() {
    var sv = document.getElementById('worldSearchInput').value.trim().toLowerCase();
    var f = allEntries;
    if (activeCategory !== '全部') f = f.filter(function(e) { return e.category === activeCategory; });
    if (sv) f = f.filter(function(e) { return (e.title || '').toLowerCase().indexOf(sv) !== -1 || (e.content || '').toLowerCase().indexOf(sv) !== -1; });
    renderGrid(f);
  }

  // 卡片签名：覆盖 cardHTML 用到的字段与展示状态，签名相同不重建节点。
  function worldCardSig(e, gi) {
    return [e.id, gi, e.title, e.category, e.content, e.main_category, activeMainCategory,
      (exportMode && selectedIds.has(e.id)) ? 'sel' : ''].join('\u0001');
  }

  function renderGrid(entries) {
    var grid = document.getElementById('entryGrid');
    var empty = document.getElementById('worldEmptyState');
    var noResult = document.getElementById('worldNoResult');
    var count = document.getElementById('worldEntryCount');
    var sv = document.getElementById('worldSearchInput').value.trim();
    count.textContent = (sv || activeCategory !== '全部') ? entries.length + '/' + allEntries.length : allEntries.length;
    if (allEntries.length === 0) { renderKeyedList(grid, []); empty.style.display = 'block'; noResult.style.display = 'none'; return; }
    empty.style.display = 'none';
    if (entries.length === 0 && (sv || activeCategory !== '全部')) { renderKeyedList(grid, []); noResult.style.display = 'block'; return; }
    noResult.style.display = 'none';
    var idxMap = {};
    for (var i = 0; i < allEntries.length; i++) idxMap[allEntries[i].id] = i;
    var items = [];
    function pushCard(e) {
      items.push({ key: 'e:' + e.id, sig: worldCardSig(e, idxMap[e.id]), html: (function(e) { return function() { return cardHTML(e, idxMap[e.id]); }; })(e) });
    }
    if (activeCategory === '全部' && !sv) {
      var groups = {};
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var cat = e.category || '未分类';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(e);
      }
      var orderedCats = Object.keys(groups).sort(function(a,b){return groups[b].length - groups[a].length;});
      for (var i = 0; i < orderedCats.length; i++) {
        var cat = orderedCats[i], list = groups[cat];
        var groupSig = 'g' + cat + '|' + list.map(function(e) { return worldCardSig(e, idxMap[e.id]); }).join('~');
        items.push({ key: 'g:' + cat, sig: groupSig, html: (function(cat, list) { return function() {
          return '<div class="cat-group"><h3 class="cat-group-title">' + esc(cat) + ' <span class="tab-count">' + list.length + '</span></h3><div class="card-row">' +
            list.map(function(e) { return cardHTML(e, idxMap[e.id]); }).join('') + '</div></div>';
        }; })(cat, list) });
      }
    } else {
      entries.forEach(pushCard);
    }
    renderKeyedList(grid, items);
    if (exportMode) updateExportButtons();
  }

  function cardHTML(e, gi) {
    var ct = e.content || '';
    var preview = ct.length > 120 ? ct.substring(0, 120) + '…' : ct;
    var showCat = activeMainCategory !== '人物背景故事' && e.category;
    var ec = selectedIds.has(e.id) ? ' selected' : '';
    var selec = selectedIds.has(e.id) ? ' selected' : '';
    return '<div class="card' + ec + '" data-drag-id="' + e.id + '" data-drag-idx="' + (gi !== undefined ? gi : 0) + '" onclick="VM.worldview.handleCardClick(' + e.id + ')">' +
      '<input type="checkbox" class="card-check" ' + (selectedIds.has(e.id) ? 'checked' : '') + ' onclick="event.stopPropagation();VM.worldview.toggleCardSelect(' + e.id + ',this.checked)" title="选择导出">' +
      '<div class="card-header">' +
      '<button class="sort-btn" title="上移" onclick="event.stopPropagation();VM.worldview.moveWorldUp(' + e.id + ');return false;">↑</button>' +
      '<button class="sort-btn" title="下移" onclick="event.stopPropagation();VM.worldview.moveWorldDown(' + e.id + ');return false;">↓</button>' +
      '<span class="card-title">' + esc(e.title) + '</span>' +
      (showCat ? '<span class="cat-tag">' + esc(e.category) + '</span>' : '') +
      '</div>' +
      (preview ? '<div class="content-preview">' + esc(preview) + '</div>' : '') +
      '<div class="card-actions"><button class="btn-action" onclick="event.stopPropagation();VM.worldview.openEditModal(' + e.id + ')">编辑</button><button class="btn-action danger" onclick="event.stopPropagation();VM.worldview.openDeleteModal(' + e.id + ',\'' + esc(e.title) + '\')">删除</button></div></div>';
  }

  function openCreateModal() {
    editReturnToDetail = null;
    document.getElementById('worldModalTitle').textContent = '添加新设定';
    document.getElementById('worldSubmitBtn').textContent = '确认添加';
    document.getElementById('worldEditId').value = '';
    document.getElementById('worldMainCategoryInput').value = activeMainCategory;
    document.getElementById('worldEntryForm').reset();
    document.getElementById('worldCategoryGroup').style.display = (activeMainCategory === '人物背景故事') ? 'none' : '';
    document.getElementById('worldModalOverlay').classList.add('active');
  }

  function openEditModal(id) {
    fetch(API + '/' + id).then(function(r) { return r.json(); }).then(function(e) {
      document.getElementById('worldModalTitle').textContent = '编辑设定';
      document.getElementById('worldSubmitBtn').textContent = '保存修改';
      document.getElementById('worldEditId').value = e.id;
      document.getElementById('worldMainCategoryInput').value = e.main_category || '';
      document.getElementById('worldTitle').value = e.title || '';
      document.getElementById('worldCategoryInput').value = e.category || '';
      document.getElementById('worldContent').value = e.content || '';
      document.getElementById('worldCategoryGroup').style.display = (e.main_category === '人物背景故事') ? 'none' : '';
      document.getElementById('worldModalOverlay').classList.add('active');
    }).catch(function() { showToast('获取数据失败', 'error'); });
  }

  function submitForm(e) {
    e.preventDefault();
    var editId = document.getElementById('worldEditId').value;
    var data = {
      main_category: document.getElementById('worldMainCategoryInput').value,
      title: document.getElementById('worldTitle').value.trim(),
      category: document.getElementById('worldCategoryInput').value.trim(),
      content: document.getElementById('worldContent').value.trim()
    };
    if (!data.title) { showToast('标题不能为空', 'error'); return; }
    var url = editId ? API + '/' + editId : API;
    var method = editId ? 'PUT' : 'POST';
    fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(function(r) {
      if (!r.ok) throw new Error();
      _autoSaveInProgress = true;
      closeModal();
      markAppDataChanged();
      loadEntries();
      showToast(editId ? '已更新' : '已创建', 'success');
      // 从卡片详情进入的编辑：保存后回到卡片详情，而不是退到列表
      if (editReturnToDetail) {
        var backId = editReturnToDetail;
        editReturnToDetail = null;
        openDetailModal(backId);
      }
      setTimeout(function() { _autoSaveInProgress = false; }, 800);
    }).catch(function() { showToast('操作失败', 'error'); });
  }

  function openDeleteModal(id, name) {
    deleteTargetId = id;
    document.getElementById('worldDeleteName').textContent = name;
    document.getElementById('worldDeleteOverlay').classList.add('active');
  }
  function closeDeleteModal() { document.getElementById('worldDeleteOverlay').classList.remove('active'); deleteTargetId = null; }
  function confirmDelete() {
    if (!deleteTargetId) return;
    fetch(API + '/' + deleteTargetId, { method: 'DELETE' }).then(function() {
      closeDeleteModal(); markAppDataChanged(); loadEntries(); showToast('已删除', 'success');
    }).catch(function() { showToast('删除失败', 'error'); });
  }
  function closeModal() {
    document.getElementById('worldModalOverlay').classList.remove('active');
  }

  function closeModalAutoSave() {
    if (_autoSaveInProgress) {
      _autoSaveInProgress = false;
      document.getElementById('worldModalOverlay').classList.remove('active');
      return;
    }
    var title = document.getElementById('worldTitle').value.trim();
    var content = document.getElementById('worldContent').value.trim();
    if (title || content) {
      submitForm({ preventDefault: function() {} });
      setTimeout(function() {
        document.getElementById('worldModalOverlay').classList.remove('active');
      }, 500);
      return;
    }
    document.getElementById('worldModalOverlay').classList.remove('active');
  }

  function cancelEdit() {
    _autoSaveInProgress = false;
    // 从卡片详情进入的编辑，取消后回到该卡片（与保存行为一致）
    var backId = editReturnToDetail;
    editReturnToDetail = null;
    document.getElementById('worldModalOverlay').classList.remove('active');
    if (backId) openDetailModal(backId);
  }
  window.cancelEditWorld = cancelEdit;
  window.closeModalAutoSaveWorld = closeModalAutoSave;

  function openDetailModal(id, returnView) {
    detailReturnView = returnView || null;   // 传 'stats' 表示「从统计页跳来」，关掉详情要回去
    fetch(API + '/' + id).then(function(r) { return r.json(); }).then(function(e) {
      detailEntryId = e.id;
      document.getElementById('worldDetailTitle').textContent = e.title;
      var body = '';
      if (e.main_category === '人物背景故事') {}
      else if (e.category) body += '<div class="detail-section"><div class="detail-label">分类</div><div class="detail-value">' + esc(e.category) + '</div></div>';
      if (e.content) body += '<div class="detail-section"><div class="detail-label">内容</div><div class="detail-value">' + renderContentWithDocLinks(e.content) + '</div></div>';
      document.getElementById('worldDetailBody').innerHTML = body || '<p style="color:var(--text-light);text-align:center;padding:20px;">暂无内容</p>';
      document.getElementById('worldDetailOverlay').classList.add('active');
    }).catch(function() { showToast('获取详情失败', 'error'); });
  }
  function closeDetailModal() {
    document.getElementById('worldDetailOverlay').classList.remove('active');
    detailEntryId = null;
    // 从统计页点进来的：关掉详情 = 这次跳转结束，切回统计页（像 [[文档]] 链接那样关掉就跳回去）
    var rv = detailReturnView; detailReturnView = null;
    if (rv) navigateTo(rv);
  }
  // 注意：切去编辑框不算「关闭详情」，先清掉返回意图，别把用户弹回统计页
  function detailEdit() { if (detailEntryId) { var id = detailEntryId; editReturnToDetail = id; detailReturnView = null; closeDetailModal(); openEditModal(id); } }

  // ====== 文档链接功能 ======
  // 渲染详情内容时把 [[doc:文件名|显示文字]] 或 [[文件名|显示文字]] 转成可点击链接
  function renderContentWithDocLinks(text) {
    if (!text) return '';
    var safe = esc(text);
    // [[doc:文件名|显示文字]] 或 [[文件名|显示文字]]
    safe = safe.replace(/\[\[(?:doc:)?([^|<>\]]+)\|([^\]]*)\]\]/g, function(m, fname, label) {
      return '<a href="#" onclick="VM.worldview.openDocFromLink(\'' + fname.replace(/'/g, "\\'") + '\');return false;" style="color:var(--accent);text-decoration:underline;">' + (label || fname) + '</a>';
    });
    // [[doc:文件名]] 或 [[文件名]]
    safe = safe.replace(/\[\[(?:doc:)?([^<>\]]+)\]\]/g, function(m, fname) {
      return '<a href="#" onclick="VM.worldview.openDocFromLink(\'' + fname.replace(/'/g, "\\'") + '\');return false;" style="color:var(--accent);text-decoration:underline;">' + fname + '</a>';
    });
    return safe;
  }

  // 从链接跳转：切到文档页并打开对应文件。
  // 同时登记「来源条目」，这样用户关掉文档后能回到刚刚那条世界观详情
  // （Android 是单页应用，不走 URL，只能靠内存里传这个标记）。
  function openDocFromLink(fname) {
    // 记下来源：当前正在看的这条设定 + 触发跳转的文档名
    docReturnTo = detailEntryId;
    docReturnDocName = fname;
    // 关闭所有世界观相关 modal
    document.getElementById('worldDetailOverlay').classList.remove('active');
    // 切到文档页
    if (typeof navigateTo === 'function') navigateTo('documents');
    // 给文档页一个短延时来初始化，然后打开查看器
    setTimeout(function() {
      if (VM.documents && VM.documents.openViewer) {
        VM.documents.openViewer(encodeURIComponent(fname));
      }
    }, 350);
  }

  // 文档查看器关闭时回调：若这次是「从世界观详情点进来的」，就切回去并重开那条详情。
  // 用户自己又翻了别的文档 → 标记已被 abandonDocReturnTo 清掉，这里什么都不做（只关弹窗）。
  function onDocViewerClosed(closedName) {
    if (docReturnTo == null) return;
    // closedName 来自 currentViewFile，是编码态（openViewer 收到的是 encodeURIComponent 后的名字）；
    // docReturnDocName 存的是原始文件名 —— 比之前先解码，否则永远判成「不是同一份」。
    var closedRaw = closedName || '';
    try { closedRaw = decodeURIComponent(closedRaw); } catch (e) {}
    if (docReturnDocName && closedRaw && closedRaw !== docReturnDocName) {
      abandonDocReturnTo();     // 看的不是当初那份，别把用户弹走
      return;
    }
    var backId = docReturnTo;
    // 文档往返只是中间过程：保留「从统计页跳来」的返回意图，回来后关掉详情仍应回统计页
    var rv = detailReturnView;
    abandonDocReturnTo();
    if (typeof navigateTo === 'function') navigateTo('worldview');
    setTimeout(function() {
      if (VM.worldview && VM.worldview.openDetailModal) VM.worldview.openDetailModal(backId, rv);
    }, 350);
  }

  // 清掉「关掉文档就返回」的意图（用户自己翻了别的文档时调）。
  // 带 docName 时只在「打开的不是当初登记的那份」才清；
  // 不带参数则无条件清（用于其它明确的放弃场景）。
  function abandonDocReturnTo(docName) {
    if (docReturnTo == null) return;
    if (docName != null && docReturnDocName && docName === docReturnDocName) return;
    docReturnTo = null;
    docReturnDocName = '';
  }

  // 插入文档链接：弹出文档选择器
  function insertDocLink() {
    var body = document.getElementById('worldDocLinkBody');
    body.innerHTML = '<p style="padding:16px;text-align:center;color:var(--text-light);">加载中…</p>';
    document.getElementById('worldDocLinkOverlay').classList.add('active');
    // 从 API 获取文档列表
    fetch('/api/files').then(function(r) { return r.json(); }).then(function(files) {
      if (!files || files.length === 0) {
        body.innerHTML = '<p style="padding:20px;text-align:center;color:var(--text-light);">暂无文档，请先上传文档</p>';
        return;
      }
      var html = files.map(function(f) {
        var disp = f.name;
        if (f.size_display) disp += ' (' + f.size_display + ')';
        return '<div style="padding:12px 8px;border-bottom:1px solid var(--border);cursor:pointer;" onclick="VM.worldview.pickDocLink(\'' + f.name.replace(/'/g, "\\'") + '\')" ontouchstart=""><span style="font-size:.9rem;">📄 ' + esc(disp) + '</span></div>';
      }).join('');
      body.innerHTML = html;
    }).catch(function() {
      // 走 api-shim 也失败 → 尝试从 docDB 拿文档列表
      if (typeof docDB !== 'undefined' && docDB.list) {
        docDB.list().then(function(files) {
          if (files && files.length) {
            body.innerHTML = files.map(function(f) {
              var disp = f.name;
              if (f.size_display) disp += ' (' + f.size_display + ')';
              return '<div style="padding:12px 8px;border-bottom:1px solid var(--border);cursor:pointer;" onclick="VM.worldview.pickDocLink(\'' + f.name.replace(/'/g, "\\'") + '\')" ontouchstart="">📄 ' + esc(disp) + '</div>';
            }).join('');
          } else {
            body.innerHTML = '<p style="padding:20px;text-align:center;color:var(--text-light);">暂无文档</p>';
          }
        }).catch(function() { body.innerHTML = '<p style="padding:20px;text-align:center;color:var(--text-light);">加载失败</p>'; });
      } else {
        body.innerHTML = '<p style="padding:20px;text-align:center;color:var(--text-light);">加载失败</p>';
      }
    });
  }

  function closeDocLinkPicker() { document.getElementById('worldDocLinkOverlay').classList.remove('active'); }

  function pickDocLink(fname) {
    closeDocLinkPicker();
    var ta = document.getElementById('worldContent');
    var linkText = '[[' + fname + '|' + fname + ']]';
    if (ta && typeof ta.setSelectionRange === 'function') {
      var start = ta.selectionStart, end = ta.selectionEnd;
      var sel = ta.value.substring(start, end);
      if (sel) linkText = '[[' + fname + '|' + sel + ']]';
      ta.value = ta.value.substring(0, start) + linkText + ta.value.substring(end);
      ta.focus();
      var newCursor = start + linkText.length;
      ta.setSelectionRange(newCursor, newCursor);
    } else if (ta) {
      ta.value += linkText;
      ta.focus();
    }
  }

  function enterExportMode() { exportMode = true; selectedIds.clear(); document.body.classList.add('export-mode'); applyFilter(); }
  function cancelExport() { exportMode = false; selectedIds.clear(); document.body.classList.remove('export-mode'); applyFilter(); }
  function handleCardClick(id) {
    if (exportMode) {
      var cb = document.querySelector('#entryGrid .card[data-drag-id="' + id + '"] .card-check');
      if (cb) { cb.checked = !cb.checked; toggleCardSelect(id, cb.checked); }
      return;
    }
    openDetailModal(id);
  }
  function toggleCardSelect(id, checked) {
    if (checked) selectedIds.add(id); else selectedIds.delete(id);
    var card = document.querySelector('#entryGrid .card[data-drag-id="' + id + '"]');
    if (card) card.classList.toggle('selected', checked);
    updateExportButtons();
  }
  // 只把勾选态刷到已有 DOM 上，不整表重建：全选时重建整页会明显卡顿。
  function syncSelectionToDom() {
    document.querySelectorAll('#entryGrid .card[data-drag-id]').forEach(function(card) {
      var on = selectedIds.has(parseInt(card.dataset.dragId, 10));
      card.classList.toggle('selected', on);
      var cb = card.querySelector('.card-check'); if (cb) cb.checked = on;
    });
    updateExportButtons();
  }
  function toggleSelectAll() {
    var cards = document.querySelectorAll('#entryGrid .card[data-drag-id]');
    if (cards.length === 0) return;
    var vi = [];
    cards.forEach(function(c) { vi.push(parseInt(c.dataset.dragId, 10)); });
    var as = vi.every(function(id) { return selectedIds.has(id); });
    if (as) vi.forEach(function(id) { selectedIds.delete(id); });
    else vi.forEach(function(id) { selectedIds.add(id); });
    syncSelectionToDom();
  }
  function updateExportButtons() {
    var btn = document.getElementById('worldConfirmExportBtn');
    if (!btn) return;
    btn.disabled = selectedIds.size === 0;
    btn.textContent = selectedIds.size > 0 ? '确认导出 (' + selectedIds.size + ')' : '确认导出';
  }
  function confirmExport() {
    if (selectedIds.size === 0) return;
    var sel = allEntries.filter(function(e) { return selectedIds.has(e.id); });
    var ed = sel.map(mapWorldExport);
    var js = JSON.stringify(ed, null, 2);
    var fn = '世界观设定_' + sel.length + '条_' + new Date().toISOString().slice(0, 10) + '.json';
    saveExportFile(js, fn, '已导出 ' + sel.length + ' 条设定');
    cancelExport();
  }

  function moveWorldUp(id) {
    var idx = allEntries.findIndex(function(e) { return e.id === id; });
    if (idx <= 0) return;
    var t = allEntries[idx - 1]; allEntries[idx - 1] = allEntries[idx]; allEntries[idx] = t;
    saveWorldOrder(); applyFilter();
  }
  function moveWorldDown(id) {
    var idx = allEntries.findIndex(function(e) { return e.id === id; });
    if (idx < 0 || idx >= allEntries.length - 1) return;
    var t = allEntries[idx + 1]; allEntries[idx + 1] = allEntries[idx]; allEntries[idx] = t;
    saveWorldOrder(); applyFilter();
  }

  // 触控拖拽
  function _tdGetItems() { return [].slice.call(_tdListEl.querySelectorAll('[data-drag-id]:not(.dragging)')); }
  function _tdFindTargetIdx(y) {
    var bi = _tdIdx, bd = Infinity;
    _tdGetItems().forEach(function(item) {
      var r = item.getBoundingClientRect(), mid = r.top + r.height / 2, d = Math.abs(y - mid);
      if (d < bd) { bd = d; bi = parseInt(item.dataset.dragIdx); }
    });
    return bd < 40 ? bi : _tdIdx;
  }
  function _tdCreateGhost() {
    if (!_tdEl) return;
    var r = _tdEl.getBoundingClientRect();
    _tdGhost = _tdEl.cloneNode(true);
    _tdGhost.style.cssText = 'position:fixed;z-index:9999;width:' + r.width + 'px;left:' + r.left + 'px;top:' + (_tdCurY - r.height / 2) + 'px;opacity:0.94;transform:scale(1.03);box-shadow:0 8px 28px rgba(0,0,0,.2);pointer-events:none;transition:none;border-radius:12px;background:#fffef9;';
    document.body.appendChild(_tdGhost);
    _tdEl.classList.add('dragging');
  }
  function _tdSwap(a, b) { if (a === b) return; var i = allEntries.splice(a, 1)[0]; allEntries.splice(b, 0, i); }
  function initTouchDrag() {
    _tdListEl = document.getElementById('entryGrid');
    if (!_tdListEl) return;
    _tdListEl.addEventListener('touchstart', function(ev) {
      var h = ev.target.closest('.drag-handle'); if (!h) return;
      var c = h.closest('[data-drag-id]'); if (!c) return;
      _tdEl = c; _tdIdx = parseInt(c.dataset.dragIdx);
      _tdStartX = ev.touches[0].clientX; _tdStartY = ev.touches[0].clientY; _tdCurY = _tdStartY;
      _tdTimer = setTimeout(function() { _tdEnabled = true; _tdCreateGhost(); if (navigator.vibrate) navigator.vibrate(10); }, 400);
    }, { passive: false });
    _tdListEl.addEventListener('touchmove', function(ev) {
      if (!_tdEnabled) {
        if (_tdTimer && (Math.abs(ev.touches[0].clientY - _tdStartY) > 8 || Math.abs(ev.touches[0].clientX - _tdStartX) > 8)) { clearTimeout(_tdTimer); _tdTimer = null; _tdEl = null; _tdIdx = -1; }
        return;
      }
      ev.preventDefault();
      _tdCurY = ev.touches[0].clientY;
      if (_tdGhost) _tdGhost.style.top = (_tdCurY - _tdGhost.offsetHeight / 2) + 'px';
      var edge = 70;
      if (_tdCurY < edge) window.scrollBy(0, -6);
      else if (_tdCurY > window.innerHeight - edge) window.scrollBy(0, 6);
      var ni = _tdFindTargetIdx(_tdCurY);
      if (ni !== _tdIdx) { _tdSwap(_tdIdx, ni); _tdIdx = ni; applyFilter();
        var nc = _tdListEl.querySelector('[data-drag-idx="' + _tdIdx + '"]');
        if (nc) { _tdEl = nc; _tdEl.classList.add('dragging'); }
        if (_tdGhost) { _tdGhost.remove(); _tdCreateGhost(); }
      }
    }, { passive: false });
    _tdListEl.addEventListener('touchend', _tdEndDrag); _tdListEl.addEventListener('touchcancel', _tdEndDrag);
  }
  function _tdEndDrag() {
    clearTimeout(_tdTimer); _tdTimer = null;
    if (_tdEnabled) { _tdEnabled = false; if (_tdGhost) { _tdGhost.remove(); _tdGhost = null; } if (_tdEl) { _tdEl.classList.remove('dragging'); _tdEl = null; } saveWorldOrder(); applyFilter(); }
    _tdEl = null; _tdIdx = -1;
  }
  function saveWorldOrder() {
    fetch(API + '/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: allEntries.map(function(e, i) { return { id: e.id, sort_order: i }; }) }) }).catch(function() {});
    markAppDataChanged();   // 顺序已变：其它视图下次进入时重新取数据
  }

  document.getElementById('worldDeleteOverlay').addEventListener('click', function(ev) { if (ev.target === this) closeDeleteModal(); });
  document.getElementById('worldDetailOverlay').addEventListener('click', function(ev) { if (ev.target === this) closeDetailModal(); });

  function init() { initTouchDrag(); loadEntries(); }

  return {
    init: init, refresh: loadEntries,
    onSearch: onSearch, clearSearch: clearSearch, selectMainCategory: selectMainCategory, selectCategory: selectCategory,
    openCreateModal: openCreateModal, openEditModal: openEditModal, submitForm: submitForm,
    openDeleteModal: openDeleteModal, closeDeleteModal: closeDeleteModal, confirmDelete: confirmDelete,
    closeModal: closeModal, closeDetailModal: closeDetailModal, detailEdit: detailEdit,
    // 供统计页榜单直接打开某世界观条目详情（统计页 → 世界观卡片）。
    // 需要先按 main_category 切好大类，否则详情弹窗背后的列表 tab 会对不上。
    openDetailModal: openDetailModal, selectMainCategory: selectMainCategory,
    getMainCategory: function () { return activeMainCategory; },
    insertDocLink: insertDocLink, closeDocLinkPicker: closeDocLinkPicker, pickDocLink: pickDocLink, openDocFromLink: openDocFromLink,
    onDocViewerClosed: onDocViewerClosed,
    abandonDocReturnTo: abandonDocReturnTo,
    handleCardClick: handleCardClick,
    enterExportMode: enterExportMode, cancelExport: cancelExport,
    toggleCardSelect: toggleCardSelect, toggleSelectAll: toggleSelectAll, confirmExport: confirmExport,
    moveWorldUp: moveWorldUp, moveWorldDown: moveWorldDown
  };
})();

// ======================== 文档管理 ========================
VM.documents = (function() {
  var API = '/api/files';
  var deleteTarget = null;
  var currentViewFile = '';
  var loadGeneration = 0;
  var viewerGeneration = 0;
  var viewerObjectUrl = null;

  function onFileSelect(e) { if (e.target.files.length > 0) uploadFiles(e.target.files); e.target.value = ''; }

  function uploadFiles(fileList) {
    var fd = new FormData();
    for (var i = 0; i < fileList.length; i++) fd.append('files', fileList[i]);
    fetch(API + '/upload', { method: 'POST', body: fd }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || '上传失败'); });
      return r.json();
    }).then(function(data) { showToast(data.message, 'success'); loadFiles(); })
    .catch(function(e) { showToast(e.message || '上传失败', 'error'); });
  }

  function loadFiles() {
    var generation = ++loadGeneration;
    var revision = window.appDataRevision || 0;
    fetch(API).then(function(r) { return r.json(); }).then(function(files) {
      if (generation !== loadGeneration || revision !== (window.appDataRevision || 0)) return;
      renderFiles(files);
    }).catch(function() { showToast('加载失败', 'error'); });
  }

  function renderFiles(files) {
    var list = document.getElementById('docFileList');
    var empty = document.getElementById('docEmptyState');
    var count = document.getElementById('docFileCount');
    count.textContent = files.length;
    if (files.length === 0) { list.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    list.innerHTML = files.map(function(f) {
      var icon = getFileIcon(f.name);
      var ext = f.name.split('.').pop().toLowerCase();
      var canView = ['docx', 'txt', 'md'].indexOf(ext) !== -1;
      var sn = encodeURIComponent(f.name);
      return '<div class="file-card"><span class="file-icon">' + icon + '</span><div class="file-info"><div class="file-name">' + esc(f.name) + '</div><div class="file-meta">' + (f.size_display || '') + ' · ' + (f.modified || '') + '</div></div><div class="file-actions">' +
        (canView ? '<button class="btn-action" onclick="VM.documents.openViewer(\'' + sn + '\')">查看</button>' : '') +
        '<a class="btn-action" href="' + API + '/' + sn + '" download>下载</a>' +
        '<button class="btn-action danger" onclick="VM.documents.openDeleteModal(\'' + sn + '\')">删除</button></div></div>';
    }).join('');
  }

  function getFileIcon(name) {
    var ext = name.split('.').pop().toLowerCase();
    var map = { docx: '📝', doc: '📝', pdf: '📕', txt: '📄', md: '📋' };
    return map[ext] || '📎';
  }

  function openDeleteModal(en) {
    deleteTarget = en;
    document.getElementById('docDeleteName').textContent = decodeURIComponent(en);
    document.getElementById('docDeleteOverlay').classList.add('active');
  }
  function closeDeleteModal() { document.getElementById('docDeleteOverlay').classList.remove('active'); deleteTarget = null; }
  function confirmDelete() {
    if (!deleteTarget) return;
    fetch(API + '/' + deleteTarget, { method: 'DELETE' }).then(function() {
      if (currentViewFile === deleteTarget) closeViewer();
      closeDeleteModal(); loadFiles(); showToast('已删除', 'success');
    }).catch(function() { showToast('删除失败', 'error'); });
  }

  function openViewer(en) {
    var generation = ++viewerGeneration;
    var fn = decodeURIComponent(en);
    // 用户自己点了别的文档：放弃「关掉就返回世界观详情」的语义，
    // 免得他翻看完别的文档后被莫名其妙弹回去。
    if (VM.worldview && VM.worldview.abandonDocReturnTo) VM.worldview.abandonDocReturnTo(fn);
    currentViewFile = en;
    var body = document.getElementById('docViewerBody');
    document.getElementById('docViewerTitle').textContent = fn;
    var ext = fn.split('.').pop().toLowerCase();
    document.getElementById('docViewerTag').textContent = ext.toUpperCase();
    releaseViewerObjectUrl();
    if (location.protocol === 'file:' && typeof docDB !== 'undefined') {
      docDB.get(fn).then(function(doc) {
        if (generation !== viewerGeneration) return;
        if (doc && doc.blob) {
          viewerObjectUrl = URL.createObjectURL(doc.blob);
          document.getElementById('docViewerDownload').href = viewerObjectUrl;
        } else document.getElementById('docViewerDownload').href = '#';
      }).catch(function() { document.getElementById('docViewerDownload').href = '#'; });
    } else {
      document.getElementById('docViewerDownload').href = API + '/' + en;
    }
    body.innerHTML = '<div class="viewer-loading"><div class="spinner"></div><div>加载中…</div></div>';
    document.getElementById('docViewerOverlay').classList.add('active');
    fetch(API + '/' + en + '/view').then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || '加载失败'); });
      return r.json();
    }).then(function(data) {
      if (generation !== viewerGeneration) return;
      renderViewerContent(data);
    }).catch(function(e) {
      if (generation !== viewerGeneration) return;
      body.innerHTML = '<div class="viewer-loading" style="color:var(--danger);"><p style="font-size:1.5rem;margin-bottom:8px;">⚠️</p><p>' + esc(e.message || '加载失败') + '</p></div>';
    });
  }

  function renderViewerContent(data) {
    var body = document.getElementById('docViewerBody');
    if (data.type === 'docx') {
      var content = data.content;
      var cacheKey = data.cache_key || '';
      if (typeof content === 'string' && !cacheKey) {
        body.innerHTML = content ? '<div class="doc-paragraph docx-html">' + content + '</div>' : '<div class="viewer-loading">文档为空</div>';
        return;
      }
      var html = '';
      var isNewFormat = Array.isArray(content) && content.length > 0 && content[0].type !== undefined;
      if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i++) {
          var item = content[i];
          if (isNewFormat && item.type === 'image') {
            var imgUrl = cacheKey ? '/api/files/images/' + encodeURIComponent(cacheKey) + '/' + encodeURIComponent(item.src) : '';
            var safeDocImage = safeImageSrc(imgUrl);
            html += '<div class="doc-image">' + (safeDocImage ? '<img src="' + safeDocImage + '" alt="' + esc(item.caption || '') + '" loading="lazy" onerror="this.style.display=\'none\'">' : imageRepairHint()) + (item.caption ? '<div class="doc-image-caption">' + esc(item.caption) + '</div>' : '') + '</div>';
          } else if (isNewFormat && item.type === 'text') {
            if (!item.text.trim()) html += '<div class="doc-empty"></div>';
            else if (item.is_heading) html += '<div class="doc-heading">' + esc(item.text) + '</div>';
            else html += '<div class="doc-paragraph">' + esc(item.text) + '</div>';
          } else if (typeof item === 'string') {
            if (!item.trim()) html += '<div class="doc-empty"></div>';
            else html += '<div class="doc-paragraph">' + esc(item) + '</div>';
          }
        }
      } else {
        html = '<div class="doc-paragraph">' + esc(content || '') + '</div>';
      }
      body.innerHTML = html || '<div class="viewer-loading">文档为空</div>';
    } else {
      var text = typeof data.content === 'string' ? data.content : '';
      body.innerHTML = text ? '<div class="doc-paragraph">' + esc(text) + '</div>' : '<div class="viewer-loading">文档为空</div>';
    }
  }

  function releaseViewerObjectUrl() {
    if (viewerObjectUrl) { URL.revokeObjectURL(viewerObjectUrl); viewerObjectUrl = null; }
  }

  function closeViewer() {
    document.getElementById('docViewerOverlay').classList.remove('active');
    var closed = currentViewFile;
    currentViewFile = '';
    releaseViewerObjectUrl();   // 关闭时释放 Blob URL，避免长期占用内存
    // 这次是「从世界观详情点 [[文档]] 进来的」→ 关掉文档就切回那条世界观详情。
    // 回调内部会判断「用户是否又翻了别的文档」，该不返回时它自己会放弃。
    if (VM.worldview && VM.worldview.onDocViewerClosed) VM.worldview.onDocViewerClosed(closed);
  }

  document.getElementById('docDeleteOverlay').addEventListener('click', function(ev) { if (ev.target === this) closeDeleteModal(); });
  document.getElementById('docViewerOverlay').addEventListener('click', function(ev) { if (ev.target === this) closeViewer(); });

  function init() { loadFiles(); }

  return {
    init: init, refresh: loadFiles,
    onFileSelect: onFileSelect,
    openDeleteModal: openDeleteModal, closeDeleteModal: closeDeleteModal, confirmDelete: confirmDelete,
    openViewer: openViewer, closeViewer: closeViewer
  };
})();

// ======================== 关系网 ========================
VM.relations = (function() {
  var API_REL = '/api/relations';
  var API_CHAR = '/api/characters';
  var allRelations = [];
  var allCharacters = [];
  var deleteTargetId = null;
  var selectedFromCharId = null;
  var infoCharId = null;
  var activeType = '全部';
  var exportMode = false;
  var selectedIds = new Set();
  var _autoSaveInProgress = false;
  var REL_TYPES = ['CP', '单箭头', '继承记忆', '参与组建', '师生', '朋友', '冤家', '亲属'];
  // 全局搜索跳转：待定位的关系 id。数据异步加载完毕后由 renderRelList 消费。
  var _pendingFocusRelId = null;
  var familyEditMap = {};

  var _tdEnabled = false, _tdEl = null, _tdGhost = null, _tdIdx = -1;
  var _tdStartY = 0, _tdStartX = 0, _tdCurY = 0, _tdTimer = null, _tdListEl = null;

  var FAMILY_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#2980b9','#27ae60','#8e44ad','#e91e63','#00bcd4','#ff5722','#607d8b','#cddc39'];
  var gFamilyColorMap = {};
  var gCanvas, gCtx, gW, gH, gDpr;
  var gNodes = [];
  var gEdges = [];
  var gScale = 1, gOffsetX = 0, gOffsetY = 0;
  var gDragNode = null, gDragging = false;

  // 关系图节点半径：随画布尺寸自适应。
  // 手机画布窄而矮（约 340×280），r=16 已经合适；平板上画布大得多，
  // 沿用 16 会让节点显得又小又空，因此按画布宽度分档放大。
  // 绘制（节点圆/头像裁剪）、关系线端点内缩、命中检测三处必须用同一个值，
  // 否则会出现「点得中但画的位置不对」。
  function gNodeR() {
    var base = Math.min(gW, gH);
    if (base >= 460) return 26;   // 横屏平板 / 大画布
    if (base >= 340) return 20;   // 竖屏平板
    return 16;                    // 手机
  }
  var gLastTouchDist = 0, gPanning = false, gLastX = 0, gLastY = 0;
  var gLastTapTime = 0, gLastTapNodeId = null;
  var gTouchStartX = 0, gTouchStartY = 0, gTouchMoved = false;
  var G_DBL_TAP_DELAY = 300, G_DBL_TAP_MOVE_TOL = 10;
  // 鼠标路径（平板接鼠标/桌面模式）判断"这算点击还是拖动"用的基准
  var gMouseDownNodeX = 0, gMouseDownNodeY = 0, gMousePanMoved = false;
  // 聚焦高亮：单击/点按某个节点后，把 ta 的家族成员与关系对象拎出来、
  // 其余节点和连线压暗；再点空白处取消。与桌面版 relations.html 同语义。
  // 注意：只影响绘制，不动坐标，也不影响拖拽/平移。
  var gFocusId = null;
  // 聚焦时「无关元素」的压暗透明度（与桌面版一致）
  var G_FOCUS_DIM = 0.16;
  var loadGeneration = 0;
  var loadedRevision = -1;    // 已加载完成的数据版本（同版本返回不再查询/重绘）
  var loadingRevision = -1;
  var gNodeIndex = new Map();       // id → node：替代每步线性 find
  var gNodeFams = new Map();        // id → 家族数组：替代每步重复拆分字符串
  var gLayout = { epoch: 0, timer: null, step: 0, total: 300, budgetMs: 8, running: false, paused: false };
  // 节点头像缓存：id → { img: HTMLImageElement }（已按 face_crop 裁好的圆形画布）
  // 或 id → null（该角色没有可用头像，避免反复重试）。key 里带 crop 签名，
  // 取脸参数变了会自动重新裁。
  var gAvatarCache = new Map();
  var gAvatarSig = new Map();       // id → 当前缓存的 key（ref+crop 签名）

  function splitFamilies(s) { return (s || '').split(/[、,，]/).map(function(x) { return x.trim(); }).filter(Boolean); }

  // ---- 聚焦高亮 ----
  // 与 ta 有关的节点集合：本人 + 同家族的人 + 有直接关系的人。
  // 同家族「算有关」是刻意的——家族在图里以聚类圈呈现，聚焦时应一起亮起来。
  function computeGFocusSet(charId) {
    var set = new Set();
    if (charId == null) return set;
    set.add(charId);
    gEdges.forEach(function(e) {
      if (e.from === charId) set.add(e.to);
      else if (e.to === charId) set.add(e.from);
    });
    var me = gNodeIndex.get(charId);
    if (me) {
      var myFams = new Set(splitFamilies(me.family || ''));
      if (myFams.size > 0) {
        gNodes.forEach(function(n) {
          if (set.has(n.id)) return;
          var fams = splitFamilies(n.family || '');
          for (var i = 0; i < fams.length; i++) {
            if (myFams.has(fams[i])) { set.add(n.id); return; }
          }
        });
      }
    }
    return set;
  }

  function setGFocus(charId, opts) {
    gFocusId = (charId == null) ? null : charId;
    renderGFocusBanner();
    graphDraw();
    // 从别处（统计页榜单）跳进来时把画布滚进视野，免得看不到高亮
    if (opts && opts.scrollToGraph) {
      var wrap = document.getElementById('canvasWrap');
      if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function clearGFocus() {
    if (gFocusId == null) return;
    gFocusId = null;
    renderGFocusBanner();
    graphDraw();
  }

  function toggleGFocus(charId) {
    if (gFocusId === charId) clearGFocus();
    else setGFocus(charId);
  }

  // 画布上方那行「已高亮 XX · 家族 … | 家人 N · 关系对象 M」+ 可点的人物 chip。
  function renderGFocusBanner() {
    var banner = document.getElementById('gFocusBanner');
    var btn = document.getElementById('gFocusClearBtn');
    if (!banner) return;
    if (gFocusId == null) {
      banner.style.display = 'none'; banner.innerHTML = '';
      if (btn) btn.style.display = 'none';
      return;
    }
    var me = gNodeIndex.get(gFocusId);
    var set = computeGFocusSet(gFocusId);
    var myFams = me ? new Set(splitFamilies(me.family || '')) : new Set();
    var famMembers = [], relMembers = [];
    set.forEach(function(id) {
      if (id === gFocusId) return;
      var n = gNodeIndex.get(id);
      if (!n) return;
      var fams = splitFamilies(n.family || '');
      var sameFam = myFams.size > 0 && fams.some(function(f) { return myFams.has(f); });
      (sameFam ? famMembers : relMembers).push(n);
    });

    var html = '🎯 已高亮 <b>' + esc(me ? me.name : ('#' + gFocusId)) + '</b>';
    if (myFams.size) html += ' · 家族 ' + esc(Array.from(myFams).join('、'));
    html += '<span class="g-focus-stat">｜家人 ' + famMembers.length + ' · 关系对象 ' + relMembers.length + '</span>';

    var others = famMembers.concat(relMembers);
    if (others.length) {
      html += '<div class="g-focus-chips">' +
        others.slice(0, 12).map(function(n) {
          return '<span class="g-focus-chip" onclick="VM.relations.setGFocus(' + n.id + ')">' + esc(n.name) + '</span>';
        }).join('') +
        (others.length > 12 ? '<span class="g-focus-more">…共 ' + others.length + ' 位</span>' : '') +
        '</div>';
    } else {
      html += ' <span class="g-focus-stat">（暂无家人或关系对象）</span>';
    }

    banner.innerHTML = html;
    banner.style.display = 'flex';
    if (btn) btn.style.display = '';
  }

  function buildFamilyColors() {
    gFamilyColorMap = {}; var idx = 0;
    allCharacters.forEach(function(c) {
      splitFamilies(c.family).forEach(function(fam) {
        if (fam && !(fam in gFamilyColorMap)) { gFamilyColorMap[fam] = FAMILY_COLORS[idx % FAMILY_COLORS.length]; idx++; }
      });
    });
  }
  function nodeFamilyColor(n) {
    var fams = splitFamilies(n.family);
    return fams.length > 0 ? (gFamilyColorMap[fams[0]] || '#8b5e3c') : '#8b5e3c';
  }
  function nodeFamilies(n) { return gNodeFams.get(n.id) || splitFamilies(n.family); }

  function loadData(force) {
    var revision = window.appDataRevision || 0;
    // 未变更返回：同版本数据已加载过，沿用内存数据与现有 DOM，并恢复被隐藏页暂停的布局。
    if (!force && loadedRevision === revision) {
      document.getElementById('relLoadingState').style.display = 'none';
      resumeLayout();
      return;
    }
    if (!force && loadingRevision === revision) return;
    loadingRevision = revision;
    var generation = ++loadGeneration;
    // 角色数据优先复用其它视图（如角色页）已加载的内存快照，不重复查询。
    // P06：关系名补全只需要 id/name/学校/家族 —— 请求 names 投影（list 投影同样满足）。
    var sharedChars = _getSharedCharacters(revision, 'names');
    var charsPromise = sharedChars ? Promise.resolve(sharedChars.slice()) : fetch(API_CHAR + '?projection=names').then(function(r) { return r.json(); });
    Promise.all([fetch(API_REL).then(function(r) { return r.json(); }), charsPromise]).then(function(arr) {
      if (generation !== loadGeneration || revision !== (window.appDataRevision || 0)) return;
      loadingRevision = -1;
      allRelations = arr[0]; allCharacters = arr[1];
      if (!sharedChars) _putSharedCharacters(allCharacters, revision, 'names');
      loadedRevision = revision;
      var ci = new Set(); allRelations.forEach(function(r) { ci.add(r.id); });
      selectedIds.forEach(function(id) { if (!ci.has(id)) selectedIds.delete(id); });
      if (exportMode) updateExportButtons();
      document.getElementById('relLoadingState').style.display = 'none';
      buildTypeTabs(); renderRelList(); graphInit();
    }).catch(function() {
      if (generation !== loadGeneration || revision !== (window.appDataRevision || 0)) return;
      loadingRevision = -1;
      document.getElementById('relLoadingState').style.display = 'none';
      if (loadedRevision !== revision) showToast('加载失败', 'error');
    });
  }

  function relCardHTML(r, gi) {
    var fn = r.from_name || '角色#' + r.from_char_id;
    var tn = r.to_name || '角色#' + r.to_char_id;
    var tc = r.relation_type === 'CP' ? 'cp' : r.relation_type === '师生' ? '师生' : '';
    var th = r.relation_type ? '<span class="rel-type ' + tc + '">' + esc(r.relation_type) + '</span>' : '';
    var ar = ['CP', '朋友', '冤家', '亲属'].indexOf(r.relation_type) !== -1 ? '⇄' : '→';
    return '<div class="rel-card' + (selectedIds.has(r.id) ? ' selected' : '') + '" data-drag-id="' + r.id + '" data-drag-idx="' + gi + '" data-rel-id="' + r.id + '">' +
      '<input type="checkbox" class="rel-check" ' + (selectedIds.has(r.id) ? 'checked' : '') + ' onchange="VM.relations.toggleCardSelect(' + r.id + ',this.checked)" onclick="event.stopPropagation()">' +
      '<div class="rel-names" onclick="' + (exportMode ? 'VM.relations.toggleCardClick(' + r.id + ')' : 'VM.relations.openEditModal(' + r.id + ')') + '">' +
      '<button class="sort-btn" title="上移" onclick="event.stopPropagation();VM.relations.moveRelUp(' + r.id + ');return false;">↑</button>' +
      '<button class="sort-btn" title="下移" onclick="event.stopPropagation();VM.relations.moveRelDown(' + r.id + ');return false;">↓</button>' +
      '<span class="rel-name">' + esc(fn) + '</span>' +
      '<span class="rel-arrow">' + ar + '</span>' +
      '<span class="rel-name">' + esc(tn) + '</span>' + th +
      '</div>' +
      (r.description ? '<div class="rel-desc">' + esc(r.description) + '</div>' : '') +
      '<div class="card-actions"><button class="btn-action" onclick="event.stopPropagation();VM.relations.openEditModal(' + r.id + ')">编辑</button><button class="btn-action danger" onclick="event.stopPropagation();VM.relations.openDeleteModal(' + r.id + ',\'' + esc(fn) + ' ' + ar + ' ' + esc(tn) + '\')">删除</button></div></div>';
  }

  // 关系卡签名：覆盖展示字段、序号与选择/导出状态。
  function relSig(r, gi) {
    return [r.id, gi, r.from_name, r.to_name, r.relation_type, r.description,
      exportMode ? 'exp' : '', (selectedIds.has(r.id) ? 'sel' : '')].join('\u0001');
  }

  function renderRelList() {
    var list = document.getElementById('relList');
    var empty = document.getElementById('relEmptyState');
    var noResult = document.getElementById('relNoResult');
    var count = document.getElementById('relCount');
    var sv = (document.getElementById('relSearchInput').value || '').trim().toLowerCase();
    var f = allRelations;
    if (activeType !== '全部') f = f.filter(function(r) { return r.relation_type === activeType; });
    if (sv) f = f.filter(function(r) {
      var fn = (r.from_name || '').toLowerCase(), tn = (r.to_name || '').toLowerCase();
      return fn.indexOf(sv) !== -1 || tn.indexOf(sv) !== -1;
    });
    count.textContent = (sv || activeType !== '全部') ? f.length + '/' + allRelations.length : allRelations.length;
    if (allRelations.length === 0) { renderKeyedList(list, []); empty.style.display = 'block'; noResult.style.display = 'none'; return; }
    empty.style.display = 'none';
    if (f.length === 0 && (sv || activeType !== '全部')) { renderKeyedList(list, []); noResult.style.display = 'block'; return; }
    noResult.style.display = 'none';
    var idxMap = {};
    for (var i = 0; i < allRelations.length; i++) idxMap[allRelations[i].id] = i;
    var items = f.map(function(r) {
      var gi = idxMap[r.id];
      return { key: 'r:' + r.id, sig: relSig(r, gi), html: (function(r, gi) { return function() { return relCardHTML(r, gi); }; })(r, gi) };
    });
    renderKeyedList(list, items);
    if (exportMode) updateExportButtons();
    if (_pendingFocusRelId != null) {
      var target = list.querySelector('.rel-card[data-rel-id="' + _pendingFocusRelId + '"]');
      if (target) applyRelFocus(target);
    }
  }

  // 滚动到目标关系卡并短暂高亮（全局搜索跳转用）
  function applyRelFocus(el) {
    _pendingFocusRelId = null;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
    el.classList.add('rel-focus');
    setTimeout(function() { el.classList.remove('rel-focus'); }, 2600);
  }

  // 供全局搜索调用：记录待定位关系 id；若列表已渲染则立即定位
  function focusRelation(id) {
    _pendingFocusRelId = id;
    var el = document.querySelector('#relList .rel-card[data-rel-id="' + id + '"]');
    if (el) applyRelFocus(el);
  }

  var searchTimer = null;
  function onSearch() {
    var v = document.getElementById('relSearchInput').value.trim();
    document.getElementById('relSearchWrap').classList.toggle('has-value', v.length > 0);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function() { searchTimer = null; renderRelList(); }, 120);   // 输入防抖
  }
  function clearSearch() {
    document.getElementById('relSearchInput').value = '';
    document.getElementById('relSearchWrap').classList.remove('has-value');
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    renderRelList();
  }

  function populateCharSelects() {
    var fromSel = document.getElementById('relFromChar');
    var toSel = document.getElementById('relToChar');
    var opts = allCharacters.map(function(c) { return '<option value="' + c.id + '">' + esc(c.name) + (c.university ? ' (' + esc(c.university) + ')' : '') + '</option>'; }).join('');
    fromSel.innerHTML = '<option value="">请选择</option>' + opts;
    toSel.innerHTML = '<option value="">请选择</option>' + opts;
  }

  function openCreateModal() {
    populateCharSelects();
    document.getElementById('relModalTitle').textContent = '添加关系';
    document.getElementById('relSubmitBtn').textContent = '确认添加';
    document.getElementById('relEditId').value = '';
    document.getElementById('relForm').reset();
    if (selectedFromCharId) { document.getElementById('relFromChar').value = selectedFromCharId; selectedFromCharId = null; }
    document.getElementById('relModalOverlay').classList.add('active');
  }

  function openEditModal(id) {
    var r = allRelations.find(function(rel) { return rel.id === id; });
    if (!r) { showToast('未找到关系数据', 'error'); return; }
    populateCharSelects();
    document.getElementById('relModalTitle').textContent = '编辑关系';
    document.getElementById('relSubmitBtn').textContent = '保存修改';
    document.getElementById('relEditId').value = r.id;
    document.getElementById('relFromChar').value = r.from_char_id;
    document.getElementById('relToChar').value = r.to_char_id;
    document.getElementById('relType').value = r.relation_type || '';
    document.getElementById('relDesc').value = r.description || '';
    document.getElementById('relModalOverlay').classList.add('active');
  }

  function submitForm(e) {
    e.preventDefault();
    var form = document.getElementById('relForm');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    var editId = document.getElementById('relEditId').value;
    var fromId = parseInt(document.getElementById('relFromChar').value);
    var toId = parseInt(document.getElementById('relToChar').value);
    if (fromId === toId) { showToast('不能选择同一个角色', 'error'); return; }
    var data = {
      from_char_id: fromId, to_char_id: toId,
      relation_type: document.getElementById('relType').value.trim(),
      description: document.getElementById('relDesc').value.trim()
    };
    var url = editId ? API_REL + '/' + editId : API_REL;
    var method = editId ? 'PUT' : 'POST';
    fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || '操作失败'); });
      _autoSaveInProgress = true;
      closeModal(); markAppDataChanged(); loadData(); showToast(editId ? '已更新' : '已创建', 'success');
      setTimeout(function() { _autoSaveInProgress = false; }, 800);
    }).catch(function(e) { showToast(e.message || '操作失败', 'error'); });
  }

  function openDeleteModal(id, info) {
    deleteTargetId = id;
    document.getElementById('relDeleteInfo').textContent = info;
    document.getElementById('relDeleteOverlay').classList.add('active');
  }
  function closeDeleteModal() { document.getElementById('relDeleteOverlay').classList.remove('active'); deleteTargetId = null; }
  function confirmDelete() {
    if (!deleteTargetId) return;
    fetch(API_REL + '/' + deleteTargetId, { method: 'DELETE' }).then(function() {
      closeDeleteModal(); markAppDataChanged(); loadData(); showToast('已删除', 'success');
    }).catch(function() { showToast('删除失败', 'error'); });
  }
  function closeModal() {
    document.getElementById('relModalOverlay').classList.remove('active');
  }

  function closeModalAutoSave() {
    if (_autoSaveInProgress) {
      _autoSaveInProgress = false;
      document.getElementById('relModalOverlay').classList.remove('active');
      return;
    }
    var fromId = document.getElementById('relFromChar').value;
    var toId = document.getElementById('relToChar').value;
    if (fromId && toId) {
      submitForm({ preventDefault: function() {} });
      setTimeout(function() {
        document.getElementById('relModalOverlay').classList.remove('active');
      }, 500);
      return;
    }
    document.getElementById('relModalOverlay').classList.remove('active');
  }

  function cancelEdit() {
    _autoSaveInProgress = false;
    document.getElementById('relModalOverlay').classList.remove('active');
  }
  window.cancelEditRel = cancelEdit;
  window.closeModalAutoSaveRel = closeModalAutoSave;

  function infoRow(l, v) {
    if (!v) return '';
    return '<div class="oc-kv" style="display:flex;padding:7px 0;border-bottom:1px solid var(--border);gap:8px;"><span style="flex:0 0 84px;color:var(--text-light);font-size:.82rem;">' + esc(l) + '</span><span style="flex:1;font-size:.88rem;white-space:pre-wrap;line-height:1.5;word-break:break-word;">' + v + '</span></div>';
  }
  function showCharInfo(charId) {
    infoCharId = charId;
    fetch(API_CHAR + '/' + charId).then(function(r) { return r.json(); }).then(function(c) {
      document.getElementById('relInfoName').textContent = c.name;
      var body = '<div style="padding:4px 0;">';
      body += infoRow('代表高校', esc(c.university));
      body += infoRow('地区', esc(c.region));
      body += infoRow('诞生地', esc(c.birthplace));
      body += infoRow('性别', esc(c.gender));
      body += infoRow('身高', esc(c.height));
      body += infoRow('生日', esc(c.birthday));
      body += infoRow('诞生时间', esc(c.birth_time));
      body += infoRow('身份存在时间', esc(c.identity_period));
      body += infoRow('存在状态', esc(c.status));
      body += infoRow('取名依据', esc(c.naming_rationale));
      body += infoRow('外貌', esc(c.appearance));
      if (c.family) {
        var fams = splitFamilies(c.family);
        body += infoRow('家族', fams.map(function(f) {
          var fc = gFamilyColorMap[f] || '#8b5e3c';
          return '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;"><span style="display:inline-block;background:' + fc + ';width:10px;height:10px;border-radius:50%;"></span>' + esc(f) + '</span>';
        }).join(''));
      }
      if (c.setting) body += infoRow('设定', esc(c.setting));
      body += '</div>';
      document.getElementById('relInfoBody').innerHTML = body || '<p style="color:var(--text-light);text-align:center;">暂无详细信息</p>';
      document.getElementById('relInfoOverlay').classList.add('active');
    }).catch(function() { showToast('获取角色信息失败', 'error'); });
  }
  function startRelationFromInfo() {
    if (infoCharId) { selectedFromCharId = infoCharId; closeInfoModal(); openCreateModal(); }
  }
  function closeInfoModal() { document.getElementById('relInfoOverlay').classList.remove('active'); infoCharId = null; }

  function openFamilyModal() {
    familyEditMap = {};
    allCharacters.forEach(function(c) { familyEditMap[c.id] = c.family || ''; });
    var af = new Set();
    allCharacters.forEach(function(c) { splitFamilies(c.family).forEach(function(f) { af.add(f); }); });
    var doo = ''; af.forEach(function(f) { doo += '<option value="' + esc(f) + '">'; });
    var body = document.getElementById('relFamilyBody');
    if (allCharacters.length === 0) {
      body.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:20px;">先添加角色才能管理家族</p>';
    } else {
      body.innerHTML = allCharacters.map(function(c) {
        var fams = splitFamilies(c.family);
        var dots = fams.map(function(f) { return '<span class="fam-dot" style="background:' + (gFamilyColorMap[f] || '#ccc') + '" title="' + esc(f) + '"></span>'; }).join('');
        return '<div class="fam-row"><span class="fam-row-name">' + esc(c.name) + '</span><input type="text" class="fam-row-input" data-char-id="' + c.id + '" value="' + esc(c.family || '') + '" placeholder="多个用、分隔" list="famS_' + c.id + '"><datalist id="famS_' + c.id + '">' + doo + '</datalist><span class="fam-dots">' + dots + '</span></div>';
      }).join('');
      body.querySelectorAll('.fam-row-input').forEach(function(inp) {
        inp.addEventListener('input', function() { familyEditMap[parseInt(this.dataset.charId)] = this.value.trim(); });
      });
    }
    document.getElementById('relFamilyOverlay').classList.add('active');
  }
  function closeFamilyModal() { document.getElementById('relFamilyOverlay').classList.remove('active'); }
  function saveFamilies() {
    var success = 0, fail = 0, pending = 0;
    for (var cid in familyEditMap) {
      var nf = familyEditMap[cid].trim();
      var ch = allCharacters.find(function(c) { return c.id === parseInt(cid); });
      if (!ch || (ch.family || '').trim() === nf) continue;
      pending++;
      (function(charId, newFamily, char) {
        fetch(API_CHAR + '/' + charId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ family: newFamily }) }).then(function(r) {
          if (r.ok) { char.family = newFamily; success++; } else fail++;
        }).catch(function() { fail++; }).finally(function() {
          pending--;
          if (pending === 0) finishFamilySave(success, fail);
        });
      })(parseInt(cid), nf, ch);
    }
    if (pending === 0) { closeFamilyModal(); showToast('没有变更', 'success'); }
  }
  function finishFamilySave(success, fail) {
    closeFamilyModal();
    buildFamilyColors();
    markAppDataChanged();   // 家族已改：其它视图下次进入时重新取数据
    graphInit(); renderRelList();
    showToast('家族更新：' + success + ' 成功' + (fail ? '，' + fail + ' 失败' : ''), fail ? 'error' : 'success');
  }

  function buildTypeTabs() {
    var ct = document.getElementById('typeTabs');
    if (!ct) return;
    var counts = {};
    REL_TYPES.forEach(function(t) { counts[t] = 0; });
    allRelations.forEach(function(r) { if (r.relation_type && counts[r.relation_type] !== undefined) counts[r.relation_type]++; });
    var h = '<button class="type-tab' + (activeType === '全部' ? ' active' : '') + '" onclick="VM.relations.selectType(\'全部\')">全部<span class="tab-count">' + allRelations.length + '</span></button>';
    REL_TYPES.filter(function(t) { return counts[t] > 0; }).sort(function(a, b) { return counts[b] - counts[a]; }).forEach(function(t) {
      h += '<button class="type-tab' + (activeType === t ? ' active' : '') + '" onclick="VM.relations.selectType(\'' + t + '\')">' + t + '<span class="tab-count">' + counts[t] + '</span></button>';
    });
    ct.innerHTML = h;
  }
  function selectType(type) {
    activeType = type;
    document.querySelectorAll('#view-relations .type-tab').forEach(function(t) { t.classList.remove('active'); });
    var tab = document.querySelector('#view-relations .type-tab[onclick="VM.relations.selectType(\'' + type + '\')"]');
    if (tab) tab.classList.add('active');
    renderRelList();
  }

  function enterExportMode() { exportMode = true; selectedIds.clear(); document.body.classList.add('export-mode'); renderRelList(); }
  function cancelExport() { exportMode = false; selectedIds.clear(); document.body.classList.remove('export-mode'); renderRelList(); }
  function toggleCardClick(id) {
    var cb = document.querySelector('.rel-card[data-rel-id="' + id + '"] .rel-check');
    if (cb) { cb.checked = !cb.checked; toggleCardSelect(id, cb.checked); }
  }
  function toggleCardSelect(id, checked) {
    if (checked) selectedIds.add(id); else selectedIds.delete(id);
    var card = document.querySelector('.rel-card[data-rel-id="' + id + '"]');
    if (card) card.classList.toggle('selected', checked);
    updateExportButtons();
  }
  // 只把勾选态刷到已有 DOM 上，不整表重建：全选时重建整页会明显卡顿。
  function syncSelectionToDom() {
    document.querySelectorAll('#relList .rel-card[data-rel-id]').forEach(function(card) {
      var on = selectedIds.has(parseInt(card.dataset.relId, 10));
      card.classList.toggle('selected', on);
      var cb = card.querySelector('.rel-check'); if (cb) cb.checked = on;
    });
    updateExportButtons();
  }
  function toggleSelectAll() {
    var cards = document.querySelectorAll('#relList .rel-card[data-rel-id]');
    if (cards.length === 0) return;
    var vi = []; cards.forEach(function(c) { vi.push(parseInt(c.dataset.relId, 10)); });
    var as = vi.every(function(id) { return selectedIds.has(id); });
    if (as) vi.forEach(function(id) { selectedIds.delete(id); });
    else vi.forEach(function(id) { selectedIds.add(id); });
    syncSelectionToDom();
  }
  function updateExportButtons() {
    var btn = document.getElementById('relConfirmExportBtn');
    if (!btn) return;
    btn.disabled = selectedIds.size === 0;
    btn.textContent = selectedIds.size > 0 ? '确认导出 (' + selectedIds.size + ')' : '确认导出';
  }
  function confirmExport() {
    if (selectedIds.size === 0) return;
    var sel = allRelations.filter(function(r) { return selectedIds.has(r.id); });
    var ed = sel.map(mapRelExport);
    var js = JSON.stringify(ed, null, 2);
    var fn = '关系网_' + sel.length + '条关系_' + new Date().toISOString().slice(0, 10) + '.json';
    saveExportFile(js, fn, '已导出 ' + sel.length + ' 条关系');
    cancelExport();
  }

  function moveRelUp(id) {
    var idx = allRelations.findIndex(function(r) { return r.id === id; });
    if (idx <= 0) return;
    var t = allRelations[idx - 1]; allRelations[idx - 1] = allRelations[idx]; allRelations[idx] = t;
    saveRelOrder(); renderRelList();
  }
  function moveRelDown(id) {
    var idx = allRelations.findIndex(function(r) { return r.id === id; });
    if (idx < 0 || idx >= allRelations.length - 1) return;
    var t = allRelations[idx + 1]; allRelations[idx + 1] = allRelations[idx]; allRelations[idx] = t;
    saveRelOrder(); renderRelList();
  }

  function _tdGetItems() { return [].slice.call(_tdListEl.querySelectorAll('[data-drag-id]:not(.dragging)')); }
  function _tdFindTargetIdx(y) {
    var bi = _tdIdx, bd = Infinity;
    _tdGetItems().forEach(function(item) {
      var r = item.getBoundingClientRect(), mid = r.top + r.height / 2, d = Math.abs(y - mid);
      if (d < bd) { bd = d; bi = parseInt(item.dataset.dragIdx); }
    });
    return bd < 40 ? bi : _tdIdx;
  }
  function _tdCreateGhost() {
    if (!_tdEl) return;
    var r = _tdEl.getBoundingClientRect();
    _tdGhost = _tdEl.cloneNode(true);
    _tdGhost.style.cssText = 'position:fixed;z-index:9999;width:' + r.width + 'px;left:' + r.left + 'px;top:' + (_tdCurY - r.height / 2) + 'px;opacity:0.94;transform:scale(1.03);box-shadow:0 8px 28px rgba(0,0,0,.2);pointer-events:none;transition:none;border-radius:12px;background:#fffef9;';
    document.body.appendChild(_tdGhost);
    _tdEl.classList.add('dragging');
  }
  function _tdSwap(a, b) { if (a === b) return; var i = allRelations.splice(a, 1)[0]; allRelations.splice(b, 0, i); }
  function initTouchDrag() {
    _tdListEl = document.getElementById('relList');
    if (!_tdListEl) return;
    _tdListEl.addEventListener('touchstart', function(ev) {
      var h = ev.target.closest('.drag-handle'); if (!h) return;
      var c = h.closest('[data-drag-id]'); if (!c) return;
      _tdEl = c; _tdIdx = parseInt(c.dataset.dragIdx);
      _tdStartX = ev.touches[0].clientX; _tdStartY = ev.touches[0].clientY; _tdCurY = _tdStartY;
      _tdTimer = setTimeout(function() { _tdEnabled = true; _tdCreateGhost(); if (navigator.vibrate) navigator.vibrate(10); }, 400);
    }, { passive: false });
    _tdListEl.addEventListener('touchmove', function(ev) {
      if (!_tdEnabled) {
        if (_tdTimer && (Math.abs(ev.touches[0].clientY - _tdStartY) > 8 || Math.abs(ev.touches[0].clientX - _tdStartX) > 8)) { clearTimeout(_tdTimer); _tdTimer = null; _tdEl = null; _tdIdx = -1; }
        return;
      }
      ev.preventDefault();
      _tdCurY = ev.touches[0].clientY;
      if (_tdGhost) _tdGhost.style.top = (_tdCurY - _tdGhost.offsetHeight / 2) + 'px';
      var edge = 70;
      if (_tdCurY < edge) window.scrollBy(0, -6);
      else if (_tdCurY > window.innerHeight - edge) window.scrollBy(0, 6);
      var ni = _tdFindTargetIdx(_tdCurY);
      if (ni !== _tdIdx) { _tdSwap(_tdIdx, ni); _tdIdx = ni; renderRelList();
        var nc = _tdListEl.querySelector('[data-drag-idx="' + _tdIdx + '"]');
        if (nc) { _tdEl = nc; _tdEl.classList.add('dragging'); }
        if (_tdGhost) { _tdGhost.remove(); _tdCreateGhost(); }
      }
    }, { passive: false });
    _tdListEl.addEventListener('touchend', _tdEndDrag); _tdListEl.addEventListener('touchcancel', _tdEndDrag);
  }
  function _tdEndDrag() {
    clearTimeout(_tdTimer); _tdTimer = null;
    if (_tdEnabled) { _tdEnabled = false; if (_tdGhost) { _tdGhost.remove(); _tdGhost = null; } if (_tdEl) { _tdEl.classList.remove('dragging'); _tdEl = null; } saveRelOrder(); renderRelList(); }
    _tdEl = null; _tdIdx = -1;
  }
  function saveRelOrder() {
    fetch(API_REL + '/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: allRelations.map(function(r, i) { return { id: r.id, sort_order: i }; }) }) }).catch(function() {});
    markAppDataChanged();   // 顺序已变：其它视图下次进入时重新取数据
  }

  // ====== Graph ======
  // 预先建立节点/家族索引：布局每步不再做线性 find，也不再重复拆分家族字符串。
  function indexGraphNodes() {
    gNodeIndex = new Map();
    gNodeFams = new Map();
    for (var i = 0; i < gNodes.length; i++) {
      var n = gNodes[i];
      gNodeIndex.set(n.id, n);
      gNodeFams.set(n.id, splitFamilies(n.family));
    }
  }

  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function layoutVisible() {
    var view = document.getElementById('view-relations');
    return !view || view.style.display !== 'none';   // 隐藏页不持续布局
  }

  function cancelLayout() {
    gLayout.epoch++;
    gLayout.running = false;
    gLayout.paused = false;
    if (gLayout.timer !== null) { clearTimeout(gLayout.timer); gLayout.timer = null; }
  }

  // 每块约 8ms，然后让出事件循环，避免长时间阻塞主线程；epoch 变化即取消旧布局。
  function layoutTick(epoch) {
    if (epoch !== gLayout.epoch || !gLayout.running) return;
    gLayout.timer = null;
    if (!layoutVisible()) { gLayout.paused = true; return; }
    var started = nowMs();
    while (gLayout.step < gLayout.total) {
      gSimulateStep(1 - gLayout.step / gLayout.total);
      gLayout.step++;
      if (nowMs() - started >= gLayout.budgetMs) break;
    }
    if (gLayout.step >= gLayout.total) {
      gLayout.running = false;
      graphDraw();
      return;
    }
    gLayout.timer = setTimeout(function() { layoutTick(epoch); }, 0);
  }

  function startLayout() {
    cancelLayout();
    gLayout.running = true;
    gLayout.step = 0;
    layoutTick(gLayout.epoch);
  }

  // 重新进入页面时恢复被暂停的布局（进度保留）。
  function resumeLayout() {
    if (!gLayout.running || !gLayout.paused) return;
    gLayout.paused = false;
    var epoch = gLayout.epoch;
    gLayout.timer = setTimeout(function() { layoutTick(epoch); }, 0);
  }

  function gSimulateStep(cooling) {
    var k = 110, repulsion = 6000, spring = 0.015, cg = 0.001;
    for (var i = 0; i < gNodes.length; i++) {
      for (var j = i + 1; j < gNodes.length; j++) {
        var dx = gNodes[j].x - gNodes[i].x, dy = gNodes[j].y - gNodes[i].y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        dist = Math.max(dist, 15);
        var force = repulsion / (dist * dist), fx = (dx / dist) * force * cooling, fy = (dy / dist) * force * cooling;
        if (!gNodes[i].fixed) { gNodes[i].vx -= fx; gNodes[i].vy -= fy; }
        if (!gNodes[j].fixed) { gNodes[j].vx += fx; gNodes[j].vy += fy; }
      }
    }
    gEdges.forEach(function(e) {
      var a = gNodeIndex.get(e.from);
      var b = gNodeIndex.get(e.to);
      if (!a || !b) return;
      var dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
      var force = (dist - k) * spring * cooling, fx = (dx / dist) * force, fy = (dy / dist) * force;
      if (!a.fixed) { a.vx += fx; a.vy += fy; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    });
    var famK = 70, famSpring = 0.02;
    for (var i = 0; i < gNodes.length; i++) {
      for (var j = i + 1; j < gNodes.length; j++) {
        var a = gNodes[i], b = gNodes[j];
        var aFams = gNodeFams.get(a.id) || [], bFams = gNodeFams.get(b.id) || [];
        var linked = false;
        for (var fa = 0; fa < aFams.length && !linked; fa++) {
          if (bFams.indexOf(aFams[fa]) !== -1) linked = true;
        }
        if (!linked) continue;
        var dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        var force = (dist - famK) * famSpring * cooling, fx = (dx / dist) * force, fy = (dy / dist) * force;
        if (!a.fixed) { a.vx += fx; a.vy += fy; }
        if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
      }
    }
    gNodes.forEach(function(n) {
      if (n.fixed) return;
      n.vx += (gW / 2 - n.x) * cg * cooling; n.vy += (gH / 2 - n.y) * cg * cooling;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx * cooling; n.y += n.vy * cooling;
    });
  }

  function gCross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  function gConvexHull(pts) {
    if (pts.length <= 2) return pts;
    var sorted = pts.slice().sort(function(a, b) { return a.x - b.x || a.y - b.y; });
    var lower = [];
    sorted.forEach(function(p) { while (lower.length >= 2 && gCross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); });
    var upper = [];
    for (var i = sorted.length - 1; i >= 0; i--) { var p = sorted[i]; while (upper.length >= 2 && gCross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function computeLabelOffsets(edgeArr) {
    var key = function(f, t) { return f < t ? f + '-' + t : t + '-' + f; };
    var groups = {};
    edgeArr.forEach(function(e, i) { var k = key(e.from, e.to); if (!groups[k]) groups[k] = []; groups[k].push(i); });
    var offsets = new Array(edgeArr.length).fill(0);
    for (var k in groups) { var indices = groups[k], n = indices.length; if (n <= 1) continue; indices.forEach(function(idx, ki) { offsets[idx] = (ki - (n - 1) / 2) * 2; }); }
    return offsets;
  }

  function drawFamilyClusters() {
    var fp = {};
    gNodes.forEach(function(n) { nodeFamilies(n).forEach(function(fam) { if (!fp[fam]) fp[fam] = []; fp[fam].push({ x: n.x, y: n.y }); }); });
    var pad = 18, nr = 16;
    for (var fam in fp) {
      var pts = fp[fam], color = gFamilyColorMap[fam] || '#8b5e3c';
      if (pts.length < 1) continue;
      if (pts.length === 1) {
        var r = nr + pad;
        gCtx.beginPath(); gCtx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
        gCtx.fillStyle = color + '14'; gCtx.fill();
        gCtx.strokeStyle = color + '66'; gCtx.lineWidth = 1.5; gCtx.setLineDash([5, 3]); gCtx.stroke(); gCtx.setLineDash([]);
        gCtx.fillStyle = color; gCtx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif'; gCtx.textAlign = 'center'; gCtx.textBaseline = 'bottom';
        gCtx.fillText(fam, pts[0].x, pts[0].y - r - 4);
        continue;
      }
      var periPts = [], samples = 8;
      pts.forEach(function(p) { for (var i = 0; i < samples; i++) { var a = (2 * Math.PI * i) / samples; periPts.push({ x: p.x + (nr + pad) * Math.cos(a), y: p.y + (nr + pad) * Math.sin(a) }); } });
      var hull = gConvexHull(periPts);
      if (hull.length < 3) {
        if (hull.length === 2) { gCtx.beginPath(); gCtx.moveTo(hull[0].x, hull[0].y); gCtx.lineTo(hull[1].x, hull[1].y); gCtx.strokeStyle = color + '66'; gCtx.lineWidth = (nr + pad) * 2; gCtx.lineCap = 'round'; gCtx.globalAlpha = 0.5; gCtx.stroke(); gCtx.globalAlpha = 1; gCtx.lineCap = 'butt'; }
        continue;
      }
      gCtx.beginPath(); gCtx.moveTo(hull[0].x, hull[0].y);
      for (var i = 1; i < hull.length; i++) gCtx.lineTo(hull[i].x, hull[i].y);
      gCtx.closePath();
      gCtx.fillStyle = color + '0F'; gCtx.fill();
      gCtx.strokeStyle = color + '66'; gCtx.lineWidth = 1.5; gCtx.setLineDash([5, 3]); gCtx.stroke(); gCtx.setLineDash([]);
      var cx = 0, cy = 0, topY = Infinity;
      hull.forEach(function(p) { cx += p.x; cy += p.y; topY = Math.min(topY, p.y); });
      cx /= hull.length; cy /= hull.length;
      gCtx.fillStyle = color; gCtx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif'; gCtx.textAlign = 'center'; gCtx.textBaseline = 'bottom';
      gCtx.fillText(fam, cx, topY - 4);
    }
  }

  function graphDraw() {
    if (!gCtx) return;
    gCtx.clearRect(0, 0, gW, gH);
    gCtx.save(); gCtx.translate(gOffsetX, gOffsetY); gCtx.scale(gScale, gScale);
    drawFamilyClusters();
    // 聚焦集合：边和节点共用一份，避免重复计算
    var gFocusSet = gFocusId != null ? computeGFocusSet(gFocusId) : null;
    var lo = computeLabelOffsets(gEdges);
    gEdges.forEach(function(e, i) {
      var a = gNodeIndex.get(e.from), b = gNodeIndex.get(e.to);
      if (!a || !b) return;
      // 聚焦时：不连着选中角色的边压暗，让关系走向一眼可见
      var edgeRelevant = !gFocusSet || gFocusSet.has(e.from) || gFocusSet.has(e.to);
      var edgeAlpha = edgeRelevant ? 1 : G_FOCUS_DIM;
      var isB = ['CP', '朋友', '冤家', '亲属'].indexOf(e.type) !== -1, isT = e.type === '师生';
      var color = isB ? '#c2185b' : isT ? '#1565c0' : '#8b5e3c';
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len, nr = gNodeR(), as_ = 7;
      var sx = a.x + ux * nr, sy = a.y + uy * nr, ex = b.x - ux * nr, ey = b.y - uy * nr;
      gCtx.strokeStyle = color; gCtx.globalAlpha = 0.7 * edgeAlpha; gCtx.lineWidth = isB ? 2.5 : 1.8;
      if (isT) gCtx.setLineDash([6, 4]);
      gCtx.beginPath(); gCtx.moveTo(sx, sy); gCtx.lineTo(ex, ey); gCtx.stroke(); gCtx.setLineDash([]);
      gCtx.globalAlpha = 0.9 * edgeAlpha; gCtx.fillStyle = color;
      gCtx.beginPath(); gCtx.moveTo(ex, ey);
      gCtx.lineTo(ex - ux * as_ - uy * as_ * 0.6, ey - uy * as_ + ux * as_ * 0.6);
      gCtx.lineTo(ex - ux * as_ + uy * as_ * 0.6, ey - uy * as_ - ux * as_ * 0.6);
      gCtx.closePath(); gCtx.fill();
      if (isB) { gCtx.beginPath(); gCtx.moveTo(sx, sy); gCtx.lineTo(sx + ux * as_ - uy * as_ * 0.6, sy + uy * as_ + ux * as_ * 0.6); gCtx.lineTo(sx + ux * as_ + uy * as_ * 0.6, sy + uy * as_ - ux * as_ * 0.6); gCtx.closePath(); gCtx.fill(); }
      if (e.type) {
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, px_ = -uy, py_ = ux;
        var off = (lo[i] || 0) * 12, lx = mx + px_ * off, ly = my + py_ * off;
        gCtx.globalAlpha = 0.9 * edgeAlpha; gCtx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif';
        var tw = gCtx.measureText(e.type).width;
        gCtx.fillStyle = themeVar('--canvas-label-bg','#fffef9'); gCtx.fillRect(lx - tw / 2 - 3, ly - 7, tw + 6, 14);
        gCtx.fillStyle = color; gCtx.textAlign = 'center'; gCtx.textBaseline = 'middle'; gCtx.fillText(e.type, lx, ly);
      }
      gCtx.globalAlpha = 1;
    });
    gNodes.forEach(function(n) {
      var fc = nodeFamilyColor(n);
      var av = gAvatarCache.get(n.id);
      var r = gNodeR();
      // 聚焦时：与选中角色无关的节点整体压暗
      var relevant = !gFocusSet || gFocusSet.has(n.id);
      gCtx.globalAlpha = relevant ? 1 : G_FOCUS_DIM;
      // 底圆：无头像时是家族色圆；有头像时也先铺一层，防止图片未就绪时透出画布。
      gCtx.beginPath(); gCtx.arc(n.x, n.y, r, 0, Math.PI * 2);
      gCtx.fillStyle = n === gDragNode ? '#c49a6c' : fc; gCtx.fill();
      if (av) {
        // 头像按圆形裁进节点圆内（图片本身已是圆形画布，直接缩放贴入即可）
        gCtx.save();
        gCtx.beginPath(); gCtx.arc(n.x, n.y, r, 0, Math.PI * 2); gCtx.clip();
        gCtx.drawImage(av, n.x - r, n.y - r, r * 2, r * 2);
        gCtx.restore();
      }
      // 家族色描边（有头像时也保留，用于区分家族）
      gCtx.beginPath(); gCtx.arc(n.x, n.y, r, 0, Math.PI * 2);
      gCtx.strokeStyle = themeVar('--stroke-ring','#fffef9'); gCtx.lineWidth = 2; gCtx.stroke();
      // 聚焦态：选中的本人再加一圈醒目虚线环，和「相关的人」区分开
      if (gFocusId != null && n.id === gFocusId) {
        gCtx.beginPath(); gCtx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
        gCtx.strokeStyle = themeVar('--accent', '#8b5e3c'); gCtx.lineWidth = 2.5;
        gCtx.setLineDash([5, 3]); gCtx.stroke(); gCtx.setLineDash([]);
      }
      // 节点名称画在彩色圆外，取主题正文色：浅色主题深字、深色主题浅字，避免与画布同色看不见
      // 字号与偏移随节点半径缩放，否则大屏上标签会贴着大圆、显得过小
      gCtx.fillStyle = themeVar('--text','#3d2b1f'); gCtx.font = Math.round(r * 0.69) + 'px "PingFang SC","Microsoft YaHei",sans-serif'; gCtx.textAlign = 'center'; gCtx.textBaseline = 'top';
      var label = n.name || ('#' + n.id); if (label.length > 5) label = label.slice(0, 4) + '…';
      gCtx.fillText(label, n.x, n.y + r + 4);
      gCtx.globalAlpha = 1;   // 每个节点画完复位
    });
    gCtx.restore();
  }

  function screenToCanvas(x, y) { return { x: (x - gOffsetX) / gScale, y: (y - gOffsetY) / gScale }; }
  function nodeAt(x, y) { var tol = gNodeR() + 6; for (var i = gNodes.length - 1; i >= 0; i--) { var n = gNodes[i], dx = x - n.x, dy = y - n.y; if (dx * dx + dy * dy <= tol * tol) return n; } return null; }

  function onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      var rect = gCanvas.getBoundingClientRect(), x = e.touches[0].clientX - rect.left, y = e.touches[0].clientY - rect.top;
      gTouchStartX = x; gTouchStartY = y; gTouchMoved = false;
      var p = screenToCanvas(x, y), node = nodeAt(p.x, p.y);
      if (node) { gDragNode = node; node.fixed = true; }
      else { gPanning = true; gLastX = x; gLastY = y; }
    } else if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      gLastTouchDist = Math.sqrt(dx * dx + dy * dy); gDragNode = null; gPanning = false;
    }
  }
  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      var rect = gCanvas.getBoundingClientRect(), x = e.touches[0].clientX - rect.left, y = e.touches[0].clientY - rect.top;
      var dx = x - gTouchStartX, dy = y - gTouchStartY;
      if (dx * dx + dy * dy > G_DBL_TAP_MOVE_TOL * G_DBL_TAP_MOVE_TOL) gTouchMoved = true;
      if (gDragNode) { var p = screenToCanvas(x, y); gDragNode.x = p.x; gDragNode.y = p.y; gDragNode.vx = 0; gDragNode.vy = 0; graphDraw(); }
      else if (gPanning) { gOffsetX += x - gLastX; gOffsetY += y - gLastY; gLastX = x; gLastY = y; graphDraw(); }
    } else if (e.touches.length === 2) {
      gTouchMoved = true;
      var dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (gLastTouchDist > 0) { gScale = Math.max(0.3, Math.min(3, gScale * (dist / gLastTouchDist))); graphDraw(); }
      gLastTouchDist = dist;
    }
  }
  function onTouchEnd(e) {
    if (e.touches.length === 0) {
      if (!gTouchMoved) {
        var p = screenToCanvas(gTouchStartX, gTouchStartY), node = nodeAt(p.x, p.y);
        if (node) {
          var now = Date.now();
          if (gLastTapNodeId === node.id && (now - gLastTapTime) < G_DBL_TAP_DELAY) {
            // 双击 = 查看角色信息（恒定行为，不加别的分叉）+ 顺手聚焦
            showCharInfo(node.id);
            setGFocus(node.id);
            gLastTapTime = 0; gLastTapNodeId = null;
          } else {
            // 单击 = 聚焦高亮（与桌面版语义一致）
            toggleGFocus(node.id);
            gLastTapTime = now; gLastTapNodeId = node.id;
          }
        } else {
          // 点空白 = 取消聚焦
          clearGFocus();
          gLastTapTime = 0; gLastTapNodeId = null;
        }
      }
      if (gDragNode) { gDragNode.fixed = false; gDragNode = null; }
      gPanning = false; gLastTouchDist = 0;
    }
  }
  function onMouseDown(e) {
    var rect = gCanvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    var p = screenToCanvas(x, y), node = nodeAt(p.x, p.y);
    gMousePanMoved = false;
    if (node) {
      gDragNode = node; node.fixed = true; gDragging = true;
      gMouseDownNodeX = node.x; gMouseDownNodeY = node.y;   // 判断是否算"拖动"的基准
    } else { gPanning = true; gLastX = x; gLastY = y; }
  }
  function onMouseMove(e) {
    if (!gDragging && !gPanning) return;
    var rect = gCanvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (gDragNode) { var p = screenToCanvas(x, y); gDragNode.x = p.x; gDragNode.y = p.y; graphDraw(); }
    else if (gPanning) {
      if (Math.abs(x - gLastX) > 3 || Math.abs(y - gLastY) > 3) gMousePanMoved = true;
      gOffsetX += x - gLastX; gOffsetY += y - gLastY; gLastX = x; gLastY = y; graphDraw();
    }
  }
  function onMouseUp() {
    if (gDragNode) {
      // 拖动过半个身位才算"拖"，否则按点击处理（避免想点却因手抖变成拖动、
      // 结果既没聚焦又挪了位置）。
      var moved = Math.abs(gDragNode.x - gMouseDownNodeX) > 3 || Math.abs(gDragNode.y - gMouseDownNodeY) > 3;
      if (!moved) toggleGFocus(gDragNode.id);
      gDragNode.fixed = false; gDragNode = null;
    } else if (gPanning && !gMousePanMoved) {
      clearGFocus();   // 点空白取消聚焦
    }
    gDragging = false; gPanning = false; gMousePanMoved = false;
  }
  function onWheel(e) { e.preventDefault(); gScale = Math.max(0.3, Math.min(3, gScale * (e.deltaY < 0 ? 1.1 : 0.9))); graphDraw(); }

  // ---- 节点头像：把 face_crop.img 指定的那张图按 face_crop 裁成圆形画布并缓存 ----
  // 返回缓存里的 Image（含已裁好的圆形内容）或 null（无图/无取脸/加载失败）。
  // drawAvatar 只读缓存、绝不同步发起加载，避免拖拽重绘时反复卡顿。
  // 取脸图引用优先用 faceRef（names 投影带出的、face_crop.img 指向的那张），
  // 完整记录没有 faceRef 时退回首图 firstRef —— 与 face_crop.img 同源，语义一致。
  function avatarRefOf(c) {
    return (c && (c.faceRef || c.firstRef)) || '';
  }
  function avatarKey(c) {
    var ref = avatarRefOf(c);
    if (!c || !c.face_crop || !ref) return '';
    return ref + '|' + c.face_crop;
  }

  function loadAvatars() {
    if (!window.FaceCrop) return;
    allCharacters.forEach(function(c) {
      var key = avatarKey(c);
      if (!key) { gAvatarCache.delete(c.id); gAvatarSig.delete(c.id); return; }
      if (gAvatarSig.get(c.id) === key) return;   // 已加载/在途：不重复
      gAvatarSig.set(c.id, key);
      var crop = FaceCrop.parse(c.face_crop);
      var src = safeImageSrc(avatarRefOf(c));
      if (!crop || !src) { gAvatarCache.set(c.id, null); return; }
      var im = new Image();
      im.onload = function() {
        FaceCrop.cropToCanvas(im, crop, 96).then(function(cv) {
          // 直接把圆形画布存进缓存（不走 toDataURL）：Android 端图片来自
          // appassets.androidplatform.net，对 file:// 页面而言是跨域，toDataURL 会因
          // canvas 被污染而抛错；canvas 本身可直接被 drawImage 使用。
          gAvatarCache.set(c.id, cv || null);
          if (gNodes.length) graphDraw();
        });
      };
      im.onerror = function() { gAvatarCache.set(c.id, null); };
      im.src = src;
    });
  }

  function graphInit() {
    gCanvas = document.getElementById('graphCanvas');
    var wrap = document.getElementById('canvasWrap'), empty = document.getElementById('graphEmpty');
    if (!gCanvas || !wrap) return;
    buildFamilyColors();
    if (allCharacters.length === 0) { empty.style.display = 'flex'; empty.textContent = '先添加角色'; if (gCtx) gCtx.clearRect(0, 0, gW, gH); return; }
    empty.style.display = 'none';
    gW = wrap.clientWidth; gH = wrap.clientHeight;
    gDpr = window.devicePixelRatio || 1;
    gCanvas.width = gW * gDpr; gCanvas.height = gH * gDpr;
    gCanvas.style.width = gW + 'px'; gCanvas.style.height = gH + 'px';
    gCtx = gCanvas.getContext('2d'); gCtx.setTransform(gDpr, 0, 0, gDpr, 0, 0);
    // 本轮 edges 先设置好，初次布局才会用到本轮关系。
    gEdges = allRelations.map(function(r) { return { from: r.from_char_id, to: r.to_char_id, type: r.relation_type || '' }; });
    var existingIds = new Set(gNodes.map(function(n) { return n.id; }));
    var currentIds = new Set(allCharacters.map(function(c) { return c.id; }));
    var needRelayout = existingIds.size !== currentIds.size;
    if (!needRelayout) currentIds.forEach(function(id) { if (!existingIds.has(id)) needRelayout = true; });
    if (needRelayout || gNodes.length === 0) {
      var bigW = gW * 2, bigH = gH * 2;
      var families = []; for (var k in gFamilyColorMap) families.push(k);
      var famCenters = {};
      families.forEach(function(fam, i) { var a = (i / Math.max(families.length, 1)) * Math.PI * 2; var r = Math.min(bigW, bigH) * 0.35; famCenters[fam] = { x: gW / 2 + r * Math.cos(a), y: gH / 2 + r * Math.sin(a) }; });
      gNodes = allCharacters.map(function(c) {
        var fams = splitFamilies(c.family), x, y;
        if (fams.length > 0 && famCenters[fams[0]]) { var center = famCenters[fams[0]]; x = center.x + (Math.random() - 0.5) * 80; y = center.y + (Math.random() - 0.5) * 80; }
        else { x = (gW - bigW) / 2 + Math.random() * bigW; y = (gH - bigH) / 2 + Math.random() * bigH; }
        return { id: c.id, name: c.name, family: c.family || '', x: x, y: y, vx: 0, vy: 0, fixed: false };
      });
      indexGraphNodes();
      loadAvatars();
      startLayout();   // 300 步按时间预算分块执行，期间让出事件循环
    } else {
      allCharacters.forEach(function(c) { var n = gNodeIndex.get(c.id) || gNodes.find(function(n) { return n.id === c.id; }); if (n) { n.name = c.name; n.family = c.family || ''; } });
      indexGraphNodes();
      loadAvatars();
      if (gLayout.running) resumeLayout(); else graphDraw();
    }
    if (!gCanvas._bound) {
      gCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
      gCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
      gCanvas.addEventListener('touchend', onTouchEnd);
      gCanvas.addEventListener('mousedown', onMouseDown); gCanvas.addEventListener('mousemove', onMouseMove);
      gCanvas.addEventListener('mouseup', onMouseUp); gCanvas.addEventListener('mouseleave', onMouseUp);
      gCanvas.addEventListener('wheel', onWheel, { passive: false });
      gCanvas._bound = true;
    }
    graphDraw();
  }

  function graphZoom(f) { gScale = Math.max(0.3, Math.min(3, gScale * f)); graphDraw(); }
  function graphReset() {
    gScale = 1; gOffsetX = 0; gOffsetY = 0; buildFamilyColors();
    var bigW = gW * 2, bigH = gH * 2;
    var families = []; for (var k in gFamilyColorMap) families.push(k);
    var famCenters = {};
    families.forEach(function(fam, i) { var a = (i / Math.max(families.length, 1)) * Math.PI * 2; var r = Math.min(bigW, bigH) * 0.35; famCenters[fam] = { x: gW / 2 + r * Math.cos(a), y: gH / 2 + r * Math.sin(a) }; });
    gNodes = allCharacters.map(function(c) {
      var fams = splitFamilies(c.family), x, y;
      if (fams.length > 0 && famCenters[fams[0]]) { var center = famCenters[fams[0]]; x = center.x + (Math.random() - 0.5) * 80; y = center.y + (Math.random() - 0.5) * 80; }
      else { x = (gW - bigW) / 2 + Math.random() * bigW; y = (gH - bigH) / 2 + Math.random() * bigH; }
      return { id: c.id, name: c.name, family: c.family || '', x: x, y: y, vx: 0, vy: 0, fixed: false };
    });
    gEdges = allRelations.map(function(r) { return { from: r.from_char_id, to: r.to_char_id, type: r.relation_type || '' }; });
    indexGraphNodes();
    startLayout();   // 重置：取消旧 generation，按 300 步重新分块布局
  }

  window.addEventListener('resize', function() {
    if (gCanvas && allCharacters.length > 0) {
      var wrap = document.getElementById('canvasWrap');
      var prevR = gNodeR();          // 必须在更新 gW/gH 之前取：这是旧尺寸对应的半径
      gW = wrap.clientWidth; gH = wrap.clientHeight;
      gCanvas.width = gW * gDpr; gCanvas.height = gH * gDpr;
      gCanvas.style.width = gW + 'px'; gCanvas.style.height = gH + 'px';
      gCtx.setTransform(gDpr, 0, 0, gDpr, 0, 0);
      // 半径档位跨档（手机↔平板，旋转/分屏都可能触发）：旧坐标是按旧半径排布的，
      // 直接换半径会让节点互相压住。这里保持各节点相对位置做一次等比缩放即可，
      // 不重新随机布局（否则用户拖过的位置会被打乱）。
      var newR = gNodeR();
      if (newR !== prevR && prevR > 0 && gNodes.length > 0) {
        var k = newR / prevR;
        gNodes.forEach(function(n) {
          // 以画布中心为原点做线性缩放，让节点间距随半径同步放大/缩小
          n.x = gW / 2 + (n.x - gW / 2) * k;
          n.y = gH / 2 + (n.y - gH / 2) * k;
        });
      }
      graphDraw();
    }
  });

  document.getElementById('relFamilyOverlay').addEventListener('click', function(ev) { if (ev.target === this) closeFamilyModal(); });
  document.getElementById('relInfoOverlay').addEventListener('click', function(ev) { if (ev.target === this) closeInfoModal(); });
  document.getElementById('relDeleteOverlay').addEventListener('click', function(ev) { if (ev.target === this) closeDeleteModal(); });

  function init() { initTouchDrag(); loadData(); }

  return {
    init: init, refresh: loadData,
    onSearch: onSearch, clearSearch: clearSearch,
    openCreateModal: openCreateModal, openEditModal: openEditModal, submitForm: submitForm,
    openDeleteModal: openDeleteModal, closeDeleteModal: closeDeleteModal, confirmDelete: confirmDelete,
    closeModal: closeModal, closeInfoModal: closeInfoModal, startRelationFromInfo: startRelationFromInfo,
    openFamilyModal: openFamilyModal, closeFamilyModal: closeFamilyModal, saveFamilies: saveFamilies,
    selectType: selectType,
    enterExportMode: enterExportMode, cancelExport: cancelExport,
    toggleCardClick: toggleCardClick, toggleCardSelect: toggleCardSelect, toggleSelectAll: toggleSelectAll, confirmExport: confirmExport,
    moveRelUp: moveRelUp, moveRelDown: moveRelDown,
    focusRelation: focusRelation,
    graphZoom: graphZoom, graphReset: graphReset,
    graphRedraw: graphDraw,
    setGFocus: setGFocus, clearGFocus: clearGFocus
  };
})();

// 从统计页榜单跳到对应详情（角色 / 世界观）。
// Android 是单页应用，这里不新开页面，而是切视图 + 打开该条目的详情弹窗；
// 并登记「来源 = 统计页」，用户关掉详情弹窗时切回统计页（像 [[文档]] 链接那样关掉就跳回去）。
//   openCharDetail(id) —— 切到角色视图并打开该角色详情
//   openWorldDetail(id) —— 先查该条目的 main_category，切好大类 tab，再打开详情
// 两个入口都做了「条目不存在」容错：详情模块内部 fetch 失败会 toast，不会弹空窗。
function openCharDetailFromStats(id) {
  if (id == null) return;
  navigateTo('index');                       // 会触发 VM.index.init()（首次）或 refresh()
  if (VM.index && VM.index.openDetailModal) VM.index.openDetailModal(id, 'stats');
}

// 统计页「关系度排行」点人名：切到关系网视图并聚焦该角色（高亮 ta 的家族 + 有关系的人）。
// 与上方 openCharDetailFromStats 区分：这里走关系网，不打开角色详情弹窗。
function openRelationFocusFromStats(id) {
  if (id == null) return;
  navigateTo('relations');                   // 触发 VM.relations.init()（首次）
  if (VM.relations && VM.relations.setGFocus) {
    VM.relations.setGFocus(id, { scrollToGraph: true });
  }
}

function openWorldDetailFromStats(id) {
  if (id == null) return;
  navigateTo('worldview');
  if (!VM.worldview || !VM.worldview.openDetailModal) return;
  // 世界观条目分两大类（意识体世界设定 / 人物背景故事），当前 tab 可能与目标不符。
  // 先拉单条拿 main_category，必要时切大类，再开详情——这样关掉详情后背后的列表也对。
  fetch('/api/world-buildings/' + id).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (e) {
    if (!e || e.id == null) throw new Error('bad payload');
    if (e.main_category && VM.worldview.getMainCategory &&
        e.main_category !== VM.worldview.getMainCategory()) {
      VM.worldview.selectMainCategory(e.main_category);
    }
    VM.worldview.openDetailModal(e.id, 'stats');
  }).catch(function () {
    showToast('找不到该设定，可能已被删除', 'error');
  });
}

// ======================== 总览统计 ========================
// 数据来自 fetch('/api/stats')：Android 端由 api-shim.js 直接聚合 IndexedDB，
// 口径与 server/backend.py 的 /api/stats 保持一致（改口径要三处同改）。
VM.stats = (function() {
  var API = '/api/stats';
  var loadedRevision = -1;
  var loading = false;

  var PALETTE = ['c1','c2','c3','c4','c5','c6','c7','c8'];
  function pickColor(i) { return PALETTE[i % PALETTE.length]; }
  function num(v) { return typeof v === 'number' ? v : 0; }

  // 横向条形图
  // 横向条形图。
  //   maxRows —— 超出则截断
  //   opts    —— { pct:false, unit:'字' }：不显示百分比，条尾显示原值 + 单位
  function barChart(items, total, maxRows, opts) {
    items = items || [];
    if (!items.length) return '<div class="stats-note">暂无数据</div>';
    opts = opts || {};
    var showPct = opts.pct !== false;      // 默认显示百分比
    var unit = opts.unit || '%';
    if (maxRows && items.length > maxRows) items = items.slice(0, maxRows);
    var sum = total || items.reduce(function(a, b) { return a + num(b.count); }, 0) || 1;
    var max = items.reduce(function(a, b) { return Math.max(a, num(b.count)); }, 0) || 1;
    return items.map(function(it, i) {
      var w = Math.max(2, Math.round(num(it.count) / max * 100));
      var suffix;
      if (showPct) {
        var pct = num(it.count) / sum * 100;
        suffix = (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + '%';
      } else {
        suffix = unit;
      }
      return '<div class="stats-bar-row">' +
        '<div class="stats-bar-meta">' +
          '<span class="stats-bar-name" title="' + esc(it.name) + '">' + esc(it.name) + '</span>' +
          '<span class="stats-bar-count">' + num(it.count) + '<span class="stats-bar-pct">' + suffix + '</span></span>' +
        '</div>' +
        '<div class="stats-bar-track"><div class="stats-bar-fill ' + pickColor(i) + '" style="width:' + w + '%"></div></div>' +
      '</div>';
    }).join('');
  }

  function pillGroup(items, total) {
    items = items || [];
    if (!items.length) return '<div class="stats-note">暂无数据</div>';
    var sum = total || items.reduce(function(a, b) { return a + num(b.count); }, 0) || 1;
    return '<div class="stats-pill-group">' + items.map(function(it, i) {
      var pct = num(it.count) / sum * 100;
      return '<span class="stats-pill">' +
        '<span class="stats-pill-dot" style="background:var(--' + pickColor(i) + ')"></span>' +
        esc(it.name) + ' <span class="stats-pill-count">' + num(it.count) + '</span>' +
        '<span class="stats-pill-pct">' + pct.toFixed(0) + '%</span>' +
      '</span>';
    }).join('') + '</div>';
  }

  function facts(list) {
    return '<div class="stats-facts">' + list.map(function(f) {
      return '<div class="stats-fact"><div class="stats-fact-label">' + f[0] + '</div>' +
        '<div class="stats-fact-value">' + esc(f[1]) + (f[2] ? '<small>' + f[2] + '</small>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function panel(title, note, body) {
    return '<div class="stats-panel"><div class="stats-panel-head">' +
      '<span class="stats-panel-title">' + title + '</span>' +
      (note ? '<span class="stats-panel-note">' + note + '</span>' : '') +
      '</div>' + body + '</div>';
  }

  function hexToRgb(hex) {
    var h = (hex || '').replace('#', '');
    if (h.length !== 6) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  // 地区关系矩阵：与桌面版 stats.html 的 buildMatrix 同口径。
  // cross = [{from, to, count}]（含同地区自环与跨地区对），regions 用于限定表头地区范围。
  function matrixHTML(cross, regions) {
    if (!cross || !cross.length) return '<div class="stats-note">暂无跨地区关系数据</div>';
    var freq = {};
    cross.forEach(function(r) { freq[r.from] = (freq[r.from] || 0) + r.count; freq[r.to] = (freq[r.to] || 0) + r.count; });
    var list = (regions && regions.length ? regions.map(function(r) { return r.name; }) : Object.keys(freq))
      .filter(function(n) { return freq[n] != null; })
      .sort(function(a, b) { return freq[b] - freq[a]; })
      .slice(0, 14);
    if (!list.length) return '<div class="stats-note">暂无跨地区关系数据</div>';
    var idx = {};
    list.forEach(function(n, i) { idx[n] = i; });
    var m = list.map(function() { return list.map(function() { return 0; }); });
    var max = 0;
    cross.forEach(function(r) {
      var a = idx[r.from], b = idx[r.to];
      if (a == null || b == null) return;
      m[a][b] += r.count;
      if (a !== b) m[b][a] += r.count;
      if (m[a][b] > max) max = m[a][b];
    });
    var base = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || '#8b5e3c';
    var rgb = hexToRgb(base) || { r: 139, g: 94, b: 60 };
    var html = '<div class="matrix-wrap"><table class="matrix"><thead><tr><th></th>';
    list.forEach(function(n) { html += '<th>' + esc(n) + '</th>'; });
    html += '</tr></thead><tbody>';
    m.forEach(function(row, i) {
      html += '<tr><th>' + esc(list[i]) + '</th>';
      row.forEach(function(v) {
        if (!v) { html += '<td class="zero">·</td>'; return; }
        var t = max ? v / max : 0;
        var alpha = 0.18 + t * 0.82;
        var cls = t > 0.55 ? ' class="hot"' : '';
        html += '<td' + cls + ' style="background:rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha.toFixed(2) + ')">' + v + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function heroCard(label, value, unit, sub) {
    var v = String(value);
    return '<div class="stats-hero-card">' +
      '<div class="stats-hero-label">' + label + '</div>' +
      '<div class="stats-hero-value' + (v.length > 6 ? ' small' : '') + '">' + esc(v) +
        (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      '<div class="stats-hero-sub">' + (sub || '') + '</div>' +
    '</div>';
  }

  // 家族规模卡
  function famCards(list) {
    if (!list || !list.length) return '<div class="stats-note">还没有家族划分</div>';
    return '<div class="stats-fam-cards">' + list.map(function(f) {
      return '<div class="stats-fam-card">' +
        '<div class="stats-fam-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
        '<div class="stats-fam-count">' + num(f.count) + '<small>人</small></div>' +
      '</div>';
    }).join('') + '</div>';
  }

  // 完整度体检
  function completenessView(comp) {
    comp = comp || {};
    var fields = comp.fields || [];
    if (!fields.length) return '<div class="stats-note">暂无数据</div>';
    var avg = num(comp.avg_pct);

    var html = '<div class="stats-gap-meter">' +
      '<div class="stats-gap-score">' + avg + '<small>%</small></div>' +
      '<div class="stats-gap-meter-body">' +
        '<div class="stats-gap-label">整体填写率（' + fields.length + ' 个字段的平均值）</div>' +
        '<div class="stats-gap-track"><div class="stats-gap-fill" style="width:' + avg + '%"></div></div>' +
      '</div></div>';

    html += fields.map(function(f) {
      var pct = num(f.pct);
      var cls = pct >= 90 ? 'ok' : pct >= 70 ? 'mid' : pct >= 40 ? 'low' : 'bad';
      return '<div class="stats-gap-row" title="' + esc(f.label) + '：已填 ' + num(f.filled) + ' / 缺 ' + num(f.missing) + '">' +
        '<span class="stats-gap-row-label">' + esc(f.label) + '</span>' +
        '<span class="stats-gap-row-track"><span class="stats-gap-row-fill ' + cls + '" style="width:' + pct + '%"></span></span>' +
        '<span class="stats-gap-row-num"><b>' + pct + '%</b> 缺 ' + num(f.missing) + '</span>' +
      '</div>';
    }).join('');

    // 待补充清单：只列缺失 >= 3 人的字段
    var missing = comp.missing || {};
    var labels = comp.label_map || {};
    var gaps = Object.keys(missing)
      .filter(function(k) { return (missing[k] || []).length >= 3; })
      .map(function(k) { return { key: k, label: labels[k] || k, names: missing[k] || [] }; });

    if (gaps.length) {
      html += '<div class="stats-gap-missing"><div class="stats-gap-missing-title">📌 待补充（仅列缺失最多的前 10 位）</div>' +
        gaps.map(function(g) {
          return '<div class="stats-gap-missing-item"><b>' + esc(g.label) + '</b>' +
            g.names.map(function(n) { return esc(n); }).join('、') + '</div>';
        }).join('') +
      '</div>';
    }

    return html;
  }

  // 角色之最列表：每行可点，直达该角色的卡片详情（VM.index 的详情弹窗）
  // items 每条都带 id（后端/离线版一致）；缺 id 时退化为不可点，避免生成坏链接
  // opts.focusRelations 为真时改为「切到关系网并聚焦该角色」（高亮 ta 的家族与关系圈）——
  // 用于"关系类型最丰富""家族羁绊最多"这两个本质是"关系"的榜，与关系度排行同语义。
  function crownList(items, unit, opts) {
    if (!items || !items.length) return '<div class="stats-note">' + esc((opts && opts.placeholder) || '暂无数据') + '</div>';
    var toRelations = !!(opts && opts.focusRelations);
    var handler = toRelations ? 'openRelationFocusFromStats' : 'openCharDetailFromStats';
    return '<div class="stats-crown-list">' + items.map(function(it, i) {
      var v = (typeof it.value === 'number') ? it.value.toLocaleString() : esc(it.value);
      var sub = [it.university, it.region].filter(Boolean).join(' · ');
      var clickable = (it.id != null);
      var oc = clickable ? ' onclick="' + handler + '(' + it.id + ')"' : '';
      return '<div class="stats-crown-row' + (clickable ? ' tappable' : '') + '"' + oc + '>' +
        '<span class="stats-crown-badge">' + (i === 0 ? '👑' : (i + 1)) + '</span>' +
        '<span class="stats-crown-body">' +
          '<span class="stats-crown-name">' + esc(it.name) + '</span>' +
          (sub ? '<span class="stats-crown-sub">' + esc(sub) + '</span>' : '') +
        '</span>' +
        '<span class="stats-crown-val">' + v + '<small>' + unit + '</small></span>' +
        (clickable ? '<span class="stats-crown-go">›</span>' : '') +
      '</div>';
    }).join('') + '</div>';
  }

  function render(d) {
    var C = d.characters || {}, W = d.worldview || {}, R = d.relations || {}, D = d.documents || {}, I = d.images || {};
    var REG = d.regions || [], COMP = d.completeness || {}, FAM = d.families || {}, HL = d.highlights || {};
    var regionTop = (C.region || []).filter(function(r) { return r.name !== '未填写'; });
    var regionBlank = (C.region || []).filter(function(r) { return r.name === '未填写'; })[0];
    // 人均关系 = 去重对数 * 2 / 角色数（含同家族自动关系）
    var avgRel = num(C.total) ? (num(R.unique_pairs) * 2 / num(C.total)) : 0;

    var html = '';

    // ---------- 概览 ----------
    html += '<div class="stats-hero">' +
      heroCard('角色总数', num(C.total), '位', regionTop.length ? '覆盖 ' + regionTop.length + ' 个地区' : '尚未填写地区') +
      heroCard('世界观条目', num(W.total), '条', (W.main_category || []).map(function(m) { return m.name + ' ' + m.count; }).join(' · ')) +
      heroCard('关系总数', num(R.total), '条', num(R.unique_pairs) + ' 对角色 · ' + (R.types || []).length + ' 种类型') +
      heroCard('文档 / 图片', num(D.total) + ' / ' + num(I.files), '', (D.size_display || '0 B') + ' 文档' + (I.size_display ? ' · ' + I.size_display + ' 图片' : '')) +
    '</div>';

    // ---------- 角色分布 ----------
    html += '<div class="stats-section-title">角色分布</div>';
    html += panel('📍 地区分布', 'Top ' + regionTop.length + (regionBlank ? ' · 未填写 ' + regionBlank.count : ''), barChart(regionTop, num(C.total), 12));
    html += panel('⚧ 性别构成', num(C.total) + ' 位', pillGroup(C.gender, num(C.total)));
    html += panel('🌗 存在状态', '按 status 字段', barChart(C.status, num(C.total)));
    html += panel('🏛 家族规模', num(FAM.families) + ' 个家族 · ' + num(FAM.with_family) + ' 人有归属', famCards(FAM.list));

    // ---------- 设定完整度体检 ----------
    html += '<div class="stats-section-title">设定完整度体检</div>';
    html += '<div class="stats-panel">' + completenessView(COMP) + '</div>';

    // ---------- 角色之最 ----------
    html += '<div class="stats-section-title">角色之最</div>';
    html += panel('📝 设定最厚', 'setting 字数', crownList(HL.items && HL.items.longest_setting, '字'));
    html += panel('🖼 图片最多', '张数', crownList(HL.items && HL.items.most_images, '张'));
    html += panel('📊 设定篇幅分布', '共 ' + num(C.total) + ' 位', barChart(HL.setting_distribution, num(C.total)));

    // 最长的世界观条目：Top N（兼容只返回单条的旧数据）
    var worldRank = (HL.world_longest_list && HL.world_longest_list.length)
      ? HL.world_longest_list
      : (HL.world_longest ? [HL.world_longest] : []);
    if (worldRank.length) {
      html += panel('🌍 最长的世界观条目',
        'Top ' + worldRank.length + ' · 榜首 ' + num(worldRank[0].chars).toLocaleString() + ' 字',
        '<div class="stats-rank-list">' + worldRank.map(function(w, i) {
          var clickable = (w.id != null);
          var oc = clickable ? ' onclick="openWorldDetailFromStats(' + w.id + ')"' : '';
          return '<div class="stats-rank-row' + (clickable ? ' tappable' : '') + '"' + oc + '>' +
            '<span class="stats-rank-no">' + (i + 1) + '</span>' +
            '<span class="stats-rank-name">' + esc(w.title) + '</span>' +
            '<span class="stats-rank-val">' + num(w.chars).toLocaleString() + '</span>' +
            (clickable ? '<span class="stats-rank-go">›</span>' : '') +
          '</div>';
        }).join('') + '</div>');
    }

    // ---------- 关系网络 ----------
    var famPairs = num(R.family_new_pairs);
    html += '<div class="stats-section-title">关系网络</div>';
    html += panel('📐 关系明细',
      '手写 ' + num(R.total) + ' 条' + (famPairs ? ' + 同家族自动 ' + famPairs + ' 条' : '') +
      ' · 去重 ' + num(R.unique_pairs) + ' 对',
      facts([
        ['手写关系', num(R.total)],
        ['去重对数', num(R.unique_pairs)],
        ['同家族关系', famPairs],
        ['孤立角色', num(R.isolated_characters)],
        ['双向互惠', num(R.mutual_pairs)],
        ['重复关系', num(R.dup_pairs)],
        ['未标类型', num(R.no_type)],
        ['自环关系', num(R.self_loop)],
        ['人均关系', avgRel.toFixed(2)]
      ]));

    // 显示格式与其余榜单完全统一（crownList）：徽章 + 姓名 + 学校·地区 + 数值。
    // top_degree 数据项是 {id, name, degree, university, region}，只有数值字段名不同
    // （degree → value），故做一层映射后交给 crownList 渲染。
    html += panel('⭐ 关系度排行', '含同家族 · 两端计次',
      crownList((R.top_degree || []).map(function(it) {
        return {
          id: it.id, name: it.name, value: it.degree,
          university: it.university, region: it.region
        };
      }), '条', { focusRelations: true, placeholder: '还没有建立任何关系' }));

    // 这两个榜从「角色之最」移来（本质是"关系"指标）；点击切关系网并聚焦该角色。
    html += panel('🎭 关系类型最丰富', '不同类型数', crownList(HL.items && HL.items.richest_types, '种', { focusRelations: true }));
    html += panel('👪 家族羁绊最多', '所属家族数', crownList(HL.items && HL.items.most_family, '个', { focusRelations: true }));

    if ((R.isolated || []).length) {
      html += panel('🔌 孤立角色', '尚无任何关系 · Top ' + R.isolated.length,
        '<div class="stats-pill-group">' + R.isolated.map(function(it) {
          return '<span class="stats-pill">' + esc(it.name) +
            (it.region ? ' <span class="stats-pill-pct">' + esc(it.region) + '</span>' : '') + '</span>';
        }).join('') + '</div>');
    }

    // ---------- 地区圈子 ----------
    html += '<div class="stats-section-title">地区圈子</div>';
    html += panel('🤝 地区凝聚力', REG.length ? REG.length + ' 个活跃地区 · 内部关系占比' : '',
      REG.length ? barChart(REG.map(function(r) {
        return { name: r.name + '（' + r.inside + '/' + r.total + '）', count: num(r.cohesion) };
      }), 100)
      : '<div class="stats-note">关系数据不足（每个地区至少需 3 条关系）</div>');

    html += panel('✍️ 设定厚度', '人均 setting 字数',
      REG.length
        ? barChart(REG.slice().sort(function(a, b) { return num(b.avg_setting) - num(a.avg_setting); })
            .map(function(r) { return { name: r.name, count: num(r.avg_setting) }; }), 0, 0, { pct: false, unit: '字' })
        : '<div class="stats-note">数据不足</div>');

    html += panel('🕸 地区关系矩阵', '越深关系越多', matrixHTML(R.cross_region, regionTop));

    // ---------- 世界观与内容 ----------
    html += '<div class="stats-section-title">世界观与内容</div>';
    html += panel('📚 大类分布', num(W.total) + ' 条', barChart(W.main_category, num(W.total)));
    html += panel('✍️ 内容体量', '字数统计', facts([
      ['世界观字数', num(W.content_chars).toLocaleString(), ' 字'],
      ['平均每条', num(W.total) ? Math.round(num(W.content_chars) / num(W.total)).toLocaleString() : 0, ' 字'],
      ['角色设定总字数', num(HL.total_setting_chars).toLocaleString(), ' 字']
    ]));

    // ---------- 素材与文档 ----------
    html += '<div class="stats-section-title">素材与文档</div>';
    html += '<div class="stats-panel"><div class="stats-facts">' +
      '<div class="stats-fact"><div class="stats-fact-label">角色图片</div><div class="stats-fact-value">' + num(C.with_image) + '<small> 位有图</small></div></div>' +
      '<div class="stats-fact"><div class="stats-fact-label">图片总数</div><div class="stats-fact-value">' + num(C.image_total) + '<small> 张</small></div></div>' +
      '<div class="stats-fact"><div class="stats-fact-label">无图角色</div><div class="stats-fact-value">' + num(C.no_image) + '<small> 位</small></div></div>' +
      '<div class="stats-fact"><div class="stats-fact-label">已取脸</div><div class="stats-fact-value">' + num(C.with_face_crop) + '<small> 位</small></div></div>' +
      '<div class="stats-fact"><div class="stats-fact-label">文档数量</div><div class="stats-fact-value">' + num(D.total) + '<small> 个</small></div></div>' +
      '<div class="stats-fact"><div class="stats-fact-label">文档占用</div><div class="stats-fact-value">' + esc(D.size_display || '—') + '</div></div>' +
    '</div></div>';

    html += '<div class="stats-generated">统计于 ' + esc(d.generated_at || '') + '</div>';

    document.getElementById('statsBody').innerHTML = html;
    document.getElementById('statsBody').style.display = '';
    document.getElementById('statsLoadingState').style.display = 'none';
    document.getElementById('statsErrorState').style.display = 'none';
  }

  function load(force) {
    var revision = window.appDataRevision || 0;
    if (!force && loadedRevision === revision) {
      document.getElementById('statsLoadingState').style.display = 'none';
      return;
    }
    if (loading) return;
    loading = true;
    document.getElementById('statsErrorState').style.display = 'none';
    if (loadedRevision < 0) document.getElementById('statsLoadingState').style.display = '';

    fetch(API).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(d) {
      loading = false;
      loadedRevision = window.appDataRevision || 0;
      render(d);
    }).catch(function(e) {
      loading = false;
      document.getElementById('statsLoadingState').style.display = 'none';
      document.getElementById('statsErrorText').textContent = '统计失败：' + e.message;
      document.getElementById('statsErrorState').style.display = '';
    });
  }

  function init() { load(true); }

  return { init: init, refresh: function() { load(true); } };
})();

