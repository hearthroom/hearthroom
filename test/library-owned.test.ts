import {SELF,env} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {ownedHistory} from '../src/owned-history';
import {resetDb,identities,bearer,restoreUpstream} from './helpers';
const original=ownedHistory.read;
beforeEach(async()=>{await resetDb();identities({fan:20001,other:20002});});
afterEach(()=>{ownedHistory.read=original;restoreUpstream();});
it('keeps private owned conversation pointers while suppressing stale current card metadata',async()=>{
 await SELF.fetch('https://c.test/v1/me/conversations',{method:'PUT',headers:{...bearer('fan'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'old',conversationId:'saved'})});
 ownedHistory.read=async()=>({conversationId:'saved',roleId:'old',title:'Saved title',canGenerate:false,reason:'author_private'});
 const result=await SELF.fetch('https://c.test/v1/me/conversations',{headers:bearer('fan')});
 const row=(await result.json() as any).conversations[0];
 expect(row).toMatchObject({conversationId:'saved',conversationRoleId:'old',conversationTitle:'Saved title',canGenerate:false,reason:'author_private'});
 expect(row.roleAvatar).toBe('');expect(row.roleName).toBe('');
 const other=await SELF.fetch('https://c.test/v1/me/conversations',{headers:bearer('other')});
 expect((await other.json() as any).conversations).toEqual([]);
});
it('does not label unavailable policy reads as author_private',async()=>{
 await SELF.fetch('https://c.test/v1/me/conversations',{method:'PUT',headers:{...bearer('fan'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'old',conversationId:'saved'})});
 ownedHistory.read=async()=>null;
 const r=await SELF.fetch('https://c.test/v1/me/conversations',{headers:bearer('fan')});
 expect((await r.json() as any).conversations[0]).toMatchObject({canGenerate:false,reason:'unavailable'});
});
it('projects a qualified private player as resumable without a closed-history reason',async()=>{
 await SELF.fetch('https://c.test/v1/me/conversations',{method:'PUT',headers:{...bearer('fan'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'old',conversationId:'saved'})});
 ownedHistory.read=async()=>({conversationId:'saved',roleId:'old',title:'Saved title',roleName:'Retained role',canGenerate:true});
 const result=await SELF.fetch('https://c.test/v1/me/conversations',{headers:bearer('fan')});
 const row=(await result.json() as any).conversations[0];
 expect(row).toMatchObject({conversationId:'saved',conversationRoleId:'old',conversationTitle:'Saved title',canGenerate:true});
 expect(row).not.toHaveProperty('reason');
});
