import {gif,png,webp} from './fixtures/animated-avatars';
import { env, createExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { resetDb, restoreUpstream, whoAmI, bearer } from './helpers';
const objects=new Map<string,ArrayBuffer>();
const bucket={put:vi.fn(async(k:string,v:ArrayBuffer)=>{objects.set(k,v)}),delete:vi.fn(async(k:string)=>{objects.delete(k)}),get:vi.fn(async(k:string)=>objects.has(k)?{body:objects.get(k)}:null)};
const images={info:vi.fn(async(_stream:ReadableStream<Uint8Array>)=>({format:'image/png',width:10,height:10,fileSize:8})),input:vi.fn(()=>({transform:()=>({output:async()=>({response:()=>new Response('converted-webp')})})}))};
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

for(const [label,type,format,data,extension] of [
 ['GIF','image/gif','image/gif',gif,'gif'],
 ['APNG','image/apng','image/png',png,'png'],
 ['APNG saved as PNG','image/png','image/png',png,'png'],
 ['animated WebP','image/webp','image/webp',webp,'webp'],
])it(`preserves every byte of ${label} through upload and public delivery`,async()=>{
 await profile();
 images.info.mockResolvedValue({format,width:16,height:16,fileSize:200});
 const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
 const f=form('Animated author','',false);f.set('avatar',new File([bytes],`avatar.${extension}`,{type}));
 const response=await save(f);expect(response.status).toBe(200);
 const current=await response.json() as any;
 expect(current.avatarUrl).toMatch(new RegExp(`\\.${extension}$`));
 expect(images.input).not.toHaveBeenCalled();
 const read=await call(current.avatarUrl);expect(read.status).toBe(200);
 expect(read.headers.get('content-type')).toBe(format);
 expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
 const replacement=await save(form('Next','',false));expect(replacement.status).toBe(200);
 expect((await call(current.avatarUrl)).status).toBe(200);
 images.info.mockResolvedValue({format:'image/png',width:10,height:10,fileSize:8});
 const replaced=await save(form('Replacement'));expect(replaced.status).toBe(200);
 expect((await call(current.avatarUrl)).status).toBe(404);expect(objects.size).toBe(1);
 const remove=form('Next','',false);remove.set('removeAvatar','true');await save(remove);
 expect((await call(current.avatarUrl)).status).toBe(404);expect(objects.size).toBe(0);
});
it('rejects oversized animations and decoder failures without replacing the saved profile',async()=>{
 await profile();await save(form());const old=await profile();
 const f=form('Replacement','',false);
 f.set('avatar',new File([new Uint8Array(10*1024*1024+1)],'avatar.gif',{type:'image/gif'}));
 expect((await save(f)).status).toBe(400);
 images.info.mockRejectedValueOnce(new Error('invalid image'));
 f.set('avatar',new File(['not a GIF'],'avatar.gif',{type:'image/gif'}));
 expect((await save(f)).status).toBe(400);
 expect((await profile()).avatarUrl).toBe(old.avatarUrl);expect(objects.size).toBe(1);
});

it.each([['image/gif',gif],['image/apng',png],['image/webp',webp]])('validates real %s bytes with the local Images binding',async(type,data)=>{
 await profile();
 images.info.mockImplementationOnce(async stream=>await env.IMAGES!.info(stream) as any);
 const f=form('Real decoder','',false);f.set('avatar',new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'avatar',{type}));
 const saved=await save(f);expect(saved.status).toBe(200);
 const read=await call((await saved.json() as any).avatarUrl);
 expect(new Uint8Array(await read.arrayBuffer())).toEqual(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));
});

it.each([['image/gif',gif],['image/apng',png],['image/webp',webp]])('accepts a 10 MiB %s avatar through the multipart route and preserves its bytes',async(type,data)=>{
 await profile();
 const bytes=new Uint8Array(10*1024*1024);bytes.set(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));
 images.info.mockResolvedValue({format:type==='image/apng'?'image/png':type,width:16,height:16,fileSize:bytes.length});
 const f=form('Large avatar','',false);f.set('avatar',new File([bytes],'avatar',{type}));
 const response=await save(f);expect(response.status).toBe(200);
 const read=await call((await response.json() as any).avatarUrl);expect(read.status).toBe(200);
 const output=await read.arrayBuffer();expect(output.byteLength).toBe(bytes.byteLength);
 const digest=async(b:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)));
 expect(await digest(output)).toEqual(await digest(bytes));expect(images.input).not.toHaveBeenCalled();
});
it('rejects an oversized multipart body before decoding or writing an avatar',async()=>{
 await profile();const f=form('Large body','',false);
 f.set('avatar',new File([new Uint8Array(10*1024*1024+16384)],'large.gif',{type:'image/gif'}));
 expect((await save(f)).status).toBe(400);expect(images.info).not.toHaveBeenCalled();expect(bucket.put).not.toHaveBeenCalled();
});
