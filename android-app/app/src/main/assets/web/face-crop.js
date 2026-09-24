/* ============================================================
   face-crop.js —— 人脸圆形框选组件（共享）

   用途
   ----
   角色有图片时，让用户在一张图上拖动/缩放一个圆形框，圈出人脸区域。
   结果以**相对原图的比例**保存：{ img, cx, cy, r }（全部 0~1），
   不落裁切后的图片字节 —— 换脸只需改参数，随角色记录一起同步。

   字段口径
   --------
   face_crop = {
     img:  图片在角色 images 数组中的下标（0 = 首图），
     cx:   圆心 x / 原图宽（0~1，可越界，裁切时自动夹取），
     cy:   圆心 y / 原图高（0~1），
     r:    半径 / min(原图宽, 原图高)（0~1），保证圆形不被拉伸
   }
   空字符串表示"未取脸" —— 关系网节点回退为纯色圆。

   对外 API（window.FaceCrop）
   -------------------------
     FaceCrop.open({ src, crop, onConfirm(crop), onCancel() })
       src       图片地址（已可被 <img> 加载）
       crop      已有参数（可选，用于编辑时回显）
       onConfirm 确认回调，收到 { img, cx, cy, r }
     FaceCrop.parse(str)   字符串 → crop 对象或 null
     FaceCrop.stringify(c) crop 对象 → 字符串（保留 4 位小数）
     FaceCrop.cropToCanvas(imgEl, crop, size) → Promise<canvas|null>
       把已加载的 <img> 按 crop 参数裁成 size×size 的圆形画布（供关系网用）

   主题
   ----
   全部样式走宿主页面的 CSS 变量（--card-bg/--text/--border/--accent/--bg…），
   深浅色自动适配。组件自包含，无外部依赖。
   ============================================================ */
(function () {
  'use strict';

  var OVERLAY_ID = 'faceCropOverlay';

  // ---------- 参数序列化 ----------

  function parse(str) {
    if (!str) return null;
    if (typeof str === 'object') return sanitize(str);
    try {
      var o = JSON.parse(String(str));
      return sanitize(o);
    } catch (e) { return null; }
  }

  function sanitize(o) {
    if (!o || typeof o !== 'object') return null;
    var cx = Number(o.cx), cy = Number(o.cy), r = Number(o.r);
    if (!isFinite(cx) || !isFinite(cy) || !isFinite(r) || r <= 0) return null;
    var img = Number(o.img);
    return {
      img: isFinite(img) && img >= 0 ? Math.floor(img) : 0,
      cx: clamp(cx, 0, 1),
      cy: clamp(cy, 0, 1),
      r: clamp(r, 0.02, 1)
    };
  }

  function stringify(c) {
    var s = sanitize(c);
    if (!s) return '';
    return JSON.stringify({
      img: s.img,
      cx: +s.cx.toFixed(4),
      cy: +s.cy.toFixed(4),
      r: +s.r.toFixed(4)
    });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- 裁切为圆形画布 ----------

  // 把已加载完成的 <img> 按 crop 参数裁成 size×size 的圆形画布。
  // 返回 Promise<canvas>；图片未就绪或参数非法时 resolve(null)。
  function cropToCanvas(imgEl, crop, size) {
    return new Promise(function (resolve) {
      var c = parse(crop);
      if (!imgEl || !c) { resolve(null); return; }
      var iw = imgEl.naturalWidth || imgEl.width;
      var ih = imgEl.naturalHeight || imgEl.height;
      if (!iw || !ih) { resolve(null); return; }
      size = size || 64;
      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      var px = Math.round(size * dpr);
      var cv = document.createElement('canvas');
      cv.width = px; cv.height = px;
      var ctx = cv.getContext('2d');
      if (!ctx) { resolve(null); return; }
      // 圆形裁剪路径 + 抗锯齿
      ctx.save();
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      // 源区域：圆心(cx,cy)·每边，半径 r·min(iw,ih)
      var rr = c.r * Math.min(iw, ih);
      var sx = c.cx * iw - rr;
      var sy = c.cy * ih - rr;
      var sw = rr * 2, sh = rr * 2;
      try {
        ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, px, px);
      } catch (e) {
        // 源矩形越界时 drawImage 会抛错：退化为整图 cover
        try { ctx.drawImage(imgEl, 0, 0, iw, ih, 0, 0, px, px); }
        catch (e2) { ctx.restore(); resolve(null); return; }
      }
      ctx.restore();
      resolve(cv);
    });
  }

  // ---------- 浮层 ----------

  var _state = null;

  function ensureStyles() {
    if (document.getElementById('faceCropStyle')) return;
    var st = document.createElement('style');
    st.id = 'faceCropStyle';
    st.textContent = [
      '#faceCropOverlay{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);}',
      '#faceCropOverlay.active{display:flex;}',
      '#faceCropOverlay .fc-panel{background:var(--card-bg,#fffef9);color:var(--text,#3d322b);border-radius:14px;padding:16px;box-shadow:0 8px 40px rgba(0,0,0,.35);max-width:min(94vw,520px);max-height:94vh;display:flex;flex-direction:column;gap:12px;}',
      '#faceCropOverlay .fc-title{font-size:1rem;font-weight:600;}',
      '#faceCropOverlay .fc-hint{font-size:.78rem;color:var(--text-light,#8c7b6e);}',
      '#faceCropOverlay .fc-stage{position:relative;overflow:hidden;border-radius:10px;background:#000;touch-action:none;user-select:none;line-height:0;}',
      '#faceCropOverlay .fc-stage img{display:block;max-width:100%;max-height:56vh;user-select:none;-webkit-user-drag:none;}',
      '#faceCropOverlay .fc-ring{position:absolute;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 9999px rgba(0,0,0,.45);cursor:move;box-sizing:border-box;}',
      '#faceCropOverlay .fc-ring::after{content:"";position:absolute;inset:-2px;border-radius:50%;border:1px solid rgba(0,0,0,.35);}',
      '#faceCropOverlay .fc-handle{position:absolute;right:-9px;bottom:-9px;width:20px;height:20px;border-radius:50%;background:#fff;border:2px solid var(--accent,#8b5e3c);cursor:nwse-resize;box-sizing:border-box;}',
      '#faceCropOverlay .fc-actions{display:flex;gap:10px;justify-content:flex-end;}',
      '#faceCropOverlay .fc-btn{border:1px solid var(--border,#e0d5c7);background:var(--bg,#f5f0eb);color:var(--text,#3d322b);border-radius:8px;padding:9px 18px;font-size:.86rem;cursor:pointer;}',
      '#faceCropOverlay .fc-btn.primary{background:var(--accent,#8b5e3c);border-color:var(--accent,#8b5e3c);color:#fff;}',
      '#faceCropOverlay .fc-btn:active{opacity:.85;}'
    ].join('');
    document.head.appendChild(st);
  }

  function open(opts) {
    opts = opts || {};
    ensureStyles();
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '';

    var panel = document.createElement('div');
    panel.className = 'fc-panel';
    panel.innerHTML =
      '<div class="fc-title">圈选人脸</div>' +
      '<div class="fc-hint">拖动白圈选人脸，拖动右下角圆点或用双指/滚轮缩放，确认后关系网圆圈会显示这张脸</div>' +
      '<div class="fc-stage"><img id="faceCropImg" alt="待圈选图片"><div class="fc-ring" id="faceCropRing"><div class="fc-handle" id="faceCropHandle"></div></div></div>' +
      '<div class="fc-actions">' +
        '<button type="button" class="fc-btn" id="faceCropCancel">取消</button>' +
        '<button type="button" class="fc-btn primary" id="faceCropOk">确认</button>' +
      '</div>';
    overlay.appendChild(panel);
    overlay.classList.add('active');

    var img = panel.querySelector('#faceCropImg');
    var stage = panel.querySelector('.fc-stage');
    var ring = panel.querySelector('#faceCropRing');
    var handle = panel.querySelector('#faceCropHandle');

    var st = {
      imgEl: img, stageEl: stage, ringEl: ring,
      iw: 0, ih: 0, dw: 0, dh: 0,     // 原图尺寸 / 显示尺寸
      cx: 0.5, cy: 0.5, r: 0.3,       // 归一化参数
      imgIndex: 0,
      onConfirm: opts.onConfirm, onCancel: opts.onCancel
    };
    _state = st;
    var preset = parse(opts.crop);
    if (preset) { st.cx = preset.cx; st.cy = preset.cy; st.r = preset.r; st.imgIndex = preset.img; }

    img.onload = function () {
      st.iw = img.naturalWidth; st.ih = img.naturalHeight;
      st.dw = img.clientWidth; st.dh = img.clientHeight;
      layoutRing();
    };
    img.onerror = function () { /* 保留浮层，用户可取消 */ };
    img.src = opts.src || '';

    function relayout() {
      if (!st.iw || !st.ih) return;
      st.dw = img.clientWidth; st.dh = img.clientHeight;
      layoutRing();
    }
    window.addEventListener('resize', relayout);

    // 归一化 → 像素（相对显示尺寸）
    function layoutRing() {
      if (!st.dw || !st.dh) return;
      var base = Math.min(st.dw, st.dh);
      var d = st.r * base * 2;                // 直径（px）
      var cxpx = st.cx * st.dw, cypx = st.cy * st.dh;
      ring.style.width = d + 'px';
      ring.style.height = d + 'px';
      ring.style.left = (cxpx - d / 2) + 'px';
      ring.style.top = (cypx - d / 2) + 'px';
      // 圆心 & 半径限制：圆心夹在画面内，半径不超过画面
      st.cx = clamp(cxpx / st.dw, 0, 1);
      st.cy = clamp(cypx / st.dh, 0, 1);
      st.r = clamp(st.r, 0.02, 1);
    }

    // 像素 → 归一化并刷新
    function commit(cxpx, cypx, rpx) {
      if (!st.dw || !st.dh) return;
      var base = Math.min(st.dw, st.dh);
      st.cx = clamp(cxpx / st.dw, 0, 1);
      st.cy = clamp(cypx / st.dh, 0, 1);
      st.r = clamp(rpx / base, 0.02, 1);
      layoutRing();
    }

    function ringGeom() {
      if (!st.dw || !st.dh) return null;
      var base = Math.min(st.dw, st.dh);
      var rpx = st.r * base;
      return { rpx: rpx, cxpx: st.cx * st.dw, cypx: st.cy * st.dh, base: base };
    }

    // ---- 拖拽圆心 ----
    var drag = null;
    ring.addEventListener('pointerdown', function (e) {
      if (e.target === handle) return;
      var g = ringGeom(); if (!g) return;
      drag = { mode: 'move', x: e.clientX, y: e.clientY, cx: g.cxpx, cy: g.cypx };
      ring.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointerdown', function (e) {
      var g = ringGeom(); if (!g) return;
      drag = { mode: 'size', x: e.clientX, y: e.clientY, r: g.rpx };
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);

    function onPointerMove(e) {
      if (!drag) return;
      var g = ringGeom(); if (!g) return;
      if (drag.mode === 'move') {
        commit(drag.cx + (e.clientX - drag.x), drag.cy + (e.clientY - drag.y), g.rpx);
      } else {
        // 以圆心为基准，按指针到圆心的距离定半径
        var dx = e.clientX - g.cxpx, dy = e.clientY - g.cypx;
        var nr = Math.sqrt(dx * dx + dy * dy);
        commit(g.cxpx, g.cypx, nr);
      }
    }
    function onPointerUp() { drag = null; }

    // ---- 滚轮缩放 ----
    stage.addEventListener('wheel', function (e) {
      var g = ringGeom(); if (!g) return;
      var factor = e.deltaY < 0 ? 1.08 : 0.92;
      commit(g.cxpx, g.cypx, g.rpx * factor);
      e.preventDefault();
    }, { passive: false });

    // ---- 双指缩放 ----
    var pinch = null;
    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var g = ringGeom();
        pinch = { dist: Math.sqrt(dx * dx + dy * dy), r: g ? g.rpx : 0 };
      }
    }, { passive: true });
    stage.addEventListener('touchmove', function (e) {
      if (pinch && e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var g = ringGeom(); if (g) commit(g.cxpx, g.cypx, pinch.r * (dist / pinch.dist));
        e.preventDefault();
      }
    }, { passive: false });
    stage.addEventListener('touchend', function (e) { if (e.touches.length < 2) pinch = null; }, { passive: true });

    // ---- 按钮 ----
    panel.querySelector('#faceCropCancel').onclick = function () { close(); if (st.onCancel) st.onCancel(); };
    panel.querySelector('#faceCropOk').onclick = function () {
      var out = { img: st.imgIndex, cx: st.cx, cy: st.cy, r: st.r };
      close();
      if (st.onConfirm) st.onConfirm(out);
    };

    function close() {
      overlay.classList.remove('active');
      window.removeEventListener('resize', relayout);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      _state = null;
    }
    st.close = close;
  }

  var api = { open: open, parse: parse, stringify: stringify, cropToCanvas: cropToCanvas };
  if (typeof window !== 'undefined') window.FaceCrop = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
