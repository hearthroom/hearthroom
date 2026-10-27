import {afterEach,expect,it,vi} from 'vitest';
import {registerCard} from '../src/lib/api';
import {i18n} from '../src/lib/i18n';

const expected={policyRevision:'policy-revision-1',approvalRevision:'approval-revision-1'};
const submit=(role:string,fandom:string)=>registerCard(role,'fixture',false as any,[],'harbor',fandom,undefined,expected);
afterEach(()=>vi.unstubAllGlobals());

it('reads a completed operation before comparing a changed local intent',async()=>{
 const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{
  if(init.method==='POST')throw new TypeError('reply lost');
  return Response.json({operation:{operationId:localStorage.getItem('hearthroom:publication:harbor:completed-recovery'),state:'complete'},card:{id:'100001'}});
 });vi.stubGlobal('fetch',fetcher);
 await expect(submit('completed-recovery','old')).rejects.toThrow();
 await expect(submit('completed-recovery','new')).resolves.toMatchObject({id:'100001'});
 expect(fetcher).toHaveBeenCalledTimes(2);
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
