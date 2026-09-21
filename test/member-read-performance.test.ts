import { env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { requireMember, memberProfile } from '../src/members';
import { identities, makeMember, resetDb } from './helpers';

beforeEach(async()=>{await resetDb();identities({'fixture':11});});
function measuredDb() {
 const trips:string[]=[];
 const wrap=(stmt:D1PreparedStatement):D1PreparedStatement=>new Proxy(stmt,{get(target,key){
   if(key==='bind')return (...args:unknown[])=>wrap(target.bind(...args));
   if(['first','all','run','raw'].includes(String(key)))return (...args:unknown[])=>{trips.push(String(key));return (target[key as keyof D1PreparedStatement] as Function).apply(target,args)};
   return Reflect.get(target,key);
 }});
 const db=new Proxy(env.DB,{get(target,key){
  if(key==='prepare')return (sql:string)=>wrap(target.prepare(sql));
  if(key==='batch')return (stmts:D1PreparedStatement[])=>{trips.push('batch');return target.batch(stmts)};
  const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;
 }});
 return {db,trips};
}
it('existing initialized identity needs one read and no write, even without an upstream nickname',async()=>{
 const id=await makeMember(11);
 await env.DB.prepare("UPDATE members SET display_name='Community name' WHERE id=?").bind(id).run();
 const {db,trips}=measuredDb();
 const member=await requireMember({env:{...env,DB:db},req:{header:k=>k==='Authorization'?'Bearer fixture':undefined}});
 expect(member.id).toBe(id);expect(trips).toEqual(['first']);
});
it('loads a member profile and linked identities in one D1 batch',async()=>{
 const id=await makeMember(11);const {db,trips}=measuredDb();
 expect((await memberProfile(db,id))?.identities).toEqual([{provider:'lunatalk',externalId:11,linkedAt:expect.any(Number),founding:true}]);
 expect(trips).toEqual(['batch']);
 expect(await memberProfile(db,'missing')).toBeNull();
});
