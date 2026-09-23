import { createExecutionContext, waitOnExecutionContext, env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { makeMember, resetDb } from './helpers';
import { beginLink, acceptIdentity, completeLink, projection, unlink, communityView, publicCommunityView, setPreferences } from '../src/community/service';
import { syncAppearance, appearanceView, saveAppearance, appearanceMedia } from '../src/community/appearance';
import type { Env } from '../src/types';
const config = () => ({...env, COMMUNITY_ENABLED:'true', COMMUNITY_GUILD_ID:'123456789012345678', COMMUNITY_BRIDGE_KEY:'a'.repeat(64), DISCORD_CLIENT_ID:'223456789012345678', DISCORD_CLIENT_SECRET:'test', COMMUNITY_SITE_URL:'https://hearthroom.club'}) as Env;
const user='423456789012345678';
let member:string;
const snapshot = async (extra = {}) => ({user, version:(await projection(config(), user)).version, observedAt:Date.now(), member:true, boostingSince:Date.now()-10000, avatar:'a_'.padEnd(34,'a'), guildAvatar:null, decoration:'a_'.padEnd(34,'b'), guildDecoration:null, ...extra});
beforeEach(async()=>{await resetDb();member=await makeMember(1); const nonce='n'.repeat(40), start=await beginLink(config(),member,nonce);await completeLink(config(),member,await acceptIdentity(config(),start.state,{id:user,name:'Member'}),nonce);});
it('grants only verified current guild supporters and keeps identity/media URLs opaque',async()=>{
 expect((await appearanceView(config(),member)).supporter.active).toBe(false);
 await expect(saveAppearance(config(),member,{avatarSource:'site',nameStyle:'ember',frame:'hearth',publicAppearance:true})).rejects.toThrow();
 expect(await syncAppearance(config(),await snapshot())).toBe(true);
 const view=await appearanceView(config(),member);
 expect(view.supporter.active).toBe(true);
 expect(JSON.stringify(view)).not.toContain(user);
 expect(JSON.stringify(view)).not.toContain('cdn.discordapp.com');
 expect(view.available.discordAvatar).toMatch(/^\/v1\/community\/media\/[a-f0-9]{64}$/);
 await saveAppearance(config(),member,{avatarSource:'discord',nameStyle:'ember',frame:'discord',publicAppearance:true});
 expect((await appearanceView(config(),member,true)).effective).toMatchObject({nameStyle:'ember',frame:'discord',avatarUrl:view.available.discordAvatar});
 expect((await communityView(config(),member)).badges).toContain('server_booster');
 expect((await publicCommunityView(config(),member)).badges).not.toContain('server_booster');
 await setPreferences(config(),member,{publicBadges:true});
 expect((await publicCommunityView(config(),member)).badges).toContain('server_booster');
});
it('revokes confirmed loss, expires stale entitlement, preserves choices and rejects stale receipts',async()=>{
 const s=await snapshot();await syncAppearance(config(),s);
 await saveAppearance(config(),member,{avatarSource:'discord',nameStyle:'glow',frame:'hearth',publicAppearance:true});
 expect(await syncAppearance(config(),{...s,observedAt:s.observedAt-1,boostingSince:null})).toBe(false);
 await env.DB.prepare('UPDATE community_discord_appearance SET verified_at=?').bind(Date.now()-86400001).run();
 expect((await appearanceView(config(),member)).effective.nameStyle).toBe('none');
 expect((await appearanceView(config(),member)).preferences.nameStyle).toBe('glow');
 await syncAppearance(config(),{...s,observedAt:s.observedAt+1,boostingSince:null});
 expect((await appearanceView(config(),member)).supporter.active).toBe(false);
 expect((await appearanceView(config(),member)).effective.avatarUrl).toBeTruthy();
 await unlink(config(),member);
 expect(await syncAppearance(config(),{...s,observedAt:s.observedAt+2})).toBe(false);
 expect((await appearanceView(config(),member)).effective.avatarUrl).toBeNull();
});
it('keeps public cosmetics private until opted in and handles missing guild assets',async()=>{
 await syncAppearance(config(),await snapshot());
 await saveAppearance(config(),member,{avatarSource:'guild',nameStyle:'aurora',frame:'discord',publicAppearance:false});
 const mine=await appearanceView(config(),member),pub=await appearanceView(config(),member,true);
 expect(mine.effective.avatarUrl).toBe(mine.available.discordAvatar);
 expect(pub.effective).toEqual({avatarUrl:null,decorationUrl:null,nameStyle:'none',frame:'none'});
 await expect(saveAppearance(config(),member,{avatarSource:'https://evil.test',nameStyle:'none',frame:'none',publicAppearance:true})).rejects.toThrow();
 await expect(syncAppearance(config(),await snapshot({avatar:'../../anything'}))).rejects.toThrow();
});
it('removes media access immediately on unlink and rejects unknown media',async()=>{
 await syncAppearance(config(),await snapshot());
 const view=await appearanceView(config(),member),key=view.available.discordAvatar!.split('/').pop()!;
 await unlink(config(),member);
 await expect(appearanceMedia(config(),key)).rejects.toThrow('not_found');
 await expect(appearanceMedia(config(),'0'.repeat(64))).rejects.toThrow('not_found');
});

it('an identical observation cannot replace media independently of its entitlement receipt',async()=>{
 const s=await snapshot();await syncAppearance(config(),s);const before=await appearanceView(config(),member);
 expect(await syncAppearance(config(),{...s,avatar:'c'.repeat(32)})).toBe(false);
 const after=await appearanceView(config(),member);expect(after.available).toEqual(before.available);
 const keys=await env.DB.prepare('SELECT key FROM community_appearance_media').all<{key:string}>();
 expect(keys.results.map(r=>'/v1/community/media/'+r.key)).toContain(before.available.discordAvatar);
});

afterEach(()=>vi.restoreAllMocks());
it('proxies only verified PNG assets and counts media failures without identity labels',async()=>{
 await syncAppearance(config(),await snapshot());
 const key=(await appearanceView(config(),member)).available.discordAvatar!.split('/').pop()!;
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  // Use the runtime's Request validation: Workers rejects redirect:'error'.
  new Request(input,init);
  return new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'Content-Type':'image/png'}});
 });
 const result=await appearanceMedia(config(),key);expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toBe('private, max-age=300');
 expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:'manual'});
 fetcher.mockResolvedValueOnce(new Response(null,{status:302,headers:{Location:'https://example.test/image.png'}}));
 await expect(appearanceMedia(config(),key)).rejects.toThrow('community_media_unavailable');
 fetcher.mockResolvedValueOnce(new Response('<svg/>',{headers:{'Content-Type':'image/png'}}));
 await expect(appearanceMedia(config(),key)).rejects.toThrow('community_media_unavailable');
 const {communityRoutes}=await import('../src/community/routes');
 const ctx=createExecutionContext();
 const response=await communityRoutes.fetch(new Request('https://hearthroom.club/v1/community/media/'+('0'.repeat(64))),config(),ctx);await waitOnExecutionContext(ctx);expect(response.status).toBe(404);
 expect(await env.DB.prepare("SELECT value FROM community_metrics WHERE operation='media' AND outcome='denied'").first()).toEqual({value:1});
 const {libraryRoutes}=await import('../src/library');
 const metrics=await (await libraryRoutes.fetch(new Request('https://hearthroom.club/metrics'),config())).text();
 expect(metrics).toContain('hearthroom_community_requests_total{operation="media",outcome="denied"} 1');
});
it('requires member auth for saving and signed bridge auth for granting',async()=>{
 const ctx=createExecutionContext();
 const {communityRoutes}=await import('../src/community/routes');
 expect((await communityRoutes.fetch(new Request('https://hearthroom.club/v1/me/community/appearance',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatarSource:'site',nameStyle:'glow',frame:'hearth',publicAppearance:true})}),config(),ctx)).status).toBe(401);
 expect((await communityRoutes.fetch(new Request('https://hearthroom.club/internal/community/appearance-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(await snapshot())}),config(),ctx)).status).toBe(401);
 await waitOnExecutionContext(ctx);
});
