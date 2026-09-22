import test from 'node:test';
import assert from 'node:assert/strict';
import { createManifest, buildNotes, publishLatest, verifyAssetLinks } from './release.mjs';
const notes={en:'First Android release.', 'zh-Hant':'首個 Android 版本。','zh-Hans':'首个 Android 版本。',ja:'Android 版を公開しました。',ko:'Android 첫 버전입니다.'};
const input={apk:Buffer.from('signed-apk'),versionCode:2,versionName:'1.0.2',sourceSha:'a'.repeat(40),notes};
test('manifest binds exact artifact and all locales',()=>{
 const m=createManifest(input);assert.equal(m.size,10);assert.match(m.sha256,/^[a-f0-9]{64}$/);assert.equal(m.downloadUrl,'https://downloads.hearthroom.club/latest.apk');assert.deepEqual(m.releaseNotes,notes);
});
test('rejects invalid versions and incomplete notes',()=>{
 for(const versionCode of [0,-1,1.5,NaN])assert.throws(()=>createManifest({...input,versionCode}));
 assert.throws(()=>createManifest({...input,notes:{en:'only'}}));
});
test('notes use Android release fragments and do not leak commit text',()=>{
 assert.deepEqual(buildNotes([{...notes}]),notes);
 assert.throws(()=>buildNotes([{en:'unfinished'}]));
});
function transport({version=1,corrupt=false,failJson=false}={}){
 const calls=[];const store=new Map([['latest.json',Buffer.from(JSON.stringify({...createManifest(input),versionCode:version}))]]);
 return {calls,store,read:async key=>{calls.push('read:'+key);return store.get(key)??null;},write:async(key,value)=>{calls.push('write:'+key);if(failJson&&key==='latest.json')throw Error('json failed');store.set(key,corrupt&&key==='latest.apk'?Buffer.from('bad'):value);}};
}
test('only latest keys; APK readback precedes manifest replacement',async()=>{
 const io=transport();await publishLatest(input,io);
 assert.deepEqual(io.calls,['read:latest.json','write:latest.apk','read:latest.apk','write:latest.json','read:latest.json']);
 assert.deepEqual([...io.store.keys()].sort(),['latest.apk','latest.json']);
});
test('stale job and same version different artifact fail before writes',async()=>{
 for(const version of [2,3]){const io=transport({version});await assert.rejects(publishLatest({...input,apk:Buffer.from('different')},io));assert.ok(io.calls.every(x=>!x.startsWith('write:')));}
});
test('replay repairs interrupted latest pair using same artifact',async()=>{
 const io=transport({version:2});io.store.set('latest.apk',Buffer.from('broken'));
 await publishLatest(input,io);assert.deepEqual(io.store.get('latest.apk'),input.apk);
});
test('corrupt readback never advances manifest',async()=>{
 const io=transport({corrupt:true});await assert.rejects(publishLatest(input,io));assert.ok(!io.calls.includes('write:latest.json'));
});
test('manifest failure remains a failure and retry can finish',async()=>{
 const io=transport({failJson:true});await assert.rejects(publishLatest(input,io));assert.equal(JSON.parse(io.store.get('latest.json')).versionCode,1);
});

test('release requires live origin association for the exact signing identity',()=>{
 const config={packageId:'club.hearthroom.app',signingCertificateSha256:'AA:BB'};
 const valid=[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:config.packageId,sha256_cert_fingerprints:['AA:BB']}}];
 assert.doesNotThrow(()=>verifyAssetLinks(valid,config));
 for(const data of [[],{},[{...valid[0],relation:[]}],[{...valid[0],target:{...valid[0].target,sha256_cert_fingerprints:['CC:DD']}}]])assert.throws(()=>verifyAssetLinks(data,config));
});
