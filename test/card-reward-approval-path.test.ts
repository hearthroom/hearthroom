import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GENERAL_RATING, identities, makeMember, resetDb, restoreUpstream, role, rolesOnMainSite } from './helpers';
import { legacyPolicyFixture } from './work-policy-fixture';
import { submitHosted } from '../src/hosting';
import { claim, stamp } from '../src/review';
import { finalizeManagedReview } from '../src/work-publication';
import { enrollWorkAccess, workPolicyGateway } from '../src/work-policy';
import { cardRewardTransport } from '../src/card-reward-service';
import { upstream } from '../src/upstream';
import { reconcileWorkAccess } from '../src/work-reconcile';
const source='reward-approval-fixture';let author:string;
beforeEach(async()=>{await resetDb();identities({owner:11001});rolesOnMainSite({roleId:source,authorNumId:11001});legacyPolicyFixture();author=await makeMember(11001);});
afterEach(async()=>{await env.DB.prepare('DROP TRIGGER IF EXISTS test_approval_audit_failure').run();vi.restoreAllMocks();restoreUpstream();});
async function submit(){
 const submitted=await submitHosted(env,{memberId:author,account:11001,role:role({roleId:source,authorNumId:11001}),token:'owner',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 return (await env.DB.prepare('SELECT submission_id FROM hosting_versions WHERE version_id=?').bind(submitted.versionId).first<{submission_id:string}>())!.submission_id;
}
async function approve(id:string){await claim(env.DB,id,'reviewer',Date.now());return stamp(env.DB,{submissionId:id,memberId:'reviewer',verdict:'approve',note:'',now:Date.now()},env);}
const approvals=(id:string)=>env.DB.prepare("SELECT after_json,actor_kind,actor_member_id FROM audit_log WHERE subject_kind='card_reward' AND subject_id=? AND action='approval'").bind(id).all<{after_json:string;actor_kind:string;actor_member_id:string|null}>();
async function managedSubmission(){await approve(await submit());await enrollWorkAccess(env,{memberId:author,roleId:source,operationId:crypto.randomUUID(),access:'public',token:'owner'});return submit();}

it('atomically records a legacy approval and pays with a service token without a reviewer bearer',async()=>{
 const now=Date.now();await env.DB.prepare(`INSERT INTO card_reward_campaigns(id,slug,title,starts_at,ends_at,payout_deadline,weekly_limit,reward,status,created_at,updated_at) VALUES(?,'approval-test','{}',?,?,NULL,6,20000,'active',0,0)`).bind(crypto.randomUUID(),now-86400000,now+86400000).run();
 const token=vi.spyOn(cardRewardTransport,'token').mockResolvedValue('app-only-token');
 const pay=vi.spyOn(upstream,'payCampaign').mockResolvedValue({kind:'paid',entryId:'receipt',paidAt:new Date(now).toISOString(),replayed:false});
 const id=await submit();expect((await approve(id)).submission.status).toBe('approved');
 const rows=(await approvals(id)).results;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({actor_kind:'system',actor_member_id:null});
 expect(JSON.parse(rows[0].after_json)).toMatchObject({path:'stamp',cardId:expect.any(Number)});
 expect(token).toHaveBeenCalledTimes(1);expect(pay).toHaveBeenCalledTimes(1);expect(pay.mock.calls[0][1]).toBe('app-only-token');
 expect(await env.DB.prepare('SELECT status,amount FROM card_rewards').first()).toEqual({status:'paid',amount:20000});
});
it('records managed stamp completion once across finalization replays',async()=>{
 const id=await managedSubmission();expect((await approve(id)).submission.status).toBe('approved');await finalizeManagedReview(env,id);await finalizeManagedReview(env,id);
 const rows=(await approvals(id)).results;expect(rows).toHaveLength(1);expect(JSON.parse(rows[0].after_json)).toMatchObject({path:'stamp'});
});
it('records recovery after a lost publication reply without requiring reward credentials',async()=>{
 const id=await managedSubmission(),commit=workPolicyGateway.commit,now=Date.now();
 await env.DB.prepare(`INSERT INTO card_reward_campaigns(id,slug,title,starts_at,ends_at,payout_deadline,weekly_limit,reward,status,created_at,updated_at) VALUES(?,'recovery-test','{}',?,?,NULL,6,20000,'active',0,0)`).bind(crypto.randomUUID(),now-86400000,now+86400000).run();
 const token=vi.spyOn(cardRewardTransport,'token').mockRejectedValue(new Error('service_unconfigured'));
 const pay=vi.spyOn(upstream,'payCampaign');
 const lost=vi.spyOn(workPolicyGateway,'commit').mockImplementation(async(...args)=>{await commit(...args);throw new Error('Synthetic lost publication reply');});
 await expect(approve(id)).rejects.toThrow('visibility_sync_pending');expect((await approvals(id)).results).toHaveLength(0);lost.mockRestore();
 expect((await reconcileWorkAccess(env,1)).complete).toBe(1);expect(await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(id).first()).toEqual({status:'approved'});
 expect(token).toHaveBeenCalledTimes(1);expect(pay).not.toHaveBeenCalled();
 const result=await env.DB.prepare("SELECT after_json FROM audit_log WHERE subject_kind='card_reward' AND action='automatic' AND json_extract(after_json,'$.outcome')='unavailable'").first<{after_json:string}>();expect(JSON.parse(result!.after_json)).toEqual({path:'recovery',outcome:'unavailable'});
 const rows=(await approvals(id)).results;expect(rows).toHaveLength(1);expect(JSON.parse(rows[0].after_json)).toMatchObject({path:'recovery'});
});
it('rolls back approval when its path audit cannot be written',async()=>{
 const id=await submit();await env.DB.prepare("CREATE TRIGGER test_approval_audit_failure BEFORE INSERT ON audit_log WHEN NEW.action='approval' BEGIN SELECT RAISE(ABORT,'synthetic audit unavailable'); END").run();
 await expect(approve(id)).rejects.toThrow('synthetic audit unavailable');expect(await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(id).first()).toEqual({status:'pending'});expect((await approvals(id)).results).toHaveLength(0);
});
