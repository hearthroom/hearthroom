import {expect,it,vi,afterEach} from 'vitest';
import {readWorkVisibilityCapability} from '../src/lib/work-visibility-capability';
afterEach(()=>vi.unstubAllGlobals());
it.each([{}, {capabilities:{}}, {capabilities:{workVisibility:false}}, {capabilities:{workVisibility:'true'}}, {capabilities:{workVisibility:true}}])('only accepts explicit boolean rollout capability %j',async body=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>body}));
 expect(await readWorkVisibilityCapability()).toBe(body.capabilities?.workVisibility===true);
});
it('fails closed on unavailable manifest',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));expect(await readWorkVisibilityCapability()).toBe(false);});
