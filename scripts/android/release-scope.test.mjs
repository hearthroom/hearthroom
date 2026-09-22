import test from 'node:test';
import assert from 'node:assert/strict';
import {needsNativeRelease,downloadBucket} from './release.mjs';
test('website and distribution maintenance do not prompt an APK update',()=>{
 assert.equal(needsNativeRelease(['web/src/pages/DownloadPage.vue','scripts/android/publish-release.mjs','android/release-config.json','.github/workflows/android.yml','android/README.md']),false);
 assert.equal(downloadBucket,'hearthroom-downloads');
});
test('app, build toolchain and explicit release notes require a native release',()=>{
 for(const path of ['android/app/src/main/AndroidManifest.xml','android/app/build.gradle','android/gradle/wrapper/gradle-wrapper.properties','android/build.gradle','android/settings.gradle','android/gradle.properties','android/gradlew','android/changes/new.json'])assert.equal(needsNativeRelease([path]),true,path);
});
