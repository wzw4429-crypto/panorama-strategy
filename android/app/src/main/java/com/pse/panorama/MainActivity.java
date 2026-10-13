package com.pse.panorama;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * 单页 WebView 壳：游戏为纯静态资源（classic script + Canvas），
 * 直接从 assets/www 加载，完全离线可玩。
 */
public class MainActivity extends Activity {
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 封面主题 → 游戏主题（windowBackground 从启动封面切为纯色，无闪烁）
        setTheme(R.style.Theme_Panorama);
        // 策略游戏：亮屏常驻
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0F14);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);       // 存档(localStorage)可用
        s.setAllowFileAccess(true);         // 允许 file:// 读 assets
        s.setAllowContentAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);

        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();     // 挂起 JS 定时器，省电
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    public void onBackPressed() {
        // 面板内返回优先关闭子页面；无处可退再退出
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
