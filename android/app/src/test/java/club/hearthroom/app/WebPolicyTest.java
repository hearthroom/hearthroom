package club.hearthroom.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class WebPolicyTest {
    @Test public void launchLinksStayOnTheVerifiedOrigin() {
        assertEquals("https://hearthroom.club/cards/example?lang=en", WebPolicy.launchUrl("https://hearthroom.club/cards/example?lang=en"));
        for (String url : new String[]{null, "javascript:alert(1)", "https://hearthroom.club@evil.test/", "https://hearthroom.club.evil.test/", "https://hearthroom.club:8443/", "file:///etc/passwd"})
            assertEquals(WebPolicy.HOME, WebPolicy.launchUrl(url));
    }
    @Test public void everyOfficialRouteIsALaunchTarget() {
        for (String root : Routes.BUILT_IN.order()) assertEquals("https://"+root+"/play/1?x=1#y", WebPolicy.launchUrl("https://"+root+"/play/1?x=1#y"));
        assertEquals(WebPolicy.HOME, WebPolicy.launchUrl("https://www.sukisuki.pro/"));
        assertEquals(WebPolicy.HOME, WebPolicy.launchUrl("https://play.sukisuki.pro/"));
    }
    @Test public void switchingRoutesKeepsThePath() {
        assertEquals("https://sukisuki.chat/play/123?lang=en#top", WebPolicy.onRoute("https://hearthroom.club/play/123?lang=en#top", "sukisuki.chat"));
        assertEquals("https://sukisuki.pro/", WebPolicy.onRoute("https://hearthroom.club", "sukisuki.pro"));
        assertEquals("External pages are not carried over", "https://sukisuki.pro/", WebPolicy.onRoute("https://evil.test/x", "sukisuki.pro"));
        assertEquals("sukisuki.chat", WebPolicy.routeOf("https://sukisuki.chat/cards/1"));
        assertNull(WebPolicy.routeOf("https://play.sukisuki.chat/"));
        assertNull(WebPolicy.routeOf("https://evil.test/"));
    }
    @Test public void cardAppHostsAreOwnPagesWithoutAppPrivileges() {
        assertTrue(WebPolicy.isOwnHost("https://play.sukisuki.pro/app/1"));
        assertTrue(WebPolicy.isOwnHost("https://sukisuki.pro/"));
        assertFalse(WebPolicy.isOwnHost("https://c123.sukisuki.pro/"));
        assertFalse(WebPolicy.isOwnHost("https://play.sukisuki.pro.evil.test/"));
        assertFalse(WebPolicy.isSite("https://play.sukisuki.pro/"));
    }
    @Test public void onlyExactCommunityOriginsGetAppPrivileges() {
        assertTrue(WebPolicy.isSite("https://sukisuki.pro/"));
        assertTrue(WebPolicy.isSite("https://hearthroom.club/"));
        assertTrue(WebPolicy.isSite("https://sukisuki.chat/cards/1"));
        assertFalse(WebPolicy.isSite("https://c123.hearthroom.club/"));
        assertFalse(WebPolicy.isSite("https://play.hearthroom.club/"));
        assertFalse(WebPolicy.isSite("https://hearthroom.club.evil.test/"));
        assertFalse(WebPolicy.isSite("https://user@hearthroom.club/"));
        assertFalse(WebPolicy.isHttps("http://hearthroom.club/"));
    }
    @Test public void unsupportedAndMissingWebviewsHaveAnExplicitExit() {
        assertFalse(WebPolicy.supportsVersion(null));
        assertFalse(WebPolicy.supportsVersion("not-a-version"));
        assertFalse(WebPolicy.supportsVersion("110.0.5481.154"));
        assertTrue(WebPolicy.supportsVersion("111.0.5563.116"));
        assertTrue(WebPolicy.supportsVersion("140.0.7339.0"));
    }
    @Test public void downloadsCannotTurnIntoLocalFileReads() {
        assertTrue(WebPolicy.canDownload("https://hearthroom.club/cards/1", "blob:https://hearthroom.club/example"));
        assertFalse(WebPolicy.canDownload("https://hearthroom.club/", "blob:https://evil.test/example"));
        assertFalse(WebPolicy.canDownload("https://evil.test/", "blob:https://evil.test/example"));
        assertFalse(WebPolicy.canDownload(WebPolicy.HOME, "file:///etc/passwd"));
        assertFalse(WebPolicy.canDownload(WebPolicy.HOME, "content://private/secret"));
        assertTrue(WebPolicy.canDownload(WebPolicy.HOME, "https://downloads.hearthroom.club/latest.apk"));
    }
}
