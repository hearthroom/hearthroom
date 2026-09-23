import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {availableProviders,chooseProvider} from '@/lib/provider-switch';
import {currentProvider,setProvider} from '@/lib/provider';
beforeEach(()=>{localStorage.clear();sessionStorage.clear();setProvider('harbor')});
afterEach(()=>vi.unstubAllGlobals());
it('ignores Luna even if an older server still advertises it',async()=>{
 vi.stubGlobal('fetch',async()=>Response.json({providers:[{id:'lunatalk'},{id:'harbor'},{id:'unknown'}]}));
 expect(await availableProviders()).toEqual([{id:'harbor',name:'HarperHarbor'}]);
});
it('offers Harper when discovery is unavailable',async()=>{
 vi.stubGlobal('fetch',async()=>{throw Error('offline')});
 expect((await availableProviders()).map(p=>p.id)).toEqual(['harbor']);
});
it('starts Harper authorization without signing out an existing account',async()=>{
 const login=vi.fn(),logout=vi.fn();await chooseProvider('harbor',{login,logout,signedIn:true});
 expect(currentProvider()).toBe('harbor');expect(login).toHaveBeenCalledOnce();expect(logout).not.toHaveBeenCalled();
});
