package com.occharacters;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

import java.io.OutputStream;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 100;

    // 文件导出相关
    private ActivityResultLauncher<Intent> saveFileLauncher;
    private byte[] pendingFileBytes;
    private String pendingFileName;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

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

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // 忽略非主框架的错误（图片、API 等）
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
        webView.addJavascriptInterface(new JsBridge(), "Android");

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

            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
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
}
