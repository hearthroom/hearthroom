import { SELF, env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { legacyPolicyFixture } from './work-policy-fixture';
import { workPolicyGateway } from '../src/work-policy';
import {pushLine} from '../src/community/push';
import {opsMetrics} from '../src/ops-metrics';
import { bearer, identities, makeReviewer, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite, ratingBody } from './helpers';

beforeEach(async () => {
  await resetDb(); legacyPolicyFixture();
  identities({author:10001, reviewer:20001, other:20002});
  rolesOnMainSite({roleId:'role-1', authorNumId:10001});
  reviewUpstream(); reviewOn();
  await makeReviewer(20001); await makeReviewer(20002);
});
afterEach(() => {restoreUpstream(); reviewOff();});

async function approved() {
  const result = await SELF.fetch('https://c.test/v1/cards', {method:'POST', headers:{...bearer('author'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'role-1',...ratingBody(false),operationId:crypto.randomUUID()})});
  expect([200,201]).toContain(result.status);
  const s=await env.DB.prepare('SELECT id FROM review_submissions ORDER BY rowid DESC LIMIT 1').first<{id:string}>();
  const claim=await SELF.fetch(`https://c.test/v1/review/${s!.id}/claim`, {method:'POST',headers:bearer('reviewer')});
  const {generation}=await claim.json() as {generation:string};
  const stamp=await SELF.fetch(`https://c.test/v1/review/${s!.id}/stamp`, {method:'POST',headers:{...bearer('reviewer'),'Content-Type':'application/json'},body:JSON.stringify({verdict:'approve',note:'original approval',generation})});
  expect(stamp.status).toBe(200);
  return s!.id;
}

it('lists only my decisions with the reviewed version and preserves blind review',async()=>{
  const id=await approved();
  const response=await SELF.fetch('https://c.test/v1/review/decisions',{headers:bearer('reviewer')});
  expect(response.status).toBe(200);
  const body=await response.json() as any;
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toMatchObject({id,verdict:'approve',status:'approved',canCorrect:true,note:'original approval'});
  expect(body.items[0].versionId).toBeTruthy();
  expect(JSON.stringify(body)).not.toMatch(/authorNumId|member_id|external_id/);
  const other=await SELF.fetch('https://c.test/v1/review/decisions',{headers:bearer('other')});
  expect((await other.json() as any).items).toEqual([]);
  expect((await SELF.fetch('https://c.test/v1/review/decisions',{headers:bearer('author')})).status).toBe(403);
});

const correct=(id:string,token='reviewer',operationId=crypto.randomUUID(),note='insufficient setting')=>SELF.fetch(`https://c.test/v1/review/${id}/correction`,{method:'POST',headers:{...bearer(token),'Content-Type':'application/json'},body:JSON.stringify({operationId,note})});

it('corrects a final approval, retains the stamp, notifies the author, and replays without a second effect',async()=>{
 const id=await approved(),operationId=crypto.randomUUID();
 const response=await correct(id,'reviewer',operationId);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({status:'rejected',publicVersionId:null,publicState:'unpublished',operationId});
 expect(await env.DB.prepare('SELECT status,note FROM review_submissions WHERE id=?').bind(id).first()).toMatchObject({status:'rejected',note:'insufficient setting'});
 expect(await env.DB.prepare('SELECT verdict,note FROM review_stamps WHERE submission_id=?').bind(id).first()).toEqual({verdict:'approve',note:'original approval'});
 expect(await env.DB.prepare('SELECT status,approved_version_id FROM cards').first()).toEqual({status:'rejected',approved_version_id:null});
 const notices=await env.DB.prepare("SELECT extra FROM community_notifications WHERE event_key=?").bind('review-correction:'+operationId).all<{extra:string}>();
 expect(notices.results).toHaveLength(1);
 expect(JSON.parse(notices.results[0].extra)).toMatchObject({correction:true,status:'rejected',note:'insufficient setting'});
 const owner=await SELF.fetch(`https://c.test/v1/mine/reviews/${id}`,{headers:bearer('author')});
 expect(owner.status).toBe(200);
 expect(await owner.json()).toMatchObject({status:'rejected',note:'insufficient setting',corrected:true});
 expect((await SELF.fetch(`https://c.test/v1/mine/reviews/${id}`,{headers:bearer('other')})).status).toBe(404);
 expect((await correct(id,'reviewer',operationId)).status).toBe(200);
 expect((await correct(id,'reviewer',operationId,'different reason')).status).toBe(409);
 expect((await env.DB.prepare('SELECT count(*) n FROM review_corrections').first<{n:number}>())!.n).toBe(1);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_review_corrections_total{operation="correct",outcome="success"} 1');
});

it('announces a correction explicitly rather than an ordinary rejection in push and Discord copy',()=>{
 const row={kind:'review_result',extra:JSON.stringify({status:'rejected',correction:true,note:'needs setting'}),actor_name:null,actor_handle:null,card_names:JSON.stringify({zh:'Synthetic card',en:'Synthetic card'})};
 expect(pushLine(row,'zh-Hant')).toContain('已從通過更正為駁回');
 expect(pushLine(row,'en')).toContain('corrected from approved to rejected');
});

it('enforces ownership, final status, 24h limit and manager override',async()=>{
 const id=await approved();
 expect((await correct(id,'other')).status).toBe(403);
 await env.DB.prepare('UPDATE review_submissions SET decided_at=? WHERE id=?').bind(Date.now()-86400001,id).run();
 expect((await correct(id)).status).toBe(403);
 await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id='member-20002'").run();
 expect((await correct(id,'other')).status).toBe(200);
});

it('keeps a durable fence after an unknown Provider reply and recovers the same operation',async()=>{
 const id=await approved(),operationId=crypto.randomUUID(),change=workPolicyGateway.change;
 workPolicyGateway.change=async(...args)=>{await change(...args);throw new Error('reply lost');};
 expect((await correct(id,'reviewer',operationId)).status).toBe(503);
 expect((await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(id).first<{status:string}>())!.status).toBe('approved');
 expect((await env.DB.prepare('SELECT sync_state FROM managed_work_access').first<{sync_state:string}>())!.sync_state).toBe('changing');
 workPolicyGateway.change=change;
 expect((await correct(id,'reviewer',operationId)).status).toBe(200);
});

it('restores the previous approved projection and does not announce it as a new update',async()=>{
 const first=await approved();
 const firstVersion=await env.DB.prepare('SELECT approved_version_id FROM cards').first<{approved_version_id:string}>();
 expect((await SELF.fetch('https://c.test/v1/cards/role-1/edit',{method:'POST',headers:bearer('author')})).status).toBe(200);
 rolesOnMainSite({roleId:'role-1',authorNumId:10001,name:'New name'});
 const second=await approved();expect(second).not.toBe(first);
 const followerNotices=async()=>(await env.DB.prepare("SELECT count(*) n FROM community_notifications WHERE kind='followed_work'").first<{n:number}>())!.n;
 const before=await followerNotices();
 const response=await correct(second);expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({publicState:'previous_version',publicVersionId:firstVersion!.approved_version_id});
 expect(await env.DB.prepare('SELECT status,approved_version_id,names FROM cards').first()).toMatchObject({status:'approved',approved_version_id:firstVersion!.approved_version_id});
 expect(await followerNotices()).toBe(before);
 const historic=await SELF.fetch(`https://c.test/v1/review/${second}/detail`,{headers:bearer('reviewer')});
 expect((await historic.json() as any).detail.document.roleName).toBe('New name');
});

it('correcting an older approval preserves the newer public version',async()=>{
 const first=await approved();
 await SELF.fetch('https://c.test/v1/cards/role-1/edit',{method:'POST',headers:bearer('author')});
 const second=await approved();
 const current=await env.DB.prepare('SELECT approved_version_id FROM cards').first<{approved_version_id:string}>();
 const response=await correct(first);expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({publicState:'unchanged',publicVersionId:current!.approved_version_id});
 expect((await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(second).first<{status:string}>())!.status).toBe('approved');
});

it('keeps the database terminal guard closed without a Provider-confirmed correction',async()=>{
 const id=await approved();
 await expect(env.DB.prepare("UPDATE review_submissions SET status='rejected' WHERE id=?").bind(id).run()).rejects.toThrow('submission already decided');
});
