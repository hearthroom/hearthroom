#!/usr/bin/env bash
set -euo pipefail
apk="$1"
android_sdk="${ANDROID_HOME:?ANDROID_HOME is required}"
build_tools="$(find -H "$android_sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
"$build_tools/apksigner" verify --verbose --print-certs "$apk" > "${RUNNER_TEMP:-/tmp}/hearthroom-apk-verification.txt"
node --input-type=module - "$apk" "${RUNNER_TEMP:-/tmp}/hearthroom-apk-verification.txt" <<'JS'
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync('android/release-config.json'));
const result=readFileSync(process.argv[3],'utf8');
const digest=result.match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/i)?.[1]?.toLowerCase();
if(!digest||digest!==config.signingCertificateSha256.replaceAll(':','').toLowerCase())throw Error('Release signing certificate mismatch.');
console.log('APK cryptographic signature verified against the pinned release certificate.');
JS
