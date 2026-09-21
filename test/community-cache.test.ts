import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import app from '../src/index';
import { resetDb, makeMember, testHandle, whoAmI, restoreUpstream, bearer, rolesOnMainSite, myRolesOnUpstream } from './helpers';
import { upstream } from '../src/upstream';
import { loadMine } from '../src/mine';
import { badgeCollection } from '../src/community/badges';
let member:string;
beforeEach(async()=>{await resetDb();member=await makeMember(11);whoAmI(11);});
afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});
async function get(path:string,headers={}) {const ctx=createExecutionContext();const res=await app.fetch(new Request('https://c.test'+path,{headers}),{...env,COMMUNITY_ENABLED:'true'},ctx);await waitOnExecutionContext(ctx);return res;}
it('reuses public identities and immediately invalidates privacy and award changes',async()=>{
 await env.DB.prepare('INSERT INTO community_preferences(member_id,public_badges) VALUES (?,1)').bind(member).run();
 await env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES (?,'first_work','work',1)").bind(member).run();
 const path='/v1/community/members/'+testHandle(11);
 expect(await (await get(path)).json()).toMatchObject({badges:['first_work']});
 const spy=vi.spyOn(env.DB,'prepare');
 const warm=await get(path);expect(warm.headers.get('X-Cache')).toBe('hit');
 expect(spy.mock.calls.length).toBe(1);
 await env.DB.prepare('UPDATE community_preferences SET public_badges=0 WHERE member_id=?').bind(member).run();
 expect(await (await get(path)).json()).toEqual({badges:[]});
});
it('batches public identities with an explicit bounded request',async()=>{
 const second=await makeMember(22);
 const r=await get('/v1/community/members?handle='+testHandle(11)+'&handle='+testHandle(22));
 expect(r.status).toBe(200);expect(await r.json()).toEqual({members:{[testHandle(11)]:{badges:[]},[testHandle(22)]:{badges:[]}}});
 expect((await get('/v1/community/members?'+Array.from({length:51},(_,i)=>'handle=h'+i).join('&'))).status).toBe(400);
});
it('caches badge definitions while reading current personal award state',async()=>{
 await badgeCollection(env,member);
 const spy=vi.spyOn(env.DB,'prepare');await badgeCollection(env,member);
 expect(spy.mock.calls.some(([sql])=>sql.includes('SELECT * FROM community_badge_definitions'))).toBe(false);
});
it('validates adult comment identity only once per request, never across requests',async()=>{
 rolesOnMainSite({roleId:'cache-card',authorNumId:11});
 const ctx=createExecutionContext();const r=await app.fetch(new Request('https://c.test/v1/cards',{method:'POST',headers:{...bearer('valid'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'cache-card',nsfw:true})}),env,ctx);await waitOnExecutionContext(ctx);
 const {id}=await r.json() as {id:string};
 await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1 WHERE id=?').bind(member).run();
 const spy=vi.spyOn(upstream,'fetchMe');
 expect((await get('/v1/cards/'+id+'/comments?nsfw=1',bearer('valid'))).status).toBe(200);expect(spy).toHaveBeenCalledTimes(1);
 expect((await get('/v1/cards/'+id+'/comments?nsfw=1',bearer('valid'))).status).toBe(200);expect(spy).toHaveBeenCalledTimes(2);
});
it('separates same-number mine caches by verified provider',async()=>{
 myRolesOnUpstream({'one':[{roleId:'one'}],'two':[{roleId:'two'}]});
 const options={page:1,pageSize:24,fresh:false,filter:'all' as const};
 await loadMine(env,'one',11,{...options,provider:'lunatalk'});
 const other=await loadMine(env,'two',11,{...options,provider:'harbor'});
 expect(other.body.items[0].roleId).toBe('two');
});
it('reuses author aggregates and invalidates profile and card visibility',async()=>{
 rolesOnMainSite({roleId:'author-card',authorNumId:11});
 const ctx=createExecutionContext();await app.fetch(new Request('https://c.test/v1/cards',{method:'POST',headers:{...bearer('valid'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'author-card',nsfw:false})}),env,ctx);await waitOnExecutionContext(ctx);
 const path='/v1/authors/'+testHandle(11);await get(path);
 expect((await get(path)).headers.get('X-Cache')).toBe('hit');
 await env.DB.prepare("UPDATE members SET display_name='Updated' WHERE id=?").bind(member).run();
 expect(await (await get(path)).json()).toMatchObject({name:'Updated'});
 await env.DB.prepare("UPDATE cards SET status='needs_review'").run();expect(await (await get(path)).json()).toMatchObject({cardCount:0});
});
it.each(['/v1/me/following','/v1/me/community'])('returns %s without waiting for metrics and eventually records it',async path=>{
 const original=env.DB.prepare.bind(env.DB);let release!:()=>void;
 const held=new Promise<void>(r=>{release=r;});
 vi.spyOn(env.DB,'prepare').mockImplementation(sql=>{
  const statement=original(sql);
  if(sql.startsWith('INSERT INTO library_metrics')||sql.startsWith('INSERT INTO community_metrics')) {
   const bind=statement.bind.bind(statement);
   statement.bind=((...values:unknown[])=>{const bound=bind(...values);const run=bound.run.bind(bound);bound.run=(async()=>{await held;return run();}) as typeof bound.run;return bound;}) as typeof statement.bind;
  }
  return statement;
 });
 const ctx=createExecutionContext();
 const response=Promise.resolve(app.fetch(new Request('https://c.test'+path,{headers:bearer('valid')}),env,ctx));
 const outcome=await Promise.race([response.then(()=> 'response'),new Promise<string>(r=>setTimeout(()=>r('blocked'),100))]);
 release();await response;await waitOnExecutionContext(ctx);
 expect(outcome).toBe('response');
 const table=path.endsWith('following')?'library_metrics':'community_metrics';
 expect((await original(`SELECT SUM(value) AS n FROM ${table}`).first<{n:number}>())?.n).toBe(1);
});
it('invalidates warm public identity on revoke, unlink, expiry and appearance opt-out',async()=>{
 const now=Date.now();
 await env.DB.prepare('INSERT INTO community_preferences(member_id,public_badges,public_level) VALUES (?,1,1)').bind(member).run();
 await env.DB.prepare("INSERT INTO community_subjects(discord_id) VALUES ('123456789012345678')").run();
 await env.DB.prepare("INSERT INTO discord_links VALUES (?,'123456789012345678','name','v1','active',1)").bind(member).run();
 await env.DB.prepare("INSERT INTO community_appearance_preferences VALUES (?,'discord','glow','hearth',1)").bind(member).run();
 await env.DB.prepare("INSERT INTO community_discord_appearance VALUES (?,'v1','sync',?,?,1,?)").bind(member,now,now,JSON.stringify({discordAvatar:'/v1/community/media/test'})).run();
 await env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at,expires_at) VALUES (?,'first_work','work',1,?)").bind(member,now+10000).run();
 const path='/v1/community/members/'+testHandle(11);
 expect(await (await get(path)).json()).toMatchObject({badges:['discord_linked','first_work','server_booster'],appearance:{nameStyle:'glow'}});
 expect((await get(path)).headers.get('X-Cache')).toBe('hit');
 await env.DB.prepare('UPDATE community_appearance_preferences SET public_enabled=0 WHERE member_id=?').bind(member).run();
 expect(await (await get(path)).json()).not.toHaveProperty('appearance');
 const clock=vi.spyOn(Date,'now').mockReturnValue(now+10001);
 expect((await (await get(path)).json() as any).badges).not.toContain('first_work');clock.mockRestore();
 await env.DB.prepare('UPDATE community_awards SET revoked_at=1 WHERE member_id=?').bind(member).run();
 expect((await (await get(path)).json() as any).badges).not.toContain('first_work');
 await env.DB.prepare("UPDATE discord_links SET state='cleanup' WHERE member_id=?").bind(member).run();
 expect(await (await get(path)).json()).toEqual({badges:[]});
});
it('invalidates the badge catalogue when a definition changes',async()=>{
 const before=await badgeCollection(env,member);const key=before.items[0].key;
 await env.DB.prepare('UPDATE community_badge_definitions SET titles=? WHERE key=?').bind('{"en":"Changed"}',key).run();
 expect((await badgeCollection(env,member)).items.find(x=>x.key===key)?.titles).toEqual({en:'Changed'});
 await env.DB.prepare('UPDATE community_badge_definitions SET titles=? WHERE key=?').bind(JSON.stringify(before.items[0].titles),key).run();
});
it('caches comment counts and invalidates on post and deletion while retaining the card guard',async()=>{
 rolesOnMainSite({roleId:'count-card',authorNumId:11});
 const ctx=createExecutionContext();const created=await app.fetch(new Request('https://c.test/v1/cards',{method:'POST',headers:{...bearer('valid'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'count-card',nsfw:false})}),env,ctx);await waitOnExecutionContext(ctx);
 const {id}=await created.json() as {id:string};const path='/v1/cards/'+id+'/comments/count';
 expect(await (await get(path)).json()).toEqual({count:0});expect((await get(path)).headers.get('X-Cache')).toBe('hit');
 await env.DB.prepare("INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES ('count-comment',?,?,'test',1)").bind(id,member).run();
 expect(await (await get(path)).json()).toEqual({count:1});
 await env.DB.prepare("UPDATE comments SET deleted_at=2 WHERE id='count-comment'").run();expect(await (await get(path)).json()).toEqual({count:0});
 await env.DB.prepare('UPDATE cards SET public_blocked=1 WHERE id=?').bind(id).run();expect((await get(path)).status).toBe(404);
});
it('loads a cold page of public identities in two D1 round trips',async()=>{
 const handles=[testHandle(11)];for(let i=30;i<45;i++){await makeMember(i);handles.push(testHandle(i));}
 const spy=vi.spyOn(env.DB,'prepare');
 const r=await get('/v1/community/members?'+handles.map(h=>'handle='+h).join('&'));expect(r.status).toBe(200);
 expect(Object.keys((await r.json() as any).members)).toHaveLength(16);
 expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
});
