/**
 * 设定集导出：把整库排成一本可离线阅读的 HTML。
 *
 * 渲染全部在后端（/api/export/setting-book），这里只负责收集选项、拼 URL。
 * 之所以不在前端拼 HTML：86 个角色 + 51 条世界观 + 图片 base64，浏览器里拼会卡，
 * 而且后端能直接复用缩略图和 HTML 转义。
 */
var bookGroup = 'family';

function openBookModal() {
  var el = document.getElementById('bookOverlay');
  if (!el) return;
  el.classList.add('active');
}

function closeBookModal() {
  var el = document.getElementById('bookOverlay');
  if (el) el.classList.remove('active');
}

function pickBookGroup(btn) {
  if (!btn) return;
  bookGroup = btn.getAttribute('data-group') || 'family';
  var chips = document.querySelectorAll('#bookOverlay .book-chip');
  for (var i = 0; i < chips.length; i++) {
    chips[i].classList.toggle('active', chips[i] === btn);
  }
}

function bookUrl(download) {
  var w = document.getElementById('bookWorld');
  var r = document.getElementById('bookRel');
  var q = [
    'group=' + encodeURIComponent(bookGroup),
    'world=' + (w && w.checked ? 1 : 0),
    'rel=' + (r && r.checked ? 1 : 0),
    'img=thumb',
  ];
  if (download) q.push('download=1');
  return '/api/export/setting-book?' + q.join('&');
}

function previewBook() {
  // 先开窗再关弹窗：某些浏览器会拦「点击后异步打开」的窗口，这里保持同一次用户手势内。
  window.open(bookUrl(false), '_blank');
  closeBookModal();
}

function downloadBook() {
  // 用隐藏 iframe 触发下载，避免 location 跳转让当前页状态丢掉
  var iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = bookUrl(true);
  document.body.appendChild(iframe);
  setTimeout(function () {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }, 20000);
  closeBookModal();
  if (typeof showToast === 'function') showToast('正在生成设定集…', 'success');
}

// 点遮罩空白处关闭
document.addEventListener('click', function (e) {
  var ov = e.target;
  if (ov && ov.id === 'bookOverlay') closeBookModal();
});

// ESC 关闭
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    var el = document.getElementById('bookOverlay');
    if (el && el.classList.contains('active')) closeBookModal();
  }
});
