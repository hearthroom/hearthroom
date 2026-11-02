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
it('keeps HarperHarbor and already authorized Harper sessions unchanged',async()=>{
 const fetch=vi.fn(async()=>new Response('[]'));vi.stubGlobal('fetch',fetch);
 expect(await ensurePlayAuthorization('test-token','/play/a')).toBe(true);
 setProvider('harbor');expect(await ensurePlayAuthorization('test-token','/play/a')).toBe(true);
 expect(fetch).toHaveBeenCalledTimes(2);expect(beginLogin).not.toHaveBeenCalled();
});
// 玩家在 HarperHarbor 控制台撤銷了這個應用：手上的 token 被拒（401）。以前只顯示「載入失敗」，
// 玩家不知道要重新授權；現在直接帶去重新授權、回到同一張卡。剛重新授權過還是被拒就不再轉（不繞圈）。
it('sends the player to authorize again when the app was revoked, but not in a loop',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'invalid_token'}),{status:401})));
 expect(await ensurePlayAuthorization('revoked-token','/play/a?provider=harbor')).toBe(false);
 expect(beginLogin).toHaveBeenCalledWith('/play/a?provider=harbor',{provider:'harbor'});
 await expect(ensurePlayAuthorization('still-rejected','/play/a?provider=harbor')).rejects.toThrow('unavailable');
 expect(beginLogin).toHaveBeenCalledTimes(1);
});
// 卡片在這個國家／地區不提供（403 region_unavailable）：授權要重做也不轉，讓遊玩頁畫「暫不提供」；卡讀得到才轉。
it('waits for the card before authorizing again, and stays put when the card is unavailable in the region',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'invalid_token'}),{status:401})));
 const denied=Object.assign(new Error('forbidden'),{status:403,code:'region_unavailable'});
 await expect(ensurePlayAuthorization('revoked-token','/play/a?provider=harbor','harbor',Promise.reject(denied))).rejects.toBe(denied);
 expect(beginLogin).not.toHaveBeenCalled();
 expect(sessionStorage.getItem('hearthroom.play.reconsentAt')).toBeNull();
 expect(await ensurePlayAuthorization('revoked-token','/play/a?provider=harbor','harbor',Promise.resolve({}))).toBe(false);
 expect(beginLogin).toHaveBeenCalledTimes(1);
});
