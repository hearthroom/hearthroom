package club.hearthroom.app;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.WebView;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.*;
import java.net.*;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Saves only to a document explicitly selected by the user; never exposes a JS/native bridge. */
final class PageDownload {
    private final Context context;
    private final WebView web;
    private final String url, owner, key = "__hrDownload" + UUID.randomUUID().toString().replace("-", "");
    private final Runnable success, failure;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final long deadline = SystemClock.elapsedRealtime() + 120000;
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;
    private Uri target;
    private OutputStream output;
    private int offset;

    PageDownload(Context context, WebView web, String url, Runnable success, Runnable failure) {
        this.context = context; this.web = web; this.url = url; this.owner = web.getUrl(); this.success = success; this.failure = failure;
        if (url.startsWith("blob:")) {
            // Capture the Blob now, before the page revokes its object URL or the user picks a folder.
            web.evaluateJavascript("(function(){var s=window[" + quote(key) + "]={},p=window.__hrPendingBlob;delete window.__hrPendingBlob;"
                + "(p&&p.url===" + quote(url) + "?p.blob:fetch(" + quote(url) + ").then(function(r){return r.blob()}))"
                + ".then(function(b){if(b.size>" + WebPolicy.MAX_DOWNLOAD_BYTES
                + "){s.error=true}else{s.blob=b;s.size=b.size}}).catch(function(){s.error=true});})()", null);
        }
    }
    void save(Uri target) {
        this.target = target;
        if (url.startsWith("blob:")) pollBlob();
        else {
            String cookie = CookieManager.getInstance().getCookie(url);
            String agent = web.getSettings().getUserAgentString();
            worker.execute(() -> {
                try {
                    output = context.getContentResolver().openOutputStream(target, "w");
                    if (output == null) throw new IOException("No output stream");
                    String current = url;
                    for (int redirects = 0; redirects <= 5; redirects++) {
                        if (cancelled || !WebPolicy.isHttps(current)) throw new IOException("Invalid download");
                        connection = (HttpURLConnection) new URL(current).openConnection();
                        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
                        connection.setRequestProperty("User-Agent", agent);
                        // Cookies may accompany the original origin, never a cross-origin redirect.
                        if (cookie != null && URI.create(url).getHost().equals(URI.create(current).getHost())) connection.setRequestProperty("Cookie", cookie);
                        int code = connection.getResponseCode();
                        if (code >= 300 && code <= 399) {
                            String location = connection.getHeaderField("Location");
                            if (location == null) throw new IOException("Missing redirect");
                            current = URI.create(current).resolve(location).toString(); connection.disconnect(); continue;
                        }
                        if (code != 200 || connection.getContentLengthLong() > WebPolicy.MAX_DOWNLOAD_BYTES) throw new IOException("Download rejected");
                        try (InputStream input = connection.getInputStream()) {
                            byte[] buffer = new byte[65536]; int count, size = 0;
                            while ((count = input.read(buffer)) != -1) {
                                if (cancelled || (size += count) > WebPolicy.MAX_DOWNLOAD_BYTES) throw new IOException("Download interrupted");
                                output.write(buffer, 0, count);
                            }
                        }
                        output.close(); output = null; connection.disconnect();
                        main.post(() -> finish(true)); return;
                    }
                    throw new IOException("Too many redirects");
                } catch (Exception e) { main.post(() -> finish(false)); }
            });
        }
    }
    private void pollBlob() {
        if (!validPage() || SystemClock.elapsedRealtime() > deadline) { finish(false); return; }
        web.evaluateJavascript("(function(){var s=window[" + quote(key) + "];return !s||s.error?-1:(s.blob?s.size:null)})()", result -> {
            if (!validPage()) { finish(false); return; }
            if ("null".equals(result)) { main.postDelayed(this::pollBlob, 100); return; }
            try {
                int size = Integer.parseInt(result);
                if (size < 0 || size > WebPolicy.MAX_DOWNLOAD_BYTES) { finish(false); return; }
                worker.execute(() -> {
                    try { output = context.getContentResolver().openOutputStream(target, "w"); if (output == null) throw new IOException(); main.post(() -> nextChunk(size)); }
                    catch (Exception e) { main.post(() -> finish(false)); }
                });
            } catch (Exception e) { finish(false); }
        });
    }
    private void nextChunk(int size) {
        if (!validPage()) { finish(false); return; }
        if (offset >= size) {
            worker.execute(() -> { try { output.close(); output = null; main.post(() -> finish(true)); } catch (Exception e) { main.post(() -> finish(false)); } });
            return;
        }
        web.evaluateJavascript("(function(){var s=window[" + quote(key) + "];if(!s||!s.blob)return;delete s.chunk;var r=new FileReader();"
            + "r.onload=function(){s.chunk=r.result.split(',')[1]};r.onerror=function(){s.error=true};r.readAsDataURL(s.blob.slice(" + offset + "," + (offset+65536) + "));})()", ignored -> pollChunk(size));
    }
    private void pollChunk(int size) {
        if (!validPage() || SystemClock.elapsedRealtime() > deadline) { finish(false); return; }
        web.evaluateJavascript("(function(){var s=window[" + quote(key) + "];return !s||s.error?'!':s.chunk||null})()", result -> {
            if (!validPage()) { finish(false); return; }
            if ("null".equals(result)) { main.postDelayed(() -> pollChunk(size), 50); return; }
            try {
                String encoded = (String) new JSONTokener(result).nextValue();
                if ("!".equals(encoded)) { finish(false); return; }
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length != Math.min(65536, size-offset)) { finish(false); return; }
                offset += bytes.length;
                worker.execute(() -> {
                    try { if (!cancelled) output.write(bytes); main.post(() -> nextChunk(size)); }
                    catch (Exception e) { main.post(() -> finish(false)); }
                });
            } catch (Exception e) { finish(false); }
        });
    }
    private boolean validPage() { return !cancelled && owner != null && owner.equals(web.getUrl()); }
    private static String quote(String text) { return JSONObject.quote(text); }
    private void finish(boolean ok) {
        if (cancelled) return;
        dispose(!ok);
        if (ok) success.run(); else failure.run();
    }
    void cancel() { if (!cancelled) dispose(true); }
    private void dispose(boolean removePartial) {
        cancelled = true; main.removeCallbacksAndMessages(null);
        if (connection != null) connection.disconnect();
        if (owner != null && owner.equals(web.getUrl())) web.evaluateJavascript("delete window[" + quote(key) + "]", null);
        worker.execute(() -> {
            try { if (output != null) output.close(); } catch (IOException ignored) {}
            if (removePartial && target != null) try { DocumentsContract.deleteDocument(context.getContentResolver(), target); } catch (Exception ignored) {}
        });
        worker.shutdown();
    }
}
