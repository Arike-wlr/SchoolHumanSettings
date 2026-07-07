package com.occharacters;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private WebView webView;
    private LinearLayout setupPanel;
    private EditText serverInput;
    private Button connectBtn;
    private TextView statusText;
    private SharedPreferences prefs;
    private String serverUrl;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences("server", Context.MODE_PRIVATE);
        webView = findViewById(R.id.webview);
        setupPanel = findViewById(R.id.setupPanel);
        serverInput = findViewById(R.id.serverInput);
        connectBtn = findViewById(R.id.connectBtn);
        statusText = findViewById(R.id.statusText);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError("页面加载失败，请检查后端是否正在运行");
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        connectBtn.setOnClickListener(v -> {
            String input = serverInput.getText().toString().trim();
            if (input.isEmpty()) {
                showStatus("请输入服务器地址");
                return;
            }
            input = input.replaceAll("^https?://", "");
            serverUrl = "http://" + input;
            hideKeyboard();
            testAndConnect(serverUrl);
        });

        String saved = prefs.getString("url", null);
        if (saved != null) {
            serverUrl = saved;
            testAndConnect(saved);
        }
    }

    private void testAndConnect(String url) {
        showStatus("正在连接...");
        connectBtn.setEnabled(false);
        executor.execute(() -> {
            boolean ok = pingServer(url);
            runOnUiThread(() -> {
                connectBtn.setEnabled(true);
                if (ok) {
                    prefs.edit().putString("url", url).apply();
                    showWebView(url);
                } else {
                    showStatus("无法连接到 " + url + "\n请确认后端已启动且手机和电脑在同一WiFi");
                }
            });
        });
    }

    private boolean pingServer(String url) {
        try {
            java.net.URL u = new java.net.URL(url);
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            conn.disconnect();
            return code > 0;
        } catch (Exception e) {
            return false;
        }
    }

    private void showWebView(String url) {
        setupPanel.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        // 加载移动版页面（路径前缀 /m）
        String mobileUrl = url.endsWith("/") ? url + "m" : url + "/m";
        webView.loadUrl(mobileUrl);
    }

    private void showStatus(String msg) {
        statusText.setText(msg);
        statusText.setVisibility(View.VISIBLE);
    }

    private void showError(String msg) {
        setupPanel.setVisibility(View.VISIBLE);
        webView.setVisibility(View.GONE);
        showStatus(msg);
    }

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) {
            imm.hideSoftInputFromWindow(serverInput.getWindowToken(), 0);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdownNow();
    }
}
