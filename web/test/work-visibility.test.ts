import { afterEach, expect, it, vi } from 'vitest';
import { createRole } from '../src/lib/api';
import { fetchWorkVisibility, changeWorkVisibility, fetchVisibilityOperation, VisibilityError } from '../src/lib/work-visibility';
afterEach(()=>vi.unstubAllGlobals());
it('creates a private source explicitly',async()=>{
 const request=vi.fn(async()=>new Response('{"roleId":"source"}'));vi.stubGlobal('fetch',request);
 await createRole({roleName:'Fixture'},'token');
 expect(JSON.parse(String((request.mock.calls[0] as any)[1].body))).toMatchObject({visibility:'private',origin:'hearthroom'});
});
it('uses the author endpoints, original provider and caller command without dropping pending receipts',async()=>{
 const result={operation:{operationId:'same-key',state:'pending'}};
 const request=vi.fn(async()=>new Response(JSON.stringify(result),{status:202}));vi.stubGlobal('fetch',request);
 const command={operationId:'same-key',expectedPolicyRevision:'3',expectedApprovalRevision:'4',action:'cancel_review' as const};
 expect(await changeWorkVisibility('source/id','token','harbor',command)).toEqual(result);
 await fetchVisibilityOperation('source/id','same-key','token','harbor');
 expect((request.mock.calls[0] as any)[0]).toBe('/v1/me/cards/source%2Fid/visibility');
 expect((request.mock.calls[1] as any)[0]).toBe('/v1/me/cards/source%2Fid/visibility/operations/same-key');
 const init=(request.mock.calls[0] as any)[1];expect(JSON.parse(init.body)).toEqual(command);
 expect(new Headers(init.headers).get('X-Provider')).toBe('harbor');expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token');
 expect(init.cache).toBe('no-store');
});
it('retains structured conflict and unavailable receipts without showing raw server text',async()=>{
 const body={error:'visibility_sync_pending',operation:{operationId:'same-key',state:'pending'}};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(body),{status:503})));
 try {await fetchWorkVisibility('source','token','harbor');throw new Error('expected rejection');}
 catch(e){expect(e).toBeInstanceOf(VisibilityError);expect(e).toMatchObject({status:503,code:body.error,result:body});}
});
