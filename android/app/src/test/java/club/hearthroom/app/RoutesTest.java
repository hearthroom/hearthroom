package club.hearthroom.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.List;
import static org.junit.Assert.*;

public class RoutesTest {
    private static JSONObject route(String host) throws Exception { return new JSONObject().put("host", host); }
    private static String list(JSONObject... routes) throws Exception {
        JSONArray array = new JSONArray(); for (JSONObject r : routes) array.put(r);
        return new JSONObject().put("schemaVersion", 1).put("routes", array).toString();
    }
    private static void rejected(String raw) { assertThrows(IllegalArgumentException.class, () -> Routes.parse(raw)); }

    @Test public void builtInRoutesAreTheFourOfficialSitesInPreferenceOrder() {
        assertEquals(List.of("sukisuki.ai", "hearthroom.club", "sukisuki.chat", "sukisuki.pro"), Routes.BUILT_IN.order());
        assertTrue(Routes.BUILT_IN.disabled().isEmpty());
    }
    @Test public void numbersFollowTheDomainNotTheRemoteOrder() throws Exception {
        Routes remote = Routes.parse(list(route("sukisuki.chat"), route("sukisuki.ai"), route("hearthroom.club"), route("sukisuki.pro")));
        assertEquals("sukisuki.chat", remote.order().get(0));
        assertEquals(3, Routes.number("sukisuki.chat"));
        assertEquals(1, Routes.number("sukisuki.ai"));
        assertEquals(0, Routes.number("evil.test"));
    }
    @Test public void remoteListMayDisableAndAnnotate() throws Exception {
        Routes remote = Routes.parse(list(route("sukisuki.ai"), route("hearthroom.club").put("disabled", true),
            route("sukisuki.chat").put("note", new JSONObject().put("en", "Maintenance tonight").put("zh-Hant", "今晚維護"))));
        assertEquals(List.of("sukisuki.ai", "sukisuki.chat", "sukisuki.pro"), remote.enabled());
        assertTrue(remote.disabled().contains("hearthroom.club"));
        assertEquals("今晚維護", remote.note("sukisuki.chat", "zh-TW"));
        assertEquals("Maintenance tonight", remote.note("sukisuki.chat", "fr"));
        assertEquals("", remote.note("sukisuki.ai", "en"));
    }
    @Test public void omittedBuiltInRoutesKeepTheirDefaultPlaceAfterListedOnes() throws Exception {
        assertEquals(List.of("sukisuki.pro", "sukisuki.ai", "hearthroom.club", "sukisuki.chat"), Routes.parse(list(route("sukisuki.pro"))).order());
    }
    @Test public void aRemoteListCannotAddOrRedirectDomains() throws Exception {
        rejected(list(route("evil.test")));
        rejected(list(route("sukisuki.ai"), route("www.evil.test")));
        rejected(list(route("play.sukisuki.ai")));
        rejected(list(route("SUKISUKI.AI.evil.test")));
        rejected(list(route("sukisuki.ai"), route("sukisuki.ai")));
        rejected(list(route("sukisuki.ai").put("disabled", "yes")));
    }
    @Test public void malformedOrUnusableListsAreDiscarded() throws Exception {
        rejected(null); rejected(""); rejected("not json"); rejected("[]");
        rejected(new JSONObject().put("schemaVersion", 2).put("routes", new JSONArray().put(route("sukisuki.ai"))).toString());
        rejected(list(route("sukisuki.ai").put("disabled", true), route("hearthroom.club").put("disabled", true),
            route("sukisuki.chat").put("disabled", true), route("sukisuki.pro").put("disabled", true)));
        rejected(list(route("sukisuki.ai").put("note", new JSONObject().put("en", "x".repeat(41)))));
        rejected("x".repeat(Routes.MAX_BYTES + 1));
    }
    @Test public void upgradedInstallsStartWhereTheirExistingSignInLives() {
        assertEquals("hearthroom.club", Routes.initialCurrent(null, true));
        assertNull(Routes.initialCurrent(null, false));
        assertEquals("sukisuki.chat", Routes.initialCurrent("sukisuki.chat", true));
        assertNull("A stale stored value is not a route", Routes.initialCurrent("evil.test", false));
    }
    @Test public void downloadHostsPreferTheCurrentRouteFamily() {
        assertEquals(List.of("downloads.sukisuki.chat", "downloads.sukisuki.ai", "downloads.hearthroom.club", "downloads.sukisuki.pro"), Routes.downloadHosts("sukisuki.chat"));
        assertEquals(List.of("downloads.sukisuki.ai", "downloads.hearthroom.club", "downloads.sukisuki.chat", "downloads.sukisuki.pro"), Routes.downloadHosts(null));
    }
}
