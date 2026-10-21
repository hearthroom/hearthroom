# Hearthroom Android

This Android app opens the existing Hearthroom PWA using Google's Android Browser Helper (the TWA runtime also used by Bubblewrap). The small checked-in native project adds an APK updater; it is not regenerated on each build. Google Play is not a distribution channel for this build.

## Browser compatibility

The launch order is **TWA-capable installed browser → in-app Android System WebView**. A Custom Tabs-only browser does not qualify as TWA. Chrome is not required. The app does not bundle GeckoView or a Chromium engine, and does not assume that a phone without Google Play receives timely WebView updates.

`MainActivity.getFallbackStrategy()` opens the non-exported `WebActivity` when Android Browser Helper cannot launch TWA. Browser-side Digital Asset Links validation failures can still produce browser controls after a TWA launch; they are not a reliable automatic fallback signal. Long-press the launcher icon and choose **Open inside app** to explicitly use WebView in that case. The normal icon continues to prefer TWA. Browser and WebView have separate cookie/storage profiles, so switching may require signing in again.

WebView requires Chromium 111 or newer for the website's dynamic viewport units and `color-mix` theme, then checks required Web APIs in the actual page. This functional floor is not a security-update guarantee or certification of every version above it. Missing, disabled or unsupported WebView shows a localized recovery screen with settings, retry and an explicit browser option; it never silently sends the launch to a regular browser. The package remains Android 8.0+, but the installed web engine must also meet these requirements.

WebView keeps HTTPS redirects and OAuth return navigation in the same view so session storage survives. Outside the four official roots and their `play.` card-app hosts it shows the current host in a native bar. Certificate errors are never ignored. File/content top-level navigation is blocked, file access is disabled, iframe sandbox/origin rules remain in force, and there is no `addJavascriptInterface` or credential bridge. A narrowly scoped WebMessage listener accepts Blob-save requests only from the top-level page on the four exact roots; iframe messages and all other origins are rejected, and every save still requires the system document dialog. Third-party login providers may impose additional embedded-browser restrictions; an unauthenticated form check is not proof of an end-to-end account authorization.

File uploads use the system document picker. Downloads use the system save dialog and are limited to 32 MiB; Blob exports are captured before the object URL expires and transferred in bounded chunks. HTTPS download redirects are bounded and cookies are never forwarded across origins. This file-saving path does not install APKs or bypass the existing updater's hash/signature/package checks. Camera/microphone/geolocation permissions are not added by this fallback.

## Build and verify

JDK 17, Android SDK platform 36 and build tools 35 are required. The checked-in Gradle wrapper pins the toolchain and distribution checksum.

```sh
node --test scripts/android/*.test.mjs
./android/gradlew -p android testDebugUnitTest lintDebug assembleDebug
./android/gradlew -p android connectedDebugAndroidTest
```

Set `ANDROID_HOME` to the SDK. The debug build uses `club.hearthroom.app.debug` and the normal Android debug signing identity; it installs alongside the release app and cannot update it. Device tests require an Android 10+ emulator for the MediaStore fixture; additionally test the supported Android versions and OEM devices before claiming broad coverage. Release signing comes from `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Never commit the keystore or its passwords to this public repository.

Instrumentation fixtures navigate to unique HTTPS URLs with controlled HTML responses, so JavaScript origin and the native URL pass through the same security rules as real pages. Back-history tests use real user gestures and verify the Activity stays alive. Gesture tests wait for window focus and the launch cover to leave; fullscreen Back waits for the native fullscreen input view to attach and receive focus. CI preserves provider/device details, JUnit reports and per-test logcat even on failure.

## Launch and routes

The app opens one of the four official site domains ("routes", `Routes.HOSTS`: sukisuki.ai, hearthroom.club, sukisuki.chat, sukisuki.pro; numbered 1–4 by domain). At launch all routes are probed in parallel by reading `/.well-known/assetlinks.json` and requiring our own package statement, so captive portals and hijacked DNS do not count. The route last opened is kept even when another is faster, because each domain has its own sign-in; installs upgraded from the single-domain app start on hearthroom.club. In automatic mode an unreachable route is replaced by the first reachable one in preference order, and the waiting screen says so before opening. A route chosen by hand turns automatic mode off and is never switched silently. Timings live in `RoutePlanner`: 5 s per probe, the waiting screen after 0.8 s, slower wording at 3 s. Long-press the icon and choose **Routes** to pick one; the WebView load-failure page offers the same screen and reopens the same path on the chosen route. Card apps on `play.<root>` are own pages without native privileges.

`android/routes.json` is published to the download bucket by the `routes` job and may only reorder, disable or annotate built-in routes; any unknown domain or malformed list is discarded whole. Adding a domain requires an app release (TWA asset statements, WebView allowlist and sign-in origins are registered per domain). `RoutesTest` parses the exact file that CI publishes.

## Updates

Opening the site never waits for the update check. A background check (at most every 6 hours) stores the release and route list; a newer release is offered on the next launch after the route is chosen, and **Later** hides that version for 3 days. Long-press the launcher icon and choose **Check for updates** for a manual check. The download has a progress bar; opening the website cancels an active download.

The updater reads `latest.json`, `routes.json` and `latest.apk` from the first answering host among `downloads.<root>` of all four routes, starting with the current route's family; all four serve the same bucket. The manifest's `downloadUrl` must name one of those hosts. It bounds payload sizes, rejects downgrades, checks the APK's size/hash/package/version/signing certificate, and delegates installation to Android. Unknown-source permission is requested only when the user installs. Cancellation preserves the current app. Android's package installer performs final signature verification.

`LaunchFlowTest` and `RoutesScreenTest` run the real Activities with controlled probes and release check; run them with `-e screens <prefix>` to write review screenshots under the app's external files directory.

R2 stores only `latest.apk`, `latest.json` and `routes.json`. All must bypass browser and CDN caching. The APK pair is not atomic: publishing writes and verifies the APK first, then writes and verifies the manifest. A client encountering a mismatch discards the file, refreshes the manifest and retries at most once; a newer release requires reviewing the new notes. All writers share the `android-stable` CI concurrency group. Older jobs cannot overwrite a newer release. Failed partial publication remains failed and can be retried from the GitHub draft's saved artifact.

## Release workflow

`.github/workflows/android.yml` verifies Android-related pull requests. A push to `main` affecting `android/`, `scripts/android/` or the workflow runs verification. Publication compares the current source against the last successful R2 release: native app, Gradle/toolchain or release-note changes publish an APK. Documentation, bucket configuration and distribution-script maintenance alone keep the existing APK. Web-only pushes continue through the website workflow and do not notify app users about an APK update. Manual dispatch also requires a new Android release-note fragment.

Before pushing a release, resolve the public manifest's source SHA against the current history. Both scope detection and note generation use the same baseline resolver. A missing commit is fetched by its exact SHA from origin. Divergent history is rejected unless `scripts/android/release-baselines.json` explicitly pins the old source, an equivalent replacement commit, and their identical full Git tree. The resolver verifies both actual trees and requires the replacement to be an ancestor of the new source; it never infers equivalence from a moving tag, Android-only diffs, or release notes. Adding a recovery entry requires source review. It does not change the published manifest, version monotonicity, or same-version artifact identity checks.

Version: `1.0.<workflow run number>`; versionCode: `10000 + run number`. Reruns reuse the exact APK and manifest saved in the release draft. GitHub keeps historical releases; R2 only keeps the latest pair. The published R2 manifest is the successful-release cursor.

Add a five-language JSON fragment under `android/changes/` for each Android release. Authors (including AI coding agents) summarize verified user-visible changes from their commits into this fragment. CI selects fragments changed since the last successfully published source SHA; raw commit messages, web-only changes and infrastructure details are not shown to users. Missing fragments fail publication rather than inventing release notes. The same text appears in GitHub and the updater.

Required Actions secrets:

- `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`; alias `hearthroom`.
- `ANDROID_R2_API_TOKEN` (R2 write access). Existing `CLOUDFLARE_API_TOKEN` is the fallback when it already has the necessary permission.
- Actions variable `ANDROID_CF_ACCOUNT_ID` identifies the authorized account.

Signing certificate identity is public in `release-config.json` and `web/public/.well-known/assetlinks.json`. The latter must be served on all four route domains so Android can validate each TWA origin. Do not mark card sandbox origins as trusted native entry points.

## Cloudflare routing

The shared download bucket is `hearthroom-downloads`, with custom domains `downloads.hearthroom.club`, `downloads.sukisuki.ai`, `downloads.sukisuki.chat` and `downloads.sukisuki.pro`. Each download host has a `host/*` zone route with **no Worker** to exclude it from the wildcard website Worker. Preserve all four exclusions and cache bypass rules. The website `/download` page selects the download host in the visitor’s domain family; installed apps from this version try all four. The published paths must bypass cache; the publishers reject cached readback.

## Scope and evidence

This package does not change provider authentication, payments, conversation state or public service APIs. MCP/Moonloom parity is not applicable to the native installer and static public release files. CI step results, immutable GitHub artifacts, hashes and public readback provide release observability; no user identifiers or prompts are sent to a new telemetry service.

A successful build is not an Android installation test. Verify first install, same-signer update, denied permission, cancelled installation, wrong hash/signer, unavailable network, back navigation, TWA origin validation, sign-in return, card sandbox and file operations. App-store variants need a separate update/distribution policy.
