import {afterEach,expect,it,vi} from 'vitest';
import {disconnectAccount} from '../src/lib/connections';
import {persist} from '../src/lib/oauth';
import {currentProvider,setProvider} from '../src/lib/provider';
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear()});
it('disconnects a sign-in provider using the other verified connection without making the user activate it',async()=>{
 setProvider('harbor');persist({accessToken:'remaining',expiresAt:Date.now()+60000},'lunatalk');
 const fetch=vi.fn(async(url:string,init?:RequestInit)=>new Response(JSON.stringify(url.includes('/open/v1/me')?{accountNumId:11}:{handle:'stable',identities:[{provider:'lunatalk',externalId:11}]})));
 vi.stubGlobal('fetch',fetch);
 const profile=await disconnectAccount('harbor','removed',[{provider:'lunatalk',externalId:11,linkedAt:1},{provider:'harbor',externalId:22,linkedAt:2}]);
 expect(profile.handle).toBe('stable');
 const request=fetch.mock.calls.find(([url])=>url.endsWith('/connections/harbor'))!;
 expect(request[1]?.headers).toEqual({Authorization:'Bearer remaining','X-Provider':'lunatalk'});
 expect(currentProvider()).toBe('lunatalk');
});
