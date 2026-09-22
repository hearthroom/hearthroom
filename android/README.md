# Hearthroom Android

This Android app opens the existing Hearthroom PWA using Google's Android Browser Helper (the TWA runtime also used by Bubblewrap). The small checked-in native project adds an APK updater; it is not regenerated on each build. Google Play is not a distribution channel for this build.

## Build and verify

JDK 17, Android SDK platform 36 and build tools 35 are required. The checked-in Gradle wrapper pins the toolchain and distribution checksum.

```sh
node --test scripts/android/*.test.mjs
./android/gradlew -p android testDebugUnitTest lintDebug assembleDebug
```

Set `ANDROID_HOME` to the SDK. The debug build uses the normal Android debug signing identity; it cannot replace a release-signed installation. Release signing comes from `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Never commit the keystore or its passwords to this public repository.

## Updates

Normal launch checks for an app update briefly, then opens the website. A failed or slow check does not block access. When an update is available, the user can read its notes, download it, or continue to the website. Long-press the launcher icon and choose **Check for updates** for a manual check. The download has a progress bar; opening the website cancels an active download.

The updater accepts only `https://downloads.hearthroom.club/latest.json` and its fixed `latest.apk` URL. It bounds payload sizes, rejects downgrades, checks the APK's size/hash/package/version/signing certificate, and delegates installation to Android. Unknown-source permission is requested only when the user installs. Cancellation preserves the current app. Android's package installer performs final signature verification.

R2 stores only `latest.apk` and `latest.json`. Both must bypass browser and CDN caching. They are not an atomic pair: publishing writes and verifies the APK first, then writes and verifies the manifest. A client encountering a mismatch discards the file, refreshes the manifest and retries at most once; a newer release requires reviewing the new notes. All writers share the `android-stable` CI concurrency group. Older jobs cannot overwrite a newer release. Failed partial publication remains failed and can be retried from the GitHub draft's saved artifact.

## Release workflow

`.github/workflows/android.yml` verifies Android-related pull requests. A push to `main` affecting `android/`, `scripts/android/` or the workflow publishes an APK after verification. Web-only pushes continue through the website workflow and do not notify app users about an APK update. Manual dispatch also requires a new Android release-note fragment.

Version: `1.0.<workflow run number>`; versionCode: `10000 + run number`. Reruns reuse the exact APK and manifest saved in the release draft. GitHub keeps historical releases; R2 only keeps the latest pair. The published R2 manifest is the successful-release cursor.

Add a five-language JSON fragment under `android/changes/` for each Android release. Authors (including AI coding agents) summarize verified user-visible changes from their commits into this fragment. CI selects fragments changed since the last successfully published source SHA; raw commit messages, web-only changes and infrastructure details are not shown to users. Missing fragments fail publication rather than inventing release notes. The same text appears in GitHub and the updater.

Required Actions secrets:

- `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`; alias `hearthroom`.
- `ANDROID_R2_API_TOKEN` (R2 write access). Existing `CLOUDFLARE_API_TOKEN` is the fallback when it already has the necessary permission.
- Actions variable `ANDROID_CF_ACCOUNT_ID` identifies the authorized account.

Signing certificate identity is public in `release-config.json` and `web/public/.well-known/assetlinks.json`. The latter must be deployed on `hearthroom.club` before the first public release so Android can validate the TWA origin. Do not mark card sandbox origins as trusted native entry points.

## Cloudflare routing

The dedicated R2 bucket is `hearthroom-android`, with custom domain `downloads.hearthroom.club`. A zone Worker route for `downloads.hearthroom.club/*` with **no Worker** excludes this domain from the existing wildcard website Worker. Preserve that exclusion. The two latest paths must bypass cache; the publisher rejects cached readback.

## Scope and evidence

This package does not change provider authentication, payments, conversation state or public service APIs. MCP/Moonloom parity is not applicable to the native installer and static public release files. CI step results, immutable GitHub artifacts, hashes and public readback provide release observability; no user identifiers or prompts are sent to a new telemetry service.

A successful build is not an Android installation test. Verify first install, same-signer update, denied permission, cancelled installation, wrong hash/signer, unavailable network, back navigation, TWA origin validation, sign-in return, card sandbox and file operations. App-store variants need a separate update/distribution policy.
