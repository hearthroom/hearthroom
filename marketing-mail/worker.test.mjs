import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {readMessages} from './cli.mjs';
const NOW=Date.now();
function setup(){
 const objects=new Map();const events=[];
 const env={READ_TOKEN:'a'.repeat(64),FORWARD_TO:'owner@example.net',MAIL:{
  async put(key,body,options){events.push('store');objects.set(key,{key,body,customMetadata:options.customMetadata});},
  async list({limit=1000}={}){return {objects:[...objects.values()].sort((a,b)=>a.key.localeCompare(b.key)).slice(0,limit),truncated:false};},
  async get(key){const o=objects.get(key);return o?{json:async()=>JSON.parse(o.body)}:null;}
 }};
 const raw='From: Sender <sender@example.net>\r\nSubject: =?UTF-8?B?6amX6K2J?=\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCode 123456 https://example.net/verify?code=123456';
 const msg={to:'suki@sukisuki.ai',from:'sender@example.net',rawSize:raw.length,raw:new Response(raw).body,forward:async dest=>{assert.equal(dest,env.FORWARD_TO);events.push('forward');},setReject:()=>events.push('reject')};
 const req=(url='/messages',opts={})=>new Request('https://mail.example.net'+url,{headers:{Authorization:'Bearer '+env.READ_TOKEN},...opts});
 return {env,msg,events,objects,req};
}
test('只收指定 envelope 位址；先 forward 再存解析後文字與驗證連結',async()=>{
 const f=setup();await worker.email(f.msg,f.env);assert.deepEqual(f.events,['forward','store']);
 const r=await worker.fetch(f.req(),f.env);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 const [m]=(await r.json()).messages;assert.equal(m.subject,'驗證');assert.match(m.text,/123456/);assert.deepEqual(m.links,['https://example.net/verify?code=123456']);assert.ok(m.receivedAt);assert.equal(m.from,'sender@example.net');
 const g=setup();g.msg.to='other@sukisuki.ai';await worker.email(g.msg,g.env);assert.deepEqual(g.events,['reject']);
});
for(const to of ['suki@sukisuki.ai','Suki@SukiSuki.AI','meta@sukisuki.ai','META@SukiSuki.AI']) {
 test(`收件人 ${to} 先轉寄再封存，CLI 顯示正規化 envelope 收件人`,async()=>{
  const f=setup();f.msg.to=to;await worker.email(f.msg,f.env);
  assert.deepEqual(f.events,['forward','store'],to);
  const mail=JSON.parse([...f.objects.values()][0].body);assert.equal(mail.to,to.toLowerCase());
  const result=await readMessages({endpoint:'https://mail.example.net',token:f.env.READ_TOKEN},5,
   (url,options)=>worker.fetch(new Request(url,options),f.env));
  assert.equal(result.messages[0].to,to.toLowerCase());
 });
}
test('其他收件人、兩個信箱的 +別名與其他網域仍拒絕，不轉寄也不封存',async()=>{
 for(const to of ['other@sukisuki.ai','suki+alias@sukisuki.ai','META+alias@sukisuki.ai','meta@example.net','meta@sukisuki.ai.example.net']) {
  const f=setup();f.msg.to=to;await worker.email(f.msg,f.env);assert.deepEqual(f.events,['reject'],to);assert.equal(f.objects.size,0);
 }
});
test('Gmail forwarding 失敗不存；私有存放失敗不阻斷已完成轉寄',async()=>{
 const f=setup();f.msg.forward=async()=>{throw Error('private address must not log');};await assert.rejects(worker.email(f.msg,f.env));assert.equal(f.objects.size,0);
 const g=setup();g.env.MAIL.put=async()=>{throw Error('private body');};await worker.email(g.msg,g.env);assert.deepEqual(g.events,['forward']);
});
test('讀取需 bearer；缺 secret 拒絕；只有 GET 路由，最多20封，拒絕不合法 limit',async()=>{
 const f=setup();
 for(const headers of [{},{Authorization:'Bearer wrong'}]) assert.equal((await worker.fetch(f.req('/messages',{headers}),f.env)).status,401);
 assert.equal((await worker.fetch(f.req(),{...f.env,READ_TOKEN:undefined})).status,401);
 assert.equal((await worker.fetch(f.req('/messages',{method:'POST'}),f.env)).status,405);
 assert.equal((await worker.fetch(f.req('/other'),f.env)).status,404);
 for(const value of ['0','21','NaN','1.5']) assert.equal((await worker.fetch(f.req('/messages?limit='+value),f.env)).status,400);
});
test('30天外的信不讀回，最新在前；metrics 無個人資料',async()=>{
 const f=setup();
 for(const age of [0,1,31]) {const receivedAt=new Date(NOW-age*86400000).toISOString();f.objects.set(String(age),{key:String(age),body:JSON.stringify({receivedAt,text:'private',from:'private@example.net'}),customMetadata:{receivedAt}});}
 const r=await worker.fetch(f.req('/messages?limit=1'),f.env);const body=await r.json();assert.equal(body.messages.length,1);assert.equal(body.messages[0].receivedAt,new Date(NOW).toISOString());
 const metrics=await worker.fetch(f.req('/metrics'),f.env);assert.equal(metrics.status,200);assert.match(await metrics.text(),/suki_marketing_mail_archive_available 1/);
});
test('HTML-only MIME、超大信與儲存讀取失敗均有界且不洩露診斷',async()=>{
 const f=setup();const raw='From: Sender <sender@example.net>\r\nSubject: HTML\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Code 654321 <a href="https://example.net/v?a=1&amp;b=2">Verify</a></p>';
 f.msg.raw=new Response(raw).body;await worker.email(f.msg,f.env);
 const [m]=(await (await worker.fetch(f.req(),f.env)).json()).messages;assert.match(m.text,/654321/);assert.doesNotMatch(m.text,/<a/);assert.deepEqual(m.links,['https://example.net/v?a=1&b=2']);
 const g=setup();g.msg.rawSize=2*1024*1024;await worker.email(g.msg,g.env);assert.deepEqual(g.events,['forward']);
 const h=setup();h.env.MAIL.list=async()=>{throw Error('private-details');};
 assert.equal((await worker.fetch(h.req(),h.env)).status,503);
 const metric=await worker.fetch(h.req('/metrics'),h.env);assert.equal(metric.status,503);assert.equal(await metric.text(),'suki_marketing_mail_archive_available 0\n');
 const stale=setup();const receivedAt=new Date(NOW-31*86400000).toISOString();stale.objects.set('mail/old',{key:'mail/old',customMetadata:{receivedAt},body:JSON.stringify({text:'expired',receivedAt})});
 assert.deepEqual(await (await worker.fetch(stale.req(),stale.env)).json(),{messages:[]});
});
test('寄件人顯示 MIME From，保留 envelope；同信箱大小寫變體仍雙收，別名拒絕',async()=>{
 const f=setup();f.msg.from='bounce+opaque@example.net';f.msg.to='Suki@SukiSuki.AI';await worker.email(f.msg,f.env);
 assert.deepEqual(f.events,['forward','store']);
 const [m]=(await (await worker.fetch(f.req(),f.env)).json()).messages;assert.equal(m.from,'sender@example.net');assert.equal(m.fromName,'Sender');assert.equal(m.envelopeFrom,'bounce+opaque@example.net');
 const g=setup();g.msg.to='suki+alias@sukisuki.ai';await worker.email(g.msg,g.env);assert.deepEqual(g.events,['reject']);
});
