import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {badgeCollection} from '../src/community/badges';
import {settleRankSnapshot} from '../src/rank-awards';
import {badgeRarity,BADGE_AP} from '../shared/badge-rarity';
import {snapshotCache} from '../src/snapshot-cache';

let a:string,b:string,c:string;
const launch=Date.parse('2026-10-17T00:00:00+08:00'),end=Date.parse('2026-11-18T00:00:00+08:00');
let generation=0;
beforeEach(async()=>{await resetDb();snapshotCache.namespace=`badge-points-${++generation}`;a=await makeMember(11);b=await makeMember(22);c=await makeMember(33);await env.DB.prepare('UPDATE members SET created_at=?').bind(end).run();});
afterEach(restoreUpstream);
const award=(member:string,badge:string,at:number)=>env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,?,'test',?)").bind(member,badge,at).run();

it('assigns fixed points by rarity and counts each repeat of a rank honor',async()=>{
 expect(badgeRarity({key:'opening_veteran',category:'member'})).toBe('common');
 expect(badgeRarity({key:'annual_all_2026_1',category:'rank'})).toBe('unique');
 expect(badgeRarity({key:'rank_all_month_1',category:'rank'})).toBe('legendary');
 for(const period of ['2026-10-17','2026-10-18'])await settleRankSnapshot(env,{zone:'clean',window:'day',period,now:end,cards:[{id:period==='2026-10-17'?100001:100002,heat:100,talkNum:1,registeredAt:Date.parse(`${period}T00:00:00+08:00`),adult:false,memberId:a,accountNo:11}]});
 await award(a,'member_profile',launch);
 const wall=await badgeCollection(env,a);
 expect(wall.items.find(x=>x.key==='rank_clean_day_1')).toMatchObject({count:2,ap:BADGE_AP.rare});
 expect(wall.items.find(x=>x.key==='creator_works_30')).toMatchObject({state:'locked',ap:BADGE_AP.epic});
 // 兩次日榜第一（稀有 15×2）＋自我介紹（普通 5）
 expect(wall.ap).toBe(15*2+5);
});

it('shows the holder share and the order in which a member earned each badge',async()=>{
 await award(a,'member_profile',100);await award(b,'member_profile',200);await award(c,'member_profile',200);
 await env.DB.prepare("UPDATE community_awards SET revoked_at=1 WHERE member_id=? AND badge='member_profile'").bind(a).run();
 const mine=(await badgeCollection(env,c)).items.find(x=>x.key==='member_profile')!;
 // a 撤銷了：持有 2／3 人，c 跟 b 同一刻拿到，都是第 1 位
 expect(mine).toMatchObject({state:'earned',share:66.7,ordinal:1});
 await award(a,'player_saver',50);await award(c,'player_saver',60);
 expect((await badgeCollection(env,c)).items.find(x=>x.key==='player_saver')).toMatchObject({ordinal:2});
 expect((await badgeCollection(env,c)).items.find(x=>x.key==='creator_works_30')).not.toHaveProperty('share');
 const visible=(await badgeCollection(env,c,true));
 expect(visible).toEqual({items:[],featured:[]});
 await env.DB.prepare('INSERT INTO community_preferences(member_id,public_badges) VALUES(?,1)').bind(c).run();
 const pub=await badgeCollection(env,c,true);
 expect(pub.items.map(x=>x.key).sort()).toEqual(['member_profile','player_saver']);
 expect(pub.ap).toBe(10);
});
