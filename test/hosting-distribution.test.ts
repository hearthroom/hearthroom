import {env} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {resetDb,makeMember,role} from './helpers';
import {submitHosted,hostGateway} from '../src/hosting';
import {upstream} from '../src/upstream';
import {transfers} from '../src/card-transfer';
import {distributeHosted,hostingTransferMedia,seedSavedHostingTargets} from '../src/hosting-distribution';
beforeEach(resetDb);afterEach(()=>vi.restoreAllMocks());
async function fixture(){
 const member=await makeMember(10001);
 await env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES ('harbor','20001',?,1)").bind(member).run();
 vi.spyOn(hostGateway,'seal').mockImplementation(async(_e,_t,_r,workId,versionId)=>({workId,versionId,hostedRevisionId:'source-snapshot'}));
 vi.spyOn(hostGateway,'read').mockResolvedValue(role({roleId:'source-snapshot',authorNumId:10001}));
 vi.spyOn(upstream,'readForReview').mockResolvedValue({hashes:{card:'',content:'',welcome:'',worldbook:'',authorAsset:''}});
 const receipt=await submitHosted(env,{memberId:member,provider:'lunatalk',account:10001,role:role({roleId:'draft',authorNumId:10001}),token:'source',nsfw:false,operationId:crypto.randomUUID(),now:1});
 const card={name:'Title',summary:'Summary',description:'Private',greeting:'Hello',language:'en'};
 vi.spyOn(transfers,'readHosted').mockResolvedValue({card,public:false});
 vi.spyOn(transfers,'update').mockResolvedValue({});
 vi.spyOn(hostGateway,'draft').mockResolvedValue({workId:receipt.workId,roleId:'transfer-draft'});
 vi.spyOn(hostGateway,'stage').mockResolvedValue({workId:receipt.workId,hostedRevisionId:'target-snapshot'});
 vi.spyOn(hostGateway,'promote').mockResolvedValue({...receipt,hostedRevisionId:'target-snapshot'});
 vi.spyOn(hostingTransferMedia,'copy').mockImplementation(async(_e,_sp,_tp,_t,_r,c)=>c);
 return {receipt,member,card,input:{memberId:member,versionId:receipt.versionId,sourceToken:'source',sourceAccount:10001,targetProvider:'harbor' as const,targetToken:'target',targetAccount:20001}};
}
it('promotes only a matching immutable readback and records the shared version',async()=>{
 const {input,receipt}=await fixture();await distributeHosted(env,input);
 expect(transfers.readHosted).toHaveBeenCalledWith(env,'lunatalk','source','source-snapshot',10001);
 expect(hostGateway.promote).toHaveBeenCalledWith(env,'target','target-snapshot',receipt.workId,receipt.versionId,'harbor');
 expect(await env.DB.prepare("SELECT hosted_revision_id,state FROM hosting_replicas WHERE provider='harbor'").first()).toEqual({hosted_revision_id:'target-snapshot',state:'ready'});
 await distributeHosted(env,input);expect(hostGateway.draft).toHaveBeenCalledTimes(1);
});
it('a mismatch never binds the official version and a later attempt can repair it',async()=>{
 const {input,card}=await fixture();vi.mocked(transfers.readHosted).mockResolvedValueOnce({card,public:false}).mockResolvedValueOnce({card:{...card,description:'Lost content'},public:false});
 await expect(distributeHosted(env,input)).rejects.toThrow('hosting_readback_mismatch');
 expect(hostGateway.promote).not.toHaveBeenCalled();
 expect(await env.DB.prepare("SELECT * FROM hosting_replicas WHERE provider='harbor'").first()).toBeNull();
 await distributeHosted(env,input);expect(hostGateway.promote).toHaveBeenCalledTimes(1);
});
it('refuses a target identity that is not connected to the submitting author',async()=>{
 const {input}=await fixture();await env.DB.prepare("DELETE FROM member_identities WHERE provider='harbor'").run();
 await expect(distributeHosted(env,input)).rejects.toThrow('sync_account_not_linked');expect(hostGateway.draft).not.toHaveBeenCalled();
});

it('records an expired saved destination without requiring tokens to be stored',async()=>{
 const {receipt,member}=await fixture();
 await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES (?,'harbor',20001,'old-copy','synced',1)").bind(receipt.workId).run();
 await seedSavedHostingTargets(env,member,receipt.versionId,[]);
 expect(await env.DB.prepare("SELECT state,error,external_id FROM hosting_transfers WHERE provider='harbor'").first()).toEqual({state:'failed',error:'sync_authorization_expired',external_id:20001});
});
it('does not report a removed ready replica as a successful retry',async()=>{
 const {input}=await fixture();await distributeHosted(env,input);
 vi.mocked(transfers.readHosted).mockRejectedValue(new Error('removed'));
 await expect(distributeHosted(env,input)).rejects.toThrow();
});
