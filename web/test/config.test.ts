import {afterEach,expect,it,vi} from 'vitest';
import * as config from '../src/lib/config';
afterEach(()=>config.resetUpstreamForTest());
it('pins upstream and OAuth resource to Harper even with stale region hints',async()=>{
 sessionStorage.setItem('hr.apiBase','https://api.lunatalk.ai');
 const fetcher=vi.fn();expect(await config.resolveUpstream(fetcher)).toBe('https://api.harperharbor.com');
 expect(config.oauthResource()).toBe('https://api.harperharbor.com/open/v1');expect(fetcher).not.toHaveBeenCalled();
});
