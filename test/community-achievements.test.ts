import { env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { resetDb, makeMember, restoreUpstream } from './helpers';
import { badgeCollection, setFeaturedBadges, FOUNDER_CUTOFF } from '../src/community/badges';
import { communityMaintenance } from '../src/community/service';
import { BADGE_ICONS, BADGE_CATEGORIES } from '../shared/community-badges';
const LOCALES=['zh-Hant','zh-Hans','en','ja','ko'];
let member:string, author:string;
beforeEach(async()=>{
 await resetDb();member=await makeMember(11);author=await makeMember(22);
 // Fresh fixtures join after the founding window so the founder badge is tested deliberately below.
 await env.DB.prepare('UPDATE members SET created_at=?').bind(FOUNDER_CUTOFF+1).run();
});
afterEach(restoreUpstream);
const find=async(who:string,key:string,publicOnly=false)=>(await badgeCollection(env,who,publicOnly)).items.find(b=>b.key===key);
async function conversations(who:string,n:number){for(let i=0;i<n;i++)await env.DB.prepare("INSERT INTO member_conversations VALUES (?,'lunatalk',?,?,1,1)").bind(who,'role-'+i,'conv-'+i).run();}
async function listedCard(id:number,authorNumId:number,extra:Record<string,unknown>={}){
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,featured_at) VALUES (?,?,?,'{}','{}',1,1,'approved',?)").bind(id,'role-'+id,authorNumId,extra.featuredAt??null).run();
}
it('ships a catalog with every locale, an allowlisted icon and a known category',async()=>{
 const wall=await badgeCollection(env,member);
 expect(wall.items.length).toBeGreaterThanOrEqual(29);
 for(const b of wall.items){
  expect(BADGE_ICONS).toContain(b.icon);expect(BADGE_CATEGORIES).toContain(b.category);
  for(const l of LOCALES){expect(b.titles[l],b.key+' title '+l).toBeTruthy();expect(b.descriptions[l],b.key+' description '+l).toBeTruthy();}
 }
 const order=wall.items.map(b=>BADGE_CATEGORIES.indexOf(b.category as typeof BADGE_CATEGORIES[number]));
 expect(order).toEqual([...order].sort((a,b)=>a-b));
 expect(wall.items.every(b=>b.state==='locked')).toBe(true);
});
it('awards milestones on the owner read, shows progress toward the next tier and persists the award',async()=>{
 await conversations(member,10);
 expect(await find(member,'player_first_play')).toMatchObject({state:'earned'});
 expect(await find(member,'player_explorer_10')).toMatchObject({state:'earned',progress:{value:10,target:10}});
 expect(await find(member,'player_explorer_50')).toMatchObject({state:'locked',progress:{value:10,target:50}});
 const rows=(await env.DB.prepare("SELECT badge,source FROM community_awards WHERE member_id=? ORDER BY badge").bind(member).all()).results;
 expect(rows).toEqual([{badge:'player_explorer_10',source:'metric-v1'},{badge:'player_first_play',source:'metric-v1'}]);
 await env.DB.prepare('DELETE FROM member_conversations').run();
 // Earned milestones are one-way: losing the counter never revokes them.
 expect(await find(member,'player_explorer_10')).toMatchObject({state:'earned'});
});
it('never evaluates counters on a public read; the hourly sweep awards without any owner visit',async()=>{
 await env.DB.prepare('INSERT INTO community_preferences(member_id,public_badges) VALUES (?,1)').bind(member).run();
 await conversations(member,1);
 expect(await find(member,'player_first_play',true)).toBeUndefined();
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM community_awards').first<{n:number}>())!.n).toBe(0);
 await communityMaintenance(env);
 expect(await find(member,'player_first_play',true)).toMatchObject({state:'earned'});
 const wall=await badgeCollection(env,member,true);
 expect(wall.items.every(b=>b.state==='earned'&&!('progress' in b))).toBe(true);
});
it('counts creator milestones by listed, owned, non-copy cards and featured picks',async()=>{
 await listedCard(100001,22);await listedCard(100002,22);await listedCard(100003,22,{featuredAt:5});
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status) VALUES (100004,'role-4',22,'{}','{}',1,1,'pending')").run();
 await listedCard(100005,22);await env.DB.prepare('UPDATE cards SET board_hidden=1 WHERE id=100005').run();
 await env.DB.prepare("INSERT INTO works VALUES ('w1',?,'lunatalk','role-100001',1)").bind(author).run();
 await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,updated_at) VALUES ('w1','harbor',22,'copy-1',1)").run();
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider) VALUES (100006,'copy-1',22,'{}','{}',1,1,'approved','harbor')").run();
 for(const [n,who] of [[100001,member],[100002,author],[100003,member]] as const)await env.DB.prepare('INSERT INTO member_favorites VALUES (?,?,1)').bind(who,n).run();
 await env.DB.prepare('INSERT INTO member_follows VALUES (?,?,1)').bind(member,author).run();
 expect(await find(author,'creator_works_3')).toMatchObject({state:'earned',progress:{value:3,target:3}});
 expect(await find(author,'creator_works_10')).toMatchObject({state:'locked',progress:{value:3,target:10}});
 expect(await find(author,'creator_featured')).toMatchObject({state:'earned'});
 expect(await find(author,'creator_favorited_10')).toMatchObject({state:'locked',progress:{value:3,target:10}});
 expect(await find(author,'creator_followers_10')).toMatchObject({state:'locked',progress:{value:1,target:10}});
 expect(await find(member,'player_follows_5')).toMatchObject({state:'locked',progress:{value:1,target:5}});
 expect(await find(member,'player_favorites_10')).toMatchObject({state:'locked',progress:{value:2,target:10}});
 expect(await find(member,'creator_works_3')).toMatchObject({state:'locked',progress:{value:0,target:3}});
});
it('reads social, profile and tenure milestones from their own tables',async()=>{
 for(let i=0;i<3;i++)await env.DB.prepare("INSERT INTO comments(id,card_id,member_id,content,like_count,created_at,deleted_at) VALUES (?,100001,?,'hi',?,1,?)").bind('c'+i,member,i===0?12:1,i===2?1:null).run();
 expect(await find(member,'player_commenter_1')).toMatchObject({state:'earned'});
 expect(await find(member,'player_commenter_10')).toMatchObject({state:'locked',progress:{value:2,target:10}});
 expect(await find(member,'player_liked_10')).toMatchObject({state:'earned',progress:{value:13,target:10}});
 expect(await find(member,'member_profile')).toMatchObject({state:'locked'});
 expect((await find(member,'member_profile'))!.progress).toBeUndefined();
 await env.DB.prepare('UPDATE members SET profile_edited_at=1 WHERE id=?').bind(member).run();
 expect(await find(member,'member_profile')).toMatchObject({state:'earned'});
 expect(await find(member,'member_founder')).toMatchObject({state:'locked'});
 await env.DB.prepare('UPDATE members SET created_at=? WHERE id=?').bind(FOUNDER_CUTOFF-1,member).run();
 expect(await find(member,'member_founder')).toMatchObject({state:'earned'});
 expect(await find(member,'member_anniversary')).toMatchObject({state:'locked',progress:{target:365,unit:'days'}});
 await env.DB.prepare('UPDATE members SET created_at=? WHERE id=?').bind(Date.now()-366*86400000,member).run();
 expect(await find(member,'member_anniversary')).toMatchObject({state:'earned'});
 expect(await find(member,'community_level_5')).toMatchObject({state:'locked',progress:{value:0,target:250,unit:'xp'}});
});
it('lets members feature up to five earned badges',async()=>{
 await conversations(member,50);
 for(let i=0;i<10;i++)await env.DB.prepare("INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES (?,100001,?,'hi',1)").bind('d'+i,member).run();
 await env.DB.prepare('UPDATE members SET profile_edited_at=1 WHERE id=?').bind(member).run();
 await badgeCollection(env,member);
 const five=['player_first_play','player_explorer_10','player_explorer_50','player_commenter_1','player_commenter_10'];
 await setFeaturedBadges(env,member,five);
 expect((await badgeCollection(env,member)).featured).toEqual(five);
 expect((await find(member,'member_profile'))!.state).toBe('earned');
 await expect(setFeaturedBadges(env,member,[...five,'member_profile'])).rejects.toThrow('community_badge_selection');
});
it('the hourly sweep evaluates every metric and agrees with the owner read',async()=>{
 const fans:string[]=[];for(let i=0;i<10;i++)fans.push(await makeMember(100+i));
 await env.DB.prepare('UPDATE members SET created_at=?').bind(FOUNDER_CUTOFF+1).run();
 // creator side: three listed cards (one featured), ten followers, ten saves on those cards
 await listedCard(100001,22);await listedCard(100002,22);await listedCard(100003,22,{featuredAt:5});
 for(const fan of fans){await env.DB.prepare('INSERT INTO member_follows VALUES (?,?,1)').bind(fan,author).run();await env.DB.prepare('INSERT INTO member_favorites VALUES (?,100001,1)').bind(fan).run();}
 // player side: one conversation, one save, ten favorites, five follows, one comment with ten likes
 await conversations(member,1);
 await env.DB.prepare("INSERT INTO card_saves VALUES (?,'role-1','slot','{}',1)").bind(member).run();
 for(let i=0;i<10;i++){await listedCard(100010+i,33);await env.DB.prepare('INSERT INTO member_favorites VALUES (?,?,1)').bind(member,100010+i).run();}
 for(const fan of fans.slice(0,5))await env.DB.prepare('INSERT INTO member_follows VALUES (?,?,1)').bind(member,fan).run();
 await env.DB.prepare("INSERT INTO comments(id,card_id,member_id,content,like_count,created_at) VALUES ('c1',100001,?,'hi',10,1)").bind(member).run();
 // membership side: profile edited, joined before the founding cutoff and more than a year ago, 250 XP on a linked Discord account
 await env.DB.prepare('UPDATE members SET profile_edited_at=1,created_at=? WHERE id=?').bind(Math.min(FOUNDER_CUTOFF-1,Date.now()-366*86400000),member).run();
 await env.DB.prepare("INSERT INTO community_subjects(discord_id) VALUES ('123456789012345678')").run();
 await env.DB.prepare("INSERT INTO discord_links VALUES (?,'123456789012345678','member','version','active',0)").bind(member).run();
 await env.DB.prepare("INSERT INTO community_xp VALUES ('e1','123456789012345678',1,250,'chat-v1')").run();
 await communityMaintenance(env);
 const awarded=async(who:string)=>(await env.DB.prepare('SELECT badge FROM community_awards WHERE member_id=? ORDER BY badge').bind(who).all<{badge:string}>()).results.map(r=>r.badge);
 expect(await awarded(author)).toEqual(['creator_favorited_10','creator_featured','creator_followers_10','creator_works_3']);
 expect(await awarded(member)).toEqual(['community_level_5','member_anniversary','member_founder','member_profile','player_commenter_1','player_favorites_10','player_first_play','player_follows_5','player_liked_10','player_saver'].sort());
 // The owner read measures the same tables, so it finds nothing new to award.
 const before=(await env.DB.prepare('SELECT COUNT(*) AS n FROM community_awards').first<{n:number}>())!.n;
 // Live badges (Discord link, booster) are never awards, so they are left out of the comparison.
 for(const who of [member,author]){const wall=await badgeCollection(env,who);expect(wall.items.filter(b=>b.state==='earned'&&!['discord_linked','server_booster'].includes(b.key)).map(b=>b.key).sort()).toEqual(await awarded(who));}
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM community_awards').first<{n:number}>())!.n).toBe(before);
});
