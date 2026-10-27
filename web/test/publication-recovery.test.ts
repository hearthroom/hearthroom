import {afterEach,expect,it,vi} from 'vitest';
import {registerCard} from '../src/lib/api';
import {i18n} from '../src/lib/i18n';

const expected={policyRevision:'policy-revision-1',approvalRevision:'approval-revision-1'};
const submit=(role:string,fandom:string)=>registerCard(role,'fixture',false as any,[],'harbor',fandom,undefined,expected);
afterEach(()=>vi.unstubAllGlobals());

it('explains that a completed prior submission did not apply the changed intent, without losing the dialog or issuing another POST',async()=>{
 const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{
  if(init.method==='POST')throw new TypeError('reply lost');
  return Response.json({operation:{operationId:localStorage.getItem('hearthroom:publication:harbor:completed-recovery'),state:'complete'},card:{id:'100001'}});
 });vi.stubGlobal('fetch',fetcher);
 await expect(submit('completed-recovery','old')).rejects.toThrow();
 const key='hearthroom:publication:harbor:completed-recovery',saved=localStorage.getItem(key);
 await expect(submit('completed-recovery','new')).rejects.toMatchObject({status:409,code:'publication_completed_different_intent',message:i18n.global.t('workspace.submitPreviousAccepted')});
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(localStorage.getItem(key)).toBe(saved);
 await expect(submit('completed-recovery','new')).rejects.toMatchObject({code:'publication_completed_different_intent'});
 expect(fetcher).toHaveBeenCalledTimes(3); // GET only; the old accepted operation stays authoritative.
});

it('directs another browser with no old key to edit and save when the server preparation still owns the work',async()=>{
 const posts:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
  if(init.method==='GET')return Response.json({error:'publication_operation_not_found',workVisibility:{...expected,syncState:'complete',actions:['submit_update']}},{status:404});
  posts.push(JSON.parse(String(init.body)).operationId);
  return Response.json({error:'hosting_preparation_unfinished'},{status:409});
 }));
 await expect(submit('different-browser-orphan','new')).rejects.toMatchObject({code:'hosting_preparation_unfinished',message:i18n.global.t('workspace.submitUnfinished')});
 await expect(submit('different-browser-orphan','new')).rejects.toMatchObject({code:'hosting_preparation_unfinished',message:i18n.global.t('workspace.submitUnfinished')});
 expect(posts).toHaveLength(2);expect(posts[1]).toBe(posts[0]);
});

it('keeps pending intent intact and explains the conflict after durable readback',async()=>{
 const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{
  if(init.method==='POST')throw new TypeError('reply lost');
  return Response.json({operation:{operationId:localStorage.getItem('hearthroom:publication:harbor:pending-recovery'),state:'pending'}});
 });vi.stubGlobal('fetch',fetcher);
 await expect(submit('pending-recovery','old')).rejects.toThrow();
 const key='hearthroom:publication:harbor:pending-recovery',saved=localStorage.getItem(key);
 await expect(submit('pending-recovery','new')).rejects.toMatchObject({code:'visibility_operation_conflict',message:i18n.global.t('workspace.submitUnfinished')});
 expect(fetcher).toHaveBeenCalledTimes(2);expect(localStorage.getItem(key)).toBe(saved);
});
