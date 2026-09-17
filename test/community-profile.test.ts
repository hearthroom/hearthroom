import {SELF,env} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {resetDb,restoreUpstream,bearer} from './helpers';
import {upstream} from '../src/upstream';
beforeEach(async()=>{await resetDb();vi.spyOn(upstream,'fetchMe').mockImplementation(async(_e,t,p)=>({accountNumId:p==='harbor'?22:11,nickName:p==='harbor'?'Harper name':'Original name',avatar:'https://example.com/avatar.png'}));});
afterEach(()=>{vi.restoreAllMocks();restoreUpstream()});
const me=async(p='lunatalk')=>(await (await SELF.fetch('https://c.test/v1/me',{headers:{...bearer('valid'),'X-Provider':p}})).json()) as any;
it('stores a community profile once and keeps it independent of the sign-in provider',async()=>{
 const first=await me();expect(first.displayName).toBe('Original name');
 const r=await SELF.fetch('https://c.test/v1/me/profile',{method:'PUT',headers:{...bearer('valid'),'Content-Type':'application/json'},body:JSON.stringify({displayName:'My community name',avatarUrl:'https://example.com/community.png'})});expect(r.status).toBe(200);
 const link=await SELF.fetch('https://c.test/v1/me/connections',{method:'POST',headers:{...bearer('valid'),'Content-Type':'application/json'},body:JSON.stringify({provider:'harbor',token:'valid'})});expect(link.status).toBe(200);
 const second=await me('harbor');expect(second.handle).toBe(first.handle);expect(second.displayName).toBe('My community name');expect(second.avatarUrl).toBe('https://example.com/community.png');
});
it('validates profile updates and never changes another member',async()=>{
 const before=await me();
 for(const body of [{displayName:'',avatarUrl:''},{displayName:'Name',avatarUrl:'javascript:alert(1)'}]){
 const r=await SELF.fetch('https://c.test/v1/me/profile',{method:'PUT',headers:{...bearer('valid'),'Content-Type':'application/json'},body:JSON.stringify(body)});expect(r.status).toBe(400);
 }
 expect((await me()).displayName).toBe(before.displayName);
});
it('shows the community profile on public cards and the author page',async()=>{
 const {upsertCard}=await import('../src/cards');const {role}=await import('./helpers');
 const profile=await me();
 await SELF.fetch('https://c.test/v1/me/profile',{method:'PUT',headers:{...bearer('valid'),'Content-Type':'application/json'},body:JSON.stringify({displayName:'Community author',avatarUrl:'https://example.com/community.png'})});
 await upsertCard(env.DB,role({roleId:'public-card',authorNumId:11,authorName:'Upstream name'}),Date.now(),{status:'approved'});
 const card=await (await SELF.fetch('https://c.test/v1/cards/public-card')).json() as any;
 expect(card.author.name).toBe('Community author');expect(card.author.avatar).toBe('https://example.com/community.png');
 const author=await (await SELF.fetch('https://c.test/v1/authors/'+profile.handle)).json() as any;
 expect(author.name).toBe('Community author');
});
