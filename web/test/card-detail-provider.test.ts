import {afterEach,expect,it,vi} from 'vitest';
import {fetchRoleDetail,fetchPreviewPage,fetchPlayerAsset,fetchCardPlatforms,setLoginViewer} from '../src/lib/api';
import {setProvider,apiBaseOf} from '../src/lib/provider';
import {resetUpstreamForTest} from '../src/lib/config';
afterEach(()=>{vi.unstubAllGlobals();setLoginViewer(null);localStorage.clear();sessionStorage.clear();resetUpstreamForTest();});
it('reads the actual card host without changing the viewer issuer',async()=>{
 setProvider('lunatalk');resetUpstreamForTest();
 const request=vi.fn(async()=>new Response(JSON.stringify({platforms:[]})));vi.stubGlobal('fetch',request);
 await fetchRoleDetail('draft',undefined,'zh-Hant','harbor');
 await fetchPreviewPage('draft','harbor');
 await fetchPlayerAsset('draft','host-token','harbor');
 for(const [url] of request.mock.calls as unknown as [string][])expect(url.startsWith(apiBaseOf('harbor'))).toBe(true);
 expect((request.mock.calls[0] as any)[1].headers.Authorization).toBeUndefined();
 expect((request.mock.calls[2] as any)[1].headers.Authorization).toBe('Bearer host-token');
});
it('passes the viewer token to platform discovery for author fallback without changing its issuer',async()=>{
 setProvider('lunatalk');setLoginViewer(async()=>'viewer-token');
 const request=vi.fn(async()=>new Response(JSON.stringify({platforms:[]})));vi.stubGlobal('fetch',request);
 await fetchCardPlatforms('neutral-work');
 expect(request).toHaveBeenCalledWith('/v1/cards/neutral-work/platforms',expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer viewer-token','X-Provider':'lunatalk'})}));
});
