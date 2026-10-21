import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {publishRoutes,downloadBucket} from './release.mjs';
if(process.env.GITHUB_REPOSITORY!=='hearthroom/hearthroom'||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Only the authorized main workflow can publish.');
const temp=mkdtempSync(join(tmpdir(),'hearthroom-routes-'));
try{
 const changed=await publishRoutes(readFileSync('android/routes.json'),{
  async read(host,key){
   const response=await fetch(`https://${host}/${key}`,{headers:{'Cache-Control':'no-cache, no-store'},signal:AbortSignal.timeout(30000)});
   if(response.status===404)return null;
   if(!response.ok)throw Error(`${host} route list readback failed.`);
   const cache=response.headers.get('cf-cache-status');
   if(cache==='HIT'||cache==='STALE'||cache==='UPDATING')throw Error('routes.json must bypass CDN cache.');
   return Buffer.from(await response.arrayBuffer());
  },
  async write(key,bytes,type){
   const file=join(temp,key);writeFileSync(file,bytes);
   execFileSync('npx',['--no-install','wrangler','r2','object','put',`${downloadBucket}/${key}`,'--file',file,'--content-type',type,'--cache-control','no-store, max-age=0','--remote'],{stdio:'inherit'});
  }
 });
 console.log(changed?'Route list published and served by every download host.':'Route list unchanged.');
}finally{rmSync(temp,{recursive:true,force:true});}
