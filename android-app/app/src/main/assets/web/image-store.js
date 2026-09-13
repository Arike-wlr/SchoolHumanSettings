/* ============================================================
   image-store.js —— 图片字节仓库（把图片从 IndexedDB 里搬出来）

   改造背景
   --------
   图片原本以 base64 data URL 的形式存在 characters[].images 里，带来了两个后果：

     1. 每条角色记录裹着几百 KB 的**文本**。于是 getById / 列表 / 备份 / 同步 /
        导出，每一次"读全表"都在搬运图片字节本身，而不只是图片的元信息。
     2. 同一张图在 imageCache.dataUrl 里还有第二份完整副本（用于服务端去重），
        库里的图片字节直接翻倍。

   现在记录里只保存 img://<sha256>.<ext> 这样的**引用**，字节落在 App 私有目录
   files/images/ 下，由 WebViewAssetLoader 以
   https://appassets.androidplatform.net/images/<id> 的形式直接流给渲染进程。
   这条路径完全不经过 JS 堆、不经过 base64、也不经过 JavaBridge 的字符串复制。

   退化口径
   --------
   没有原生接口时（桌面浏览器、单元测试），所有 put* 返回 null，调用方保留
   原来的 data URL 形态 —— 即与改造前**完全一致**的行为。
   这条口径很重要：既有测试因此无需改动就能继续验证同步/去重/投影等逻辑。
   ============================================================ */

var IMG_REF_SCHEME = 'img://';
var IMG_ASSET_BASE = 'https://appassets.androidplatform.net/images/';

// MIME → 文件扩展名（也用于 WebViewAssetLoader 推断 Content-Type）
var IMG_MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg'
};

// ---------- 引用判定与地址换算 ----------

function isImageRef(v) {
  return typeof v === 'string' && v.slice(0, IMG_REF_SCHEME.length).toLowerCase() === IMG_REF_SCHEME;
}

function isDataImageUrl(v) {
  return typeof v === 'string' && /^data:image\//i.test(v);
}

function imageRefId(ref) {
  return isImageRef(ref) ? ref.slice(IMG_REF_SCHEME.length) : '';
}

/** img://<id> → 页面可直接加载的 https 地址 */
function imageRefToSrc(ref) {
  return isImageRef(ref) ? IMG_ASSET_BASE + imageRefId(ref) : '';
}

/** 原生图片仓库是否可用；不可用时全链路退回 data URL */
function nativeImageStore() {
  var A = (typeof window !== 'undefined') ? window.Android : null;
  return (A && A.saveImage && A.hasImage) ? A : null;
}

function imageStoreAvailable() {
  return !!nativeImageStore();
}

/**
 * 把任意图片引用换算成能放进 <img src> 的地址。
 * img:// 引用在无原生仓库时无法解析，返回空串，由上层显示"图片不可用"占位 ——
 * 这只会发生在"图片已在 Android 上迁移成引用、却又在别处打开"的场景。
 */
function imageRefToSrcSafe(ref) {
  var v = (ref == null) ? '' : String(ref).trim();
  if (!v) return '';
  if (isImageRef(v)) return nativeImageStore() ? imageRefToSrc(v) : '';
  return /^(?:data:image\/|blob:|https?:\/\/)/i.test(v) ? v : '';
}

// ---------- 字节 / base64 / data URL 互转 ----------

function bytesToBase64(bytes) {
  var s = '';
  var CHUNK = 0x8000;   // 分块拼字符串，避免 apply 参数过多触发栈溢出
  for (var i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToBytes(b64) {
  var bin = atob(b64);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/** 解析 data URL → { mime, bytes }；解析不了返回 null */
function parseDataUrl(dataUrl) {
  var s = (dataUrl == null) ? '' : String(dataUrl);
  if (s.slice(0, 5).toLowerCase() !== 'data:') return null;
  var comma = s.indexOf(',');
  if (comma < 0) return null;
  var header = s.slice(5, comma);
  var parts = header.split(';');
  var mime = (parts[0] || '').trim() || 'text/plain';
  var isB64 = false;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].trim().toLowerCase() === 'base64') isB64 = true;
  }
  var payload = s.slice(comma + 1);
  try {
    if (isB64) return { mime: mime, bytes: base64ToBytes(payload) };
    // 非 base64 的 data URL（如 svg 的 utf8 写法）
    return { mime: mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  } catch (e) {
    return null;
  }
}

/** 按魔数嗅探真实类型：声明的 MIME 可能不准，扩展名错了 Content-Type 就错了 */
function detectImageMime(bytes) {
  if (!bytes || bytes.length < 4) return '';
  var b = bytes;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}

function imageExtFor(mime) {
  var ext = IMG_MIME_EXT[String(mime || '').trim().toLowerCase()];
  return ext || 'jpg';
}

// ---------- 内容哈希（文件名即指纹） ----------

async function imageDigestHex(bytes) {
  // SHA-256：file:// 在 Chromium 里属于安全上下文，crypto.subtle 可用
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      var buf = await crypto.subtle.digest('SHA-256', bytes);
      var view = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < view.length; i++) {
        hex += (view[i] < 16 ? '0' : '') + view[i].toString(16);
      }
      return hex;
    }
  } catch (e) { /* 环境不支持则退化 */ }
  // 退化：双通道 djb2 且把长度掺进去。前缀 f 与 SHA-256 的 64 位十六进制可区分，
  // 字符集也停在 [0-9a-z]，不会破坏原生侧 id 白名单。
  var h1 = 5381, h2 = 52711;
  for (var j = 0; j < bytes.length; j++) {
    var c = bytes[j];
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return 'f' + bytes.length.toString(36) + h1.toString(36) + h2.toString(36);
}

// ---------- 写入仓库 ----------

/**
 * 把图片字节写进仓库，返回 img:// 引用；仓库不可用或失败返回 null。
 * 文件名是内容哈希，因此写入天然幂等：同一张图重复调用只会命中"已存在"分支。
 */
async function imageStorePutBytes(bytes, mime) {
  var A = nativeImageStore();
  if (!A || !bytes || !bytes.length) return null;
  var id = (await imageDigestHex(bytes)) + '.' + imageExtFor(mime || detectImageMime(bytes));
  try {
    if (!A.hasImage(id)) {
      // 过桥的是单张图的 base64（十几 MB 量级封顶，且一次只处理一张），
      // 与改造前"整库图片一起过桥"是完全不同的量级。
      if (!A.saveImage(id, bytesToBase64(bytes))) return null;
    }
  } catch (e) {
    return null;
  }
  return IMG_REF_SCHEME + id;
}

async function imageStorePutBlob(blob) {
  if (!blob) return null;
  try {
    var bytes = new Uint8Array(await blob.arrayBuffer());
    return await imageStorePutBytes(bytes, blob.type || '');
  } catch (e) {
    return null;
  }
}

async function imageStorePutDataUrl(dataUrl) {
  var parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  return imageStorePutBytes(parsed.bytes, parsed.mime);
}

/** 引用对应的文件是否真的还在（缓存命中时也要校验，文件可能被清理过） */
function imageRefExists(ref) {
  if (!isImageRef(ref)) return false;
  var A = nativeImageStore();
  if (!A) return false;
  try { return !!A.hasImage(imageRefId(ref)); } catch (e) { return false; }
}

// ---------- 读回 ----------

/**
 * 引用 → Blob。img:// 引用走 https 取图（原生侧直接读盘，不经过 JS 堆），
 * data URL 就地解码，blob:/http(s) 直接抓。
 * 生成缩略图时用它取字节，替代改造前的 dataUrlToBlob。
 */
async function imageRefToBlob(ref) {
  var s = (ref == null) ? '' : String(ref);
  if (!s) return null;
  if (isImageRef(s)) {
    var res = await fetch(imageRefToSrc(s));
    if (!res.ok) throw new Error('图片读取失败 HTTP ' + res.status);
    return await res.blob();
  }
  if (/^data:/i.test(s)) {
    var parsed = parseDataUrl(s);
    return parsed ? new Blob([parsed.bytes], { type: parsed.mime }) : null;
  }
  if (/^blob:/i.test(s) || /^https?:\/\//i.test(s)) {
    var r = await fetch(s);
    if (!r.ok) throw new Error('图片读取失败 HTTP ' + r.status);
    return await r.blob();
  }
  return null;
}

/** 引用 → data URL。只有确实需要 base64 的场景才用（如把图片嵌进 Word 文档） */
async function imageRefToDataUrl(ref) {
  var s = (ref == null) ? '' : String(ref);
  if (/^data:/i.test(s)) return s;
  var blob = await imageRefToBlob(s);
  if (!blob) return '';
  var bytes = new Uint8Array(await blob.arrayBuffer());
  return 'data:' + (blob.type || detectImageMime(bytes) || 'image/jpeg') + ';base64,' + bytesToBase64(bytes);
}
