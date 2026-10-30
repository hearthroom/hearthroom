import {env,createExecutionContext} from 'cloudflare:test';
import {afterEach,beforeEach,expect,it} from 'vitest';
import worker from '../src/index';
import {bearer,identities,makeMember,resetDb,restoreUpstream} from './helpers';
import {dispatchPush,pushLine,pushTitle,saveSubscription,type PushSender} from '../src/community/push';
import type {Env} from '../src/types';

// Harbor 的平台帳號通知（處置、申訴結果）放進會員的通知清單：只有伺服器能呼叫，網址只能指向 Console，
// 不受「關閉通知」影響，但測試帳號照樣排除。
const ACCOUNT=30001,URL_OK='https://console.harperharbor.com/appeal/n0123456789abcdef0123';
const options=(extra:Record<string,string>={})=>({...env,HOSTING_SERVICE_KEY:'fixture-key',ENFORCEMENT_CONSOLE_ORIGINS:'https://console.example.test',...extra}) as Env;
const post=(body:unknown,key:string|null='fixture-key',opts=options())=>worker.fetch(new Request('https://c.test/internal/enforcement/notices',{method:'POST',headers:{'Content-Type':'application/json',...(key===null?{}:{'X-Hosting-Key':key})},body:JSON.stringify(body)}),opts,createExecutionContext());
const notice=(over:Record<string,unknown>={})=>({accountNumId:ACCOUNT,eventKey:'enforcement:n0123456789abcdef0123',kind:'enforcement_notice',url:URL_OK,deadline:'2026-11-29T15:59:59Z',...over});
const rows=()=>env.DB.prepare('SELECT event_key,member_id,kind,path,extra,author_id,actor_id,card_id FROM community_notifications ORDER BY created_at').all<any>().then(r=>r.results);
let member='';
beforeEach(async()=>{await resetDb();member=await makeMember(ACCOUNT);});
afterEach(()=>restoreUpstream());

it('rejects a missing, wrong or unconfigured key before reading anything',async()=>{
 expect((await post(notice(),null)).status).toBe(401);
 expect((await post(notice(),'wrong-key')).status).toBe(401);
 expect((await post(notice(),'',options({HOSTING_SERVICE_KEY:''}))).status).toBe(401);
 expect((await post(notice(),'fixture-key',options({HOSTING_SERVICE_KEY:''}))).status).toBe(401);
 expect(await rows()).toEqual([]);
});

it('accepts only https links to the console and a well-formed notice',async()=>{
 for(const body of [
  notice({url:'https://evil.example/appeal/x'}),notice({url:'http://console.harperharbor.com/appeal/x'}),
  notice({url:'https://console.harperharbor.com.evil.example/appeal/x'}),notice({url:'https://user@console.harperharbor.com/appeal/x'}),
  notice({url:'/appeal/x'}),notice({url:undefined}),notice({kind:'comment_reply'}),notice({accountNumId:0}),notice({accountNumId:'30001'}),
  notice({accountNumId:1.5}),notice({eventKey:''}),notice({eventKey:'x'.repeat(129)}),notice({deadline:'soon'}),
  notice({kind:'enforcement_result',decision:'maybe'}),notice({kind:'enforcement_result'}),
 ])expect((await post(body)).status,JSON.stringify(body)).toBe(400);
 expect(await rows()).toEqual([]);
 expect((await post(notice({url:'https://console.example.test/appeal/x'}))).status).toBe(200);
 const metrics=await (await worker.fetch(new Request('https://c.test/metrics'),options(),createExecutionContext())).text();
 expect(metrics).toContain('hearthroom_enforcement_notices_total{operation="notice",outcome="invalid"} 13');
 expect(metrics).toContain('hearthroom_enforcement_notices_total{operation="result",outcome="invalid"} 2');
 expect(metrics).toContain('hearthroom_enforcement_notices_total{operation="notice",outcome="delivered"} 1');
});

it('reports an account that never joined without writing',async()=>{
 const r=await post(notice({accountNumId:39999}));
 expect(r.status).toBe(200);expect(await r.json()).toEqual({delivered:false,member:false,locale:''});
 expect(await rows()).toEqual([]);
});

it('answers a dry run with membership and interface language only, as Harbor sends it',async()=>{
 await env.DB.prepare("UPDATE members SET locale='ja' WHERE id=?").bind(member).run();
 // Harbor's language lookup sends no link and no event key.
 const r=await post({accountNumId:ACCOUNT,eventKey:'',kind:'enforcement_notice',url:'',dryRun:true});
 expect(r.status).toBe(200);expect(await r.json()).toEqual({delivered:false,member:true,locale:'ja'});
 await env.DB.prepare('UPDATE members SET locale=NULL WHERE id=?').bind(member).run();
 expect(await (await post(notice({dryRun:true}))).json()).toEqual({delivered:false,member:true,locale:''});
 expect(await (await post({accountNumId:39999,kind:'enforcement_notice',dryRun:true})).json()).toEqual({delivered:false,member:false,locale:''});
 expect(await rows()).toEqual([]);
});

it('writes one platform notice per event, resolving retained account connections first',async()=>{
 await env.DB.prepare("UPDATE members SET locale='en' WHERE id=?").bind(member).run();
 const r=await post(notice());
 expect(r.status).toBe(200);expect(await r.json()).toEqual({delivered:true,member:true,locale:'en'});
 expect(await rows()).toEqual([{event_key:'enforcement:n0123456789abcdef0123',member_id:member,kind:'enforcement_notice',path:URL_OK,extra:JSON.stringify({deadline:'2026-11-29T15:59:59.000Z'}),author_id:null,actor_id:null,card_id:null}]);
 // Harbor retries after a timeout: the same event stays one row.
 expect(await (await post(notice())).json()).toEqual({delivered:true,member:true,locale:'en'});
 expect(await rows()).toHaveLength(1);
 const canonical=await makeMember(30002);
 await env.DB.prepare("INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES('harbor',?,?,?)").bind(String(ACCOUNT),canonical,Date.now()).run();
 await post(notice({eventKey:'enforcement-result:n0123456789abcdef0123',kind:'enforcement_result',decision:'revoked',deadline:undefined}));
 const result=(await rows())[1];
 expect(result).toMatchObject({member_id:canonical,kind:'enforcement_result',extra:JSON.stringify({decision:'revoked'})});
 const metrics=await (await worker.fetch(new Request('https://c.test/metrics'),options(),createExecutionContext())).text();
 expect(metrics).toContain('hearthroom_enforcement_notices_total{operation="notice",outcome="duplicate"} 1');
 expect(metrics).toContain('hearthroom_enforcement_notices_total{operation="result",outcome="delivered"} 1');
 expect(metrics).not.toContain(String(ACCOUNT));
});

it('reaches members who turned site notifications off, and pushes it with the platform as sender',async()=>{
 await env.DB.prepare('INSERT INTO community_preferences(member_id,notifications) VALUES(?,0)').bind(member).run();
 expect(await (await post(notice())).json()).toMatchObject({delivered:true});
 expect(await rows()).toHaveLength(1);
 const configured={...options(),PUSH_VAPID_PUBLIC_KEY:'BPtnWqq9-GEcvvu8iLFiek-R2e0irBqzECbuvs8OeAYhRAk832IDbJh2f10ssltIXg5-Bb26zvc4R6JwK_Si0ro',PUSH_VAPID_PRIVATE_KEY:'x'.repeat(43),PUSH_VAPID_SUBJECT:'mailto:test@example.com'} as Env;
 await saveSubscription(configured,member,{endpoint:'https://push.example/e1',keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)},locale:'zh-Hant'});
 const sent:{title:string;body:string;path:string}[]=[];
 const send:PushSender=async(_s,data)=>{sent.push(data);return 201;};
 expect(await dispatchPush(configured,send)).toBe(1);
 expect(sent).toEqual([expect.objectContaining({title:'HarperHarbor 帳號處置通知',body:'你的推薦碼出現異常，我們已採取處置。2026-11-29 23:59（台北時間）前可以申訴。',path:'/me/notifications'})]);
});

it('keeps test accounts out',async()=>{
 await env.DB.prepare("UPDATE members SET account_class='test' WHERE id=?").bind(member).run();
 expect((await post(notice())).status).toBe(403);
 expect((await post(notice({dryRun:true}))).status).toBe(403);
 expect(await rows()).toEqual([]);
});

it('words the notice and the result in every language, with the deadline exactly as the email shows it',()=>{
 const n={kind:'enforcement_notice',extra:JSON.stringify({deadline:'2026-11-29T15:59:59.000Z'}),actor_name:null,actor_handle:null,card_names:null};
 expect(pushLine(n,'zh-Hans')).toBe('你的推荐码出现异常，我们已采取处置。2026-11-29 23:59（北京时间）前可以申诉。');
 expect(pushLine(n,'en')).toBe('We found unusual activity on your referral code and took action. You can appeal until 2026-11-29 23:59 (UTC+8).');
 expect(pushLine(n,'ja')).toBe('紹介コードに異常が見つかり、対応を行いました。2026-11-29 23:59（UTC+8）まで異議を申し立てられます。');
 expect(pushLine(n,'ko')).toBe('추천 코드에서 이상 징후를 발견해 조치했어요. 2026-11-29 23:59 (UTC+8)까지 이의를 신청할 수 있어요.');
 expect(pushTitle(n,'en')).toBe('HarperHarbor account action notice');
 const r=(decision:string)=>({kind:'enforcement_result',extra:JSON.stringify({decision}),actor_name:null,actor_handle:null,card_names:null});
 expect(pushTitle(r('maintained'),'zh-Hant')).toBe('申訴結果：維持原處置');
 expect(pushTitle(r('revoked'),'ko')).toBe('이의 신청 결과: 조치 취소');
 expect(pushLine(r('revoked'),'ja')).toBe('タップして回答を確認できます。');
});

it('lists an unread platform notice above newer notices until it is read',async()=>{
 identities({member:ACCOUNT});
 await post(notice());
 await env.DB.prepare("INSERT INTO community_notifications(event_key,member_id,kind,path,created_at) VALUES('later',?,'comment_reply','/cards/1',?)").bind(member,Date.now()+60_000).run();
 const list=async()=>((await (await worker.fetch(new Request('https://c.test/v1/me/community/notifications?lang=en',{headers:bearer('member')}),options(),createExecutionContext())).json()) as any).items as {kind:string;path:string;extra:unknown}[];
 const first=await list();
 expect(first.map(n=>n.kind)).toEqual(['enforcement_notice','comment_reply']);
 expect(first[0]).toMatchObject({path:URL_OK,extra:{deadline:'2026-11-29T15:59:59.000Z'}});
 await env.DB.prepare("UPDATE community_notifications SET read_at=? WHERE kind='enforcement_notice'").bind(Date.now()).run();
 expect((await list()).map(n=>n.kind)).toEqual(['comment_reply','enforcement_notice']);
});
