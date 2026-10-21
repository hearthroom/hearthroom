package club.hearthroom.app;

import android.app.Activity;
import android.content.Intent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.test.rule.ActivityTestRule;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import static org.junit.Assert.*;

/** The routes screen against controlled probes (design S2, S3, S3a). */
public class RoutesScreenTest {
    private static final String AI = "sukisuki.ai", CLUB = "hearthroom.club", CHAT = "sukisuki.chat", PRO = "sukisuki.pro";
    @Rule public ActivityTestRule<RoutesActivity> rule = new ActivityTestRule<>(RoutesActivity.class, true, false);
    private Fixtures f;

    private RoutesActivity open(String current, String reason) { return open(current, reason, false); }
    private RoutesActivity open(String current, String reason, boolean allDown) {
        f = new Fixtures().start(current, false);
        f.store().visit(CLUB);
        f.probe.answer(AI, 120, true); f.probe.answer(CLUB, 340, true); f.probe.answer(CHAT, 60, false); f.probe.answer(PRO, 30_000, true);
        if (allDown) for (String h : Routes.HOSTS) f.probe.answer(h, 60, false);
        return rule.launchActivity(new Intent().putExtra(RoutesActivity.REASON, reason));
    }
    @After public void cleanup() { if (f != null) f.stop(); }
    private View row(Activity a, String host) {
        ViewGroup rows = a.findViewById(R.id.rows);
        for (int i = 0; i < rows.getChildCount(); i++) if (host.equals(((TextView) rows.getChildAt(i).findViewById(R.id.row_host)).getText().toString())) return rows.getChildAt(i);
        throw new AssertionError(host);
    }
    private String status(Activity a, String host) { return ((TextView) row(a, host).findViewById(R.id.row_status)).getText().toString(); }
    private void settled(Activity a) { f.waitFor("three answers", () -> !status(a, CLUB).equals(f.context.getString(R.string.route_checking)), 3000); }

    @Test public void rowsShowEachAnswerAsItArrives() {
        RoutesActivity a = open(CLUB, null);
        settled(a);
        f.instrumentation.runOnMainSync(() -> {
            assertEquals("120 ms", status(a, AI));
            assertEquals(f.context.getString(R.string.route_unreachable), status(a, CHAT));
            assertEquals("A slow route keeps checking without holding up the others", f.context.getString(R.string.route_checking), status(a, PRO));
            assertEquals(View.VISIBLE, row(a, CLUB).findViewById(R.id.row_check).getVisibility());
            assertEquals(f.context.getString(R.string.route_current), ((TextView) row(a, CLUB).findViewById(R.id.row_tag)).getText().toString());
            assertTrue(a.findViewById(R.id.open).isEnabled());
            assertEquals(f.context.getString(R.string.route_1), ((TextView) row(a, AI).findViewById(R.id.row_name)).getText().toString());
        });
        f.screen("s3");
    }
    @Test public void aRouteNotUsedBeforeAsksFirstAndTurnsAutomaticOff() {
        RoutesActivity a = open(CLUB, null);
        settled(a);
        f.instrumentation.runOnMainSync(() -> row(a, AI).performClick());
        UiDevice device = UiDevice.getInstance(f.instrumentation);
        UiObject2 confirm = device.wait(Until.findObject(By.text(f.context.getString(R.string.switch_confirm))), 3000);
        assertNotNull("Switching to a route without sign-in is confirmed first", confirm);
        f.screen("s3a");
        confirm.click();
        f.waitFor("result", a::isFinishing, 3000);
        assertEquals(Activity.RESULT_OK, rule.getActivityResult().getResultCode());
        assertEquals(AI, rule.getActivityResult().getResultData().getStringExtra(RoutesActivity.HOST));
        assertEquals(AI, f.store().current());
        assertTrue(f.store().fixed());
    }
    @Test public void anUnreachableRouteCannotBeChosen() {
        RoutesActivity a = open(CLUB, null);
        settled(a);
        f.instrumentation.runOnMainSync(() -> row(a, CHAT).performClick());
        f.instrumentation.waitForIdleSync();
        assertFalse(a.isFinishing());
        assertEquals(CLUB, f.store().current());
    }
    @Test public void anUnreachableCurrentRouteCannotBeOpened() {
        RoutesActivity a = open(CHAT, null);
        settled(a);
        f.instrumentation.runOnMainSync(() -> {
            assertFalse(a.findViewById(R.id.open).isEnabled());
            assertEquals(View.VISIBLE, a.findViewById(R.id.pick_working).getVisibility());
        });
    }
    @Test public void retryingFromNothingReachableUsesTheAutomaticRules() {
        RoutesActivity a = open(CHAT, RoutesActivity.UNREACHABLE);
        f.waitFor("automatic choice", a::isFinishing, 4000);
        assertEquals(Activity.RESULT_OK, rule.getActivityResult().getResultCode());
        assertEquals("First reachable in preference order", AI, rule.getActivityResult().getResultData().getStringExtra(RoutesActivity.HOST));
        assertFalse("An outage does not turn automatic selection off", f.store().fixed());
        assertEquals(AI, f.store().autoSwitched());
    }
    @Test public void offlinePhonesAreToldToCheckTheirNetwork() {
        RoutesActivity a = open(CLUB, RoutesActivity.OFFLINE, true);
        settled(a);
        f.instrumentation.runOnMainSync(() -> {
            assertEquals(f.context.getString(R.string.offline_title), ((TextView) a.findViewById(R.id.failure_title)).getText().toString());
            assertEquals(View.VISIBLE, a.findViewById(R.id.network_settings).getVisibility());
        });
        f.screen("s2-offline");
    }
}
