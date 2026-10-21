package club.hearthroom.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.view.View;
import android.widget.TextView;
import org.junit.After;
import org.junit.Test;
import static org.junit.Assert.*;

/** The real launcher lifecycle with controlled route probes and release check (design §2–§4). */
public class LaunchFlowTest {
    private static final String AI = "sukisuki.ai", CLUB = "hearthroom.club", CHAT = "sukisuki.chat", PRO = "sukisuki.pro";
    private Fixtures f;
    private Instrumentation.ActivityMonitor web, routes;

    private void setup(String current, boolean fixed) {
        f = new Fixtures().start(current, fixed);
        // Observe destinations without loading the live website or keeping the routes screen.
        web = f.instrumentation.addMonitor(WebActivity.class.getName(), new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null), true);
    }
    @After public void cleanup() {
        if (f == null) return;
        f.stop(); f.instrumentation.removeMonitor(web);
        if (routes != null) f.instrumentation.removeMonitor(routes);
    }
    private void launch(Intent intent) {
        f.instrumentation.startActivitySync((intent == null ? new Intent() : intent).setClass(f.context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private void launch() { launch(new Intent(Intent.ACTION_MAIN)); }
    private void opened(long ms) {
        long until = SystemClock.uptimeMillis() + ms;
        while (web.getHits() == 0 && SystemClock.uptimeMillis() < until) SystemClock.sleep(25);
        assertEquals("The launcher should open the site", 1, web.getHits());
    }
    private String text(int id) {
        String[] t = {null};
        f.instrumentation.runOnMainSync(() -> t[0] = ((TextView) f.launcher.findViewById(id)).getText().toString());
        return t[0];
    }
    private boolean visible(int id) {
        boolean[] v = {false};
        f.instrumentation.runOnMainSync(() -> v[0] = f.launcher.findViewById(id).getVisibility() == View.VISIBLE);
        return v[0];
    }
    private void allReachable(long delay) { for (String h : Routes.HOSTS) f.probe.answer(h, delay, true); }

    @Test public void reachableRouteOpensWithoutWaitingForTheUpdateCheck() {
        setup(CLUB, false); allReachable(50);
        launch();
        opened(3000);
        assertEquals("Opening runs no release check of its own", 0, f.client.checks.get());
        assertEquals(CLUB, f.store().current());
    }
    @Test public void slowCurrentRouteShowsWaitingThenKeepsTheRoute() {
        setup(CHAT, false); allReachable(20); f.probe.answer(CHAT, 3600, true);
        launch();
        f.waitFor("waiting screen", () -> f.launcher.findViewById(R.id.waiting).getVisibility() == View.VISIBLE, 2000);
        assertEquals(f.context.getString(R.string.launch_connecting), text(R.id.waiting_status));
        f.screen("s1");
        f.waitFor("slow wording", () -> ((TextView) f.launcher.findViewById(R.id.waiting_status)).getText().toString().equals(f.context.getString(R.string.launch_slow)), 3000);
        assertTrue("Switching is offered once it is slow", visible(R.id.change_route));
        f.screen("s1-slow");
        opened(3000);
        assertEquals("A faster route never replaces the signed-in one", CHAT, f.store().current());
    }
    @Test public void unreachableRouteSwitchesAndSaysSoFirst() {
        setup(CLUB, false); allReachable(100); f.probe.answer(CLUB, 50, false);
        f.store().visit(CLUB);
        launch();
        String name = f.context.getString(R.string.route_1);
        f.waitFor("switch notice", () -> ((TextView) f.launcher.findViewById(R.id.waiting_status)).getText().toString().equals(f.context.getString(R.string.launch_switched_sign_in, name)), 3000);
        assertEquals("The notice stays before opening", 0, web.getHits());
        f.screen("s5");
        opened(3000);
        assertEquals(AI, f.store().current());
        assertEquals(AI, f.store().autoSwitched());
    }
    @Test public void fixedRouteThatFailsAsksInsteadOfSwitching() {
        setup(CHAT, true); allReachable(50); f.probe.answer(CHAT, 50, false);
        routes = f.instrumentation.addMonitor(RoutesActivity.class.getName(), null, false);
        launch();
        Activity screen = routes.waitForActivityWithTimeout(5000);
        assertNotNull(screen);
        assertEquals(RoutesActivity.FIXED_UNAVAILABLE, screen.getIntent().getStringExtra(RoutesActivity.REASON));
        assertEquals(0, web.getHits());
        assertEquals(CHAT, f.store().current());
    }
    @Test public void nothingReachableShowsTheFailureWithinTheBudget() {
        setup(AI, false); for (String h : Routes.HOSTS) f.probe.answer(h, 200, false);
        routes = f.instrumentation.addMonitor(RoutesActivity.class.getName(), null, false);
        long start = SystemClock.uptimeMillis();
        launch();
        Activity screen = routes.waitForActivityWithTimeout(8000);
        assertNotNull(screen);
        assertTrue(SystemClock.uptimeMillis() - start < 6000);
        assertEquals(RoutesActivity.UNREACHABLE, screen.getIntent().getStringExtra(RoutesActivity.REASON));
        f.waitFor("failure block", () -> screen.findViewById(R.id.failure).getVisibility() == View.VISIBLE, 2000);
        f.waitFor("rows settle", () -> screen.findViewById(R.id.retry).isEnabled(), 3000);
        f.screen("s2");
    }
    @Test public void releaseFoundEarlierIsOfferedAndLaterOpensTheSite() {
        setup(AI, false); allReachable(20);
        f.store().saveRelease(Fixtures.manifest(2_000_000_000L));
        launch();
        f.waitFor("update offer", () -> f.launcher.findViewById(R.id.update).getVisibility() == View.VISIBLE, 3000);
        assertEquals(f.context.getString(R.string.update_available, "1.0.99"), text(R.id.status));
        f.screen("s4");
        f.instrumentation.runOnMainSync(() -> f.launcher.findViewById(R.id.open_site).performClick());
        opened(2000);
        assertEquals(2_000_000_000, f.store().deferred());
    }
    @Test public void deferredReleaseIsNotOfferedAgainSoon() {
        setup(AI, false); allReachable(20);
        f.store().saveRelease(Fixtures.manifest(2_000_000_000L));
        f.store().defer(2_000_000_000, System.currentTimeMillis());
        launch();
        opened(3000);
    }
    @Test public void aLinkOpensOnItsOwnDomainWithoutChangingTheRoute() {
        setup(AI, false); allReachable(20);
        launch(new Intent(Intent.ACTION_VIEW, Uri.parse("https://sukisuki.chat/cards/1?x=1")));
        opened(3000);
        assertEquals("https://sukisuki.chat/cards/1?x=1", launchUrl());
        assertEquals(AI, f.store().current());
        assertTrue(f.store().visited(CHAT));
    }
    @Test public void aLinkToAnUnreachableDomainKeepsItsPathOnTheWorkingRoute() {
        setup(AI, false); allReachable(20); f.probe.answer(CHAT, 20, false);
        launch(new Intent(Intent.ACTION_VIEW, Uri.parse("https://sukisuki.chat/cards/1")));
        opened(4000);
        assertEquals("https://sukisuki.ai/cards/1", launchUrl());
    }
    private String launchUrl() {
        try { java.lang.reflect.Field field = MainActivity.class.getDeclaredField("launchUrl"); field.setAccessible(true); return (String) field.get(f.launcher); }
        catch (Exception e) { throw new AssertionError(e); }
    }
}
