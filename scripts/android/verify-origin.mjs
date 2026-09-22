import {readFileSync} from 'node:fs';
import {verifyAssetLinks} from './release.mjs';
const config=JSON.parse(readFileSync('android/release-config.json'));
for(let attempt=0;;attempt++) {
 try {
  const response=await fetch('https://hearthroom.club/.well-known/assetlinks.json',{redirect:'error',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Origin association unavailable.');
  verifyAssetLinks(await response.json(),config);
  console.log('Live website association matches release certificate.');break;
 } catch(error) {
  if(attempt===29)throw error;
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
}
