package club.hearthroom.app;

import java.net.URI;
import java.util.Set;

final class WebPolicy {
    static final String HOME = "https://" + Routes.HOSTS.get(0) + "/";
    // Functional floor: dynamic viewport units and color-mix used by the website.
    // This is not a claim that an old Chromium version receives security updates.
    static final int MIN_WEBVIEW_MAJOR = 111;
    static final int MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
    /** Exact origins for narrow native save/routes messages. Card apps and sandboxes do not qualify. */
    static final Set<String> ORIGINS = Set.of("https://" + Routes.HOSTS.get(0), "https://" + Routes.HOSTS.get(1), "https://" + Routes.HOSTS.get(2), "https://" + Routes.HOSTS.get(3));
    static String launchUrl(String url) { return routeOf(url) != null ? url : HOME; }
    /** The route a URL is on, or null when it is not one of the official roots. */
    static String routeOf(String url) { return isHttps(url) && Routes.isRoute(URI.create(url).getHost()) ? URI.create(url).getHost() : null; }
    /** The same page on another route; anything that is not an official page starts at that route's home. */
    static String onRoute(String url, String route) {
        String base = "https://" + route;
        if (routeOf(url) == null) return base + "/";
        URI uri = URI.create(url);
        String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        return base + path + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()) + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
    }
    static boolean isSite(String url) { return routeOf(url) != null; }
    /** Message content never supplies a route or URL; use WebView's own current URL. */
    static boolean canOpenRoutes(String currentUrl, String sourceOrigin, boolean mainFrame, String message) {
        String current = routeOf(currentUrl), source = routeOf(sourceOrigin);
        return mainFrame && "open".equals(message) && current != null && current.equals(source);
    }
    /** Our own pages, including installed card apps on play.<root>: no external-origin bar, no extra privileges. */
    static boolean isOwnHost(String url) {
        if (!isHttps(url)) return false;
        String host = URI.create(url).getHost();
        return Routes.isRoute(host) || host.startsWith("play.") && Routes.isRoute(host.substring(5));
    }
    static boolean isHttps(String url) {
        try {
            URI uri = URI.create(url);
            return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getRawUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception e) { return false; }
    }
    static boolean supportsVersion(String version) {
        try { return Integer.parseInt(version.split("\\.")[0]) >= MIN_WEBVIEW_MAJOR; }
        catch (Exception e) { return false; }
    }
    static boolean canDownload(String source, String url) {
        if (!isSite(source) || url == null) return false;
        if (isHttps(url)) return true;
        if (!url.startsWith("blob:")) return false;
        String inner = url.substring(5);
        return isHttps(inner) && URI.create(source).getHost().equals(URI.create(inner).getHost());
    }
}
