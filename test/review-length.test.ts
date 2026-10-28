import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GENERAL_RATING, makeMember, resetDb, role } from './helpers';
import { hostGateway, submitHosted } from '../src/hosting';
import { upstream } from '../src/upstream';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

it('rejects a new short submission before sealing or writing a review', async () => {
  const memberId = await makeMember(10001);
  const draft = role({roleId: 'short-draft', authorNumId: 10001});
  const seal = vi.spyOn(hostGateway, 'seal').mockImplementation(async (_env, _token, _role, workId, versionId) => ({workId, versionId, hostedRevisionId: 'sealed-short'}));
  vi.spyOn(hostGateway, 'read').mockResolvedValue({...draft, roleId: 'sealed-short'});
  vi.spyOn(upstream, 'readForReview').mockResolvedValue({
    document: {roleDetailDesc: '字'.repeat(2999)},
    greetings: {welcome: '開'.repeat(5000)},
    worldbooks: [{entries: [{content: '不計'.repeat(5000), isEnabled: true, isConstant: false}]}],
    hashes: {card: '', welcome: '', worldbook: '', authorAsset: '', content: ''},
  });
  await expect(submitHosted(env, {memberId, account: 10001, role: draft, token: 'author', rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now()}))
    .rejects.toMatchObject({status: 400, message: 'review_length_insufficient'});
  expect(seal).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_submissions').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM hosting_versions').first('n')).toBe(0);
});

it('returns the exact counts over HTTP and emits the low-cardinality insufficient metric', async () => {
  const { SELF } = await import('cloudflare:test');
  const { bearer, identities, rolesOnMainSite, ratingBody } = await import('./helpers');
  identities({author: 10001}); rolesOnMainSite({roleId: 'http-short', authorNumId: 10001});
  vi.spyOn(upstream, 'readForReview').mockResolvedValue({document: {roleDetailDesc: '字'.repeat(2000)}, worldbooks: [{entries: [{content: '常'.repeat(1000), isConstant: true}]}], hashes: {card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
  const response = await SELF.fetch('https://c.test/v1/cards', {method:'POST',headers:{...bearer('author'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'http-short',...ratingBody(false),operationId:crypto.randomUUID()})});
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({error:'review_length_insufficient',detail:{reviewLength:{persona:2000,constantWorldbook:1000,total:3000,required:3001,remaining:1,eligible:false,welcome:0}}});
  const { opsMetrics } = await import('../src/ops-metrics');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_review_length_checks_total{phase="draft",outcome="insufficient"} 1');
});

it('checks the immutable revision even if the draft passes preflight', async () => {
  const memberId=await makeMember(10001), draft=role({roleId:'race-draft',authorNumId:10001});
  vi.spyOn(hostGateway,'seal').mockImplementation(async(_env,_token,_role,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-race'}));
  vi.spyOn(hostGateway,'read').mockResolvedValue({...draft,roleId:'sealed-race'});
  vi.spyOn(upstream,'readForReview').mockImplementation(async(_env,_token,id)=>({document:{roleDetailDesc:'字'.repeat(id==='race-draft'?3001:3000)},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}}));
  await expect(submitHosted(env,{memberId,account:10001,role:draft,token:'author',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()})).rejects.toMatchObject({status:400,message:'review_length_insufficient'});
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_submissions').first('n')).toBe(0);
  const {opsMetrics}=await import('../src/ops-metrics');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_review_length_checks_total{phase="sealed",outcome="insufficient"} 1');
});

it('accepts 3001 mixed persona and constant characters, persists counts, replays accepted operations and preserves the public version on a short update', async () => {
  const { loadSnapshot } = await import('../src/review-snapshot');
  const { claim, stamp } = await import('../src/review');
  const memberId=await makeMember(10001), draft=role({roleId:'valid-draft',authorNumId:10001});
  vi.spyOn(hostGateway,'seal').mockImplementation(async(_env,_token,_role,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-'+versionId}));
  vi.spyOn(hostGateway,'read').mockImplementation(async(_env,_token,id)=>({...draft,roleId:id}));
  const read=vi.spyOn(upstream,'readForReview').mockResolvedValue({document:{roleDetailDesc:'a'.repeat(2000)},worldbooks:[{entries:[{content:'字'.repeat(1001),isConstant:true}]}],hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
  const input={memberId,account:10001,role:draft,token:'author',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()};
  const receipt=await submitHosted(env,input);
  const submission=await env.DB.prepare('SELECT id FROM review_submissions').first<{id:string}>();
  expect((await loadSnapshot(env.DB,submission!.id))?.reviewLength).toMatchObject({persona:2000,constantWorldbook:1001,total:3001,eligible:true,remaining:0});
  const {opsMetrics}=await import('../src/ops-metrics');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_review_length_checks_total{phase="sealed",outcome="eligible"} 1');
  await claim(env.DB,submission!.id,'reviewer',Date.now());
  await stamp(env.DB,{submissionId:submission!.id,memberId:'reviewer',verdict:'approve',note:'',now:Date.now()},env);
  const before=await env.DB.prepare("SELECT * FROM cards WHERE source_role_id='valid-draft'").first();
  read.mockResolvedValue({document:{roleDetailDesc:'短'},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
  const reads=read.mock.calls.length;
  expect(await submitHosted(env,input)).toEqual(receipt);
  expect(read).toHaveBeenCalledTimes(reads);
  await expect(submitHosted(env,{...input,operationId:crypto.randomUUID()})).rejects.toMatchObject({message:'review_length_insufficient'});
  expect(await env.DB.prepare("SELECT * FROM cards WHERE source_role_id='valid-draft'").first()).toEqual(before);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_submissions').first('n')).toBe(1);
});
