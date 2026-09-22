package club.hearthroom.app;

import android.content.Intent;
import android.content.ContentValues;
import android.provider.MediaStore;
import android.net.Uri;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.core.content.FileProvider;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.ActivityTestRule;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Until;
import org.junit.Rule;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs against the real Android WebView, not a JVM shadow or a mocked web engine. */
public class WebActivityTest {
    @Rule public ActivityTestRule<WebActivity> activity = new ActivityTestRule<>(WebActivity.class, false, false);
    private android.content.IntentFilter saveFilter() throws Exception {
        android.content.IntentFilter filter = new android.content.IntentFilter(Intent.ACTION_CREATE_DOCUMENT);
        filter.addCategory(Intent.CATEGORY_OPENABLE); filter.addDataType("*/*"); return filter;
    }
    private void ui(Runnable action) { InstrumentationRegistry.getInstrumentation().runOnMainSync(action); }
    private WebView launch() throws Exception {
        WebActivity host = activity.launchActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(WebPolicy.HOME)));
        AtomicReference<WebView> view = new AtomicReference<>();
        ui(() -> view.set((WebView)((FrameLayout)host.findViewById(R.id.web_content)).getChildAt(0)));
        assertNotNull(view.get()); return view.get();
    }
    private String js(WebView web, String script) throws Exception {
        CountDownLatch ready = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        ui(() -> web.evaluateJavascript(script, value -> {result.set(value); ready.countDown();}));
        assertTrue(ready.await(10, TimeUnit.SECONDS)); return result.get();
    }
    private void fixture(WebView web, String html) throws Exception {
        ui(() -> web.loadDataWithBaseURL("https://hearthroom.club/test", html, "text/html", "UTF-8", "https://hearthroom.club/test"));
        long until = System.currentTimeMillis()+15000;
        while (System.currentTimeMillis()<until) {
            if ("true".equals(js(web,"document.body && document.body.dataset.ready === 'yes'"))) return;
            Thread.sleep(100);
        }
        fail("Fixture did not load");
    }
    @Test public void realEngineRetainsWebStateAndHasNoNativeBridge() throws Exception {
        WebView web = launch();
        fixture(web, "<body data-ready='yes'><input id='entry'><script>sessionStorage.setItem('hr-test','kept')</script></body>");
        assertEquals("\"kept\"", js(web,"sessionStorage.getItem('hr-test')"));
        assertEquals("true", js(web,"navigator.userAgent.includes('HearthroomApp/')"));
        assertEquals("\"undefined\"", js(web,"typeof window.Android"));
        assertEquals("true", js(web,"!!crypto.subtle && !!ReadableStream && CSS.supports('color','color-mix(in srgb,red,blue)')"));
        ui(() -> { assertFalse(web.getSettings().getAllowFileAccess()); assertFalse(web.getSettings().getAllowContentAccess()); });
        assertEquals("true", js(web,"history.pushState({},'', '/test/next'); history.length >= 2"));
        ui(() -> activity.getActivity().onBackPressed());
        Thread.sleep(300);
        assertEquals("\"kept\"", js(web,"sessionStorage.getItem('hr-test')"));
    }
    @Test public void blobExportSavesAllChunksWithoutAJavaScriptBridge() throws Exception {
        WebView web = launch();
        fixture(web, "<body data-ready='yes'></body>");
        String encoded = js(web,"window.exportUrl=URL.createObjectURL(new Blob(['hello'.repeat(30000)],{type:'text/plain'}));exportUrl");
        String url = new org.json.JSONTokener(encoded).nextValue().toString();
        File folder = new File(activity.getActivity().getCacheDir(),"updates"); folder.mkdirs();
        File output = new File(folder,"web-export-test.txt");
        Uri target = FileProvider.getUriForFile(activity.getActivity(),activity.getActivity().getPackageName()+".files",output);
        CountDownLatch done = new CountDownLatch(1); AtomicReference<Boolean> success = new AtomicReference<>(false);
        ui(() -> new PageDownload(activity.getActivity(),web,url,()->{success.set(true);done.countDown();},done::countDown).save(target));
        assertTrue(done.await(30,TimeUnit.SECONDS)); assertTrue(success.get());
        assertEquals("hello".repeat(30000), new String(Files.readAllBytes(output.toPath()), java.nio.charset.StandardCharsets.UTF_8));
        output.delete();
    }
    @Test public void userCanPickAFileAndThePageCanReadIt() throws Exception {
        WebView web = launch();
        fixture(web,"<body data-ready='yes'><button onclick=\"document.getElementById('file').click()\">Pick fixture</button><input id='file' type='file' hidden onchange=\"this.files[0].text().then(function(t){window.picked=t})\"></body>");
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME,"hearthroom-webview-fixture.txt");
        values.put(MediaStore.Downloads.MIME_TYPE,"text/plain");
        Uri fixture = activity.getActivity().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
        try {
            try(java.io.OutputStream stream = activity.getActivity().getContentResolver().openOutputStream(fixture)) { stream.write("upload works".getBytes()); }
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            assertNotNull(device.wait(Until.findObject(By.text("Pick fixture")),5000));
            device.findObject(By.text("Pick fixture")).click();
            assertNotNull(device.wait(Until.findObject(By.text("hearthroom-webview-fixture.txt")),10000));
            device.findObject(By.text("hearthroom-webview-fixture.txt")).click();
            long until = System.currentTimeMillis()+10000;
            while(System.currentTimeMillis()<until && !"\"upload works\"".equals(js(web,"window.picked"))) Thread.sleep(100);
            assertEquals("\"upload works\"",js(web,"window.picked"));
        } finally { activity.getActivity().getContentResolver().delete(fixture,null,null); }
    }
    @Test public void fullScreenReturnsToTheSamePage() throws Exception {
        WebView web = launch();
        fixture(web,"<body data-ready='yes'><button onclick='document.documentElement.requestFullscreen()'>Enter fullscreen</button></body>");
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        assertNotNull(device.wait(Until.findObject(By.text("Enter fullscreen")),5000));
        device.findObject(By.text("Enter fullscreen")).click();
        Thread.sleep(500);
        assertEquals("true",js(web,"!!document.fullscreenElement"));
        device.pressBack(); Thread.sleep(500);
        assertEquals("false",js(web,"!!document.fullscreenElement"));
    }
    @Test public void exportClickReachesTheSystemSaveFlow() throws Exception {
        WebView web = launch();
        fixture(web,"<body data-ready='yes'><button onclick=\"var u=window.URL.createObjectURL(new Blob(['export via click']));var a=document.createElement('a');a.href=u;a.download='export.txt';a.click();window.URL.revokeObjectURL(u)\">Export fixture</button></body>");
        File folder = new File(activity.getActivity().getCacheDir(),"updates"); folder.mkdirs();
        File output = new File(folder,"clicked-export.txt"); output.delete();
        assertEquals("\"object\"", js(web,"typeof window.HearthroomDownload"));
        assertEquals("true", js(web,"HTMLAnchorElement.prototype.click.toString().includes('download(this)')"));
        Uri target = FileProvider.getUriForFile(activity.getActivity(),activity.getActivity().getPackageName()+".files",output);
        android.app.Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        android.app.Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(saveFilter(),
            new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK,new Intent().setData(target)),true);
        try {
            UiDevice device = UiDevice.getInstance(instrumentation);
            assertNotNull(device.wait(Until.findObject(By.text("Export fixture")),5000));
            device.findObject(By.text("Export fixture")).click();
            long until = System.currentTimeMillis()+10000;
            while(System.currentTimeMillis()<until && output.length()!=16) Thread.sleep(100);
            assertEquals(js(web,"JSON.stringify({pending:!!window.__hrPendingBlob,origin:location.origin,main:window===window.top,blobMatches:window.__hrPendingBlob?window.__hrPendingBlob.url.startsWith('blob:https://hearthroom.club/'):null})"),1,monitor.getHits());
            assertEquals("export via click",new String(Files.readAllBytes(output.toPath()),java.nio.charset.StandardCharsets.UTF_8));
        } finally { instrumentation.removeMonitor(monitor); output.delete(); }
    }
    @Test public void crossOriginReturnKeepsTheLoginStateAndShowsTheExternalHost() throws Exception {
        WebView web = launch(); WebActivity host = activity.getActivity();
        ui(() -> web.setWebViewClient(host.new Client() {
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request) {
                if (!"https".equals(request.getUrl().getScheme())) return null;
                String html = "hearthroom.club".equals(request.getUrl().getHost())
                    ? "<body data-ready='yes'>Returned</body>"
                    : "<body data-ready='yes'><a href='https://hearthroom.club/test-return'>Return to community</a></body>";
                return new android.webkit.WebResourceResponse("text/html","UTF-8",new java.io.ByteArrayInputStream(html.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            }
        }));
        fixture(web,"<body data-ready='yes'><a href='https://issuer.example.test/authorize'>Continue to test issuer</a><script>sessionStorage.setItem('test-oauth-state','retained')</script></body>");
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        device.wait(Until.findObject(By.text("Continue to test issuer")),5000).click();
        assertNotNull(device.wait(Until.findObject(By.text("issuer.example.test")),5000));
        assertEquals("\"undefined\"",js(web,"typeof window.HearthroomDownload"));
        device.wait(Until.findObject(By.text("Return to community")),5000).click();
        assertNotNull(device.wait(Until.findObject(By.text("Returned")),5000));
        assertEquals("\"retained\"",js(web,"sessionStorage.getItem('test-oauth-state')"));
    }
    @Test public void iframeCannotOpenTheNativeSaveDialog() throws Exception {
        WebView web = launch(); WebActivity host = activity.getActivity();
        ui(() -> web.setWebViewClient(host.new Client() {
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request) {
                if (!"https".equals(request.getUrl().getScheme())) return null;
                return new android.webkit.WebResourceResponse("text/html","UTF-8",new java.io.ByteArrayInputStream("<body>Frame</body>".getBytes()));
            }
        }));
        fixture(web,"<body data-ready='yes'><iframe id='child' src='https://hearthroom.club/frame'></iframe></body>");
        long until=System.currentTimeMillis()+5000;
        while(System.currentTimeMillis()<until && !"\"object\"".equals(js(web,"typeof document.getElementById('child').contentWindow.HearthroomDownload"))) Thread.sleep(100);
        assertEquals("\"object\"",js(web,"typeof document.getElementById('child').contentWindow.HearthroomDownload"));
        android.app.Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        android.app.Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(saveFilter(),null,true);
        try {
            js(web,"document.getElementById('child').contentWindow.HearthroomDownload.postMessage(JSON.stringify({url:'blob:https://hearthroom.club/not-real',name:'blocked.txt'}));true");
            Thread.sleep(500); assertEquals(0,monitor.getHits());
        } finally { instrumentation.removeMonitor(monitor); }
    }
    @Test public void recoveryGuidanceFitsAllFiveLocales() throws Exception {
        launch(); WebActivity host=activity.getActivity();
        android.content.res.Configuration original=new android.content.res.Configuration(host.getResources().getConfiguration());
        java.lang.reflect.Method unavailable=WebActivity.class.getDeclaredMethod("showUnavailable"); unavailable.setAccessible(true);
        UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        try {
            for(String locale:new String[]{"en","zh-TW","zh-CN","ja","ko"}) {
                ui(()->{
                    android.content.res.Configuration config=new android.content.res.Configuration(original);
                    config.setLocale(java.util.Locale.forLanguageTag(locale));
                    host.getResources().updateConfiguration(config,host.getResources().getDisplayMetrics());
                    try { unavailable.invoke(host); } catch(Exception e) { throw new RuntimeException(e); }
                });
                assertNotNull(device.wait(Until.findObject(By.text(host.getString(R.string.retry))),5000));
                androidx.test.uiautomator.UiObject2 scroll=device.findObject(By.scrollable(true));
                if(scroll!=null)scroll.scroll(androidx.test.uiautomator.Direction.DOWN,1.0f);
                assertNotNull(device.wait(Until.findObject(By.text(host.getString(R.string.web_open_browser))),5000));
                File directory=host.getExternalFilesDir("qa");
                assertTrue(device.takeScreenshot(new File(directory,"recovery-"+locale+".png")));
            }
        } finally { ui(()->host.getResources().updateConfiguration(original,host.getResources().getDisplayMetrics())); }
    }
}
