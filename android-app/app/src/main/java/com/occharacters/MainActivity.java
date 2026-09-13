package com.occharacters;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private JsBridge jsBridge;                     // 持有引用，onDestroy 时好收尾未完成的备份
    private static final int FILE_CHOOSER_REQUEST = 100;

    // ==================== 崩溃日志 ====================
    // 目的：闪退后不依赖电脑/adb，直接在 App 内看到原因。覆盖三类现场：
    //   1. Java 未捕获异常      —— 有完整堆栈
    //   2. WebView 渲染进程崩溃 —— 没有 Java 堆栈，但能记录 didCrash
    //   3. 前台进程被系统直接杀死（OOM 等）—— 没有任何回调，下次启动时补记
    private static final String CRASH_LOG_NAME = "crash_log.txt";
    private static final long CRASH_LOG_MAX_BYTES = 256 * 1024L;   // 单文件上限
    private static final long CRASH_LOG_KEEP_BYTES = 128 * 1024L;  // 超限时保留的尾部长度
    private static boolean crashHandlerInstalled = false;

    // ==================== 流式备份 ====================
    // 整份备份 JSON 一次性从 JS 过桥时，App 进程要在 384MB 的 Java 堆里再复制一份等大的
    // String。数据量涨到几百 MB 时这是必崩的操作（2026-09-12 日志：JavaBridge 线程申请
    // 434MB，而堆上限 384MB、系统内存却有 2.5GB 空闲 —— 说明卡点是这一次复制，不是手机内存）。
    // 改成 begin → 多次 append(小片) → end，单次过桥由 JS 侧限制在 1MB 字符以内，
    // 内存峰值从此与数据总量无关。
    private static final String BACKUP_FILE_NAME = "data_backup.json";
    private static final String BACKUP_TMP_NAME = "data_backup.json.tmp";

    // ==================== 图片文件仓库 ====================
    // 图片字节从 IndexedDB（base64 文本）搬到私有目录文件：files/images/<sha256>.<ext>。
    // 文件名就是内容哈希，所以同一张图无论被引用多少次都只存一份，内容不可变、可长缓存。
    // 页面通过 https://appassets.androidplatform.net/images/<id> 取图，由 WebViewAssetLoader
    // 直接从磁盘读进渲染进程 —— 不经过 JS 堆、不经过 base64、也不经过 JavaBridge 的字符串复制。
    private static final String IMAGES_DIR = "images";
    private WebViewAssetLoader assetLoader;

    // 文件导出相关
    private ActivityResultLauncher<Intent> saveFileLauncher;
    private byte[] pendingFileBytes;
    private String pendingFileName;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        installCrashHandler();
        checkAbnormalExit();
        cleanStaleBackupTemp();

        webView = findViewById(R.id.webview);

        WebSettings settings = webView.getSettings();
        // 核心：启用 JS + DOM 存储 + IndexedDB
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // 允许访问本地文件（assets）
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        // 视口适配
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        // 缩放
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        // 允许混合内容（同步时 http 请求）
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // 离线优先：优先使用缓存
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 缓存策略：只在覆盖安装后的第一次启动清一次缓存，保证加载 APK 内最新资源；
        // 不再每次启动都全量清缓存——那是同步磁盘 IO，会在启动内存峰值上再叠一层。
        clearCacheIfAppUpdated();

        // 图片仓库路由：https://appassets.androidplatform.net/images/<id> → files/images/<id>。
        // 用官方 WebViewAssetLoader 而非手搓 shouldInterceptRequest：MIME 推断、Range 请求、
        // 路径穿越防护它都已经处理好了（这几样自己写很容易漏，漏了就是安全漏洞）。
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/images/", new WebViewAssetLoader.InternalStoragePathHandler(
                        this, new File(getFilesDir(), IMAGES_DIR)))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (assetLoader == null) return null;
                WebResourceResponse response = assetLoader.shouldInterceptRequest(request.getUrl());
                if (response == null) return null;
                // 页面是从 file:// 加载的，到这里取图属于跨域请求：
                // <img> 不受同源限制，但生成缩略图用的 fetch() 必须拿到 CORS 头才放行。
                Map<String, String> headers = new HashMap<>();
                if (response.getResponseHeaders() != null) headers.putAll(response.getResponseHeaders());
                headers.put("Access-Control-Allow-Origin", "*");
                // 文件名即内容哈希：同一 id 的内容永不改变，可以放心长缓存，
                // 避免列表滚动时对同一张图反复读盘。
                headers.put("Cache-Control", "public, max-age=31536000, immutable");
                response.setResponseHeaders(headers);
                return response;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // 忽略非主框架的错误（图片、API 等）
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // 渲染进程崩溃最典型的诱因就是内存不足（大图/base64 撑爆）。
                // 不接管的话系统会连带杀掉整个 App —— 外部看到的就是"闪退"。
                // 返回 true = 已处理，随后重建一个干净的 WebView 继续用。
                boolean didCrash = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        && detail != null && detail.didCrash();
                appendCrashLog(getApplicationContext(),
                        "\n========== WebView 渲染进程终止 ==========\n"
                                + deviceInfo(MainActivity.this)
                                + "didCrash=" + didCrash + "\n");
                // 短时间反复崩就不重启了，否则会陷入"重建-崩溃"死循环
                SharedPreferences sp = getSharedPreferences("app_cache", MODE_PRIVATE);
                long now = System.currentTimeMillis();
                long last = sp.getLong("render_crash_at", 0L);
                int count = (now - last > 60000L) ? 0 : sp.getInt("render_crash_count", 0);
                count++;
                sp.edit().putLong("render_crash_at", now).putInt("render_crash_count", count).apply();
                if (count > 2) {
                    Toast.makeText(MainActivity.this,
                            "页面反复崩溃，请重启应用。原因已记录，见首页「诊断日志」。",
                            Toast.LENGTH_LONG).show();
                    return true;
                }
                Toast.makeText(MainActivity.this, "页面渲染进程异常，正在恢复…", Toast.LENGTH_SHORT).show();
                recreate();
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                             WebChromeClient.FileChooserParams fileChooserParams) {
                MainActivity.this.filePathCallback = filePathCallback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                // 根据 HTML input 的 accept 属性动态设置 MIME 类型，默认允许所有文件
                // 否则硬编码 image/* 会导致文档页只能上传图片
                String[] acceptTypes = fileChooserParams.getAcceptTypes();
                String primaryType = "*/*";
                java.util.List<String> validTypes = new java.util.ArrayList<>();
                if (acceptTypes != null) {
                    for (String t : acceptTypes) {
                        if (t != null && !t.isEmpty() && t.contains("/")) {
                            validTypes.add(t);
                        }
                    }
                }
                if (!validTypes.isEmpty()) {
                    primaryType = validTypes.get(0);
                    if (validTypes.size() > 1) {
                        intent.putExtra(Intent.EXTRA_MIME_TYPES,
                                validTypes.toArray(new String[0]));
                    }
                }
                intent.setType(primaryType);
                startActivityForResult(Intent.createChooser(intent, "选择文件"), FILE_CHOOSER_REQUEST);
                return true;
            }
        });

        // 注册文件保存启动器
        saveFileLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                new ActivityResultCallback<ActivityResult>() {
                    @Override
                    public void onActivityResult(ActivityResult result) {
                        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                            Uri uri = result.getData().getData();
                            if (uri != null && pendingFileBytes != null) {
                                writeToUri(uri);
                            }
                        }
                        pendingFileBytes = null;
                        pendingFileName = null;
                    }
                });

        // 暴露 JS 接口给网页调用
        jsBridge = new JsBridge();
        webView.addJavascriptInterface(jsBridge, "Android");

        // 直接加载本地离线页面
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl("file:///android_asset/web/index.html");
    }

    /**
     * 只在"本次安装/覆盖安装"后的第一次启动清空 WebView 缓存。
     * 用 lastUpdateTime 而不是 versionCode：即使忘了升 versionCode，
     * 覆盖安装也会刷新资源，不会继续命中旧的 db.js / app.js。
     * 同时避免每次冷启动都做全量清缓存。
     */
    private void clearCacheIfAppUpdated() {
        try {
            long stamp = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            android.content.SharedPreferences sp = getSharedPreferences("app_cache", MODE_PRIVATE);
            if (sp.getLong("cleared_update_time", -1L) != stamp) {
                webView.clearCache(true);
                sp.edit().putLong("cleared_update_time", stamp).apply();
            }
        } catch (Exception e) {
            // 取安装时间失败时保守处理：清一次，保证资源刷新
            try { webView.clearCache(true); } catch (Exception ignore) { }
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onStop() {
        // 放在 onStop 而非 onPause：先让页面 hidden 那一刻触发的退出备份跑完，
        // 再冻结 JS 定时器，避免应用退到后台后还继续解码图片、写 IndexedDB。
        if (webView != null) {
            webView.pauseTimers();
        }
        // 能走到 onStop 说明进程是「活着退出前台」的，不算异常退出。
        // 若下次启动时该标记仍为 true，说明进程是在前台被直接干掉的（OOM / 原生崩溃），
        // 那种情况拿不到任何 Java 堆栈，只能靠这个标记补记一条现场。
        getSharedPreferences("app_cache", MODE_PRIVATE).edit()
                .putBoolean("session_foreground", false).commit();
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        // 关键：WebView 不 destroy 会连同 Activity、JS 定时器、已解码图片一起泄漏。
        // 低内存机型上「退出再进入」= 进程里叠出第二个 WebView，内存翻倍后 OOM 闪退。
        if (webView != null) {
            try {
                webView.stopLoading();
                webView.loadUrl("about:blank");   // 解除对当前页面/Activity 的引用
                webView.setWebChromeClient(null);
                webView.setWebViewClient(null);
                webView.removeAllViews();
                android.view.ViewGroup parent = (android.view.ViewGroup) webView.getParent();
                if (parent != null) parent.removeView(webView);
                webView.destroy();
            } catch (Exception ignore) {
                // destroy 失败不影响退出流程
            }
            webView = null;
        }
        filePathCallback = null;
        pendingFileBytes = null;
        pendingFileName = null;
        if (jsBridge != null) {
            jsBridge.abortBackup();   // 备份写到一半就退出：作废临时文件，不动上一份完整备份
            jsBridge = null;
        }
        super.onDestroy();
    }

    /** JS 可调用的原生方法：弹出保存对话框并写入文件 */
    public class JsBridge {
        @JavascriptInterface
        public void saveFile(String base64Data, String fileName) {
            runOnUiThread(() -> doSaveFile(base64Data, fileName));
        }

        /**
         * 自动备份：把核心数据 JSON 写入 App 私有目录 files/data_backup.json。
         * 私有目录不受"清理缓存/存储压力清理"影响（除非用户手动清除数据或卸载 App），
         * 作为 IndexedDB 被系统误清的兜底。
         * 这里用 OutputStreamWriter 流式写：json 往往很大（内含 base64 原图），
         * getBytes() 会再复制一份等大的 byte[]，是切后台 OOM 的常见诱因。
         */
        @JavascriptInterface
        public void saveBackup(String json) {
            if (json == null) return;
            java.io.OutputStreamWriter writer = null;
            try {
                java.io.File f = new java.io.File(getFilesDir(), "data_backup.json");
                writer = new java.io.OutputStreamWriter(
                        new java.io.FileOutputStream(f), java.nio.charset.StandardCharsets.UTF_8);
                writer.write(json);
            } catch (Exception e) {
                // 备份失败不打断主流程
            } finally {
                if (writer != null) {
                    try { writer.close(); } catch (Exception ignore) { }
                }
            }
        }

        // ---------- 图片文件仓库 ----------
        // 页面侧只传 <sha256>.<ext> 这样的 id，路径穿越由 imageFile() 的白名单挡掉。

        /** id → 私有目录下的图片文件；id 只允许 [A-Za-z0-9._-]，其余一律拒绝 */
        private File imageFile(String id) {
            if (id == null || id.isEmpty() || id.length() > 128) return null;
            for (int i = 0; i < id.length(); i++) {
                char c = id.charAt(i);
                boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                        || c == '.' || c == '_' || c == '-';
                if (!ok) return null;
            }
            return new File(new File(getFilesDir(), IMAGES_DIR), id);
        }

        /** 这张图是否已经在仓库里（JS 侧据此决定用引用还是退回 data URL） */
        @JavascriptInterface
        public boolean hasImage(String id) {
            File f = imageFile(id);
            return f != null && f.isFile();
        }

        /**
         * 保存一张图片。id 是内容哈希，已存在即同一张图，直接跳过。
         * base64 由 JS 侧剥掉 data URL 前缀后传入，避免这里再切一次大字符串（那是纯浪费的复制）。
         */
        @JavascriptInterface
        public boolean saveImage(String id, String base64) {
            File dst = imageFile(id);
            if (dst == null || base64 == null || base64.isEmpty()) return false;
            if (dst.isFile()) return true;
            FileOutputStream out = null;
            File tmp = null;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                File dir = dst.getParentFile();
                if (dir != null) dir.mkdirs();
                tmp = new File(dir, id + ".tmp");
                out = new FileOutputStream(tmp);
                out.write(bytes);
                out.flush();
                out.getFD().sync();
                out.close();
                out = null;
                // 先写临时文件再改名：中途被杀只会留个 .tmp，不会留下半个图片（半张图是解不开的）
                if (!tmp.renameTo(dst)) { copyFile(tmp, dst); tmp.delete(); }
                return dst.isFile();
            } catch (Throwable e) {
                return false;
            } finally {
                if (out != null) { try { out.close(); } catch (Exception ignore) { } }
                if (tmp != null && tmp.exists()) { try { tmp.delete(); } catch (Exception ignore) { } }
            }
        }

        /** 删除一张图片（仅在确认没有任何记录引用它时才该调用） */
        @JavascriptInterface
        public boolean deleteImage(String id) {
            File f = imageFile(id);
            if (f == null || !f.isFile()) return false;
            try {
                return f.delete();
            } catch (Throwable e) {
                return false;
            }
        }

        /** 仓库里现有全部图片 id（JSON 数组字符串；用于统计与清理孤儿文件） */
        @JavascriptInterface
        public String listImages() {
            File[] files = new File(getFilesDir(), IMAGES_DIR).listFiles();
            if (files == null) return "[]";
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (File f : files) {
                String n = f.getName();
                if (!f.isFile() || n.endsWith(".tmp")) continue;
                if (!first) sb.append(',');
                first = false;
                sb.append('"').append(n).append('"');
            }
            return sb.append(']').toString();
        }

        // ---------- 流式备份（防 OOM） ----------
        // 与 saveBackup 的区别：不再要求 JS 把整份 JSON 当一个参数传进来，
        // 而是 begin → 多次 append(≤1MB 的小片) → end。原因见 BACKUP_FILE_NAME 处的说明。

        private java.io.FileOutputStream backupOut = null;
        private java.io.File backupTmp = null;

        /** 开始一次备份：先写临时文件，endBackup 时才原子替换正式文件 */
        @JavascriptInterface
        public synchronized void beginBackup() {
            abortBackup();
            try {
                backupTmp = new java.io.File(getFilesDir(), BACKUP_TMP_NAME);
                backupOut = new java.io.FileOutputStream(backupTmp);
            } catch (Exception e) {
                backupTmp = null;
                backupOut = null;
            }
        }

        /** 追加一片备份内容；单片 1MB 量级，不构成大分配 */
        @JavascriptInterface
        public synchronized void appendBackup(String chunk) {
            if (backupOut == null || chunk == null || chunk.isEmpty()) return;
            try {
                backupOut.write(chunk.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            } catch (Exception e) {
                // 写失败就作废本次：宁可留上一份完整备份，也不落一份残缺数据
                abortBackup();
            }
        }

        /** 结束备份：落盘后原子替换。中途被杀只会留下 .tmp，正式文件永远是一份完整 JSON */
        @JavascriptInterface
        public synchronized void endBackup() {
            if (backupOut == null) return;
            try {
                backupOut.flush();
                backupOut.getFD().sync();     // 备份的意义就是扛住异常退出，先落盘再改名
            } catch (Exception ignore) {
            }
            try {
                backupOut.close();
            } catch (Exception ignore) {
            }
            backupOut = null;
            if (backupTmp == null) return;
            try {
                java.io.File dst = new java.io.File(getFilesDir(), BACKUP_FILE_NAME);
                // rename 在同一文件系统内是原子的、且直接覆盖目标，不会出现"目标已删、新文件未就位"的空档
                if (!backupTmp.renameTo(dst)) {
                    if (dst.exists()) dst.delete();
                    if (!backupTmp.renameTo(dst)) copyFile(backupTmp, dst);
                }
            } catch (Exception ignore) {
            }
            try {
                if (backupTmp.exists()) backupTmp.delete();
            } catch (Exception ignore) {
            }
            backupTmp = null;
        }

        /** 放弃本次备份（JS 抛错或写入失败时调用） */
        @JavascriptInterface
        public synchronized void abortBackup() {
            if (backupOut != null) {
                try { backupOut.close(); } catch (Exception ignore) { }
                backupOut = null;
            }
            if (backupTmp != null) {
                try { backupTmp.delete(); } catch (Exception ignore) { }
                backupTmp = null;
            }
        }

        /** 备份文件字节数；恢复时用来分段读取 */
        @JavascriptInterface
        public long backupBytes() {
            java.io.File f = new java.io.File(getFilesDir(), BACKUP_FILE_NAME);
            return f.exists() ? f.length() : 0L;
        }

        /**
         * 按字节区间读备份并返回 Base64。整份 String 一次性返回同样会在 Java 堆里炸
         * （和写入侧对称的坑），所以只交付小片，由 JS 侧用 TextDecoder 流式拼回。
         */
        @JavascriptInterface
        public String readBackupBytes(long offset, int length) {
            if (offset < 0 || length <= 0) return "";
            java.io.RandomAccessFile raf = null;
            try {
                java.io.File f = new java.io.File(getFilesDir(), BACKUP_FILE_NAME);
                if (!f.exists()) return "";
                raf = new java.io.RandomAccessFile(f, "r");
                long size = raf.length();
                if (offset >= size) return "";
                byte[] buf = new byte[(int) Math.min((long) length, size - offset)];
                raf.seek(offset);
                raf.readFully(buf);
                return Base64.encodeToString(buf, Base64.NO_WRAP);
            } catch (Throwable e) {
                return "";
            } finally {
                if (raf != null) {
                    try { raf.close(); } catch (Throwable ignore) { }
                }
            }
        }

        /** 读取自动备份内容；没有备份则返回空串（同样流式读，避免 byte[] + String 双份） */
        @JavascriptInterface
        public String loadBackup() {
            java.io.File f = new java.io.File(getFilesDir(), "data_backup.json");
            if (!f.exists() || f.length() == 0) return "";
            java.io.InputStreamReader reader = null;
            try {
                reader = new java.io.InputStreamReader(
                        new java.io.FileInputStream(f), java.nio.charset.StandardCharsets.UTF_8);
                StringBuilder sb = new StringBuilder((int) Math.min(f.length(), 1 << 20));
                char[] buf = new char[65536];
                int n;
                while ((n = reader.read(buf)) > 0) sb.append(buf, 0, n);
                return sb.toString();
            } catch (Exception e) {
                return "";
            } finally {
                if (reader != null) {
                    try { reader.close(); } catch (Exception ignore) { }
                }
            }
        }

        /** 是否存在自动备份文件 */
        @JavascriptInterface
        public boolean hasBackup() {
            return new java.io.File(getFilesDir(), "data_backup.json").exists();
        }

        // ---------- 崩溃日志（诊断用） ----------

        /** 读取崩溃日志全文；没有记录则返回空串（流式读，避免大日志多占一份内存） */
        @JavascriptInterface
        public String readCrashLog() {
            java.io.File f = new java.io.File(getFilesDir(), CRASH_LOG_NAME);
            if (!f.exists() || f.length() == 0) return "";
            java.io.InputStreamReader reader = null;
            try {
                reader = new java.io.InputStreamReader(
                        new java.io.FileInputStream(f), java.nio.charset.StandardCharsets.UTF_8);
                StringBuilder sb = new StringBuilder((int) Math.min(f.length(), 1 << 18));
                char[] buf = new char[32768];
                int n;
                while ((n = reader.read(buf)) > 0) sb.append(buf, 0, n);
                return sb.toString();
            } catch (Exception e) {
                return "";
            } finally {
                if (reader != null) {
                    try { reader.close(); } catch (Exception ignore) { }
                }
            }
        }

        /** 有没有崩溃记录（首页据此决定要不要显示红点提醒） */
        @JavascriptInterface
        public boolean hasCrashLog() {
            return new java.io.File(getFilesDir(), CRASH_LOG_NAME).length() > 0;
        }

        /** 清空崩溃日志 */
        @JavascriptInterface
        public void clearCrashLog() {
            try {
                new java.io.FileOutputStream(new java.io.File(getFilesDir(), CRASH_LOG_NAME)).close();
            } catch (Exception ignore) {
            }
        }

        /** 网页侧未捕获的 JS 错误也记进来，和原生崩溃放在一起看 */
        @JavascriptInterface
        public void logJsError(String message) {
            if (message == null || message.isEmpty()) return;
            appendCrashLog(getApplicationContext(),
                    "\n---------- JS 错误 ----------\n" + message + "\n");
        }

        /** 设备 / 内存信息，供页面直接展示 */
        @JavascriptInterface
        public String deviceInfo() {
            return MainActivity.deviceInfo(MainActivity.this);
        }
    }

    private void doSaveFile(String base64Data, String fileName) {
        try {
            // 去掉可能的数据 URL 前缀
            String clean = base64Data;
            if (clean.contains(",")) {
                clean = clean.substring(clean.indexOf(",") + 1);
            }
            pendingFileBytes = Base64.decode(clean, Base64.DEFAULT);
            pendingFileName = fileName;

            String lower = fileName == null ? "" : fileName.toLowerCase(java.util.Locale.US);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            // 按扩展名给 MIME：诊断日志导出的是 txt，用 json 类型会被某些机型改成 .json
            intent.setType(lower.endsWith(".txt") ? "text/plain"
                    : lower.endsWith(".json") ? "application/json"
                    : "application/octet-stream");
            intent.putExtra(Intent.EXTRA_TITLE, fileName);
            saveFileLauncher.launch(intent);
        } catch (Exception e) {
            Toast.makeText(this, "导出失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void writeToUri(Uri uri) {
        try {
            OutputStream os = getContentResolver().openOutputStream(uri);
            if (os != null) {
                os.write(pendingFileBytes);
                os.close();
                Toast.makeText(this, "已导出: " + pendingFileName, Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "保存失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK) {
                    if (data != null) {
                        if (data.getClipData() != null) {
                            int count = data.getClipData().getItemCount();
                            results = new Uri[count];
                            for (int i = 0; i < count; i++) {
                                results[i] = data.getClipData().getItemAt(i).getUri();
                            }
                        } else if (data.getData() != null) {
                            results = new Uri[]{data.getData()};
                        }
                    } else {
                        // 某些机型直接返回 null data
                        results = new Uri[]{};
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    // ==================== 崩溃现场记录 ====================

    /** 只装一次：Activity 重建时重复安装会让 handler 层层嵌套，同一条崩溃被记很多遍 */
    private void installCrashHandler() {
        if (crashHandlerInstalled) return;
        crashHandlerInstalled = true;
        final Context appCtx = getApplicationContext();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, Throwable e) {
                try {
                    StringBuilder sb = new StringBuilder();
                    sb.append("\n########## 未捕获异常 ##########\n");
                    sb.append(deviceInfo(appCtx));
                    sb.append("线程  : ").append(thread.getName()).append('\n');
                    sb.append("异常  : ").append(e.getClass().getName())
                      .append(": ").append(e.getMessage()).append('\n');
                    java.io.StringWriter sw = new java.io.StringWriter();
                    e.printStackTrace(new java.io.PrintWriter(sw));
                    sb.append(sw).append('\n');
                    // 真正有信息量的往往是 cause（Java 习惯把根因包在 RuntimeException 里）
                    Throwable cause = e.getCause();
                    int depth = 0;
                    while (cause != null && depth < 3) {
                        sb.append("---- 根因 ").append(depth + 1).append(" ----\n");
                        java.io.StringWriter cw = new java.io.StringWriter();
                        cause.printStackTrace(new java.io.PrintWriter(cw));
                        sb.append(cw).append('\n');
                        cause = cause.getCause();
                        depth++;
                    }
                    sb.append("########## 记录结束 ##########\n");
                    appendCrashLog(appCtx, sb.toString());
                } catch (Throwable ignore) {
                    // 记日志本身再出错就直接放弃，绝不能改变崩溃的原始行为
                }
                if (previous != null) previous.uncaughtException(thread, e);
            }
        });
    }

    /** 上次是否在前台被直接杀掉；是的话补记一条（OOM 场景压根没有堆栈可抓，只能靠这个） */
    private void checkAbnormalExit() {
        SharedPreferences sp = getSharedPreferences("app_cache", MODE_PRIVATE);
        if (sp.getBoolean("session_foreground", false)) {
            appendCrashLog(getApplicationContext(),
                    "\n========== 非正常退出 ==========\n"
                            + deviceInfo(this)
                            + "上次进程没有走到 onStop，是被系统在前台直接终止的。\n"
                            + "这种退出没有 Java 堆栈，绝大多数是内存不足（OOM）导致的。\n");
        }
        sp.edit().putBoolean("session_foreground", true).commit();
    }

    /**
     * 清理上次备份写到一半留下的临时文件。
     * 正常流程里 endBackup 会把它改名成正式文件，留下 .tmp 就说明上次写到一半进程没了。
     * 直接删掉 —— 正式文件仍是上一份完整备份，绝不能让半个 JSON 覆盖它。
     */
    private void cleanStaleBackupTemp() {
        try {
            java.io.File tmp = new java.io.File(getFilesDir(), BACKUP_TMP_NAME);
            if (tmp.exists()) tmp.delete();
        } catch (Throwable ignore) {
        }
    }

    /** renameTo 失败（跨挂载点等极少见情况）时的退化路径：逐块拷贝 */
    private static void copyFile(java.io.File src, java.io.File dst) {
        java.io.FileInputStream in = null;
        java.io.FileOutputStream out = null;
        try {
            in = new java.io.FileInputStream(src);
            out = new java.io.FileOutputStream(dst);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
        } catch (Exception ignore) {
        } finally {
            if (in != null) { try { in.close(); } catch (Exception ignore) { } }
            if (out != null) { try { out.close(); } catch (Exception ignore) { } }
        }
    }

    /**
     * 追加写崩溃日志。
     * 全程吞异常：日志是诊断手段，任何情况下都不允许它反过来影响 App 运行。
     */
    static void appendCrashLog(Context ctx, String text) {
        if (ctx == null || text == null) return;
        java.io.FileOutputStream fos = null;
        try {
            java.io.File f = new java.io.File(ctx.getFilesDir(), CRASH_LOG_NAME);
            if (f.length() > CRASH_LOG_MAX_BYTES) trimCrashLog(f);
            fos = new java.io.FileOutputStream(f, true);
            fos.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            fos.flush();
        } catch (Throwable ignore) {
        } finally {
            if (fos != null) {
                try { fos.close(); } catch (Throwable ignore) { }
            }
        }
    }

    /** 超限时只保留尾部，避免日志文件无限膨胀 */
    private static void trimCrashLog(java.io.File f) {
        java.io.RandomAccessFile raf = null;
        try {
            raf = new java.io.RandomAccessFile(f, "rw");
            long len = raf.length();
            long keep = Math.min(CRASH_LOG_KEEP_BYTES, len);
            byte[] tail = new byte[(int) keep];
            raf.seek(len - keep);
            raf.readFully(tail);
            raf.setLength(0);
            raf.seek(0);
            raf.write("=== 早期日志已截断 ===\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            raf.write(tail);
        } catch (Throwable ignore) {
        } finally {
            if (raf != null) {
                try { raf.close(); } catch (Throwable ignore) { }
            }
        }
    }

    /** 设备 / 内存 / WebView 版本 —— 判断 OOM 与渲染兼容问题的关键上下文 */
    static String deviceInfo(Context ctx) {
        StringBuilder sb = new StringBuilder();
        try {
            sb.append("时间  : ").append(stamp()).append('\n');
            sb.append("机型  : ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n');
            sb.append("系统  : Android ").append(Build.VERSION.RELEASE)
              .append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
            if (Build.SUPPORTED_ABIS.length > 0) {
                sb.append("ABI   : ").append(Build.SUPPORTED_ABIS[0]).append('\n');
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.content.pm.PackageInfo wv = WebView.getCurrentWebViewPackage();
                if (wv != null) sb.append("WebView: ").append(wv.versionName).append('\n');
            }
            sb.append("堆上限: ").append(Runtime.getRuntime().maxMemory() / 1048576L).append("MB\n");
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                sb.append("内存  : 可用 ").append(mi.availMem / 1048576L)
                  .append("MB / 总计 ").append(mi.totalMem / 1048576L)
                  .append("MB / 低内存线 ").append(mi.threshold / 1048576L)
                  .append("MB / 系统低内存=").append(mi.lowMemory).append('\n');
            }
        } catch (Throwable ignore) {
        }
        return sb.toString();
    }

    private static String stamp() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", java.util.Locale.US)
                .format(new java.util.Date());
    }
}
