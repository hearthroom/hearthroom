package club.hearthroom.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.ActivityTestRule;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Real manifest resolution, WebMessage origins and Activity result delivery. No JS bridge mock. */
public class RouteBridgeTest {
    @Rule public ActivityTestRule<WebActivity> rule = new ActivityTestRule<>(WebActivity.class, false, false);
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private Fixtures fixtures;
    private WebView web;
    private volatile String html = "<body data-ready='yes'>Route fixture</body>";
    private volatile String frameHtml = "<body>Frame</body>";
    private volatile String heldUrl;
    private final CountDownLatch heldStarted = new CountDownLatch(1);
    private final CountDownLatch heldResponse = new CountDownLatch(1);
    private Instrumentation.ActivityMonitor monitor;

    private void ui(Runnable action) { instrumentation.runOnMainSync(action); }
    @After public void cleanup() {
        heldResponse.countDown();
        if (monitor != null) instrumentation.removeMonitor(monitor);
        if (fixtures != null) fixtures.stop();
    }
    private void launch() {
        fixtures = new Fixtures().start("hearthroom.club", false);
        for (String host : Routes.HOSTS) { fixtures.probe.answer(host, 20, true); fixtures.store().visit(host); }
        WebActivity host = rule.launchActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://hearthroom.club/.well-known/assetlinks.json")));
        ui(() -> {
            web = (WebView) ((FrameLayout) host.findViewById(R.id.web_content)).getChildAt(0);
            web.setWebViewClient(host.new Client() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    if (request.getUrl().toString().equals(heldUrl)) {
                        heldStarted.countDown();
                        try { heldResponse.await(10, TimeUnit.SECONDS); }
                        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    }
                    String body = request.isForMainFrame() ? html : frameHtml;
                    return new WebResourceResponse("text/html", "UTF-8", new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
                }
            });
        });
        monitor = instrumentation.addMonitor(RoutesActivity.class.getName(), null, false);
    }
    private String js(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        ui(() -> web.evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue("JavaScript callback", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }
    private void page(String host, String body) throws Exception {
        html = "<body data-ready='yes'>" + body + "</body>";
        String url = "https://" + host + "/route-test?case=" + java.util.UUID.randomUUID();
        ui(() -> web.loadUrl(url));
        long until = SystemClock.uptimeMillis() + 5000;
        while (SystemClock.uptimeMillis() < until) {
            if ("true".equals(js("location.href === " + org.json.JSONObject.quote(url) + " && document.readyState === 'complete' && document.body.dataset.ready === 'yes'"))) return;
            SystemClock.sleep(50);
        }
        fail("Controlled HTTPS page did not load");
    }
    private RoutesActivity openRoutes() throws Exception {
        assertEquals("\"object\"", js("typeof window.HearthroomRoutes"));
        js("HearthroomRoutes.postMessage('open'); true");
        RoutesActivity routes = (RoutesActivity) monitor.waitForActivityWithTimeout(3000);
        assertNotNull("The official main frame opens native Routes", routes);
        assertEquals(RoutesActivity.FROM_WEB, routes.getIntent().getStringExtra(RoutesActivity.REASON));
        return routes;
    }
    private void cancel(RoutesActivity routes) {
        ui(() -> routes.findViewById(R.id.back).performClick());
        fixtures.waitFor("WebView resumes", web::hasWindowFocus, 3000);
    }
    private void denied(String script) throws Exception {
        int before = monitor.getHits();
        js(script);
        SystemClock.sleep(300);
        assertEquals("Untrusted message must not open Routes", before, monitor.getHits());
    }

    @Test public void genericHttpsLinksStayInTheBrowserAndLauncherRemains() {
        android.content.Context context = instrumentation.getTargetContext();
        PackageManager packages = context.getPackageManager();
        for (String host : Routes.HOSTS) for (String path : new String[]{"/", "/auth/route/prepare", "/auth/route/issue", "/auth/route/complete", "/mine?next=chat#draft"}) {
            Intent link = new Intent(Intent.ACTION_VIEW, Uri.parse("https://" + host + path))
                .addCategory(Intent.CATEGORY_BROWSABLE).setPackage(context.getPackageName());
            assertTrue("Installed app must not resolve generic HTTPS " + link.getData(), packages.queryIntentActivities(link, PackageManager.MATCH_DEFAULT_ONLY).isEmpty());
        }
        assertNotNull("App still opens from its icon", packages.getLaunchIntentForPackage(context.getPackageName()));
        assertTrue("Routes shortcut stays available", ((android.content.pm.ShortcutManager) context.getSystemService(android.content.Context.SHORTCUT_SERVICE))
            .getManifestShortcuts().stream().anyMatch(shortcut -> "routes".equals(shortcut.getId())));
    }
    @Test public void fourExactOfficialRootsCanOpenAndCancelWithoutReloading() throws Exception {
        launch();
        for (String root : Routes.HOSTS) {
            page(root, "Ready");
            js("window.kept = 'draft'; history.replaceState({}, '', '/editor/a%2Fb?mode=edit#draft'); true");
            String before = js("location.href");
            RoutesActivity routes = openRoutes();
            cancel(routes);
            assertEquals(before, js("location.href"));
            assertEquals("\"draft\"", js("window.kept"));
            assertEquals("hearthroom.club", fixtures.store().current());
            assertFalse(fixtures.store().fixed());
        }
    }
    @Test public void selectedRouteKeepsSameWebViewAndLiveSpaPathQueryHash() throws Exception {
        launch(); page("hearthroom.club", "Ready");
        js("history.pushState({}, '', '/editor/a%2Fb?mode=edit#draft'); true");
        WebView original = web;
        RoutesActivity routes = openRoutes();
        fixtures.waitFor("route probes", () -> routes.findViewById(R.id.open).isEnabled(), 3000);
        ui(() -> {
            ViewGroup rows = routes.findViewById(R.id.rows);
            for (int i = 0; i < rows.getChildCount(); i++) if ("sukisuki.chat".equals(((TextView) rows.getChildAt(i).findViewById(R.id.row_host)).getText().toString())) rows.getChildAt(i).performClick();
        });
        fixtures.waitFor("selected route", () -> "https://sukisuki.chat/editor/a%2Fb?mode=edit#draft".equals(web.getUrl()), 3000);
        ui(() -> assertSame(original, ((FrameLayout) rule.getActivity().findViewById(R.id.web_content)).getChildAt(0)));
        assertEquals("sukisuki.chat", fixtures.store().current());
        assertTrue(fixtures.store().fixed());
    }
    @Test public void malformedMessagesAndRepeatClicksCannotOpenExtraScreens() throws Exception {
        launch(); page("hearthroom.club", "Ready");
        assertEquals("\"object\"", js("typeof HearthroomRoutes"));
        denied("HearthroomRoutes.postMessage('{\"action\":\"open\",\"host\":\"sukisuki.chat\"}'); true");
        denied("HearthroomRoutes.postMessage('https://sukisuki.chat'); true");
        denied("HearthroomRoutes.postMessage('OPEN'); true");
        int before = monitor.getHits();
        js("HearthroomRoutes.postMessage('open'); HearthroomRoutes.postMessage('open'); true");
        RoutesActivity routes = (RoutesActivity) monitor.waitForActivityWithTimeout(3000);
        assertNotNull(routes);
        SystemClock.sleep(300);
        assertEquals(before + 1, monitor.getHits());
        cancel(routes);
        cancel(openRoutes());
    }
    @Test public void sameOriginIframeCannotOpenRoutes() throws Exception {
        launch(); page("hearthroom.club", "<iframe id='child' src='https://hearthroom.club/frame'></iframe>");
        assertEquals("\"object\"", js("typeof document.getElementById('child').contentWindow.HearthroomRoutes"));
        denied("document.getElementById('child').contentWindow.HearthroomRoutes.postMessage('open'); true");
        // Positive control: the same listener and same origin are accepted from the main frame.
        cancel(openRoutes());
    }
    @Test public void playSandboxAndExternalPagesReceiveNoRoutesBridge() throws Exception {
        launch();
        for (String host : new String[]{"play.hearthroom.club", "sandbox.hearthroom.club", "issuer.example.test", "hearthroom.club.example.test"}) {
            page(host, "Ready");
            assertEquals(host, "\"undefined\"", js("typeof window.HearthroomRoutes"));
        }
        page("hearthroom.club", "<script>window.addEventListener('message', e => window.frameBridge=e.data)</script><iframe sandbox='allow-scripts' srcdoc=\"<script>parent.postMessage(typeof HearthroomRoutes,'*')</script>\"></iframe>");
        long until = SystemClock.uptimeMillis() + 3000;
        while (SystemClock.uptimeMillis() < until && !"\"undefined\"".equals(js("window.frameBridge"))) SystemClock.sleep(50);
        assertEquals("\"undefined\"", js("window.frameBridge"));
        assertEquals(0, monitor.getHits());
    }
    @Test public void pendingTopLevelNavigationCannotOpenRoutes() throws Exception {
        launch(); page("hearthroom.club", "Ready");
        assertEquals("\"object\"", js("typeof HearthroomRoutes"));
        heldUrl = "https://hearthroom.club/held";
        // Queue the message in the old document as navigation begins. evaluateJavascript after
        // loadUrl can instead wait for the new response, which would no longer test a pending load.
        js("location.href=" + org.json.JSONObject.quote(heldUrl) + "; HearthroomRoutes.postMessage('open'); true");
        assertTrue("A real navigation is waiting for its response", heldStarted.await(3, TimeUnit.SECONDS));
        SystemClock.sleep(300);
        assertEquals(0, monitor.getHits());
        heldResponse.countDown();
        fixtures.waitFor("navigation completes", () -> web.getProgress() == 100, 3000);
        cancel(openRoutes());
    }
    @Test public void sourceOriginCannotActForADifferentNativePage() throws Exception {
        launch(); page("hearthroom.club", "Ready");
        frameHtml = "<script>HearthroomRoutes.postMessage('open'); parent.postMessage(typeof HearthroomRoutes,'*')</script>";
        page("sukisuki.ai", "<script>window.addEventListener('message',e=>window.frameBridge=e.data)</script><iframe src='https://hearthroom.club/frame'></iframe>");
        long until = SystemClock.uptimeMillis() + 3000;
        while (SystemClock.uptimeMillis() < until && !"\"object\"".equals(js("window.frameBridge"))) SystemClock.sleep(50);
        assertEquals("The other official origin really sent a bridge message", "\"object\"", js("window.frameBridge"));
        SystemClock.sleep(300);
        assertEquals(0, monitor.getHits());
    }
    @Test public void backgroundedPageCannotOpenRoutesAndResumedPageCan() throws Exception {
        launch(); page("hearthroom.club", "Ready");
        assertEquals("\"object\"", js("typeof HearthroomRoutes"));
        Activity host = rule.getActivity();
        ui(() -> assertTrue(host.moveTaskToBack(true)));
        fixtures.waitFor("WebView loses foreground", () -> !web.hasWindowFocus(), 3000);
        try {
            denied("HearthroomRoutes.postMessage('open'); true");
        } finally {
            android.app.ActivityManager manager = (android.app.ActivityManager) host.getSystemService(android.content.Context.ACTIVITY_SERVICE);
            for (android.app.ActivityManager.AppTask task : manager.getAppTasks()) if (task.getTaskInfo().taskId == host.getTaskId()) task.moveToFront();
        }
        fixtures.waitFor("WebView returns to foreground", web::hasWindowFocus, 3000);
        cancel(openRoutes());
    }
}
