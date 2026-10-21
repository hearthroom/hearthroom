package club.hearthroom.app;

import org.junit.Test;
import java.util.List;
import static org.junit.Assert.*;
import static club.hearthroom.app.RoutePlanner.Kind.*;

public class RoutePlannerTest {
    private static final List<String> ALL = Routes.HOSTS;
    private static final String AI = "sukisuki.ai", CLUB = "hearthroom.club", CHAT = "sukisuki.chat", PRO = "sukisuki.pro";

    @Test public void theCurrentRouteWinsEvenWhenAnotherIsFaster() {
        RoutePlanner p = new RoutePlanner(ALL, CHAT, false);
        p.result(AI, true, 200); p.result(CLUB, true, 250);
        assertEquals(WAIT, p.decide(3000).kind);
        p.result(CHAT, true, 3700);
        RoutePlanner.Decision d = p.decide(3700);
        assertEquals(OPEN, d.kind); assertEquals(CHAT, d.host); assertFalse(d.switched);
    }
    @Test public void aSilentCurrentRouteIsGivenUpAtTheProbeTimeout() {
        RoutePlanner p = new RoutePlanner(ALL, CHAT, false);
        p.result(PRO, true, 300);
        assertEquals(WAIT, p.decide(4999).kind);
        RoutePlanner.Decision d = p.decide(RoutePlanner.PROBE_TIMEOUT);
        assertEquals(OPEN, d.kind); assertEquals(PRO, d.host); assertTrue(d.switched);
    }
    @Test public void anExplicitFailureSwitchesImmediatelyToThePreferredWorkingRoute() {
        RoutePlanner p = new RoutePlanner(ALL, CLUB, false);
        p.result(CLUB, false, 100); p.result(AI, false, 120); p.result(PRO, true, 300); p.result(CHAT, true, 350);
        RoutePlanner.Decision d = p.decide(350);
        assertEquals(OPEN, d.kind); assertEquals("Preference order, not speed", CHAT, d.host); assertTrue(d.switched);
    }
    @Test public void aPreferredRouteStillCheckingGetsAShortWindow() {
        RoutePlanner p = new RoutePlanner(ALL, null, false);
        p.result(PRO, true, 300);
        assertEquals(WAIT, p.decide(899).kind);
        p.result(CLUB, true, 700);
        assertEquals("AI is still pending and preferred", WAIT, p.decide(800).kind);
        RoutePlanner.Decision d = p.decide(300 + RoutePlanner.PREFERENCE_WINDOW);
        assertEquals(OPEN, d.kind); assertEquals(CLUB, d.host); assertFalse("A new install has nothing to switch from", d.switched);
    }
    @Test public void theMostPreferredRouteOpensWithoutWaiting() {
        RoutePlanner p = new RoutePlanner(ALL, null, false);
        p.result(AI, true, 400);
        assertEquals(AI, p.decide(400).host);
    }
    @Test public void aFixedRouteThatFailsAsksThePlayerInsteadOfSwitching() {
        RoutePlanner p = new RoutePlanner(ALL, CHAT, true);
        p.result(AI, true, 200); p.result(CHAT, false, 300);
        assertEquals(CHOOSE, p.decide(300).kind);
    }
    @Test public void nothingReachableEndsTheWaitEarlyOrAtTheDeadline() {
        RoutePlanner p = new RoutePlanner(ALL, AI, false);
        for (String h : ALL) p.result(h, false, 500);
        assertEquals(UNREACHABLE, p.decide(500).kind);
        RoutePlanner q = new RoutePlanner(ALL, null, false);
        assertEquals(WAIT, q.decide(4999).kind);
        assertEquals("Every probe has ended by its timeout, inside the 6 s ceiling", UNREACHABLE, q.decide(RoutePlanner.PROBE_TIMEOUT).kind);
    }
    @Test public void aRemotelyDisabledCurrentRouteIsTreatedAsUnavailable() {
        RoutePlanner p = new RoutePlanner(List.of(AI, CHAT, PRO), CLUB, false);
        p.result(AI, true, 200);
        RoutePlanner.Decision d = p.decide(200);
        assertEquals(AI, d.host); assertTrue(d.switched);
        assertEquals(CHOOSE, new RoutePlanner(List.of(AI, CHAT, PRO), CLUB, true).decide(0).kind);
    }
    @Test public void lateResultsAfterTheTimeoutDoNotCount() {
        RoutePlanner p = new RoutePlanner(ALL, AI, false);
        p.result(CLUB, true, 300);
        p.result(AI, true, 5200);
        RoutePlanner.Decision d = p.decide(5200);
        assertEquals(CLUB, d.host); assertTrue(d.switched);
    }
    @Test public void decisionsAreStable() {
        RoutePlanner p = new RoutePlanner(ALL, AI, false);
        p.result(AI, true, 100);
        assertEquals(AI, p.decide(100).host);
        p.result(AI, false, 200);
        assertEquals(AI, p.decide(200).host);
    }
    @Test public void updatePromptsRespectTheThreeDayLater() {
        long day = 86_400_000L, now = 100 * day;
        assertTrue(UpdatePolicy.prompt(5, 4, 0, 0, now));
        assertFalse(UpdatePolicy.prompt(5, 5, 0, 0, now));
        assertFalse(UpdatePolicy.prompt(5, 4, 5, now - 2 * day, now));
        assertTrue(UpdatePolicy.prompt(5, 4, 5, now - 3 * day, now));
        assertTrue("A newer release than the deferred one prompts again", UpdatePolicy.prompt(6, 4, 5, now - day, now));
        assertTrue(UpdatePolicy.due(0, now));
        assertFalse(UpdatePolicy.due(now - 5 * 3_600_000L, now));
        assertTrue(UpdatePolicy.due(now - 6 * 3_600_000L, now));
        assertTrue("A clock moved backwards is not a reason to wait", UpdatePolicy.due(now + day, now));
    }
}
