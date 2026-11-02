import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {rankSnapshot,settleRankSnapshot} from '../src/rank-awards';
import {opsMetrics} from '../src/ops-metrics';
let member:string;
const at=Date.parse('2026-10-17T00:00:00+08:00');
beforeEach(async()=>{await resetDb();member=await makeMember(11)});
afterEach(restoreUpstream);
const input=()=>({zone:'clean' as const,window:'day' as const,period:'2026-10-17',now:at+3*86400000,cards:Array.from({length:10},(_,i)=>({id:100001+i,heat:200-i,talkNum:10,registeredAt:at+i,adult:false,memberId:member,accountNo:11}))});
it('atomically freezes one ranking and one payment key per winner across concurrent retries',async()=>{
 const in_=input();await Promise.all([settleRankSnapshot(env,in_),settleRankSnapshot(env,in_)]);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(1);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(10);
 expect(await env.DB.prepare('SELECT SUM(amount) n FROM rank_awards').first('n')).toBe(17000);
 const changed={...in_,cards:in_.cards.map(c=>({...c,heat:500-c.heat}))};await settleRankSnapshot(env,changed);
 const saved=await rankSnapshot(env,'clean','day','2026-10-17');expect(saved?.cards[0].heat).toBe(200);
 expect(await env.DB.prepare('SELECT card_id FROM rank_awards WHERE rank=1').first('card_id')).toBe(100001);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_rank_settlements_total{operation="day",outcome="success"} 1');
});
it('does not publish provisional awards and keeps empty positive-heat cohorts as settled facts',async()=>{
 await expect(settleRankSnapshot(env,{...input(),now:at+86400000})).rejects.toThrow('rank_not_due');
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(0);
 await settleRankSnapshot(env,{...input(),cards:input().cards.map(c=>({...c,heat:0}))});
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(1);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(0);
});
