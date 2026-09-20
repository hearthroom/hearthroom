import { env, createExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { resetDb, restoreUpstream, whoAmI, bearer } from './helpers';
const objects=new Map<string,ArrayBuffer>();
const bucket={put:vi.fn(async(k:string,v:ArrayBuffer)=>{objects.set(k,v)}),delete:vi.fn(async(k:string)=>{objects.delete(k)}),get:vi.fn(async(k:string)=>objects.has(k)?{body:objects.get(k)}:null)};
const images={info:vi.fn(async()=>({format:'image/png',width:10,height:10,fileSize:8})),input:vi.fn(()=>({transform:()=>({output:async()=>({response:()=>new Response('converted-webp')})})}))};
const fixture=()=>({...env,AVATARS:bucket,IMAGES:images}) as unknown as Env;
const call=(path:string,init:RequestInit={})=>worker.fetch(new Request('https://c.test'+path,init),fixture(),createExecutionContext());
const profile=async()=>await (await call('/v1/me',{headers:bearer()})).json() as any;
function form(name='Community name',bio='My introduction',image=true){const f=new FormData();f.set('displayName',name);f.set('bio',bio);if(image)f.set('avatar',new File([new Uint8Array([137,80,78,71,13,10,26,10])],'avatar.png',{type:'image/png'}));return f;}
const save=(f:FormData)=>call('/v1/me/profile',{method:'PUT',headers:bearer(),body:f});
beforeEach(async()=>{await resetDb();whoAmI(11);objects.clear();vi.clearAllMocks();images.info.mockResolvedValue({format:'image/png',width:10,height:10,fileSize:8});});
afterEach(restoreUpstream);
it('saves a bio and a processed owned avatar, replacing the prior object',async()=>{
 await profile(); const first=await save(form());expect(first.status).toBe(200);
 const a=await first.json() as any;expect(a.bio).toBe('My introduction');expect(a.avatarUrl).toMatch(/^\/v1\/avatars\//);
 expect(objects.size).toBe(1);expect(images.input).toHaveBeenCalledTimes(1);
 const second=await save(form('New name'));expect(second.status).toBe(200);
 const b=await second.json() as any;expect(b.avatarUrl).not.toBe(a.avatarUrl);expect(objects.size).toBe(1);
 expect((await profile()).displayName).toBe('New name');
 const read=await call(b.avatarUrl);expect(read.status).toBe(200);expect(read.headers.get('content-type')).toBe('image/webp');
});
it('preserves the old profile when the replacement cannot be stored',async()=>{
 await profile();await save(form());const old=await profile();bucket.put.mockRejectedValueOnce(new Error('storage unavailable'));
 const r=await save(form('Must not save'));expect(r.status).toBe(503);
 expect((await profile()).avatarUrl).toBe(old.avatarUrl);expect((await profile()).displayName).toBe(old.displayName);expect(objects.size).toBe(1);
});
it('does not accept arbitrary avatar URLs, oversized biographies or non-images',async()=>{
 await profile();
 const json=await call('/v1/me/profile',{method:'PUT',headers:{...bearer(),'Content-Type':'application/json'},body:JSON.stringify({displayName:'Name',avatarUrl:'https://external.test/avatar.png'})});expect(json.status).toBe(400);
 expect((await save(form('Name','x'.repeat(501),false))).status).toBe(400);
 const f=form('Name','',false);f.set('avatar',new File(['<svg/>'],'image.svg',{type:'image/svg+xml'}));expect((await save(f)).status).toBe(400);expect(objects.size).toBe(0);
});
it('removes an avatar only when the owner saves the removal',async()=>{
 await profile();await save(form());const f=form('Name','',false);f.set('removeAvatar','true');expect((await save(f)).status).toBe(200);
 expect((await profile()).avatarUrl).toBe('');expect(objects.size).toBe(0);
});

it('publishes a saved bio on an author page even before the first card',async()=>{
 const me=await profile();await save(form('Author','Public introduction',false));
 const response=await call('/v1/authors/'+me.handle);expect(response.status).toBe(200);
 const author=await response.json() as any;expect(author.bio).toBe('Public introduction');expect(author.cardCount).toBe(0);expect(author.joinedAt).toBe(me.memberSince);
});

it('retries old-avatar cleanup without deleting the active avatar',async()=>{
 await profile();await save(form());bucket.delete.mockRejectedValueOnce(new Error('temporary failure'));
 await save(form('Second'));expect(objects.size).toBe(2);
 const {cleanAvatars}=await import('../src/community-profile');await cleanAvatars(fixture());
 expect(objects.size).toBe(1);expect((await call((await profile()).avatarUrl)).status).toBe(200);
});
it('switches to the newly uploaded avatar while preserving supporter style preferences',async()=>{
 await profile();
 const m=await env.DB.prepare("SELECT id FROM members LIMIT 1").first<{id:string}>();
 await env.DB.prepare("INSERT INTO community_appearance_preferences(member_id,avatar_source,name_style,frame) VALUES(?,'discord','glow','hearth')").bind(m!.id).run();
 expect((await save(form())).status).toBe(200);
 expect(await env.DB.prepare('SELECT avatar_source,name_style,frame FROM community_appearance_preferences WHERE member_id=?').bind(m!.id).first()).toEqual({avatar_source:'site',name_style:'glow',frame:'hearth'});
});
