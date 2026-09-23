import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {resetManagedAuthForTest} from '@/lib/managed-auth';
import {managedToken,managedLogout,disconnectManaged,managedAuth} from '@/lib/managed-auth';
import {persist,restorePersisted,refresh,revokeSession} from '@/lib/oauth';

beforeEach(()=>{resetManagedAuthForTest();localStorage.clear();sessionStorage.clear();});
afterEach(()=>vi.unstubAllGlobals());
it('restores server-held provider authorization without local credentials and keeps access tokens in memory',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url==='/v1/auth/config')return Response.json({managed:true});
    if(url==='/v1/auth/token')return Response.json({accessToken:'short-lived',expiresAt:Date.now()+60000});
    return Response.json({ok:true});
  }));
  const pair=await refresh('harbor');
  expect(pair?.accessToken).toBe('short-lived');
  persist(pair!,'harbor');
  expect(restorePersisted('harbor')?.accessToken).toBe('short-lived');
  expect(localStorage.getItem('hearthroom.oauth.access.harbor')).toBeNull();
  expect(localStorage.getItem('hearthroom.oauth.refresh.harbor')).toBeNull();
  await revokeSession('harbor');
  expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/oauth/revoke'),expect.anything());
});

it('clears legacy mirrors and scoped credentials when managed mode is enabled',async()=>{
  for(const key of ['hearthroom.oauth.refresh','hearthroom.oauth.refresh.harbor','hearthroom.oauth.access.lunatalk'])localStorage.setItem(key,'old-private');
  vi.stubGlobal('fetch',async()=>Response.json({managed:true}));
  await managedAuth();
  expect([...Array(localStorage.length)].map((_,i)=>localStorage.getItem(localStorage.key(i)!))).not.toContain('old-private');
});

it('does not reinstall a token response that arrives after logout or disconnect',async()=>{
  let finish!:(r:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url.endsWith('/config'))return Response.json({managed:true});
    if(url.endsWith('/token'))return new Promise<Response>(resolve=>{finish=resolve;});
    return Response.json({ok:true,pending:false});
  }));
  await managedAuth();
  const waiting=managedToken('harbor');
  await managedLogout();
  finish(Response.json({accessToken:'late-token',expiresAt:Date.now()+60000}));
  expect(await waiting).toBeNull();
  expect(restorePersisted('harbor')).toBeNull();
  expect(await managedToken('harbor')).toBeNull();
});

it('clears tokens and embedded app state when another tab logs out',async()=>{
  const reload=vi.fn();vi.stubGlobal('location',{reload});
  vi.stubGlobal('fetch',async()=>Response.json({managed:true}));
  await managedAuth();persist({accessToken:'previous-tab',expiresAt:Date.now()+60000},'harbor');
  window.dispatchEvent(new StorageEvent('storage',{key:'hearthroom.auth.change',newValue:JSON.stringify({action:'logout',nonce:'test'})}));
  expect(restorePersisted('harbor')).toBeNull();
  // 重新載入前先刪掉舞台的聊天快取（stage-storage），所以 reload 是非同步的。
  await vi.waitFor(()=>expect(reload).toHaveBeenCalledOnce());
  expect(await managedToken('harbor')).toBeNull();
});

// 重用只在五分鐘內、且離到期超過一分鐘（managed-token-reuse.test.ts）。另一台設備換綁後，
// 快到期的那張不會再被拿出來用；還很新的那張由供應商拒絕後換掉（recoverRejectedToken）。
it('uses the current server grant after another device reconnects once the local access token is near expiry',async()=>{
  const {createPinia,setActivePinia}=await import('pinia');
  const {useSession}=await import('@/lib/session');
  const {accountToken}=await import('@/lib/connections');
  setActivePinia(createPinia());
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/config')
    ?Response.json({managed:true})
    :Response.json({accessToken:'new-generation',expiresAt:Date.now()+60000})));
  await managedAuth();
  const old={accessToken:'superseded',expiresAt:Date.now()+60000};
  persist(old,'harbor');
  expect(await accountToken('harbor')).toBe('new-generation');
  const session=useSession();session.token=old;
  expect(await session.accessToken()).toBe('new-generation');
});
