import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {applyBadgeStats,type BadgeStats} from '../src/badge-stats';
import {badgeCollection,sweepMilestones} from '../src/community/badges';
import {badgeAp,badgeRarity,badgeReward} from '../shared/badge-rarity';

// 成就第一批（owner 2026-11-23）：對話輪數、單卡輪數、留言／獲讚／粉絲／收藏的防刷口徑、三合君王。
const DAY=86400000;
let member:string,author:string;const fans:string[]=[];
beforeEach(async()=>{
 await resetDb();member=await makeMember(11);author=await makeMember(22);
 fans.length=0;for(let i=0;i<6;i++)fans.push(await makeMember(100+i));
 await env.DB.prepare('UPDATE members SET created_at=?').bind(Date.now()-10*DAY).run();
});
afterEach(restoreUpstream);
const find=async(who:string,key:string)=>(await badgeCollection(env,who)).items.find(b=>b.key===key);
const awarded=async(who:string)=>(await env.DB.prepare('SELECT badge FROM community_awards WHERE member_id=? ORDER BY badge').bind(who).all<{badge:string}>()).results.map(r=>r.badge);
/** 有效互動者：在 Harbor 聊過至少 3 輪（徽章統計寫入），且註冊滿 3 天 */
async function qualify(who:string,turns=3){
 await env.DB.prepare(`INSERT INTO badge_qualifications(member_id,account_no,effective_invites,net_topup_usd_micros,consumed_credits,verified_at,send_turns) VALUES (?,?,0,0,0,1,?)
  ON CONFLICT(member_id) DO UPDATE SET send_turns=excluded.send_turns`).bind(who,Number(who.replace('member-','')),turns).run();
}
let seq=0;
async function comment(who:string,card:number,content:string,at=1){const id='c'+(++seq);await env.DB.prepare('INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES (?,?,?,?,?)').bind(id,card,who,content,at).run();return id;}
const LONG='这是一则超过十个字的认真留言内容';

it('stores Harbor turn counts, keeps them on older reads and awards both turn ladders',async()=>{
 const stats=(extra:Partial<BadgeStats>):BadgeStats=>({accountNo:11,effectiveInvites:0,netTopupUsdMicros:0,consumedCredits:0,complete:true,...extra});
 const stored=()=>env.DB.prepare('SELECT send_turns,max_role_turns FROM badge_qualifications WHERE member_id=?').bind(member).first();
 await applyBadgeStats(env,member,stats({sendTurns:520,maxRoleTurns:160}));
 expect(await stored()).toEqual({send_turns:520,max_role_turns:160});
 await applyBadgeStats(env,member,stats({}));   // 舊版 Harbor 沒有這兩個欄位
 expect(await stored()).toEqual({send_turns:520,max_role_turns:160});
 await sweepMilestones(env);
 const got=await awarded(member);
 expect(got).toEqual(expect.arrayContaining(['player_turns_50','player_turns_500','player_devoted_30','player_devoted_150']));
 expect(got).not.toContain('player_turns_2500');expect(got).not.toContain('player_devoted_500');
 expect(await find(member,'player_turns_2500')).toMatchObject({state:'locked',progress:{value:520,target:2500}});
 expect(await find(member,'player_devoted_500')).toMatchObject({state:'locked',progress:{value:160,target:500}});
});

it('counts comments of at least ten characters, three per card and five per Taipei business day',async()=>{
 const day=Date.parse('2026-11-01T02:00:00Z');                       // 10:00 台北
 for(let k=0;k<4;k++)await comment(member,100001,LONG,day+k);         // 同一張卡 4 則，算 3 則
 await comment(member,100002,'短短的一句',day+10);                     // 不到 10 個字
 for(let k=0;k<4;k++)await comment(member,100010+k,LONG,day+20+k);    // 當天共 7 則，算 5 則
 await comment(member,100030,LONG,day+17*3600000);                   // 隔天 03:00 台北，仍屬 11-01
 for(let k=0;k<2;k++)await comment(member,100020+k,LONG,day+DAY+k);   // 11-02 兩則
 expect(await find(member,'player_commenter_10')).toMatchObject({state:'locked',progress:{value:7,target:10}});
 await sweepMilestones(env);
 expect(await awarded(member)).toContain('player_commenter_1');
});

it('counts likes from established members, at most three each, never your own',async()=>{
 const mine:string[]=[];for(let k=0;k<6;k++)mine.push(await comment(member,100001+k,LONG));
 const like=(id:string,who:string)=>env.DB.prepare('INSERT INTO comment_likes(comment_id,member_id,created_at) VALUES (?,?,1)').bind(id,who).run();
 await qualify(fans[0]);await qualify(fans[1]);await qualify(fans[3]);
 await env.DB.prepare('UPDATE members SET created_at=? WHERE id=?').bind(Date.now()-DAY,fans[3]).run();   // 才註冊一天
 for(const id of mine.slice(0,5))await like(id,fans[0]);   // 5 個讚只算 3 個
 await like(mine[0],fans[1]);                              // 1
 await like(mine[1],fans[2]);await like(mine[2],fans[2]);  // 沒聊過，不算
 await like(mine[3],fans[3]);                              // 註冊不滿 3 天，不算
 await qualify(member);await like(mine[4],member);          // 自己按的不算
 expect(await find(member,'player_liked_5')).toMatchObject({state:'locked',progress:{value:4,target:5}});
 await qualify(fans[2]);
 await sweepMilestones(env);
 expect(await awarded(member)).toContain('player_liked_5');
});

it('counts followers and favorites only from established members other than the author',async()=>{
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider) VALUES (100001,'role-100001',22,'{}','{}',1,1,'approved','harbor')").run();
 for(const fan of fans.slice(0,3))await qualify(fan);
 await qualify(author);
 for(const who of [...fans.slice(0,4),author]){
  await env.DB.prepare('INSERT INTO member_follows VALUES (?,?,1)').bind(who,author).run();
  await env.DB.prepare('INSERT INTO member_favorites VALUES (?,100001,1)').bind(who).run();
 }
 expect(await find(author,'creator_followers_10')).toMatchObject({progress:{value:3,target:10}});
 expect(await find(author,'creator_favorited_10')).toMatchObject({progress:{value:3,target:10}});
});

it('crowns one card that reached #1 on a daily, a weekly and a monthly board',async()=>{
 let id=0;
 const honor=async(card:number,zone:string,window:string,band:number)=>{id++;
  await env.DB.prepare('INSERT OR IGNORE INTO rank_settlements(zone,window,period,settled_at,receipt,snapshot) VALUES(?,?,?,1,?,?)').bind(zone,window,'p'+id,'r','{}').run();
  await env.DB.prepare(`INSERT INTO rank_awards(id,card_id,zone,window,period,rank,band,member_id,account_no,amount,awarded_at,status)
  VALUES(?,?,?,?,?,?,?,?,22,1000,1,'paid')`).bind('h'+id,card,zone,window,'p'+id,band,band,author).run();};
 await honor(100001,'clean','day',1);await honor(100001,'all','week',1);await honor(100002,'all','month',1);
 await honor(100001,'all','month',3);
 await sweepMilestones(env);
 expect(await awarded(author)).not.toContain('rank_same_card_crown');   // 兩張卡分開拿的不算
 await honor(100001,'clean','month',1);
 await sweepMilestones(env);
 expect(await awarded(author)).toContain('rank_same_card_crown');
});

it('rates the new tiers by how hard they are and keeps the board badge credit-free',()=>{
 const r=(key:string,category='play')=>[badgeRarity({key,category}),badgeReward({key,category})];
 expect(r('player_explorer_3')).toEqual(['common',100]);
 expect(r('player_turns_50')).toEqual(['common',100]);
 expect(r('player_turns_500')).toEqual(['rare',500]);
 expect(r('player_turns_2500')).toEqual(['epic',2000]);
 expect(r('player_turns_10000')).toEqual(['legendary',6000]);
 expect(r('player_devoted_30')).toEqual(['common',100]);
 expect(r('player_devoted_150')).toEqual(['rare',500]);
 expect(r('player_devoted_500')).toEqual(['epic',2000]);
 expect(r('player_devoted_1500')).toEqual(['legendary',6000]);
 expect(r('player_liked_5','social')).toEqual(['common',100]);
 expect(r('player_liked_500','social')).toEqual(['legendary',6000]);
 expect(r('player_commenter_300','social')).toEqual(['legendary',6000]);
 expect(r('creator_followers_300','creation')).toEqual(['legendary',6000]);
 expect(r('creator_favorited_1000','creation')).toEqual(['legendary',6000]);
 expect(r('rank_same_card_crown','rank')).toEqual(['legendary',0]);
 expect(badgeAp({key:'rank_same_card_crown',category:'rank'})).toBe(100);
});
