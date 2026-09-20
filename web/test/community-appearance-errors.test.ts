import {expect,it,vi,afterEach} from 'vitest';
import {communityRequest} from '../src/lib/community';
import {applyLocale} from '../src/lib/i18n';
afterEach(()=>vi.restoreAllMocks());
it('explains changed supporter eligibility instead of telling the member to retry indefinitely',async()=>{
 await applyLocale('en');vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({error:'community_supporter_required'}),{status:403}));
 await expect(communityRequest('/me/community/appearance','test','PATCH',{})).rejects.toThrow('server boost');
});
