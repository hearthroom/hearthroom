import {readFileSync} from 'node:fs';
import {verifyAssetLinks,downloadHosts} from './release.mjs';
const config=JSON.parse(readFileSync('android/release-config.json'));
// Every route the app may open as a TWA origin must vouch for the release certificate.
for(const root of downloadHosts.map(host=>host.slice('downloads.'.length))) for(let attempt=0;;attempt++) {
 try {
  const response=await fetch(`https://${root}/.well-known/assetlinks.json`,{redirect:'error',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`${root}: origin association unavailable.`);
  verifyAssetLinks(await response.json(),config);
  console.log(`${root}: live website association matches release certificate.`);break;
 } catch(error) {
  if(attempt===29)throw error;
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
}
