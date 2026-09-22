/** One-time offline operator helper. Inputs/outputs contain private migration data.
 * Bundle with esbuild --bundle --platform=node --format=esm, then invoke the bundle.
 * No DB access or production writes; generated SQL still requires explicit execution.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {transfers} from '../src/card-transfer';
import {hostingTransferMedia} from '../src/hosting-distribution';
import {projectRole,buildSearchText} from '../src/upstream';
import type {Env} from '../src/types';
import type {ProviderId} from '../src/providers';
interface Item {cardId:string;sourceRoleId:string;authorNumId:number;memberId:string;workId:string;versionId:string;submissionId:string;targetRoleId?:string;targetAccount?:number;operationId?:string}
const [mode,manifestPath,expectedHash,sourceDir,targetDir,outputDir]=process.argv.slice(2);
const raw=await readFile(manifestPath);
if(createHash('sha256').update(raw).digest('hex')!==expectedHash)throw Error('manifest digest mismatch');
const manifest=JSON.parse(raw.toString()) as Item[];
if(manifest.length!==18||manifest.filter(i=>i.targetRoleId).length!==6)throw Error('manifest cardinality changed');
const seen=new Set<string>();
for(const item of manifest){for(const key of ['cardId','sourceRoleId','memberId','workId','versionId','submissionId'] as const){if(!/^[0-9a-f-]{36}$/i.test(item[key]))throw Error('invalid identity')};if(seen.has(item.versionId))throw Error('duplicate version');seen.add(item.versionId)}
const env={PROVIDER_API_BASE:'https://api.lunatalk.ai',PROVIDER_API_BASE_HARBOR:'https://api.harperharbor.com'} as Env;
const fetchNetwork=globalThis.fetch;
const readJSON=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
async function bundle(dir:string,item:Item,provider:ProviderId){
 const data=await readJSON(join(dir,item.versionId+'.json'));
 const owner=provider==='lunatalk'?item.authorNumId:item.targetAccount;
 if(data.receipt.workId!==item.workId||!data.receipt.hostedRevisionId||Number(data.role.accountNumId)!==owner)throw Error('bundle ownership/receipt mismatch');
 if(provider==='lunatalk'&&data.receipt.versionId!==item.versionId)throw Error('source version mismatch');
 globalThis.fetch=async(input,init)=>{
  if(init?.method&&init.method!=='GET')throw Error('offline conversion attempted write');
  const url=new URL(String(input));let value:any;
  if(url.pathname.endsWith('/role/detail'))value=data.role;
  else if(url.pathname.endsWith('/role/author-asset')){if(!data.asset)return new Response('{}',{status:404});value=data.asset}
  else if(url.pathname.endsWith('/worldbook/bindings'))value={bindings:data.books.map((b:any)=>({worldbookId:b.metadata.worldbookId,isActive:true}))};
  else {
   const book=data.books.find((b:any)=>b.metadata.worldbookId===url.searchParams.get('worldbookId'));
   if(!book)throw Error('bundle dependency unavailable');
   if(url.pathname.endsWith('/worldbook/detail'))value=book.metadata;
   else if(url.pathname.endsWith('/worldbook/entry/list'))value={entries:book.entries.map((e:any)=>({...e,matchOptions:typeof e.matchOptions==='string'?(e.matchOptions?JSON.parse(e.matchOptions):null):e.matchOptions})),total:book.entries.length};
   else throw Error('unexpected bundle read');
  }
  return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 };
 try{return {data,card:(await transfers.readHosted(env,provider,'offline-proof',data.receipt.hostedRevisionId,owner!)).card}}finally{globalThis.fetch=fetchNetwork}
}
await mkdir(outputDir,{recursive:true,mode:0o700});
async function save(name:string,data:unknown){await writeFile(join(outputDir,name),typeof data==='string'?data:JSON.stringify(data,null,2),{mode:0o600,flag:'wx'})}
if(mode==='target-manifest'){
 const target=[];
 for(const item of manifest){const source=await bundle(sourceDir,item,'lunatalk');if(item.targetRoleId)target.push({existingRoleId:item.targetRoleId,targetAccount:item.targetAccount,workId:item.workId,versionId:item.versionId,operationId:item.operationId,card:source.card})}
 await save('target-manifest.json',target);
 console.log('validated 18 source bundles; prepared 6 target manifests');
}else if(mode==='verify-target'){
 const receipts=[];
 for(const item of manifest.filter(i=>i.targetRoleId)){
  const source=await bundle(sourceDir,item,'lunatalk'),target=await bundle(targetDir,item,'harbor');
  const sourceHash=await hostingTransferMedia.hash(env,'lunatalk',source.card),targetHash=await hostingTransferMedia.hash(env,'harbor',target.card);
  if(sourceHash!==targetHash)throw Error('immutable target mismatch; no promotion authorized by this receipt');
  receipts.push({versionId:item.versionId,hostedRevisionId:target.data.receipt.hostedRevisionId,sourceHash,targetHash});
 }
 await save('verified-targets.json',receipts);console.log('6 immutable target snapshots match source content and image bytes');
}else if(mode==='cutover-sql'){
 const q=(v:unknown)=>v==null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 const now=Date.now();let index=0;
 for(const item of manifest){
  const source=await bundle(sourceDir,item,'lunatalk');const role=projectRole({...source.data.role,roleTag:source.card.fields?.roleTag??[]});const projection={...role,searchText:buildSearchText(role)};
  let target:any;
  if(item.targetRoleId){target=await bundle(targetDir,item,'harbor');if(target.data.receipt.versionId!==item.versionId)throw Error('target not promoted');if(await hostingTransferMedia.hash(env,'lunatalk',source.card)!==await hostingTransferMedia.hash(env,'harbor',target.card))throw Error('promoted target mismatch')}
  const predicate=`id=${q(item.cardId)} AND provider='lunatalk' AND source_role_id=${q(item.sourceRoleId)} AND author_num_id=${q(item.authorNumId)} AND status='approved' AND (approved_version_id IS NULL OR approved_version_id=${q(item.versionId)})`;
  const sql=[
   `INSERT OR IGNORE INTO works(id,member_id,source_provider,source_role_id,created_at) SELECT ${q(item.workId)},${q(item.memberId)},'lunatalk',${q(item.sourceRoleId)},${now} WHERE EXISTS(SELECT 1 FROM cards WHERE ${predicate});`,
   `UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL,decided_at=${now} WHERE card_id=${q(item.cardId)} AND status='pending' AND id<>${q(item.submissionId)} AND NOT EXISTS(SELECT 1 FROM hosting_versions v WHERE v.submission_id=review_submissions.id);`,
   `DELETE FROM review_snapshots WHERE submission_id IN(SELECT id FROM review_submissions WHERE card_id=${q(item.cardId)} AND status='superseded');`,
   `INSERT OR IGNORE INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,nsfw,hosted_revision_id,card_id,submission_id,public_role,state,created_at) SELECT ${q(item.versionId)},${q(item.workId)},${q(item.memberId)},${q(item.versionId)},${q(item.sourceRoleId)},'lunatalk',nsfw,${q(source.data.receipt.hostedRevisionId)},id,${q(item.submissionId)},${q(JSON.stringify(projection))},'pending',${now} FROM cards WHERE ${predicate} AND EXISTS(SELECT 1 FROM works WHERE id=${q(item.workId)} AND member_id=${q(item.memberId)});`,
   `INSERT OR IGNORE INTO review_submissions(id,card_id,provider,source_role_id,kind,status,content_hash,submitted_at,nsfw) SELECT submission_id,card_id,provider,hosted_revision_id,'re','pending','version:'||version_id,created_at,nsfw FROM hosting_versions WHERE version_id=${q(item.versionId)};`,
   `INSERT OR IGNORE INTO hosting_replicas(version_id,provider,source_role_id,hosted_revision_id,state,created_at) SELECT version_id,provider,source_role_id,hosted_revision_id,'ready',created_at FROM hosting_versions WHERE version_id=${q(item.versionId)};`,
  ];
  if(target)sql.push(`INSERT OR IGNORE INTO hosting_replicas(version_id,provider,source_role_id,hosted_revision_id,state,created_at) SELECT version_id,'harbor',${q(item.operationId)},${q(target.data.receipt.hostedRevisionId)},'ready',created_at FROM hosting_versions WHERE version_id=${q(item.versionId)};`);
  if(target)sql.push(`INSERT OR IGNORE INTO hosting_transfers(version_id,provider,external_id,operation_id,draft_role_id,hosted_revision_id,state,error,updated_at) SELECT version_id,'harbor',${q(item.targetAccount)},${q(item.operationId)},${q(item.operationId)},${q(target.data.receipt.hostedRevisionId)},'ready','',${now} FROM hosting_versions WHERE version_id=${q(item.versionId)};`);
  sql.push(`UPDATE review_submissions SET status='approved',decided_at=${now},note='Owner-authorized version cutover' WHERE id=${q(item.submissionId)} AND status='pending' AND EXISTS(SELECT 1 FROM cards WHERE ${predicate});`,`UPDATE cards SET reviewed_hash='version:'||approved_version_id WHERE id=${q(item.cardId)} AND approved_version_id=${q(item.versionId)};`);
  await save(`cutover-${String(++index).padStart(2,'0')}.sql`,sql.join('\n')+'\n');
 }
 console.log('prepared 18 guarded per-card cutovers; no database writes');
}else throw Error('unknown mode');
