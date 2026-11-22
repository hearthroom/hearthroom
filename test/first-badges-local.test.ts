import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {awardFirstBadges,LOCAL_FIRST_BADGES} from '../src/community/first-badges';
import {badgeCollection} from '../src/community/badges';
import {badgeRarity,badgeReward,parseConversationRewardFreeze} from '../shared/badge-rarity';

const DAY=86400000,now=Date.parse('2027-06-01T00:00:00Z');
let a:string,b:string;
beforeEach(async()=>{await resetDb();a=await makeMember(11);b=await makeMember(22);});
afterEach(restoreUpstream);
const holders=async(badge:string)=>(await env.DB.prepare('SELECT member_id,created_at FROM community_awards WHERE badge=? ORDER BY created_at').bind(badge).all<{member_id:string;created_at:number}>()).results;
let id=0;
async function honor(member:string,zone:'clean'|'all',window:'day'|'week'|'month',band:1|3|10,period:string,at:number){
 id++;
 await env.DB.prepare('INSERT OR IGNORE INTO rank_settlements(zone,window,period,settled_at,receipt,snapshot) VALUES(?,?,?,?,?,?)').bind(zone,window,period,at,'r','{}').run();
 await env.DB.prepare(`INSERT INTO rank_awards(id,card_id,zone,window,period,rank,band,member_id,account_no,amount,awarded_at,status) VALUES(?,?,?,?,?,?,?,?,11,1000,?,'paid')`).bind(`h${id}`,900000+id,zone,window,period,band,band,member,at).run();
}
const card=(cid:number,author=22)=>env.DB.prepare("INSERT OR IGNORE INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider) VALUES (?,?,?,'{}','{}',1,1,'approved','harbor')").bind(cid,'role-'+cid,author).run();
/** n 位一次性成員（不綁身分），用來湊收藏、按讚 */
async function crowd(n:number){await env.DB.prepare(`WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM s WHERE i<?) INSERT INTO members(id,handle,created_at) SELECT 'crowd-'||i,'crowd'||i,0 FROM s`).bind(n).run();}

it('rates the new badges and pays the default one-of-a-kind amount',()=>{
 expect(badgeRarity({key:'sole_grand_slam',category:'creation'})).toBe('unique');
 expect(badgeReward({key:'sole_grand_slam',category:'creation'})).toBe(30000);
 expect(badgeRarity({key:'player_scout_20',category:'play'})).toBe('legendary');
});

it('keeps conversation explorer and wanderer badges earnable by rarity while freezing their credit rewards at zero',()=>{
 expect(badgeRarity({key:'player_explorer_50',category:'play'})).toBe('rare');
 expect(badgeRarity({key:'player_explorer_100',category:'play'})).toBe('epic');
 expect(badgeRarity({key:'player_explorer_300',category:'play'})).toBe('legendary');
 expect(badgeRarity({key:'sole_wanderer',category:'play'})).toBe('unique');
 expect(badgeRarity({key:'sole_wanderer_pioneer',category:'play'})).toBe('epic');
 for(const key of ['player_explorer_50','player_explorer_100','player_explorer_300','sole_wanderer','sole_wanderer_pioneer']){
  expect(badgeReward({key,category:'play'}),key).toBe(0);
 }
 // Lower tiers stay unchanged until Harbor paid-turn counting lands.
 expect(badgeReward({key:'player_first_play',category:'play'})).toBe(100);
 expect(badgeReward({key:'player_explorer_10',category:'play'})).toBe(100);

 // Cutoff mode: pre-cutoff earned non-excluded keeps original reward; post-cutoff, locked, excluded, or malformed config fail closed to 0.
 expect(parseConversationRewardFreeze(undefined)).toEqual({mode:'all'});
 expect(parseConversationRewardFreeze('')).toEqual({mode:'all'});
 expect(parseConversationRewardFreeze('all')).toEqual({mode:'all'});
 expect(parseConversationRewardFreeze('not-a-date')).toEqual({mode:'all'});
 expect(parseConversationRewardFreeze('off')).toEqual({mode:'off'});

 const cutoff='2026-11-22T03:30:00Z';
 const cutoffMs=Date.parse(cutoff);
 const policy=parseConversationRewardFreeze(cutoff,' abuser-1 , abuser-2 ');
 expect(policy.mode).toBe('cutoff');
 expect(badgeReward({key:'player_explorer_50',category:'play'},{freeze:policy,memberId:'ok-1',state:'earned',earnedAt:cutoffMs-1})).toBe(500);
 expect(badgeReward({key:'player_explorer_100',category:'play'},{freeze:policy,memberId:'ok-1',state:'earned',earnedAt:cutoffMs-1})).toBe(2000);
 expect(badgeReward({key:'player_explorer_300',category:'play'},{freeze:policy,memberId:'ok-1',state:'earned',earnedAt:cutoffMs-1})).toBe(6000);
 expect(badgeReward({key:'sole_wanderer',category:'play'},{freeze:policy,memberId:'ok-1',state:'earned',earnedAt:cutoffMs-1})).toBe(30000);
 expect(badgeReward({key:'sole_wanderer_pioneer',category:'play'},{freeze:policy,memberId:'ok-1',state:'earned',earnedAt:cutoffMs-1})).toBe(2000);
 // At/after cutoff, locked, excluded, or missing memberId when exclusion list is active -> 0.
 expect(badgeReward({key:'player_explorer_50',category:'play'},{freeze:policy,memberId:'ok-1',state:'earned',earnedAt:cutoffMs})).toBe(0);
 expect(badgeReward({key:'player_explorer_50',category:'play'},{freeze:policy,memberId:'ok-1',state:'locked',earnedAt:null})).toBe(0);
 expect(badgeReward({key:'player_explorer_50',category:'play'},{freeze:policy,memberId:'abuser-1',state:'earned',earnedAt:cutoffMs-1000})).toBe(0);
 expect(badgeReward({key:'sole_wanderer',category:'play'},{freeze:policy,memberId:'abuser-2',state:'earned',earnedAt:cutoffMs-1000})).toBe(0);
 expect(badgeReward({key:'player_explorer_50',category:'play'},{freeze:policy,state:'earned',earnedAt:cutoffMs-1000})).toBe(0);
 // Full-freeze switch overrides pre-cutoff earned too.
 expect(badgeReward({key:'player_explorer_50',category:'play'},{freeze:parseConversationRewardFreeze('all'),memberId:'ok-1',state:'earned',earnedAt:cutoffMs-1})).toBe(0);
});

it('crowns three weekly #1s in a row by the time of the third win',async()=>{
 await honor(a,'all','week',1,'2026-10-05',Date.parse('2026-10-13'));
 await honor(a,'clean','week',1,'2026-10-05',Date.parse('2026-10-13'));   // 同一週兩個榜只算一週
 await honor(a,'all','week',1,'2026-10-12',Date.parse('2026-10-20'));
 await honor(a,'all','week',1,'2026-10-26',Date.parse('2026-11-03'));     // 中間斷了一週
 await honor(b,'clean','week',1,'2026-10-12',Date.parse('2026-10-20'));
 await honor(b,'clean','week',1,'2026-10-19',Date.parse('2026-10-27'));
 await honor(b,'all','week',1,'2026-10-26',Date.parse('2026-11-03'));
 await awardFirstBadges(env,LOCAL_FIRST_BADGES,now);
 expect(await holders('sole_triple_crown')).toEqual([{member_id:b,created_at:Date.parse('2026-11-03')}]);
});

it('crowns the double champion and the grand slam',async()=>{
 await honor(a,'clean','month',1,'2026-10-01',Date.parse('2026-12-01'));
 await honor(a,'all','month',1,'2026-10-01',Date.parse('2026-12-01T01:00:00Z'));
 let t=Date.parse('2026-12-02');
 for(const zone of ['clean','all'] as const)for(const window of ['day','week','month'] as const)for(const band of [1,3,10] as const)
  await honor(b,zone,window,band,'2026-11-01',t+=DAY);
 await awardFirstBadges(env,LOCAL_FIRST_BADGES,now);
 expect(await holders('sole_double_crown')).toEqual([{member_id:a,created_at:Date.parse('2026-12-01T01:00:00Z')}]);
 expect(await holders('sole_grand_slam')).toEqual([{member_id:b,created_at:t}]);
});

it('crowns the first comment to reach 100 likes only once the likes hold for a day',async()=>{
 await crowd(100);
 await card(100001);await env.DB.prepare("INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES('c1',100001,?,'hi',1)").bind(a).run();
 await env.DB.prepare(`INSERT INTO comment_likes(comment_id,member_id,created_at) SELECT 'c1',id,1000+CAST(substr(id,7) AS INTEGER) FROM members WHERE id LIKE 'crowd-%'`).run();
 await awardFirstBadges(env,LOCAL_FIRST_BADGES,1100);
 expect(await holders('sole_eloquent')).toEqual([]);
 await awardFirstBadges(env,LOCAL_FIRST_BADGES,1100+DAY);
 expect(await holders('sole_eloquent')).toEqual([{member_id:a,created_at:1100}]);
});

it('crowns the author of the first card saved 1,000 times',async()=>{
 await crowd(1000);
 await card(100001);
 await env.DB.prepare(`INSERT INTO member_favorites(member_id,card_id,created_at) SELECT id,'100001',5000+CAST(substr(id,7) AS INTEGER) FROM members WHERE id LIKE 'crowd-%'`).run();
 await awardFirstBadges(env,LOCAL_FIRST_BADGES,now);
 expect(await holders('sole_treasured')).toEqual([{member_id:b,created_at:6000}]);
});

it('counts talent spotting and ratings for the new player ladders',async()=>{
 for(const cid of [700001,700002,700003])await card(cid,cid===700003?11:33);
 await env.DB.batch([
  env.DB.prepare("INSERT INTO member_favorites(member_id,card_id,created_at) VALUES(?,'700001',10),(?,'700002',500),(?,'700003',10)").bind(b,b,a),
  env.DB.prepare("INSERT INTO card_scores(card_id,member_id,score,created_at,updated_at) VALUES('700001',?,5,1,1)").bind(b),
 ]);
 await env.DB.prepare("INSERT OR IGNORE INTO rank_settlements(zone,window,period,settled_at,receipt,snapshot) VALUES('all','day','2026-10-01',1,'r','{}')").run();
 // 700001、700002 是別人的卡（member 為 null），700003 是 a 自己的卡
 for(const [cid,member] of [[700001,null],[700002,null],[700003,a]] as const)
  await env.DB.prepare(`INSERT INTO rank_awards(id,card_id,zone,window,period,rank,band,member_id,account_no,amount,awarded_at,status) VALUES(?,?,'all','day','2026-10-01',1,1,?,11,1000,100,'paid')`).bind(`s${cid}`,cid,member).run();
 const wall=await badgeCollection(env,b);
 // 700001 在拿名次前收藏（算），700002 收藏時已經上榜（不算）；a 收藏自己的 700003 不算
 expect(wall.items.find(x=>x.key==='player_scout_1')).toMatchObject({state:'earned',progress:{value:1,target:1}});
 expect(wall.items.find(x=>x.key==='player_rater_10')?.progress).toMatchObject({value:1,target:10});
 expect((await badgeCollection(env,a)).items.find(x=>x.key==='player_scout_1')?.state).toBe('locked');
});

it('tells everyone else that a one-of-a-kind badge is taken, naming the holder only if they show their badges',async()=>{
 await env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'sole_grand_slam','sole-v1',1)").bind(a).run();
 expect((await badgeCollection(env,b)).items.find(x=>x.key==='sole_grand_slam')).toMatchObject({state:'locked',taken:true});
 expect((await badgeCollection(env,b)).items.find(x=>x.key==='sole_grand_slam')).not.toHaveProperty('holder');
 await env.DB.prepare('INSERT INTO community_preferences(member_id,public_badges) VALUES(?,1)').bind(a).run();
 expect((await badgeCollection(env,b)).items.find(x=>x.key==='sole_grand_slam')).toMatchObject({taken:true,holder:'aaaaaabb'});
 expect((await badgeCollection(env,a)).items.find(x=>x.key==='sole_grand_slam')).not.toHaveProperty('taken');
});

it('holds the 500-character badge back while its count is unverified',async()=>{
 await env.DB.prepare(`WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM s WHERE i<500) INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) SELECT ?,'harbor','r'||i,'c'||i,i,i FROM s`).bind(a).run();
 await awardFirstBadges(env,LOCAL_FIRST_BADGES,now);
 expect([...await holders('sole_wanderer'),...await holders('sole_wanderer_pioneer')]).toEqual([]);
});
