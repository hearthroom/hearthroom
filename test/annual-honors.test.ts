import {env,SELF} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream,testHandle} from './helpers';
import {annualStandings,annualMaintenance,annualPaymentMaintenance} from '../src/annual-honors';
import {rankTransport} from '../src/rank-maintenance';
import {cardRewardTransport} from '../src/card-reward-service';
import {opsMetrics} from '../src/ops-metrics';
import {annualSettlesAt} from '../shared/annual-honors';

const real={...rankTransport},token=cardRewardTransport.token;
let a:string,b:string;
const oct=Date.parse('2026-10-05T12:00:00+08:00');
beforeEach(async()=>{await resetDb();a=await makeMember(11);b=await makeMember(22);cardRewardTransport.token=async()=>'service-only';});
afterEach(()=>{Object.assign(rankTransport,real);cardRewardTransport.token=token;restoreUpstream();});

type Award={card:number;published:number;zone:'clean'|'all';window:'day'|'week'|'month';band:1|3|10;member:string|null;account:number;at?:number};
async function award(x:Award){
 const period=new Date(x.published+8*3600000).toISOString().slice(0,10);
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO rank_publications(card_id,published_at,captured_at) VALUES(?,?,?)').bind(x.card,x.published,x.published),
  env.DB.prepare('INSERT OR IGNORE INTO rank_settlements(zone,window,period,settled_at,receipt,snapshot) VALUES(?,?,?,?,?,?)').bind(x.zone,x.window,period,x.published,'r','{}'),
  env.DB.prepare(`INSERT INTO rank_awards(id,card_id,zone,window,period,rank,band,member_id,account_no,amount,awarded_at,status) VALUES(?,?,?,?,?,?,?,?,?,1000,?,'paid')`)
   .bind(`rank-${x.zone}-${x.window}-${period}-${x.card}`,x.card,x.zone,x.window,period,x.band,x.band,x.member,x.account,x.at??x.published+86400000),
 ]);
}

/** 一件作品所屬的日、週、月各期都已在兩個榜結算。 */
async function cohortsSettled(at:number){
 const {cohortOf}=await import('../src/rank-settlement');
 for(const window of ['day','week','month'] as const)for(const zone of ['clean','all'] as const)
  await env.DB.prepare('INSERT OR IGNORE INTO rank_settlements(zone,window,period,settled_at,receipt,snapshot) VALUES(?,?,?,?,?,?)').bind(zone,window,new Date(cohortOf(at,window).at+8*3600000).toISOString().slice(0,10),at,'r','{}').run();
}

it('sums the point table per author and zone, counting only works first published in that Taipei year',async()=>{
 await award({card:1,published:oct,zone:'all',window:'day',band:1,member:a,account:11});        // 3
 await award({card:1,published:oct,zone:'all',window:'week',band:3,member:a,account:11});       // 6
 await award({card:2,published:oct,zone:'all',window:'month',band:10,member:b,account:22});     // 8
 await award({card:3,published:oct,zone:'clean',window:'day',band:1,member:b,account:22});      // other zone
 await award({card:4,published:Date.parse('2027-01-01T00:30:00+08:00'),zone:'all',window:'week',band:1,member:b,account:22}); // 2027
 await award({card:5,published:Date.parse('2026-12-31T23:30:00+08:00'),zone:'all',window:'day',band:10,member:null,account:33}); // unlinked author, 1
 const rows=await annualStandings(env,2026,'all');
 expect(rows.map(r=>[r.memberId,r.accountNo,r.points,r.firsts,r.top3])).toEqual([[a,11,9,1,2],[b,22,8,0,0],[null,33,1,0,0]]);
 expect(rows[0].author.handle).toBe(testHandle(11));
 expect((await annualStandings(env,2026,'clean')).map(r=>r.points)).toEqual([3]);
});

it('breaks ties by firsts, then top-3 finishes, then whoever reached the final score first',async()=>{
 const c=await makeMember(33);
 await award({card:1,published:oct,zone:'all',window:'week',band:1,member:a,account:11,at:oct+5});   // 10, one first
 await award({card:2,published:oct,zone:'all',window:'week',band:3,member:b,account:22,at:oct+1});   // 6
 await award({card:3,published:oct,zone:'all',window:'day',band:10,member:b,account:22,at:oct+2});  // 1
 await award({card:4,published:oct,zone:'all',window:'day',band:3,member:b,account:22,at:oct+3});   // 2  -> b: 9
 await award({card:5,published:oct,zone:'all',window:'day',band:3,member:c,account:33,at:oct+1});   // 2
 await award({card:6,published:oct,zone:'all',window:'week',band:3,member:c,account:33,at:oct+2});  // 6
 await award({card:7,published:oct,zone:'all',window:'day',band:10,member:c,account:33,at:oct+9});  // 1  -> c: 9, later
 await award({card:8,published:oct,zone:'all',window:'day',band:10,member:a,account:11,at:oct+6});  // a: 11
 const rows=await annualStandings(env,2026,'all');
 expect(rows.map(r=>[r.memberId,r.points])).toEqual([[a,11],[b,9],[c,9]]);
});

it('settles once after February 1 when every cohort is settled, crowning one author and paying only the crown',async()=>{
 for(let i=0;i<12;i++)await award({card:100+i,published:oct+i,zone:'all',window:'day',band:i===0?1:10,member:i<11?(i%2?b:a):null,account:i<11?(i%2?22:11):44});
 const due=annualSettlesAt(2026),pubs=[{published_at:oct}];await cohortsSettled(oct);
 await annualMaintenance(env,due-1,pubs);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM annual_settlements').first('n')).toBe(0);
 await Promise.all([annualMaintenance(env,due,pubs),annualMaintenance(env,due,pubs)]);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM annual_settlements').first('n')).toBe(2);
 const rows=(await env.DB.prepare("SELECT rank,member_id,account_no,amount,status FROM annual_awards WHERE zone='all' ORDER BY rank").all()).results;
 expect(rows).toEqual([
  {rank:1,member_id:a,account_no:11,amount:200000,status:'pending'},
  {rank:2,member_id:b,account_no:22,amount:0,status:'none'},
  {rank:3,member_id:null,account_no:44,amount:0,status:'none'},
 ]);
 expect((await env.DB.prepare("SELECT member_id,badge FROM community_awards WHERE source='annual-v1' ORDER BY badge").all()).results)
  .toEqual([{member_id:a,badge:'annual_all_2026_1'},{member_id:b,badge:'annual_all_2026_10'}]);
 // 結算後的榜照快照，不跟著之後的榮譽變
 await award({card:999,published:oct,zone:'all',window:'month',band:1,member:b,account:22});
 const res=await SELF.fetch('https://hearthroom.test/v1/rankings/annual?year=2026&zone=all');
 const body=await res.json<{settled:boolean;items:{rank:number;points:number}[]}>();
 expect(body.settled).toBe(true);expect(body.items[0]).toMatchObject({rank:1,points:8});
 expect(await opsMetrics(env.DB)).toContain('hearthroom_rank_settlements_total{operation="year",outcome="success"} 2');
});

it('holds the year while any cohort with that year\'s works is unsettled',async()=>{
 await award({card:1,published:oct,zone:'all',window:'day',band:1,member:a,account:11});
 const late=Date.parse('2026-12-31T20:00:00+08:00');await cohortsSettled(oct);
 await annualMaintenance(env,annualSettlesAt(2026),[{published_at:oct},{published_at:late}]);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM annual_settlements').first('n')).toBe(0);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_rank_settlements_total{operation="year",outcome="pending"} 1');
});

it('pays the crown once through the leaderboard pool with a stable key',async()=>{
 await award({card:1,published:oct,zone:'all',window:'day',band:1,member:a,account:11});await cohortsSettled(oct);
 await annualMaintenance(env,annualSettlesAt(2026),[{published_at:oct}]);
 const seen:unknown[]=[];let fail=true;
 rankTransport.pay=async(_e,bearer,input)=>{expect(bearer).toBe('service-only');seen.push(input);if(fail){fail=false;throw new Error('lost');}return input;};
 await annualPaymentMaintenance(env,annualSettlesAt(2026));
 await env.DB.prepare('UPDATE annual_awards SET attempted_at=0').run();
 await annualPaymentMaintenance(env,annualSettlesAt(2026)+3600000);
 expect(seen).toEqual([
  {key:'annual-all-2026',accountNo:11,amount:200000,campaignRef:'annual:all:2026',contentRef:'year:2026'},
  {key:'annual-all-2026',accountNo:11,amount:200000,campaignRef:'annual:all:2026',contentRef:'year:2026'},
 ]);
 expect(await env.DB.prepare("SELECT status FROM annual_awards WHERE zone='all' AND rank=1").first('status')).toBe('paid');
});

it('serves provisional standings publicly with the rule window',async()=>{
 await award({card:1,published:oct,zone:'clean',window:'week',band:1,member:a,account:11});
 const res=await SELF.fetch('https://hearthroom.test/v1/rankings/annual?zone=clean&year=2026');
 expect(res.status).toBe(200);
 const body=await res.json<Record<string,unknown>>();
 expect(body).toMatchObject({year:2026,zone:'clean',settled:false,settlesAt:annualSettlesAt(2026),items:[{rank:1,points:10,firsts:1,top3:1,author:{handle:testHandle(11)}}]});
 expect(JSON.stringify(body)).not.toMatch(/member-|accountNo/);
 expect((await SELF.fetch('https://hearthroom.test/v1/rankings/annual?zone=nope')).status).toBe(400);
 expect((await SELF.fetch('https://hearthroom.test/v1/rankings/annual?year=2019')).status).toBe(400);
});
