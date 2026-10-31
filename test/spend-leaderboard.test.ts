import {SELF,env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {makeMember,resetDb,identities,bearer,restoreUpstream} from './helpers';
import {spendGateway} from '../src/spend-leaderboard';
import {upstream} from '../src/upstream';
import {savePrivacy} from '../src/leaderboard-privacy';
import {startsAtPrimary} from '../src/d1-session';

const original=spendGateway.read;
beforeEach(async()=>{
 await resetDb();identities({player:80001});
 await env.DB.prepare("INSERT INTO card_numbers(num,provider,source_role_id) VALUES(100001,'harbor','stable-source')").run();
 await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,status,rating,approved_hosted_role_id) VALUES(100001,'harbor','stable-source',90001,1000,1000,'approved','G','hosted-v2')").run();
 spendGateway.read=async()=>({list:[{rank:1,credits:'9007199254740993',accountNumId:80001}],self:{rank:1,credits:'9007199254740993',accountNumId:80001},total:1,updatedAt:'2026-10-28T00:00:00Z'});
});
afterEach(()=>{spendGateway.read=original;restoreUpstream();});
it('projects named and anonymous identity on the real public endpoint, including self, without cached identity',async()=>{
 const member=await makeMember(80001);
 await env.DB.prepare("UPDATE members SET display_name='Visible name',avatar_url='https://example.test/avatar' WHERE id=?").bind(member).run();
 let response=await SELF.fetch('https://c.test/v1/cards/100001/leaderboard',{headers:bearer('player')});
 expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 expect((await response.json() as any).list[0]).toMatchObject({nickname:'Visible name',credits:'9007199254740993',isSelf:true});
 await savePrivacy(env.DB,member,{requestId:crypto.randomUUID(),revision:0,anonymous:false,cardKey:'harbor:stable-source',mode:'anonymous'});
 response=await SELF.fetch('https://c.test/v1/cards/100001/leaderboard',{headers:bearer('player')});
 const body=await response.json() as any;
 expect(body.list[0]).toEqual({rank:1,credits:'9007199254740993',anonymous:true,isSelf:true});
 expect(body.self).toEqual(body.list[0]);
 expect(JSON.stringify(body)).not.toContain('Visible name');expect(JSON.stringify(body)).not.toContain('80001');
 expect(startsAtPrimary('GET','/v1/cards/100001/leaderboard')).toBe(true);
});
it('keeps preference writes owner scoped and recovers the exact atomic operation',async()=>{
 const input={requestId:crypto.randomUUID(),revision:0,anonymous:true,cardId:'100001',mode:'inherit'};
 let res=await SELF.fetch('https://c.test/v1/me/leaderboard-privacy',{method:'PUT',headers:{...bearer('player'),'Content-Type':'application/json'},body:JSON.stringify(input)});
 expect(res.status).toBe(200);expect(await res.json()).toMatchObject({anonymous:true,revision:1});
 res=await SELF.fetch('https://c.test/v1/me/leaderboard-privacy/operations/'+input.requestId,{headers:bearer('player')});
 expect(res.status).toBe(200);expect(await res.json()).toMatchObject({anonymous:true,revision:1});
 expect((await SELF.fetch('https://c.test/v1/me/leaderboard-privacy')).status).toBe(401);
 await env.DB.prepare("UPDATE cards SET public_blocked=1 WHERE id=100001").run();
 expect((await SELF.fetch('https://c.test/v1/cards/100001/leaderboard')).status).toBe(404);
});
it.each([
 [false,'inherit',false],[true,'inherit',true],
 [false,'anonymous',true],[true,'anonymous',true],
 [false,'public',false],[true,'public',false],
] as const)('projects the site/card privacy combination %s/%s',async(anonymous,mode,expected)=>{
 const member=await makeMember(80001);
 await savePrivacy(env.DB,member,{requestId:crypto.randomUUID(),revision:0,anonymous,mode,cardKey:'harbor:stable-source',confirmed:true});
 const res=await SELF.fetch('https://c.test/v1/cards/100001/leaderboard',{headers:bearer('player')});
 expect(res.status).toBe(200);const body=await res.json() as any;
 expect(body.list[0].anonymous).toBe(expected);expect(body.self.anonymous).toBe(expected);
 expect(Object.hasOwn(body.list[0],'accountNumId')).toBe(!expected);
});

it('sends the stable work revision without a publication cutoff, including after legacy hosting cutover',async()=>{
 const inputs:unknown[]=[];
 spendGateway.read=async(_env,input)=>{inputs.push(input);return {list:[],self:null,total:0};};
 expect((await SELF.fetch('https://c.test/v1/cards/100001/leaderboard')).status).toBe(200);
 await env.DB.prepare("UPDATE cards SET registered_at=9999999999999,approved_hosted_role_id='hosted-v3' WHERE id=100001").run();
 expect((await SELF.fetch('https://c.test/v1/cards/100001/leaderboard')).status).toBe(200);
 expect(inputs).toEqual([
  {roleId:'hosted-v2',limit:10,offset:0},
  {roleId:'hosted-v3',limit:10,offset:0},
 ]);
});

it('shows the author their own spend beside an unchanged board, and never to anyone else',async()=>{
 identities({player:80001,author:90001});
 spendGateway.read=async()=>({list:[{rank:1,credits:'500',accountNumId:80001}],self:null,total:1,authorCredits:'42'});
 const author=await (await SELF.fetch('https://c.test/v1/cards/100001/leaderboard',{headers:bearer('author')})).json() as any;
 expect(author).toMatchObject({selfState:'author',authorCredits:'42',self:null,total:1});
 expect(author.list).toHaveLength(1);
 // A provider answer meant for an author is never forwarded to another viewer.
 for(const headers of [bearer('player'),{}]){
  const body=await (await SELF.fetch('https://c.test/v1/cards/100001/leaderboard',{headers})).json() as any;
  expect(Object.hasOwn(body,'authorCredits')).toBe(false);
  expect(body.list.map((p:any)=>[p.rank,p.credits])).toEqual(author.list.map((p:any)=>[p.rank,p.credits]));expect(body.total).toBe(author.total);
 }
});
it('keeps a test-account author excluded and without a figure',async()=>{
 spendGateway.read=async()=>({list:[],self:null,total:0,authorCredits:'42'});
 upstream.fetchMe=async()=>({accountNumId:90001,accountClass:'test',testState:'active',testGeneration:1} as any);
 const test=await (await SELF.fetch('https://c.test/v1/cards/100001/leaderboard',{headers:bearer('author')})).json() as any;
 expect(test.selfState).toBe('test');expect(Object.hasOwn(test,'authorCredits')).toBe(false);
});
