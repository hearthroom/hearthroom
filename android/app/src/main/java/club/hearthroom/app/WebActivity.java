package club.hearthroom.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;

/** No general native JS interface; only an origin-scoped, main-frame Blob save request. */
public final class WebActivity extends Activity {
    private static final int PICK_FILE = 41, SAVE_FILE = 42;
    private WebView web;
    private FrameLayout content;
    private ProgressBar progress;
    private TextView origin;
    private ValueCallback<Uri[]> fileChoice;
    private PageDownload download;
    private String destination;
    private boolean pageFailed;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.web);
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.web_root), (view, insets) -> {
            androidx.core.graphics.Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        content = findViewById(R.id.web_content);
        progress = findViewById(R.id.page_progress);
        origin = findViewById(R.id.page_origin);
        findViewById(R.id.return_to_site).setOnClickListener(v -> back());
        destination = WebPolicy.launchUrl(getIntent().getDataString());
        try {
            PackageInfo provider = WebView.getCurrentWebViewPackage();
            if (provider == null || !WebPolicy.supportsVersion(provider.versionName)) { showUnavailable(); return; }
            web = new WebView(this);
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) { showUnavailable(); return; }
            WebSettings settings = web.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setGeolocationEnabled(false);
            settings.setMediaPlaybackRequiresUserGesture(true);
            settings.setUserAgentString(settings.getUserAgentString() + " HearthroomApp/" + BuildConfig.VERSION_NAME);
            settings.setSupportMultipleWindows(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
            java.util.Set<String> origins = java.util.Set.of("https://hearthroom.club", "https://sukisuki.ai", "https://sukisuki.chat");
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(web, "HearthroomDownload", origins, (view, message, source, mainFrame, reply) -> {
                if (!mainFrame || !WebPolicy.isSite(source.toString()) || !WebPolicy.isSite(view.getUrl()) || !source.getHost().equals(Uri.parse(view.getUrl()).getHost())) return;
                try {
                    String raw = message.getData();
                    if (raw == null || raw.length() > 8192) return;
                    JSONObject data = new JSONObject(raw);
                    String url = data.getString("url");
                    if (url.startsWith("blob:") && WebPolicy.canDownload(view.getUrl(), url)) beginDownload(url, null, null, -1, data.optString("name"));
                } catch (Exception ignored) { /* Malformed messages have no authority. */ }
            });
            try (java.io.InputStream input = getResources().openRawResource(R.raw.download_hook)) {
                java.io.ByteArrayOutputStream script = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) script.write(buffer, 0, count);
                if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) WebViewCompat.addDocumentStartJavaScript(web, script.toString("UTF-8"), origins);
            } catch (java.io.IOException e) { showUnavailable(); return; }
            web.setWebViewClient(new Client());
            web.setWebChromeClient(new Chrome());
            web.setDownloadListener((url, ua, disposition, mime, size) -> beginDownload(url, disposition, mime, size, null));
            content.addView(web, new FrameLayout.LayoutParams(-1, -1));
            if (state == null || web.restoreState(state) == null) web.loadUrl(destination);
        } catch (RuntimeException e) { showUnavailable(); }
    }

    class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false; // Preserve iframe sandbox/origin rules.
            String url = request.getUrl().toString();
            if (WebPolicy.isHttps(url)) return false;
            if (url.startsWith("blob:") && WebPolicy.canDownload(view.getUrl(), url)) return false;
            String scheme = request.getUrl().getScheme();
            if (request.hasGesture() && ("mailto".equals(scheme) || "tel".equals(scheme))) openExternal(request.getUrl());
            return true; // No intent:, javascript:, local file or content navigation.
        }
        @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
            pageFailed = false;
            cancelDownload();
            destination = url;
            showOrigin(url);
            progress.setVisibility(View.VISIBLE);
        }
        @Override public void onPageFinished(WebView view, String url) {
            progress.setVisibility(View.GONE);
            CookieManager.getInstance().flush();
            if (!pageFailed && WebPolicy.isSite(url)) {
                // Feature detection complements the version floor; no site data leaves the view.
                view.evaluateJavascript("Boolean(window.fetch && window.ReadableStream && window.TextDecoder && window.AbortController && window.ResizeObserver && window.crypto && crypto.subtle && window.CSS && CSS.supports('color','color-mix(in srgb,red,blue)'))", result -> {
                    if (web == view && !isFinishing() && url.equals(view.getUrl()) && !"true".equals(result)) showUnavailable();
                });
            }
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) { pageFailed = true; showPageError(); }
        }
        @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel(); // Never bypass certificate errors.
        }
        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            destroyWeb();
            showMessage(R.string.web_closed, false);
            return true;
        }
    }

    private class Chrome extends WebChromeClient {
        @Override public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreen != null) { callback.onCustomViewHidden(); return; }
            fullscreen = view; fullscreenCallback = callback;
            web.setVisibility(View.GONE); content.addView(view, new FrameLayout.LayoutParams(-1,-1));
            findViewById(R.id.origin_bar).setVisibility(View.GONE);
            WindowCompat.getInsetsController(getWindow(), content).hide(WindowInsetsCompat.Type.systemBars());
        }
        @Override public void onHideCustomView() { exitFullscreen(); }
        @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChoice != null) fileChoice.onReceiveValue(null);
            fileChoice = callback;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            String[] types = params.getAcceptTypes();
            if (types.length > 0 && !types[0].isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            try { startActivityForResult(intent, PICK_FILE); }
            catch (ActivityNotFoundException e) { callback.onReceiveValue(null); fileChoice = null; toast(R.string.web_file_failed); }
            return true;
        }
        @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, android.os.Message message) {
            if (!userGesture) return false;
            // A sandboxed card may open a link; it gains no native capabilities.
            WebView popup = new WebView(WebActivity.this);
            popup.setWebViewClient(new WebViewClient() {
                private boolean open(String url) {
                    if (WebPolicy.isHttps(url)) new AlertDialog.Builder(WebActivity.this)
                        .setMessage(Uri.parse(url).getHost()).setPositiveButton(R.string.web_open_link, (d,w) -> web.loadUrl(url))
                        .setNegativeButton(R.string.not_now, null).show();
                    popup.destroy(); return true;
                }
                @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) { return open(request.getUrl().toString()); }
                @Override public void onPageStarted(WebView v, String url, Bitmap icon) { if (!"about:blank".equals(url)) { v.stopLoading(); open(url); } }
            });
            ((WebView.WebViewTransport) message.obj).setWebView(popup);
            message.sendToTarget();
            return true;
        }
        @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
    }

    private void showOrigin(String url) {
        boolean own = WebPolicy.isSite(url);
        findViewById(R.id.origin_bar).setVisibility(own ? View.GONE : View.VISIBLE);
        origin.setText(own ? "" : Uri.parse(url).getHost());
    }
    private void beginDownload(String url, String disposition, String mime, long size, String name) {
        if (download != null) return;
        if (web == null || !WebPolicy.canDownload(web.getUrl(), url) || size > WebPolicy.MAX_DOWNLOAD_BYTES) {
            toast(R.string.web_file_failed); return;
        }
        download = new PageDownload(this, web, url, () -> { download = null; toast(R.string.web_saved); }, () -> { download = null; toast(R.string.web_file_failed); });
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime == null || !mime.matches("[\\w.+-]+/[\\w.+-]+") ? "application/octet-stream" : mime)
            .putExtra(Intent.EXTRA_TITLE, name == null || name.isEmpty() ? URLUtil.guessFileName(url, disposition, mime) : name.replaceAll("[\\\\/\\p{Cntrl}]", "_").substring(0, Math.min(128, name.length())));
        try { startActivityForResult(intent, SAVE_FILE); }
        catch (ActivityNotFoundException e) { cancelDownload(); toast(R.string.web_file_failed); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && fileChoice != null) {
            Uri[] chosen = WebChromeClient.FileChooserParams.parseResult(result, data);
            if (chosen != null) for (Uri uri : chosen) if (!"content".equals(uri.getScheme())) { chosen = null; break; }
            fileChoice.onReceiveValue(chosen); fileChoice = null;
        } else if (request == SAVE_FILE && download != null) {
            if (result == RESULT_OK && data != null && data.getData() != null && "content".equals(data.getData().getScheme())) download.save(data.getData());
            else cancelDownload();
        }
    }
    private void showPageError() { showMessage(R.string.web_load_failed, false); }
    private void showUnavailable() { destroyWeb(); showMessage(R.string.web_unavailable, true); }
    private void showMessage(int message, boolean settings) {
        progress.setVisibility(View.GONE);
        content.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL);
        int padding = (int)(24 * getResources().getDisplayMetrics().density); panel.setPadding(padding,padding,padding,padding);
        TextView text = new TextView(this); text.setText(message); text.setTextSize(18); text.setTextColor(getColor(R.color.text)); panel.addView(text);
        Button retry = new Button(this); retry.setText(R.string.retry); retry.setAllCaps(false); panel.addView(retry);
        retry.setOnClickListener(v -> {
            if (web == null) recreate();
            else { content.removeAllViews(); content.addView(web); web.loadUrl(WebPolicy.isHttps(destination) ? destination : WebPolicy.HOME); }
        });
        if (settings) {
            Button update = new Button(this); update.setText(R.string.open_settings); update.setAllCaps(false); panel.addView(update);
            update.setOnClickListener(v -> { try { startActivity(new Intent(Settings.ACTION_SETTINGS)); } catch (ActivityNotFoundException ignored) {} });
            Button browser = new Button(this); browser.setText(R.string.web_open_browser); browser.setAllCaps(false); panel.addView(browser);
            browser.setOnClickListener(v -> openExternal(Uri.parse(WebPolicy.HOME)));
        }
        scroll.addView(panel); content.addView(scroll);
    }
    private void openExternal(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
        // Target a browser explicitly so our own verified app link cannot loop back here.
        if ("https".equals(uri.getScheme())) {
            Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")).addCategory(Intent.CATEGORY_BROWSABLE);
            java.util.List<android.content.pm.ResolveInfo> choices = getPackageManager().queryIntentActivities(probe, 0);
            if (choices.isEmpty()) { toast(R.string.web_no_browser); return; }
            intent.setPackage(choices.get(0).activityInfo.packageName);
        }
        try { startActivity(intent); } catch (ActivityNotFoundException e) { toast(R.string.web_no_browser); }
    }
    private void toast(int text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private void exitFullscreen() {
        if (fullscreen == null) return;
        content.removeView(fullscreen); fullscreen = null;
        if (web != null) { web.setVisibility(View.VISIBLE); showOrigin(web.getUrl()); }
        WindowCompat.getInsetsController(getWindow(), content).show(WindowInsetsCompat.Type.systemBars());
        WebChromeClient.CustomViewCallback callback = fullscreenCallback; fullscreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }
    private void back() { if (fullscreen != null) exitFullscreen(); else if (web != null && web.canGoBack()) web.goBack(); else finish(); }
    @Override public void onBackPressed() { back(); }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); if (web != null) web.saveState(state); }
    @Override protected void onPause() { if (web != null) { web.onPause(); CookieManager.getInstance().flush(); } super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    private void cancelDownload() { if (download != null) { download.cancel(); download = null; } }
    private void destroyWeb() { exitFullscreen(); cancelDownload(); if (web != null) { content.removeView(web); web.destroy(); web = null; } }
    @Override protected void onDestroy() { if (fileChoice != null) fileChoice.onReceiveValue(null); destroyWeb(); super.onDestroy(); }
}
