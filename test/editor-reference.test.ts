import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {getCard,upsertCard} from '../src/cards';
import {hostGateway} from '../src/hosting';
import {workPolicyGateway} from '../src/work-policy';
import {HttpError} from '../src/types';
import {identitiesFor,makeMember,resetDb,restoreUpstream,role} from './helpers';

beforeEach(resetDb);
afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});
async function fixture(){
 identitiesFor({harbor:{owner:11,other:42,profileOnly:11}});const member=await makeMember(11);await makeMember(42);
 const source=crypto.randomUUID();
 await upsertCard(env.DB,role({roleId:source,authorNumId:11,name:'Synthetic owner draft'}),Date.now(),{status:'unlisted'});
 const row=await getCard(env.DB,source);if(!row)throw Error('fixture missing');
 const owner=vi.spyOn(workPolicyGateway,'owner').mockImplementation(async(_env,_provider,_id,token)=>{if(token!=='owner')throw new HttpError(403,'insufficient_scope');return undefined as never;});
 const read=vi.spyOn(hostGateway,'read').mockImplementation(async(_env,token)=>{if(token!=='owner')throw new HttpError(403,'insufficient_scope');return role({roleId:source,authorNumId:11,name:'Synthetic owner draft'});});
 return {source,num:row.num??Number(row.id),owner,read,member};
}
async function request(num:number,token?:string){
 const ctx=createExecutionContext();const response=await worker.fetch(new Request('https://c.test/v1/me/cards/'+num+'/author-reference',{headers:token?{Authorization:'Bearer '+token}:{}}),{...env,WORK_SHARING_ENABLED:'true'},ctx);await waitOnExecutionContext(ctx);return response;
}
it('resolves only the owned source of an unrated link card without enabling adult viewing',async()=>{
 const {source,num,owner,read,member}=await fixture();
 const response=await request(num,'owner');expect(response.status).toBe(200);
 const body=await response.json();expect(body).toEqual({num,provider:'harbor',sourceRoleId:source});
 expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
 expect(owner).toHaveBeenCalledWith(expect.anything(),'harbor',source,'owner');expect(read).toHaveBeenCalledWith(expect.anything(),'owner',source,'harbor');
 const settings=await env.DB.prepare('SELECT show_nsfw,age_verified_at,adult_consent_version FROM members WHERE id=?').bind(member).first();
 expect(settings?.show_nsfw??0).toBe(0);expect(settings?.age_verified_at??null).toBeNull();
});
it.each(['other','profileOnly',undefined])('does not disclose an author source to %s',async token=>{
 const {source,num}=await fixture();const response=await request(num,token);expect(response.status).toBe(token?404:401);expect(await response.text()).not.toContain(source);
});
it('fails closed when the owner gateway returns another source',async()=>{
 const {num,read}=await fixture();read.mockResolvedValueOnce(role({roleId:crypto.randomUUID(),authorNumId:11}));expect((await request(num,'owner')).status).toBe(404);
});

it('retains the owned card fandom metadata used by the editor',async()=>{
 const {source,num}=await fixture();await env.DB.prepare("UPDATE cards SET fandom='Synthetic work',fandom_key='wd:Q123' WHERE source_role_id=?").bind(source).run();
 const response=await request(num,'owner');expect(response.status).toBe(200);expect(await response.json()).toMatchObject({sourceRoleId:source,fandom:'Synthetic work',fandomKey:'wd:Q123'});
});

it('does not disclose an approved adult source to another account',async()=>{
 const {source,num}=await fixture();await env.DB.prepare("UPDATE cards SET status='approved',rating='R' WHERE source_role_id=?").bind(source).run();
 const response=await request(num,'other');expect(response.status).toBe(404);expect(await response.text()).not.toContain(source);
});
it('resolves an owned source with only a card number and no cards projection',async()=>{
 const {source,num}=await fixture();await env.DB.prepare('DELETE FROM cards WHERE source_role_id=?').bind(source).run();
 const response=await request(num,'owner');expect(response.status).toBe(200);expect(await response.json()).toEqual({num,provider:'harbor',sourceRoleId:source});
 expect(await getCard(env.DB,source)).toBeNull();
 for(const token of ['other','profileOnly']){const denied=await request(num,token);expect(denied.status).toBe(404);expect(await denied.text()).not.toContain(source);}
});
