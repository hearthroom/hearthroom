import { afterEach, expect, it, vi } from 'vitest';
import { registerCard } from '../src/lib/api';
const expected={policyRevision:'policy-revision-1',approvalRevision:'approval-revision-1'};
const call=registerCard as (...args:any[])=>Promise<unknown>;
const submit=(id:string,intent:object)=>call(id,'fixture',false,[],'harbor',undefined,undefined,expected,intent);
afterEach(()=>vi.unstubAllGlobals());
it('sends the canonical notification intent and preserves it on an unknown-result retry',async()=>{
 const bodies:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
  if(init.method==='GET')return Response.json({error:'publication_operation_not_found',workVisibility:{...expected,syncState:'complete',actions:['submit_update']}},{status:404});
  bodies.push(JSON.parse(String(init.body)));
  if(bodies.length===1)throw new TypeError('network');return Response.json({id:'100001'});
 }));
 await expect(submit('log-retry',{updateKind:'major',updateNote:'  新增第二章劇情和兩條支線\r\n新結局  '})).rejects.toThrow();
 await submit('log-retry',{updateKind:'major',updateNote:'新增第二章劇情和兩條支線\n新結局'});
 expect(bodies[0]).toMatchObject({updateKind:'major',updateNote:'新增第二章劇情和兩條支線\n新結局'});
 expect(bodies[1].operationId).toBe(bodies[0].operationId);
});
it('does not change the notification intent underneath an unresolved operation',async()=>{
 let requests=0;
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{requests++;if(init.method==='GET')return Response.json({operation:{operationId:localStorage.getItem('hearthroom:publication:harbor:frozen-log'),state:'pending'}});throw new TypeError('network');}));
 await expect(submit('frozen-log',{updateKind:'major',updateNote:'新增第二章劇情和兩條支線'})).rejects.toThrow();
 await expect(submit('frozen-log',{updateKind:'major',updateNote:'另外新增第三章劇情和結局'})).rejects.toMatchObject({status:409});
 // Durable readback precedes the intent check; no second POST is sent.
 expect(requests).toBe(2);
});
it('lets an explicit silent retry start a new operation after a definitive cooldown refusal',async()=>{
 const bodies:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
  bodies.push(JSON.parse(String(init.body)));
  return bodies.length===1?Response.json({error:'update_notification_cooldown',nextMajorUpdateAt:Date.now()+10000},{status:409}):Response.json({id:'100001'});
 }));
 await expect(submit('refused-log',{updateKind:'major',updateNote:'新增第二章劇情和兩條支線'})).rejects.toMatchObject({status:409});
 await submit('refused-log',{updateKind:'minor',updateNote:''});
 expect(bodies[1]).toMatchObject({updateKind:'minor',updateNote:''});
 expect(bodies[1].operationId).not.toBe(bodies[0].operationId);
});
