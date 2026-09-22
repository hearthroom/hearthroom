import { env, SELF } from 'cloudflare:test';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { resetDb, makeMember, makeReviewer, role, identities, bearer, restoreUpstream } from './helpers';
import { upsertCard } from '../src/cards';

let card: string;
const request = (path: string, token = 'r1', body?: unknown) => SELF.fetch('https://c.test/v1/moderation' + path, {
  method: body ? 'POST' : 'GET', headers: { ...bearer(token), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const proposal = (action: string, token = 'r1') => request('/cases', token, { cardId: card, action, reason: 'A specific review reason', operationId: crypto.randomUUID() });
beforeEach(async () => {
  await resetDb();
  await makeMember(10001);
  await makeReviewer(2); await makeReviewer(3); await makeReviewer(4);
  identities({author:10001,r1:2,r2:3,manager:4});
  card = (await upsertCard(env.DB, role({roleId:'reviewed',authorNumId:10001}), Date.now())).id;
});
afterEach(() => { restoreUpstream(); vi.restoreAllMocks(); });
it('two independent votes remove a work from discovery while retaining direct sharing', async () => {
  const before = await SELF.fetch('https://c.test/v1/cards?zone=all'); expect((await before.json() as any).items).toHaveLength(1);
  const res = await proposal('delist'); expect(res.status).toBe(201);
  const c = await res.json() as any;
  expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(200);
  expect((await request(`/cases/${c.id}/vote`,'r1',{vote:'confirm',reason:'again'})).status).toBe(409);
  expect((await request(`/cases/${c.id}/vote`,'r2',{vote:'confirm',reason:'Agreed'})).status).toBe(200);
  expect((await SELF.fetch('https://c.test/v1/cards?zone=all').then(r=>r.json()) as any).items).toHaveLength(0);
  expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(200);
  expect((await request(`/cards/${card}`)).status).toBe(200);
});
it('one severe report immediately blocks public links, a dispute stays blocked until independent manager resolution',async()=>{
  const listUrl='https://c.test/v1/cards?zone=all';
  await SELF.fetch(listUrl);
  expect((await SELF.fetch(listUrl)).headers.get('X-Cache')).toBe('hit');
  const res=await proposal('suspend');expect(res.status).toBe(201);const c=await res.json() as any;
  const removed=await SELF.fetch(listUrl);
  expect(removed.headers.get('X-Cache')).toBe('miss');
  expect((await removed.json() as any).items).toHaveLength(0);
  expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(404);
  expect((await SELF.fetch('https://c.test/v1/cards/reviewed/platforms')).status).toBe(404);
  expect((await request(`/cases/${c.id}/vote`,'r2',{vote:'oppose',reason:'Needs discussion'})).status).toBe(200);
  expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(404);
  expect((await request(`/cases/${c.id}/resolve`,'r1',{decision:'dismiss',reason:'undo'})).status).toBe(403);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id='member-4'").run();
  expect((await request(`/cases/${c.id}/resolve`,'manager',{decision:'dismiss',reason:'False positive'})).status).toBe(200);
  expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(200);
});
it('rejects non-reviewers and self-review, requires reasons, and replays an operation without duplicate cases',async()=>{
  expect((await proposal('suspend','author')).status).toBe(403);
  await makeReviewer(10001);
  expect((await proposal('suspend','author')).status).toBe(403);
  expect((await request('/cases','r1',{cardId:card,action:'suspend',reason:' ',operationId:crypto.randomUUID()})).status).toBe(400);
  const body={cardId:card,action:'suspend',reason:'Specific problem',operationId:crypto.randomUUID()};
  const a=await request('/cases','r1',body);const b=await request('/cases','r1',body);
  expect(a.status).toBe(201);expect(b.status).toBe(200);
  expect((await a.json() as any).id).toBe((await b.json() as any).id);
});
it('summary counts actionable peer votes only and metadata history omits private snapshots',async()=>{
  const res=await proposal('suspend');expect(res.status).toBe(201);
  const mine=await request('/summary','r1').then(r=>r.json()) as any;
  const peer=await request('/summary','r2').then(r=>r.json()) as any;
  expect(mine.cases).toBe(0);expect(peer.cases).toBe(1);
  const history=await request(`/cards/${card}`).then(r=>r.json()) as any;
  expect(history.cases).toHaveLength(1);expect(history).not.toHaveProperty('snapshot');
  const metrics=await SELF.fetch('https://c.test/metrics').then(r=>r.text());
  expect(metrics).toContain('hearthroom_moderation_requests_total');
  expect(metrics).not.toContain('member-');
});
it('restoration needs two votes, suspension survives re-registration and cannot be cleared by a new approval',async()=>{
 const c=await proposal('suspend').then(r=>r.json()) as any;
 await request(`/cases/${c.id}/vote`,'r2',{vote:'confirm',reason:'Confirmed problem'});
 await env.DB.prepare('DELETE FROM cards WHERE id=?').bind(card).run();
 card=(await upsertCard(env.DB,role({roleId:'reviewed',authorNumId:10001}),Date.now())).id;
 expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(404);
 const restore=await proposal('restore_public').then(r=>r.json()) as any;
 expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(404);
 expect((await request(`/cases/${restore.id}/vote`,'r2',{vote:'confirm',reason:'Issue resolved'})).status).toBe(200);
 expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(200);
});
it('manager tag corrections survive source sync, compensation is scoped, audited and idempotent',async()=>{
 const b={tags:['Mystery'],reason:'Correct classification',operationId:crypto.randomUUID()};
 expect((await request(`/cards/${card}/tags`,'r1',b)).status).toBe(403);
 await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id='member-4'").run();
 expect((await request(`/cards/${card}/tags`,'manager',b)).status).toBe(200);
 await upsertCard(env.DB,role({roleId:'reviewed',authorNumId:10001,tags:['Old']}),Date.now());
 expect((await SELF.fetch('https://c.test/v1/cards/reviewed').then(r=>r.json()) as any).tags).toEqual(['Mystery']);
 const old=Date.now()-30*60*60*1000;
 await env.DB.prepare('UPDATE cards SET registered_at=? WHERE id=?').bind(old,card).run();
 const compensation={board:'day',hours:12,reason:'Site outage',operationId:crypto.randomUUID()};
 expect((await request(`/cards/${card}/compensation`,'manager',compensation)).status).toBe(200);
 expect((await request(`/cards/${card}/compensation`,'manager',compensation)).status).toBe(200);
 expect((await env.DB.prepare('SELECT count(*) n FROM moderation_compensation').first<any>()).n).toBe(1);
 expect((await env.DB.prepare('SELECT registered_at FROM cards WHERE id=?').bind(card).first<any>()).registered_at).toBe(old);
 expect((await SELF.fetch('https://c.test/v1/cards?zone=all&sort=day').then(r=>r.json()) as any).items).toHaveLength(1);
});
it('an urgent suspension can supersede a pending quality vote',async()=>{
 expect((await proposal('delist')).status).toBe(201);
 expect((await proposal('suspend','r2')).status).toBe(201);
 expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(404);
});
it('suspension revokes every approved hosting decision and later approvals cannot reopen the work',async()=>{
 const {submitHosted,hostingDecision,hostGateway}=await import('../src/hosting');
 const {upstream}=await import('../src/upstream');const {claim,stamp}=await import('../src/review');
 const author=await makeMember(10001);const source=role({roleId:'hosted-draft',authorNumId:10001});
 vi.spyOn(hostGateway,'seal').mockImplementation(async(_e,_t,_id,workId,versionId)=>({workId,versionId,hostedRevisionId:'frozen-'+versionId}));
 vi.spyOn(hostGateway,'read').mockImplementation(async(_e,_t,id)=>({...source,roleId:id}));
 vi.spyOn(upstream,'readForReview').mockResolvedValue({hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const submit=()=>submitHosted(env,{memberId:author,account:10001,role:source,token:'author',nsfw:false,operationId:crypto.randomUUID(),now:Date.now()});
 const approve=async()=>{const sub=await env.DB.prepare("SELECT id FROM review_submissions WHERE status='pending'").first<any>();for(const m of ['a','b']){await claim(env.DB,sub.id,m,Date.now());await stamp(env.DB,{submissionId:sub.id,memberId:m,verdict:'approve',note:'',now:Date.now()});if((await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(sub.id).first<any>()).status==='approved')break;}};
 const a=await submit();await approve();const b=await submit();await approve();
 card=(await env.DB.prepare("SELECT id FROM cards WHERE source_role_id='hosted-draft'").first<any>()).id;
 const quality=await proposal('delist').then(r=>r.json()) as any;await request(`/cases/${quality.id}/vote`,'r2',{vote:'confirm',reason:'Quality'});
 expect((await hostingDecision(env.DB,a.versionId)).status).toBe('approved');
 expect((await hostingDecision(env.DB,b.versionId)).status).toBe('approved');
 expect((await proposal('suspend')).status).toBe(201);
 expect((await hostingDecision(env.DB,a.versionId)).status).toBe('revoked');
 expect((await hostingDecision(env.DB,b.versionId)).status).toBe('revoked');
 const third=await submit();await approve();expect((await hostingDecision(env.DB,third.versionId)).status).toBe('revoked');
 const pending=await env.DB.prepare("SELECT id FROM moderation_cases WHERE action='suspend' AND status='pending'").first<any>();await request(`/cases/${pending.id}/vote`,'r2',{vote:'confirm',reason:'Serious problem'});
 const staleRestore=await proposal('restore_public').then(r=>r.json()) as any;
 const fourth=await submit();await approve();
 expect((await request(`/cases/${staleRestore.id}/vote`,'r2',{vote:'confirm',reason:'Stale review'})).status).toBe(409);
 const restore=await proposal('restore_public').then(r=>r.json()) as any;await request(`/cases/${restore.id}/vote`,'r2',{vote:'confirm',reason:'Reviewed revised version'});
 expect((await hostingDecision(env.DB,fourth.versionId)).status).toBe('approved');
 expect((await hostingDecision(env.DB,third.versionId)).status).toBe('revoked');
 expect((await hostingDecision(env.DB,a.versionId)).status).toBe('revoked');
 expect((await hostingDecision(env.DB,b.versionId)).status).toBe('revoked');
});
it('concurrent confirmations produce one decision and preserve independent voter identity',async()=>{
 const c=await proposal('delist').then(r=>r.json()) as any;
 const outcomes=await Promise.all(['r2','manager'].map(t=>request(`/cases/${c.id}/vote`,t,{vote:'confirm',reason:'Checked independently'})));
 expect(outcomes.map(r=>r.status).sort()).toEqual([200,409]);
 expect((await env.DB.prepare('SELECT count(*) n FROM moderation_votes WHERE case_id=?').bind(c.id).first<any>()).n).toBe(2);
});
it('keeps the reported public version available only to eligible reviewers after suspension',async()=>{
 const c=await proposal('suspend').then(r=>r.json()) as any;
 expect((await request(`/cases/${c.id}/evidence`,'author')).status).toBe(403);
 const evidence=await request(`/cases/${c.id}/evidence`,'r2');expect(evidence.status).toBe(200);
 const original=await evidence.json() as any;expect(original.cardNumber).toBeGreaterThan(0);expect(original.names).toBeDefined();
 await upsertCard(env.DB,role({roleId:'reviewed',name:'Changed'}),Date.now());
 expect(await request(`/cases/${c.id}/evidence`,'r2').then(r=>r.json())).toEqual(original);
 expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(404);
});
it('does not expose the game configuration of a suspended work',async()=>{
 const roleId='99999999-1234-1234-1234-123456789abc';
 card=(await upsertCard(env.DB,role({roleId}),Date.now())).id;
 await env.DB.prepare('INSERT INTO game_worlds VALUES(?,?,?,?)').bind(roleId,10001,'{"enabled":true}',Date.now()).run();
 expect((await SELF.fetch(`https://c.test/v1/cards/${roleId}/game`)).status).toBe(200);
 expect((await proposal('suspend')).status).toBe(201);
 expect((await SELF.fetch(`https://c.test/v1/cards/${roleId}/game`)).status).toBe(404);
});
it('atomically rejects a restoration inserted from a stale version read',async()=>{
 const c=await proposal('suspend').then(r=>r.json()) as any;await request(`/cases/${c.id}/vote`,'r2',{vote:'confirm',reason:'Checked'});
 const restore=await proposal('restore_public').then(r=>r.json()) as any;
 // Models a proposal whose earlier card read lost a race to a new version.
 await env.DB.prepare("UPDATE moderation_cases SET version_id='stale-version' WHERE id=?").bind(restore.id).run();
 expect((await request(`/cases/${restore.id}/vote`,'r2',{vote:'confirm',reason:'Stale evidence'})).status).toBe(409);
 expect((await SELF.fetch('https://c.test/v1/cards/reviewed')).status).toBe(404);
});

it('returns provider and durable featured state in workbench list and detail',async()=>{
 await env.DB.prepare('UPDATE cards SET featured_at=123 WHERE id=?').bind(card).run();
 const list=await request('/cards');expect(list.status).toBe(200);
 expect((await list.json() as any).items[0]).toMatchObject({id:card,provider:'lunatalk',featured:true});
 expect((await request(`/cards/${card}`).then(r=>r.json()) as any).card).toMatchObject({provider:'lunatalk',featured:true});
});
