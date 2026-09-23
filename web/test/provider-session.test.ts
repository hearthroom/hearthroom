import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {setProvider} from '@/lib/provider';
import {fetchTags} from '@/lib/api';
beforeEach(()=>{localStorage.clear();sessionStorage.clear();setProvider('harbor')});
afterEach(()=>vi.unstubAllGlobals());
it('marks community requests with the Harper issuer',async()=>{
 const fetcher=vi.fn(async()=>Response.json({items:[]}));vi.stubGlobal('fetch',fetcher);await fetchTags('zh');
 expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('X-Provider')).toBe('harbor');
});
