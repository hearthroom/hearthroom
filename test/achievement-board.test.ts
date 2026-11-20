import {env,SELF} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream,testHandle} from './helpers';
import {achievementBoard} from '../src/community/achievement-board';
import {badgeCollection} from '../src/community/badges';
import {levelOf,levelThreshold} from '../shared/achievements';
import {snapshotCache} from '../src/snapshot-cache';

let a:string,b:string,c:string;let generation=0;
const oct=Date.parse('2026-10-10T12:00:00+08:00'),nov=Date.parse('2026-11-10T12:00:00+08:00');
beforeEach(async()=>{await resetDb();snapshotCache.namespace=`achievement-board-${++generation}`;a=await makeMember(11);b=await makeMember(22);c=await makeMember(33);});
afterEach(restoreUpstream);
const award=(member:string,badge:string,at=oct)=>env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,?,'test',?)").bind(member,badge,at).run();
async function honor(member:string,id:string,window:'day'|'week'|'month',band:1|3|10,at:number){
 const period=new Date(at+8*3600000).toISOString().slice(0,10);
 await env.DB.prepare('INSERT OR IGNORE INTO rank_settlements(zone,window,period,settled_at,receipt,snapshot) VALUES(?,?,?,?,?,?)').bind('all',window,period,at,'r','{}').run();
 await env.DB.prepare(`INSERT INTO rank_awards(id,card_id,zone,window,period,rank,band,member_id,account_no,amount,awarded_at,status) VALUES(?,?,'all',?,?,?,?,?,11,1000,?,'paid')`).bind(id,Number(id.replace(/\D/g,''))||1,window,period,band,band,member,at).run();
}

it('levels follow 25 × L(L−1)/2 points',()=>{
 expect([1,2,5,10].map(levelThreshold)).toEqual([0,25,250,1125]);
 expect([0,24,25,249,250,1125].map(levelOf)).toEqual([1,1,2,4,5,10]);
});

it('ranks authors by creation and board honors only, counting every repeat and keeping spending and invites out',async()=>{
 await award(a,'creator_works_10');           // rare 15
 await award(a,'invite_100');                 // legendary, never ranked
 await award(a,'player_commenter_100');       // epic, not an author achievement
 await honor(b,'h1','day',1,oct);await honor(b,'h2','day',1,nov); // rare ×2 = 30
 await award(c,'spend_4');                    // never ranked
 const board=await achievementBoard(env,'author','all');
 expect(board.items.map(i=>[i.author.handle,i.ap,i.level])).toEqual([[testHandle(22),30,2],[testHandle(11),15,1]]);
 const october=await achievementBoard(env,'author','2026-10');
 expect(october.items.map(i=>[i.author.handle,i.ap])).toEqual([[testHandle(11),15],[testHandle(22),15]]);
});

it('lists only members who made their badges public and did not choose to stay anonymous on the overall board',async()=>{
 await award(a,'player_commenter_100');await award(b,'member_profile');await award(c,'creator_works_30');
 await env.DB.batch([a,b,c].map(m=>env.DB.prepare('INSERT INTO community_preferences(member_id,public_badges) VALUES(?,?)').bind(m,m===b?0:1)));
 await env.DB.prepare('INSERT INTO leaderboard_privacy(member_id,anonymous) VALUES(?,1)').bind(c).run();
 expect((await achievementBoard(env,'all','all')).items.map(i=>[i.author.handle,i.ap])).toEqual([[testHandle(11),40]]);
});

it('shows level and author rank on the collection and serves the board publicly',async()=>{
 await award(a,'creator_works_30');await award(b,'creator_works_10');
 const wall=await badgeCollection(env,b);
 expect(wall).toMatchObject({ap:15,level:1,authorRank:2});
 const res=await SELF.fetch('https://c.test/v1/rankings/achievements?board=author&period=all');
 expect(res.status).toBe(200);
 const body=await res.json<{items:{rank:number;author:{handle:string}}[]}>();
 expect(body.items.map(i=>i.author.handle)).toEqual([testHandle(11),testHandle(22)]);
 expect(JSON.stringify(body)).not.toContain('member-');
 for(const q of ['board=spend','period=2019-01','period=2026-13','period=2099-01'])expect((await SELF.fetch(`https://c.test/v1/rankings/achievements?${q}`)).status,q).toBe(400);
});
