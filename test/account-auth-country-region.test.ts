import {memberProfile} from '../src/members';
import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import worker from '../src/index';
import {makeMember,resetDb} from './helpers';

const origin='https://c.test';
let member:string,cookie:string;
const authEnv=()=>({...env,AUTH_ENABLED:'true',AUTH_ALLOWED_ORIGINS:origin,AUTH_KEYRING:JSON.stringify({active:'test',keys:{test:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}})});
beforeEach(async()=>{
 await resetDb();member=await makeMember(42);
 const raw='synthetic-region-session';
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
 const hashed=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 await env.DB.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?)').bind(hashed,member,'harbor','42',origin,Date.now(),Date.now()+30*86400000).run();
 cookie='__Host-hr-session='+raw;
});
afterEach(async()=>{await env.DB.exec('DROP TRIGGER IF EXISTS region_session_no_member_write');});
async function session(country:string,language:string,extra:Record<string,string>={}){
 const context=createExecutionContext();
 const response=await worker.fetch(new Request(origin+'/v1/auth/session',{
  method:'POST',headers:{Origin:origin,'X-Hearthroom-Request':'1','Content-Type':'application/json',Cookie:cookie,'CF-IPCountry':country,language,'Accept-Language':language.startsWith('zh')?'en':'zh-Hant',...extra},
  body:JSON.stringify({provider:'harbor',token:true}),
 }),authEnv(),context);
 await waitOnExecutionContext(context);return response;
}
it.each([
 ['HK','en','HK'],['MO','en','MO'],['TW','en','TW'],['SG','en','SG'],['MY','en','MY'],
 ['JP','zh-Hant','JP'],['KR','zh-Hant','KR'],['US','zh-Hant','US'],
 ['CN','zh-Hant','TW'],['CN','zh-Hans','TW'],['FR','zh-Hant','TW'],['CN','en','OTHER'],['FR','ja','OTHER'],
])('initializes the managed session profile from IP %s and UI %s as %s before returning',async(country,language,expected)=>{
 const response=await session(country,language);
 expect(response.status).toBe(200);
 expect((await response.json() as any).profile.countryRegion).toBe(expected);
 expect((await env.DB.prepare('SELECT country_region FROM members WHERE id=?').bind(member).first())?.country_region).toBe(expected);
});
it('keeps a selected region and makes no member write on later session reads',async()=>{
 await env.DB.prepare("UPDATE members SET country_region='CN' WHERE id=?").bind(member).run();
 await env.DB.exec("CREATE TRIGGER region_session_no_member_write BEFORE UPDATE ON members BEGIN SELECT RAISE(ABORT,'initialized member is read only'); END");
 for(const [country,language] of [['JP','ja'],['CN','zh-Hant']]){
  const response=await session(country,language);
  expect(response.status).toBe(200);expect((await response.json() as any).profile.countryRegion).toBe('CN');
 }
});
it('does not initialize a member from an unauthenticated or cross-origin session request',async()=>{
 const authenticatedCookie=cookie;cookie='__Host-hr-session=invalid';
 expect((await session('JP','ja')).status).toBe(401);
 cookie=authenticatedCookie;
 expect((await session('JP','ja',{Origin:'https://attacker.test'})).status).toBe(403);
 expect((await env.DB.prepare('SELECT country_region FROM members WHERE id=?').bind(member).first())?.country_region).toBeNull();
});

it('reads back an explicit choice made between the first profile read and default initialization',async()=>{
 let first=true;
 const db=new Proxy(env.DB,{get(target,key){
  if(key==='batch')return async(statements:D1PreparedStatement[])=>{
   const result=await target.batch(statements);
   if(first){first=false;await env.DB.prepare("UPDATE members SET country_region='CN' WHERE id=?").bind(member).run();}
   return result;
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 expect((await memberProfile(db,member,{country:'JP',locale:'ja'}))?.countryRegion).toBe('CN');
 expect((await env.DB.prepare('SELECT country_region FROM members WHERE id=?').bind(member).first())?.country_region).toBe('CN');
});
it('counts the first persisted default once without region or member labels',async()=>{
 expect((await session('CN','zh-Hant')).status).toBe(200);
 expect((await session('JP','ja')).status).toBe(200);
 const context=createExecutionContext();
 const response=await worker.fetch(new Request(origin+'/metrics'),authEnv(),context);
 await waitOnExecutionContext(context);
 const metrics=await response.text();
 expect(metrics).toContain('hearthroom_country_region_operations_total{operation="initialize",outcome="success"} 1');
 expect(metrics).not.toContain('countryRegion=');
});
