import { memberProfile } from './members';
import { HttpError, type Env } from './types';
import { preservesOriginalAnimation } from './avatar-animation';
import { AVATAR_MAX_BYTES } from '../shared/avatar';

const RASTER_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','image/apng']);

/** Durable cleanup includes failed uploads; a live profile object is never collected. */
export async function cleanAvatars(env:Env, now=Date.now()) {
 if(!env.AVATARS)return;
 const rows=await env.DB.prepare(`SELECT key FROM avatar_cleanup WHERE delete_after<=? AND NOT EXISTS (SELECT 1 FROM members WHERE avatar_key=avatar_cleanup.key) LIMIT 50`).bind(now).all<{key:string}>();
 for(const {key} of rows.results) {
  try {await env.AVATARS.delete(key);await env.DB.prepare('DELETE FROM avatar_cleanup WHERE key=?').bind(key).run();}
  catch { /* Keep the durable task for the next scheduled run. */ }
 }
}

export async function saveCommunityProfile(env:Env, memberId:string, request:Request) {
 let name:unknown, bio:unknown, file:File|null=null, remove=false;
 if(request.headers.get('Content-Type')?.startsWith('multipart/form-data')) {
  const form=await request.formData().catch(()=>{throw new HttpError(400,'profile_invalid')});
  name=form.get('displayName');bio=form.get('bio')??'';remove=form.get('removeAvatar')==='true';
  const image=form.get('avatar');
  if(image!==null) {if(!(image instanceof File))throw new HttpError(400,'avatar_invalid');file=image;}
 } else {
  const input=await request.json().catch(()=>{throw new HttpError(400,'profile_invalid')}) as Record<string,unknown>;
  if(!input || 'avatarUrl' in input)throw new HttpError(400,'profile_invalid');
  name=input.displayName;bio=input.bio??'';
 }
 if(typeof name!=='string'||!name.trim()||name.trim().length>60||typeof bio!=='string'||bio.trim().length>500)throw new HttpError(400,'profile_invalid');
 if(file&&remove)throw new HttpError(400,'avatar_invalid');
 const prior=await env.DB.prepare('SELECT handle,avatar_key,avatar_url FROM members WHERE id=?').bind(memberId).first<{handle:string;avatar_key:string;avatar_url:string}>();
 if(!prior)throw new HttpError(404,'member not found');
 let key=remove?'':prior.avatar_key;
 let url=remove?'':prior.avatar_url;
 if(file) {
  if(!file.size||file.size>AVATAR_MAX_BYTES||!RASTER_TYPES.has(file.type))throw new HttpError(400,'avatar_invalid');
  if(!env.AVATARS||!env.IMAGES)throw new HttpError(503,'avatar_unavailable');
  let output:ArrayBuffer;
  let contentType='image/webp', extension='webp';
  try {
   const info=await env.IMAGES.info(file.stream());
   if(!RASTER_TYPES.has(info.format)||!('width' in info)||info.width*info.height>40_000_000)throw new Error('invalid image');
   const bytes=await file.arrayBuffer();
   if(preservesOriginalAnimation(bytes,info.format)) {
    // APNG is not guaranteed to survive the image transformation service.
    // Preserve animated rasters byte-for-byte; <img> supplies the visual crop.
    output=bytes;contentType=info.format==='image/apng'?'image/png':info.format;
    extension=contentType.slice('image/'.length);
   } else {
    const transformed=await env.IMAGES.input(file.stream()).transform({width:512,height:512,fit:'cover'}).output({format:'image/webp',quality:80,anim:true});
    output=await transformed.response().arrayBuffer();
   }
  }catch {throw new HttpError(400,'avatar_invalid');}
  key=`${prior.handle}/${crypto.randomUUID()}.${extension}`;url=`/v1/avatars/${key}`;
  // Register before R2 writes so interrupted requests leave a collectable object.
  await env.DB.prepare('INSERT INTO avatar_cleanup(key,delete_after) VALUES (?,?)').bind(key,Date.now()+3600000).run();
  try {await env.AVATARS.put(key,output,{httpMetadata:{contentType}});}
  catch {throw new HttpError(503,'avatar_unavailable');}
 }
 const updated=await env.DB.prepare(`UPDATE members SET display_name=?,bio=?,avatar_url=?,avatar_key=?,profile_edited_at=? WHERE id=? AND avatar_key=?`).bind(name.trim(),bio.trim(),url,key,Date.now(),memberId,prior.avatar_key).run();
 if(!updated.meta.changes)throw new HttpError(409,'profile_changed');
 if(prior.avatar_key && prior.avatar_key!==key)await env.DB.prepare('INSERT OR REPLACE INTO avatar_cleanup(key,delete_after) VALUES (?,?)').bind(prior.avatar_key,0).run();
 if(file||remove)await env.DB.prepare("UPDATE community_appearance_preferences SET avatar_source='site' WHERE member_id=?").bind(memberId).run();
 await cleanAvatars(env);
 return memberProfile(env.DB,memberId);
}
