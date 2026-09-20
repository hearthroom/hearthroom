import { SELF, env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { resetDb, makeMember, bearer, whoAmI, restoreUpstream } from './helpers';
import { badgeCollection, setFeaturedBadges, createEventBadge, changeBadgeAward } from '../src/community/badges';
import { projection, communityMaintenance } from '../src/community/service';
let member:string, manager:string;
beforeEach(async()=>{await resetDb();member=await makeMember(11);manager=await makeMember(22);await env.DB.prepare("INSERT INTO reviewers(member_id,granted_at,granted_by,role) VALUES (?,0,'test','manager')").bind(manager).run();});
afterEach(restoreUpstream);
const definition=()=>({key:'event_summer',icon:'star',titles:{'zh-Hant':'夏日旅人',en:'Summer traveler'},descriptions:{'zh-Hant':'參與夏日活動。',en:'Join the summer event.'}});
async function grant(action='grant',requestId=crypto.randomUUID(),extra={}){return changeBadgeAward(env,manager,{handle:'aaaaaabb',badge:'event_summer',action,requestId,reason:'Event participation',...extra});}
it('shows the catalog and honest locked conditions without granting anything',async()=>{
 const wall=await badgeCollection(env,member);expect(wall.items.length).toBeGreaterThanOrEqual(6);expect(wall.items.every(b=>b.state==='locked')).toBe(true);expect(wall.featured).toEqual([]);expect(wall.canManage).toBe(false);
 expect((await badgeCollection(env,manager)).canManage).toBe(true);
});
it('preserves first-work awards and hides all collection data by default',async()=>{
 await env.DB.prepare("INSERT INTO community_awards VALUES (?, 'first_work','work',100,NULL,NULL,0)").bind(member).run();
 const own=await badgeCollection(env,member);expect(own.items.find(b=>b.key==='first_work')).toMatchObject({state:'earned',earnedAt:100});
 expect(await badgeCollection(env,member,true)).toEqual({items:[],featured:[]});
});
it('persists selected badges, rejects unearned/duplicate/more-than-three picks, and respects public consent',async()=>{
 await env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES (?, 'first_work','work',100)").bind(member).run();
 for(const keys of [['server_booster'],['first_work','first_work'],['a','b','c','d']])await expect(setFeaturedBadges(env,member,keys)).rejects.toThrow('community_badge_selection');
 await setFeaturedBadges(env,member,['first_work']);expect((await badgeCollection(env,member)).featured).toEqual(['first_work']);
 await env.DB.prepare('UPDATE community_preferences SET public_badges=1 WHERE member_id=?').bind(member).run();
 const publicWall=await badgeCollection(env,member,true);expect(publicWall.items).toHaveLength(1);expect(publicWall).not.toHaveProperty('xp');expect(publicWall).not.toHaveProperty('canManage');
 await setFeaturedBadges(env,member,[]);expect((await badgeCollection(env,member)).featured).toEqual([]);
});
it('denies member/reviewer grants and validates event definitions',async()=>{
 await expect(createEventBadge(env,member,definition())).rejects.toThrow('community_manager_required');
 await env.DB.prepare("UPDATE reviewers SET role='reviewer' WHERE member_id=?").bind(manager).run();
 await expect(createEventBadge(env,manager,definition())).rejects.toThrow('community_manager_required');
 await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(manager).run();
 await expect(createEventBadge(env,manager,{...definition(),key:'first_work'})).rejects.toThrow('community_input');
 await expect(createEventBadge(env,manager,{...definition(),icon:'<svg>'})).rejects.toThrow('community_input');
});
it('creates, grants, revokes and regrants an event with durable idempotency and audit',async()=>{
 await createEventBadge(env,manager,definition());const requestId=crypto.randomUUID();await grant('grant',requestId);await grant('grant',requestId);
 expect((await badgeCollection(env,member)).items.find(b=>b.key==='event_summer')?.state).toBe('earned');
 expect((await env.DB.prepare('SELECT * FROM community_badge_audit').all()).results).toHaveLength(1);
 await setFeaturedBadges(env,member,['event_summer']);await grant('revoke');
 expect((await badgeCollection(env,member)).items.find(b=>b.key==='event_summer')?.state).toBe('revoked');expect((await badgeCollection(env,member)).featured).toEqual([]);
 await grant('grant',requestId);expect((await badgeCollection(env,member)).items.find(b=>b.key==='event_summer')?.state).toBe('revoked');
 await expect(grant('revoke',requestId)).rejects.toThrow('community_badge_conflict');
 await grant();expect((await badgeCollection(env,member)).items.find(b=>b.key==='event_summer')?.state).toBe('earned');
});
it('does not allow staff to forge automatic badges',async()=>{
 await expect(grant('grant',crypto.randomUUID(),{badge:'server_booster'})).rejects.toThrow('community_input');
});
it('expires awards and queues role cleanup even though expiry itself is not a write',async()=>{
 await createEventBadge(env,manager,definition());await grant('grant',crypto.randomUUID(),{expiresAt:Date.now()+60000});
 await env.DB.prepare("INSERT INTO community_subjects(discord_id) VALUES ('123456789012345678')").run();
 await env.DB.prepare("INSERT INTO discord_links VALUES (?,'123456789012345678','member','version','active',0)").bind(member).run();
 expect((await projection(env,'123456789012345678')).badges).toContain('event_summer');
 await env.DB.prepare("UPDATE community_awards SET expires_at=1 WHERE member_id=?").bind(member).run();
 await env.DB.prepare('UPDATE community_subjects SET dirty=0').run();
 expect((await badgeCollection(env,member)).items.find(b=>b.key==='event_summer')?.state).toBe('expired');
 expect((await projection(env,'123456789012345678')).badges).not.toContain('event_summer');
 await communityMaintenance(env);
 expect((await env.DB.prepare('SELECT dirty FROM community_subjects').first())?.dirty).toBe(1);
});
it('automatically earns activity milestones once and retains them when Discord unlinks',async()=>{
 await env.DB.prepare("INSERT INTO community_subjects(discord_id) VALUES ('123456789012345678')").run();
 await env.DB.prepare("INSERT INTO discord_links VALUES (?,'123456789012345678','member','version','active',0)").bind(member).run();
 await env.DB.prepare("INSERT INTO community_xp(event_id,discord_id,event_time,points) VALUES ('event','123456789012345678',100,1000)").run();
 const earned=(await badgeCollection(env,member)).items.filter(b=>b.state==='earned').map(b=>b.key);expect(earned).toContain('community_level_5');expect(earned).toContain('community_level_10');expect(earned).not.toContain('community_level_20');
 await env.DB.prepare('DELETE FROM discord_links WHERE member_id=?').bind(member).run();expect((await badgeCollection(env,member)).items.find(b=>b.key==='community_level_10')?.state).toBe('earned');
});
it('authenticates routes, scopes writes to the session and exports member request metrics',async()=>{
 expect((await SELF.fetch('https://c.test/v1/me/community/badges')).status).toBe(401);whoAmI(11);
 const response=await SELF.fetch('https://c.test/v1/me/community/badges',{headers:bearer('valid')});expect(response.status).toBe(200);
 const denied=await SELF.fetch('https://c.test/v1/me/community/badges/manage/definitions',{method:'POST',headers:{...bearer('valid'),'Content-Type':'application/json'},body:JSON.stringify(definition())});expect(denied.status).toBe(403);
 expect((await SELF.fetch('https://c.test/v1/community/members/aaaaaabb/badges')).status).toBe(200);
 const metrics=await (await SELF.fetch('https://c.test/metrics')).text();expect(metrics).toContain('operation="badge_read"');expect(metrics).toContain('operation="badge_admin",outcome="denied"');
});
it('allows ordinary multiline event conditions from the management form',async()=>{
 await createEventBadge(env,manager,{...definition(),descriptions:{en:'Join the event.\nComplete both activities.'}});
 expect((await badgeCollection(env,member)).items.find(b=>b.key==='event_summer')?.descriptions.en).toContain('\n');
});
it('isolates concurrent retries and never lets them grant a different member',async()=>{
 await createEventBadge(env,manager,definition());const requestId=crypto.randomUUID();await Promise.all([grant('grant',requestId),grant('grant',requestId)]);
 await expect(grant('grant',requestId,{handle:'aaaaaacc'})).rejects.toThrow('community_badge_conflict');
 expect((await env.DB.prepare('SELECT * FROM community_badge_audit').all()).results).toHaveLength(1);expect((await badgeCollection(env,manager)).items.find(b=>b.key==='event_summer')?.state).toBe('locked');
});

it('rejects expiry values outside the browser date range',async()=>{
 await createEventBadge(env,manager,definition());await expect(grant('grant',crypto.randomUUID(),{expiresAt:Number.MAX_SAFE_INTEGER})).rejects.toThrow('community_input');
});
