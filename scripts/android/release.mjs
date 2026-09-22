import { createHash } from 'node:crypto';
export const locales = ['en','zh-Hant','zh-Hans','ja','ko'];
export const downloadBase = 'https://downloads.hearthroom.club';
export function buildNotes(fragments) {
  if (!fragments.length) throw Error('Add an Android release-note fragment before publishing.');
  const result = Object.fromEntries(locales.map(locale => [locale, []]));
  for (const fragment of fragments) for (const locale of locales) {
    const note = fragment[locale];
    if (typeof note !== 'string' || !note.trim() || note.length > 4000) throw Error('Incomplete Android release notes.');
    result[locale].push(note.trim());
  }
  return Object.fromEntries(locales.map(locale => [locale, result[locale].join('\n')]));
}
export function createManifest({apk,versionCode,versionName,sourceSha,notes,publishedAt=new Date().toISOString()}) {
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw Error('Invalid versionCode.');
  if (typeof versionName !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(versionName)) throw Error('Invalid versionName.');
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw Error('Invalid source SHA.');
  if (!Buffer.isBuffer(apk) || apk.length === 0 || apk.length > 100000000) throw Error('Invalid APK size.');
  return {schemaVersion:1,channel:'stable',packageId:'club.hearthroom.app',versionCode,versionName,
    downloadUrl:`${downloadBase}/latest.apk`,sha256:createHash('sha256').update(apk).digest('hex'),size:apk.length,
    sourceSha,publishedAt,releaseNotes:buildNotes([notes])};
}
/** Caller serializes ALL writers for this bucket. Reads must use the public, uncached URL. */
export async function publishLatest(input, io) {
  const manifest=createManifest(input);
  const before=await io.read('latest.json');
  if (before) {
    const current=JSON.parse(before.toString());
    if (!Number.isSafeInteger(current.versionCode)) throw Error('Invalid current release.');
    if (current.versionCode>manifest.versionCode) throw Error('Refusing stale release.');
    if (current.versionCode===manifest.versionCode && (current.sha256!==manifest.sha256 || current.sourceSha!==manifest.sourceSha)) throw Error('Version already belongs to another artifact.');
  }
  await io.write('latest.apk',input.apk,'application/vnd.android.package-archive');
  const apk=await io.read('latest.apk');
  if (!apk || apk.length!==manifest.size || createHash('sha256').update(apk).digest('hex')!==manifest.sha256) throw Error('Published APK readback failed.');
  const data=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  await io.write('latest.json',data,'application/json; charset=utf-8');
  const verified=await io.read('latest.json');
  if (!verified?.equals(data)) throw Error('Published manifest readback failed.');
  return manifest;
}

export function verifyAssetLinks(data, config) {
  const normalize=value=>String(value).replaceAll(':','').toUpperCase();
  if(!Array.isArray(data)||!data.some(entry=>entry.relation?.includes('delegate_permission/common.handle_all_urls')&&entry.target?.namespace==='android_app'&&entry.target.package_name===config.packageId&&entry.target.sha256_cert_fingerprints?.some(value=>normalize(value)===normalize(config.signingCertificateSha256))))throw Error('Website has not published the release signing identity.');
}
