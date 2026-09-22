package club.hearthroom.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class WebPolicyTest {
    @Test public void launchLinksStayOnTheVerifiedOrigin() {
        assertEquals("https://hearthroom.club/cards/example?lang=en", WebPolicy.launchUrl("https://hearthroom.club/cards/example?lang=en"));
        for (String url : new String[]{null, "javascript:alert(1)", "https://hearthroom.club@evil.test/", "https://hearthroom.club.evil.test/", "https://hearthroom.club:8443/", "file:///etc/passwd"})
            assertEquals(WebPolicy.HOME, WebPolicy.launchUrl(url));
    }
    @Test public void onlyExactCommunityOriginsGetAppPrivileges() {
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
