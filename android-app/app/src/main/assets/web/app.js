/* ============================================================
   全局工具函数
   ============================================================ */
 function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
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

// 目标尺寸：两维都不小于显示物理像素（cover 后不放大）；源图更小则不放大。
function thumbTargetSize(w, h, dpr) {
  var s = Math.max((CARD_BOX_W * dpr) / w, (CARD_BOX_H * dpr) / h);
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
var viewInited = { home: true, index: false, worldview: false, relations: false, documents: false };

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

  if (!viewInited[name]) {
    viewInited[name] = true;
    VM[name].init();
  } else {
    if (VM[name].refresh) VM[name].refresh();
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
  var exportMode = false;
  var selectedIds = new Set();
  var detailCharId = null;
  var detailImages = [];
  var detailImageIdx = 0;
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
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.type.startsWith('image/')) { showToast('文件 '+file.name+' 不是图片，已跳过', 'error'); continue; }
      if (file.size > 20*1024*1024) { showToast('图片 '+file.name+' 超过20MB，已跳过', 'error'); continue; }
      currentImageFiles.push({ file: file, previewUrl: URL.createObjectURL(file) });
    }
    renderImagePreview();
    event.target.value = '';
  }

  function renderImagePreview() {
    var grid = document.getElementById('indexImagePreviewGrid');
    var items = [];
    for (var i = 0; i < currentImageUrls.length; i++) items.push({ url: currentImageUrls[i], index: i });
    for (var j = 0; j < currentImageFiles.length; j++) items.push({ url: currentImageFiles[j].previewUrl, index: currentImageUrls.length+j });
    if (items.length === 0) { grid.style.display = 'none'; grid.innerHTML = ''; return; }
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(72px, 1fr))';
    grid.style.gap = '8px';
    grid.innerHTML = items.map(function(it) {
      return '<div style="position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;border:1px solid var(--border);">' +
        (safeImageSrc(it.url) ? '<img src="'+safeImageSrc(it.url)+'" alt="预览" style="width:100%;height:100%;object-fit:cover;">' : imageRepairHint()) +
        '<button type="button" onclick="VM.index.removeImageItem('+it.index+')" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(0,0,0,0.6);color:#fff;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;">✕</button></div>';
    }).join('');
  }

  function removeImageItem(index) {
    var uc = currentImageUrls.length;
    if (index < uc) { currentImageUrls.splice(index, 1); }
    else { var fi = index - uc; URL.revokeObjectURL(currentImageFiles[fi].previewUrl); currentImageFiles.splice(fi, 1); }
    renderImagePreview();
  }

  function resetImageUpload() {
    currentImageFiles.forEach(function(item) { URL.revokeObjectURL(item.previewUrl); });
    currentImageUrls = []; currentImageFiles = [];
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
      ph='<div style="flex-shrink:0;width:88px;position:relative;align-self:stretch;margin-right:4px;margin-top:4px;min-height:64px;"><div style="width:88px;height:100%;border-radius:4px;overflow:hidden;border:1px solid var(--border);background:#f8f9fa;">'+(safeImageSrc(cv)?'<img src="'+safeImageSrc(cv)+'" alt="'+esc(c.name)+'" loading="lazy" style="width:100%;height:100%;object-fit:cover;">':imageRepairHint())+'</div>'+bd+'</div>';
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
      renderImagePreview();
      document.getElementById('indexModalOverlay').classList.add('active');
    }).catch(function(){showToast('获取数据失败','error');});
  }

  var _autoSaveInProgress = false;
  function doSubmitFinal(editId, data) {
    var allImages=currentImageUrls.concat(data.newUrls||[]);
    if(allImages.length>0){data.images=allImages;data.image_url=allImages[0];}
    else{data.images=[];data.image_url='';}
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
    var nu=[],pending=currentImageFiles.length,hasErr=false;
    currentImageFiles.forEach(function(item){
      var fd=new FormData();fd.append('file',item.file);
      fetch('/api/images/upload',{method:'POST',body:fd}).then(function(r){if(r.ok)return r.json();throw new Error();}).then(function(r){nu.push(r.image_url);}).catch(function(){hasErr=true;}).finally(function(){
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
    document.getElementById('indexModalOverlay').classList.remove('active');
  }
  window.cancelEditIndex = cancelEdit;
  window.closeModalAutoSaveIndex = closeModalAutoSave;

  function openDetailModal(id){
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
  function closeDetailModal(){document.getElementById('indexDetailOverlay').classList.remove('active');detailCharId=null;}
  function detailEdit(){if(detailCharId){var id=detailCharId;closeDetailModal();openEditModal(id);}}

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
  function toggleSelectAll(){
    var cards=document.querySelectorAll('#charGrid .card[data-drag-id]');
    if(cards.length===0)return;
    var vi=[];cards.forEach(function(c){vi.push(parseInt(c.dataset.dragId));});
    var as=vi.every(function(id){return selectedIds.has(id);});
    if(as){vi.forEach(function(id){selectedIds.delete(id);});}
    else{vi.forEach(function(id){selectedIds.add(id);});}
    applyFilter();
  }
  function confirmExport(){
    if(selectedIds.size===0)return;
    var sel=allCharacters.filter(function(c){return selectedIds.has(c.id);});
    var ed=sel.map(function(c){return{姓名:c.name,别名:c.alias||'',代表高校:c.university||'',地区:c.region||'',诞生地:c.birthplace||'',存在状态:c.status||'存在',性别:c.gender||'',身高:c.height||'',生日:c.birthday||'',外貌:c.appearance||'',身份存在时间:c.identity_period||'',诞生时间:c.birth_time||'',取名依据:c.naming_rationale||'',设定:c.setting||''};});
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
    handleImageUpload:handleImageUpload, removeImageItem:removeImageItem, detailImageGo:detailImageGo, detailImageStep:detailImageStep,
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
    document.getElementById('worldModalOverlay').classList.remove('active');
  }
  window.cancelEditWorld = cancelEdit;
  window.closeModalAutoSaveWorld = closeModalAutoSave;

  function openDetailModal(id) {
    fetch(API + '/' + id).then(function(r) { return r.json(); }).then(function(e) {
      detailEntryId = e.id;
      document.getElementById('worldDetailTitle').textContent = e.title;
      var body = '';
      if (e.main_category === '人物背景故事') {}
      else if (e.category) body += '<div class="detail-section"><div class="detail-label">分类</div><div class="detail-value">' + esc(e.category) + '</div></div>';
      if (e.content) body += '<div class="detail-section"><div class="detail-label">内容</div><div class="detail-value">' + esc(e.content) + '</div></div>';
      document.getElementById('worldDetailBody').innerHTML = body || '<p style="color:var(--text-light);text-align:center;padding:20px;">暂无内容</p>';
      document.getElementById('worldDetailOverlay').classList.add('active');
    }).catch(function() { showToast('获取详情失败', 'error'); });
  }
  function closeDetailModal() { document.getElementById('worldDetailOverlay').classList.remove('active'); detailEntryId = null; }
  function detailEdit() { if (detailEntryId) { var id = detailEntryId; closeDetailModal(); openEditModal(id); } }

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
  function toggleSelectAll() {
    var cards = document.querySelectorAll('#entryGrid .card[data-drag-id]');
    if (cards.length === 0) return;
    var vi = [];
    cards.forEach(function(c) { vi.push(parseInt(c.dataset.dragId)); });
    var as = vi.every(function(id) { return selectedIds.has(id); });
    if (as) vi.forEach(function(id) { selectedIds.delete(id); });
    else vi.forEach(function(id) { selectedIds.add(id); });
    applyFilter();
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
    var ed = sel.map(function(e) { return { 标题: e.title, 大类: e.main_category || '', 分类: e.category || '', 内容: e.content || '' }; });
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
    currentViewFile = '';
    releaseViewerObjectUrl();   // 关闭时释放 Blob URL，避免长期占用内存
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
  var gLastTouchDist = 0, gPanning = false, gLastX = 0, gLastY = 0;
  var gLastTapTime = 0, gLastTapNodeId = null;
  var gTouchStartX = 0, gTouchStartY = 0, gTouchMoved = false;
  var G_DBL_TAP_DELAY = 300, G_DBL_TAP_MOVE_TOL = 10;
  var loadGeneration = 0;
  var loadedRevision = -1;    // 已加载完成的数据版本（同版本返回不再查询/重绘）
  var loadingRevision = -1;
  var gNodeIndex = new Map();       // id → node：替代每步线性 find
  var gNodeFams = new Map();        // id → 家族数组：替代每步重复拆分字符串
  var gLayout = { epoch: 0, timer: null, step: 0, total: 300, budgetMs: 8, running: false, paused: false };

  function splitFamilies(s) { return (s || '').split(/[、,，]/).map(function(x) { return x.trim(); }).filter(Boolean); }
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
    return '<div style="display:flex;padding:7px 0;border-bottom:1px solid var(--border);gap:8px;"><span style="flex:0 0 84px;color:var(--text-light);font-size:.82rem;">' + esc(l) + '</span><span style="flex:1;font-size:.88rem;white-space:pre-wrap;line-height:1.5;word-break:break-word;">' + v + '</span></div>';
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
  function toggleSelectAll() {
    var cards = document.querySelectorAll('#relList .rel-card[data-rel-id]');
    if (cards.length === 0) return;
    var vi = []; cards.forEach(function(c) { vi.push(parseInt(c.dataset.relId)); });
    var as = vi.every(function(id) { return selectedIds.has(id); });
    if (as) vi.forEach(function(id) { selectedIds.delete(id); });
    else vi.forEach(function(id) { selectedIds.add(id); });
    renderRelList();
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
    var ed = sel.map(function(r) { return { 角色A: r.from_name || '', 角色B: r.to_name || '', 关系类型: r.relation_type || '', 关系描述: r.description || '' }; });
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
    var lo = computeLabelOffsets(gEdges);
    gEdges.forEach(function(e, i) {
      var a = gNodeIndex.get(e.from), b = gNodeIndex.get(e.to);
      if (!a || !b) return;
      var isB = ['CP', '朋友', '冤家', '亲属'].indexOf(e.type) !== -1, isT = e.type === '师生';
      var color = isB ? '#c2185b' : isT ? '#1565c0' : '#8b5e3c';
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len, nr = 16, as_ = 7;
      var sx = a.x + ux * nr, sy = a.y + uy * nr, ex = b.x - ux * nr, ey = b.y - uy * nr;
      gCtx.strokeStyle = color; gCtx.globalAlpha = 0.7; gCtx.lineWidth = isB ? 2.5 : 1.8;
      if (isT) gCtx.setLineDash([6, 4]);
      gCtx.beginPath(); gCtx.moveTo(sx, sy); gCtx.lineTo(ex, ey); gCtx.stroke(); gCtx.setLineDash([]);
      gCtx.globalAlpha = 0.9; gCtx.fillStyle = color;
      gCtx.beginPath(); gCtx.moveTo(ex, ey);
      gCtx.lineTo(ex - ux * as_ - uy * as_ * 0.6, ey - uy * as_ + ux * as_ * 0.6);
      gCtx.lineTo(ex - ux * as_ + uy * as_ * 0.6, ey - uy * as_ - ux * as_ * 0.6);
      gCtx.closePath(); gCtx.fill();
      if (isB) { gCtx.beginPath(); gCtx.moveTo(sx, sy); gCtx.lineTo(sx + ux * as_ - uy * as_ * 0.6, sy + uy * as_ + ux * as_ * 0.6); gCtx.lineTo(sx + ux * as_ + uy * as_ * 0.6, sy + uy * as_ - ux * as_ * 0.6); gCtx.closePath(); gCtx.fill(); }
      if (e.type) {
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, px_ = -uy, py_ = ux;
        var off = (lo[i] || 0) * 12, lx = mx + px_ * off, ly = my + py_ * off;
        gCtx.globalAlpha = 0.9; gCtx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif';
        var tw = gCtx.measureText(e.type).width;
        gCtx.fillStyle = '#fffef9'; gCtx.fillRect(lx - tw / 2 - 3, ly - 7, tw + 6, 14);
        gCtx.fillStyle = color; gCtx.textAlign = 'center'; gCtx.textBaseline = 'middle'; gCtx.fillText(e.type, lx, ly);
      }
      gCtx.globalAlpha = 1;
    });
    gNodes.forEach(function(n) {
      var fc = nodeFamilyColor(n);
      gCtx.beginPath(); gCtx.arc(n.x, n.y, 16, 0, Math.PI * 2);
      gCtx.fillStyle = n === gDragNode ? '#c49a6c' : fc; gCtx.fill();
      gCtx.strokeStyle = '#fffef9'; gCtx.lineWidth = 2; gCtx.stroke();
      gCtx.fillStyle = '#3d2b1f'; gCtx.font = '11px "PingFang SC","Microsoft YaHei",sans-serif'; gCtx.textAlign = 'center'; gCtx.textBaseline = 'top';
      var label = n.name || ('#' + n.id); if (label.length > 5) label = label.slice(0, 4) + '…';
      gCtx.fillText(label, n.x, n.y + 20);
    });
    gCtx.restore();
  }

  function screenToCanvas(x, y) { return { x: (x - gOffsetX) / gScale, y: (y - gOffsetY) / gScale }; }
  function nodeAt(x, y) { for (var i = gNodes.length - 1; i >= 0; i--) { var n = gNodes[i], dx = x - n.x, dy = y - n.y; if (dx * dx + dy * dy <= 22 * 22) return n; } return null; }

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
        if (node) { var now = Date.now(); if (gLastTapNodeId === node.id && (now - gLastTapTime) < G_DBL_TAP_DELAY) { showCharInfo(node.id); gLastTapTime = 0; gLastTapNodeId = null; } else { gLastTapTime = now; gLastTapNodeId = node.id; } }
        else { gLastTapTime = 0; gLastTapNodeId = null; }
      }
      if (gDragNode) { gDragNode.fixed = false; gDragNode = null; }
      gPanning = false; gLastTouchDist = 0;
    }
  }
  function onMouseDown(e) {
    var rect = gCanvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    var p = screenToCanvas(x, y), node = nodeAt(p.x, p.y);
    if (node) { gDragNode = node; node.fixed = true; gDragging = true; }
    else { gPanning = true; gLastX = x; gLastY = y; }
  }
  function onMouseMove(e) {
    if (!gDragging && !gPanning) return;
    var rect = gCanvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (gDragNode) { var p = screenToCanvas(x, y); gDragNode.x = p.x; gDragNode.y = p.y; graphDraw(); }
    else if (gPanning) { gOffsetX += x - gLastX; gOffsetY += y - gLastY; gLastX = x; gLastY = y; graphDraw(); }
  }
  function onMouseUp() { if (gDragNode) { gDragNode.fixed = false; gDragNode = null; } gDragging = false; gPanning = false; }
  function onWheel(e) { e.preventDefault(); gScale = Math.max(0.3, Math.min(3, gScale * (e.deltaY < 0 ? 1.1 : 0.9))); graphDraw(); }

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
      startLayout();   // 300 步按时间预算分块执行，期间让出事件循环
    } else {
      allCharacters.forEach(function(c) { var n = gNodeIndex.get(c.id) || gNodes.find(function(n) { return n.id === c.id; }); if (n) { n.name = c.name; n.family = c.family || ''; } });
      indexGraphNodes();
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
      gW = wrap.clientWidth; gH = wrap.clientHeight;
      gCanvas.width = gW * gDpr; gCanvas.height = gH * gDpr;
      gCanvas.style.width = gW + 'px'; gCanvas.style.height = gH + 'px';
      gCtx.setTransform(gDpr, 0, 0, gDpr, 0, 0); graphDraw();
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
    graphZoom: graphZoom, graphReset: graphReset
  };
})();

// ======================== 诊断日志 ========================
// 闪退排查用：原生把崩溃堆栈写进 App 私有目录，这里只负责展示与导出，
// 全程不依赖电脑 / adb。入口在首页 footer 的「诊断日志」。
var diagLogText = '';

function diagNativeReady() {
  return typeof Android !== 'undefined' && Android && Android.readCrashLog;
}

// 首页入口上的红点：只在确实有崩溃记录时才亮
function refreshDiagBadge() {
  var dot = document.getElementById('diagBadge');
  if (!dot) return;
  var has = false;
  try { has = !!(diagNativeReady() && Android.hasCrashLog && Android.hasCrashLog()); } catch (e) { }
  dot.style.display = has ? 'inline-block' : 'none';
}

function openDiagModal() {
  var overlay = document.getElementById('diagOverlay');
  var info = document.getElementById('diagInfo');
  var pre = document.getElementById('diagContent');
  if (!overlay) return;
  diagLogText = '';
  if (!diagNativeReady()) {
    // 浏览器里直接打开时没有原生桥接
    info.textContent = '当前运行在浏览器环境，没有原生崩溃日志。';
    pre.textContent = '（无）';
  } else {
    try { info.textContent = Android.deviceInfo ? Android.deviceInfo() : ''; } catch (e) { info.textContent = ''; }
    var full = '';
    try { full = Android.readCrashLog() || ''; } catch (e) { full = ''; }
    diagLogText = full;
    var MAX_SHOW = 20000;
    if (!full) {
      pre.textContent = '还没有崩溃记录。\n\n如果刚闪退过这里仍然为空，说明进程是在原生层被系统直接终止的（例如内存不足），那种情况没有堆栈，下次启动时才会补记一条。';
    } else if (full.length > MAX_SHOW) {
      // 日志可能上百 KB，全量塞进 DOM 会卡住页面；崩溃现场在尾部，显示尾段即可
      pre.textContent = '……（日志较长，此处只显示最后 ' + MAX_SHOW + ' 字符，点「导出日志」可拿完整内容）\n\n' + full.slice(-MAX_SHOW);
    } else {
      pre.textContent = full;
    }
  }
  overlay.classList.add('active');
}

function closeDiagModal() {
  var overlay = document.getElementById('diagOverlay');
  if (overlay) overlay.classList.remove('active');
}

function exportDiagLog() {
  if (!diagLogText) { showToast('没有可导出的日志', 'error'); return; }
  var header = '校拟设定簿 崩溃诊断日志\n导出时间: ' + new Date().toLocaleString() + '\n\n';
  var text = header + diagLogText;
  var fileName = 'crash_log_' + new Date().toISOString().slice(0, 10) + '.txt';
  if (typeof Android !== 'undefined' && Android.saveFile) {
    var blob = new Blob([text], { type: 'text/plain' });
    var reader = new FileReader();
    reader.onloadend = function() { Android.saveFile(reader.result, fileName); };
    reader.readAsDataURL(blob);
    showToast('请选择保存位置', 'success');
  } else {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = fileName;
    a.click();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
  }
}

function clearDiagLog() {
  if (!confirm('确定清空崩溃日志？')) return;
  try { if (diagNativeReady() && Android.clearCrashLog) Android.clearCrashLog(); } catch (e) { }
  diagLogText = '';
  document.getElementById('diagContent').textContent = '（已清空）';
  refreshDiagBadge();
  showToast('已清空', 'success');
}

(function bindDiagOverlay() {
  var overlay = document.getElementById('diagOverlay');
  if (overlay) overlay.addEventListener('click', function(e) { if (e.target === this) closeDiagModal(); });
})();

// 进首页时刷新红点，让"上次崩过"一眼可见
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshDiagBadge);
else refreshDiagBadge();

