import { env, SELF } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ADULT_RATING, GENERAL_RATING, ratingBody, resetDb, role, makeMember } from './helpers';
import { submitHosted, hostingDecision, hostGateway, beginHostedEdit } from '../src/hosting';
import { syncBatch } from '../src/index';
import { claim, stamp, pendingSubmissionOf } from '../src/review';
import { getCard, syncStatement } from '../src/cards';
import { upstream } from '../src/upstream';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
async function setup() {
 const memberId = await makeMember(10001);
 const draft = role({roleId:'draft',authorNumId:10001});
 vi.spyOn(hostGateway,'seal').mockImplementation(async(_env,_token,_id,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-'+versionId}));
 vi.spyOn(hostGateway,'read').mockImplementation(async(_env,_token,id)=>({...draft,roleId:id}));
 vi.spyOn(upstream,'readForReview').mockResolvedValue({document:{roleDetailDesc:'fixture'},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const submit = (adult=false) => submitHosted(env,{memberId,account:10001,role:draft,token:'fixture',rating:adult?ADULT_RATING:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 const pending = async () => (await pendingSubmissionOf(env.DB,(await getCard(env.DB,'draft','harbor'))!.id))!;
 const approve = async () => { const s=await pending(); for(const memberId of s.kind==='first'?['a','b']:['c']) {await claim(env.DB,s.id,memberId,Date.now());if((await stamp(env.DB,{submissionId:s.id,memberId,verdict:'approve',note:'',now:Date.now()})).submission.status!=='pending')break;} };
 return {memberId,draft,submit,pending,approve};
}
it('editing a pending update retires its review, preserves A, and a fresh review promotes B',async()=>{
 const f=await setup();const a=await f.submit();await f.approve();
 f.draft.names.en='B';const b=await f.submit(true);const old=await f.pending();
 await claim(env.DB,old.id,'old-reviewer',Date.now());
 expect(await beginHostedEdit(env.DB,f.memberId,'draft',Date.now())).toEqual({resubmit:true,...ratingBody(true)});
 expect((await hostingDecision(env.DB,a.versionId)).status).toBe('approved');
 expect((await hostingDecision(env.DB,b.versionId)).status).toBe('superseded');
 await expect(stamp(env.DB,{submissionId:old.id,memberId:'old-reviewer',verdict:'approve',note:'',now:Date.now()})).rejects.toThrow('already decided');
 expect(await env.DB.prepare('SELECT 1 FROM review_snapshots WHERE submission_id=?').bind(old.id).first()).toBeNull();
 // A failed or interrupted save can resume without losing the re-review obligation.
 expect(await beginHostedEdit(env.DB,f.memberId,'draft',Date.now())).toEqual({resubmit:true,...ratingBody(true)});
 f.draft.names.en='B revised';const next=await f.submit(true);await f.approve();
 const card=(await getCard(env.DB,'draft','harbor'))!;
 expect(card.approved_version_id).toBe(next.versionId);
 expect(JSON.parse(card.names).en).toBe('B revised');
 expect(card.rating).toBe('R');
 expect((await env.DB.prepare('SELECT search_name FROM cards WHERE id=?').bind(card.id).first<{search_name:string}>())?.search_name).toContain('b revised');
 expect((await getCard(env.DB,a.hostedRevisionId,'harbor'))?.approved_version_id).toBe(next.versionId);
 expect((await hostingDecision(env.DB,a.versionId)).status).toBe('approved');
});
// 過審那一版的內容版本記在卡上（0052）：「我的卡片」拿它跟草稿現在的比，看得出作者改了沒送審。
// 新版還在審時不動，新版過審才換成新那一版的。
const approvedHash=async()=>(await env.DB.prepare("SELECT approved_content_hash h FROM cards WHERE source_role_id='draft'").first<{h:string|null}>())?.h;
it('remembers the approved version\'s content hash, and replaces it only when a newer version is approved',async()=>{
 const f=await setup();
 f.draft.contentHash='h-a';await f.submit();await f.approve();
 expect(await approvedHash()).toBe('h-a');
 f.draft.contentHash='h-b';await f.submit();
 expect(await approvedHash()).toBe('h-a');
 await f.approve();
 expect(await approvedHash()).toBe('h-b');
});
// 0052 之前封存的版本沒記到：同步讀的就是過審的封存版，順手補上；供應商沒回版本就保留原值。
it('sync fills in the approved hash for versions sealed before it was recorded, and keeps it when the provider omits it',async()=>{
 const f=await setup();await f.submit();await f.approve();
 expect(await approvedHash()).toBeNull();
 const sealedId=(await getCard(env.DB,'draft','harbor'))!.approved_hosted_role_id!;
 vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>({...role({roleId:id,authorNumId:10001}),contentHash:'h-sealed'}));
 await env.DB.prepare('UPDATE cards SET last_synced_at=0').run();
 expect((await syncBatch(env)).failed).toBe(0);
 expect(await approvedHash()).toBe('h-sealed');
 vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>role({roleId:id,authorNumId:10001}));
 await env.DB.prepare('UPDATE cards SET last_synced_at=0').run();
 await syncBatch(env);
 expect(await approvedHash()).toBe('h-sealed');
 expect(sealedId).toMatch(/^sealed-/);
});
// 0055：整份內容版本（含作者規則與世界書）跟內容版本一樣記、一樣換、一樣由同步補齊。
const approvedRevision=async()=>(await env.DB.prepare("SELECT approved_revision_hash h FROM cards WHERE source_role_id='draft'").first<{h:string|null}>())?.h;
it('remembers the approved version\'s revision hash alongside the content hash, and sync fills it in',async()=>{
 const f=await setup();
 f.draft.contentHash='h-a';(f.draft as any).revisionHash='r-a';await f.submit();await f.approve();
 expect(await approvedRevision()).toBe('r-a');
 (f.draft as any).revisionHash='r-b';await f.submit();
 expect(await approvedRevision()).toBe('r-a');
 await f.approve();
 expect(await approvedRevision()).toBe('r-b');
 vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>({...role({roleId:id,authorNumId:10001}),contentHash:'h-a',revisionHash:'r-sealed'}));
 await env.DB.prepare('UPDATE cards SET last_synced_at=0').run();
 expect((await syncBatch(env)).failed).toBe(0);
 expect(await approvedRevision()).toBe('r-sealed');
});
it('editing an approved draft does not start review, and another member cannot cancel a pending review',async()=>{
 const f=await setup();const a=await f.submit();await f.approve();
 expect(await beginHostedEdit(env.DB,f.memberId,'draft',Date.now())).toEqual({resubmit:false});
 const b=await f.submit();
 await expect(beginHostedEdit(env.DB,'other','draft',Date.now())).rejects.toThrow('not the author');
 expect((await hostingDecision(env.DB,b.versionId)).status).toBe('pending');
 expect((await hostingDecision(env.DB,a.versionId)).status).toBe('approved');
});
it('the database refuses a stale stamp or decision after a pending revision is superseded',async()=>{
 const f=await setup();await f.submit();const old=await f.pending();
 await beginHostedEdit(env.DB,f.memberId,'draft',Date.now());
 await expect(env.DB.prepare("INSERT INTO review_stamps(submission_id,member_id,verdict,note,created_at) VALUES (?,'stale','approve','',0)").bind(old.id).run()).rejects.toThrow('submission already decided');
 await expect(env.DB.prepare("UPDATE review_submissions SET status='approved' WHERE id=?").bind(old.id).run()).rejects.toThrow('submission already decided');
 expect((await getCard(env.DB,'draft','harbor'))!.approved_version_id).toBeNull();
});

it('HTTP edit requires the source author and preserves the public play choice',async()=>{
 const f=await setup();const a=await f.submit();await f.approve();await f.submit();
 vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>role({roleId:id,authorNumId:10001}));
 await env.DB.prepare("INSERT INTO member_connections VALUES ('harbor','10001',?,0)").bind(f.memberId).run();
 (env as {HOSTING_SERVICE_KEY?:string}).HOSTING_SERVICE_KEY='fixture';
 const identity=vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:10002});
 const url='https://c.test/v1/cards/draft/edit';
 const headers={Authorization:'Bearer fixture','X-Provider':'harbor'};
 try {
  expect((await SELF.fetch(url,{method:'POST'})).status).toBe(401);
  expect((await SELF.fetch(url,{method:'POST',headers})).status).toBe(403);
  identity.mockResolvedValue({accountNumId:10001});
  const response=await SELF.fetch(url,{method:'POST',headers});
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({resubmit:true,...ratingBody(false)});
  const choices=await SELF.fetch('https://c.test/v1/cards/draft/platforms',{headers});
  expect(await choices.json()).toEqual({platforms:[{provider:'harbor',roleId:a.hostedRevisionId,playable:true}]});
 } finally {delete (env as {HOSTING_SERVICE_KEY?:string}).HOSTING_SERVICE_KEY;}
});

it('a delayed sync of A cannot overwrite the public projection after B is approved',async()=>{
 const f=await setup();await f.submit();await f.approve();
 const card=(await getCard(env.DB,'draft','harbor'))!;
 const delayed=syncStatement(env.DB,card.id,0,role({roleId:card.approved_hosted_role_id!,nameEn:'A'}),Date.now());
 f.draft.names.en='B';await f.submit();await f.approve();
 await delayed.run();
 expect(JSON.parse((await getCard(env.DB,'draft','harbor'))!.names).en).toBe('B');
});

it('rejects stale legacy review writes after migration supersedes the old submission',async()=>{
 const {upsertCard}=await import('../src/cards');
 const card=await upsertCard(env.DB,role({roleId:'legacy',authorNumId:10001}),1,{status:'approved'});
 const sub={id:crypto.randomUUID()};
 await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,content_hash,submitted_at) VALUES (?,?,'harbor','legacy','re','pending','old',1)").bind(sub.id,card.id).run();
 await env.DB.prepare("UPDATE review_submissions SET status='superseded' WHERE id=?").bind(sub.id).run();
 await expect(env.DB.prepare("INSERT INTO review_stamps(submission_id,member_id,verdict,note,created_at) VALUES (?,'stale','approve','',0)").bind(sub.id).run()).rejects.toThrow('submission already decided');
 await expect(env.DB.prepare("UPDATE review_submissions SET status='approved' WHERE id=?").bind(sub.id).run()).rejects.toThrow('submission already decided');
});
// 分享圖（作者畫的 1.91:1 連結預覽圖）與橫式背景跟其他公開欄位一樣跟著過審那一版走：過審的觸發器從封存的 public_role 抄（0054），
// 同步讀過審的封存版時也帶上；新的一版沒有分享圖，過審後就清掉，不殘留上一版的。
const shareImage=async()=>(await env.DB.prepare("SELECT share_image_url s FROM cards WHERE source_role_id='draft'").first<{s:string|null}>())?.s;
it('the approved version\'s share image reaches the card, and a later version without one clears it',async()=>{
 const f=await setup();
 f.draft.shareImageUrl='https://assets.harperharbor.com/share-a.png';await f.submit();await f.approve();
 expect(await shareImage()).toBe('https://assets.harperharbor.com/share-a.png');
 expect((await getCard(env.DB,'draft','harbor'))!.share_image_url).toBe('https://assets.harperharbor.com/share-a.png');
 f.draft.shareImageUrl='https://assets.harperharbor.com/share-b.png';await f.submit();
 expect(await shareImage()).toBe('https://assets.harperharbor.com/share-a.png');
 await f.approve();
 expect(await shareImage()).toBe('https://assets.harperharbor.com/share-b.png');
 delete f.draft.shareImageUrl;await f.submit();await f.approve();
 expect(await shareImage()).toBeNull();
});
it('sync writes the share image of the approved revision onto the card',async()=>{
 const f=await setup();await f.submit();await f.approve();
 expect(await shareImage()).toBeNull();
 vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>({...role({roleId:id,authorNumId:10001}),shareImageUrl:'https://assets.harperharbor.com/share-sync.png'}));
 await env.DB.prepare('UPDATE cards SET last_synced_at=0').run();
 expect((await syncBatch(env)).failed).toBe(0);
 expect(await shareImage()).toBe('https://assets.harperharbor.com/share-sync.png');
});
const landscape=async()=>(await env.DB.prepare("SELECT landscape_url l FROM cards WHERE source_role_id='draft'").first<{l:string|null}>())?.l;
it('the approved version\'s landscape background reaches the card, and a later version without one clears it',async()=>{
 const f=await setup();
 f.draft.backgroundLandscapeUrl='https://assets.harperharbor.com/land-a.png';await f.submit();await f.approve();
 expect(await landscape()).toBe('https://assets.harperharbor.com/land-a.png');
 f.draft.backgroundLandscapeUrl='https://assets.harperharbor.com/land-b.png';await f.submit();
 expect(await landscape()).toBe('https://assets.harperharbor.com/land-a.png');
 await f.approve();
 expect(await landscape()).toBe('https://assets.harperharbor.com/land-b.png');
 delete f.draft.backgroundLandscapeUrl;await f.submit();await f.approve();
 expect(await landscape()).toBeNull();
});
it('sync writes the landscape background of the approved revision onto the card',async()=>{
 const f=await setup();await f.submit();await f.approve();
 vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>({...role({roleId:id,authorNumId:10001}),backgroundLandscapeUrl:'https://assets.harperharbor.com/land-sync.png'}));
 await env.DB.prepare('UPDATE cards SET last_synced_at=0').run();
 expect((await syncBatch(env)).failed).toBe(0);
 expect(await landscape()).toBe('https://assets.harperharbor.com/land-sync.png');
});
