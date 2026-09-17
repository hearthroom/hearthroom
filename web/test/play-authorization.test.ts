import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {ensurePlayAuthorization} from '@/lib/play-authorization';
import {setProvider,scopeOf} from '@/lib/provider';
import {beginLogin} from '@/lib/oauth';
vi.mock('@/lib/oauth',()=>({beginLogin:vi.fn()}));
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.clearAllMocks();setProvider('harbor')});
afterEach(()=>vi.unstubAllGlobals());
it('requests conversation access without replacing existing platform links',()=>expect(scopeOf('harbor').split(' ')).toContain('chat.play'));
it('upgrades an existing read/write grant only when the server says scope is missing',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'insufficient_scope'}),{status:403})));
 expect(await ensurePlayAuthorization('test-token','/play/a?provider=harbor')).toBe(false);
 expect(beginLogin).toHaveBeenCalledWith('/play/a?provider=harbor',{provider:'harbor'});
});
it('does not repeatedly authorize on network or provider errors',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));
 await expect(ensurePlayAuthorization('test-token','/play/a')).rejects.toThrow('unavailable');
 expect(beginLogin).not.toHaveBeenCalled();
});
it('keeps LunaTalk and already authorized Harper sessions unchanged',async()=>{
 const fetch=vi.fn(async()=>new Response('[]'));vi.stubGlobal('fetch',fetch);
 expect(await ensurePlayAuthorization('test-token','/play/a')).toBe(true);
 setProvider('lunatalk');expect(await ensurePlayAuthorization('test-token','/play/a')).toBe(true);
 expect(fetch).toHaveBeenCalledTimes(1);expect(beginLogin).not.toHaveBeenCalled();
});
