import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {rankSnapshot,settleRankSnapshot,supplementRankSnapshot} from '../src/rank-awards';
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
it('rolls back the entire D1 snapshot and all honors when a later award insert fails, then recovers',async()=>{
 await env.DB.prepare("CREATE TRIGGER rank_test_abort BEFORE INSERT ON rank_awards WHEN NEW.rank=2 BEGIN SELECT RAISE(ABORT,'rank_fixture_failure'); END").run();
 try{
  await expect(settleRankSnapshot(env,input())).rejects.toThrow('rank_fixture_failure');
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(0);
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM community_awards WHERE source='rank-v1'").first('n')).toBe(0);
 }finally{await env.DB.prepare('DROP TRIGGER rank_test_abort').run()}
 await settleRankSnapshot(env,input());expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(10);
});
it('records held pre-launch honors and atomically supplements an already settled cohort without revoking existing awards',async()=>{
 const preMember=await makeMember(22),weekStart=Date.parse('2026-10-12T00:00:00+08:00'),cutoff=Date.parse('2026-10-17T00:00:00+08:00'),now=cutoff+10*86400000;
 const initial=Array.from({length:10},(_,i)=>({id:100011+i,heat:200-i*2,talkNum:10,registeredAt:cutoff+i,adult:true,memberId:member,accountNo:11}));
 await settleRankSnapshot(env,{zone:'all',window:'week',period:'2026-10-12',now,cards:initial});
 await env.DB.prepare("UPDATE rank_awards SET status='paid',paid_at=?").bind(now).run();
 const preCards=[
  {id:100001,heat:195,talkNum:10,registeredAt:weekStart+4*86400000,adult:true,memberId:preMember,accountNo:22,payoutHold:true},
  {id:100002,heat:189,talkNum:10,registeredAt:weekStart+4*86400000+1000,adult:true,memberId:preMember,accountNo:22,payoutHold:true},
 ];
 const supplementInput={supplementKey:'pre-2026-10-17-v1',zone:'all' as const,window:'week' as const,period:'2026-10-12',now:now+60000,cards:[...initial,...preCards],entrantCutoff:cutoff};
 await Promise.all([supplementRankSnapshot(env,supplementInput),supplementRankSnapshot(env,supplementInput)]);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlement_supplements').first('n')).toBe(1);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(12);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM rank_awards WHERE status='paid' AND payout_hold=0").first('n')).toBe(10);
 const added=(await env.DB.prepare('SELECT card_id,rank,band,amount,status,payout_hold FROM rank_awards WHERE card_id IN(100001,100002) ORDER BY card_id').all()).results;
 expect(added).toEqual([
  {card_id:100001,rank:4,band:10,amount:10000,status:'pending',payout_hold:1},
  {card_id:100002,rank:8,band:10,amount:10000,status:'pending',payout_hold:1},
 ]);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM community_awards WHERE member_id=? AND badge='rank_all_week_10' AND source='rank-v1'").bind(preMember).first('n')).toBe(1);
 await supplementRankSnapshot(env,{...supplementInput,cards:[...initial,{...preCards[0],heat:999}]});
 expect(await env.DB.prepare('SELECT rank FROM rank_awards WHERE card_id=100001').first('rank')).toBe(4);
});
