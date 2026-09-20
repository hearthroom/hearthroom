import { HttpError, type Env } from '../types';
import { digest } from './crypto';

export type NameStyle = 'none' | 'ember' | 'aurora' | 'glow';
export interface AppearancePreferences { avatarSource: 'site'|'discord'|'guild'; nameStyle: NameStyle; frame:'none'|'hearth'|'discord'; publicAppearance:boolean }
const defaults: AppearancePreferences = {avatarSource:'site',nameStyle:'none',frame:'none',publicAppearance:false};
const plain = () => ({avatarUrl:null as string|null,decorationUrl:null as string|null,nameStyle:'none' as NameStyle,frame:'none' as AppearancePreferences['frame']});
type Assets = {discordAvatar?:string;guildAvatar?:string;discordDecoration?:string;guildDecoration?:string};
// A short outage preserves the last confirmed status, bounded to one day.
export async function appearanceView(env:Env, member:string, publicOnly=false) {
 const pref=await env.DB.prepare('SELECT * FROM community_appearance_preferences WHERE member_id=?').bind(member).first<{avatar_source:AppearancePreferences['avatarSource'];name_style:NameStyle;frame:AppearancePreferences['frame'];public_enabled:number}>();
 const preferences:AppearancePreferences=pref?{avatarSource:pref.avatar_source,nameStyle:pref.name_style,frame:pref.frame,publicAppearance:!!pref.public_enabled}:{...defaults};
 const row=await env.DB.prepare(`SELECT a.* FROM community_discord_appearance a JOIN discord_links l ON l.member_id=a.member_id AND l.version=a.link_version AND l.state='active' WHERE a.member_id=?`).bind(member).first<{verified_at:number;boosting_since:number|null;assets:string}>();
 const fresh=!!row && row.verified_at>=Date.now()-86400000 && env.COMMUNITY_ENABLED==='true';
 const available:Assets=fresh?JSON.parse(row!.assets):{};
 const active=fresh && row!.boosting_since!==null;
 const effective=plain();
 if(!publicOnly || preferences.publicAppearance) {
  effective.avatarUrl=preferences.avatarSource==='site'?null:preferences.avatarSource==='guild'?(available.guildAvatar??available.discordAvatar??null):(available.discordAvatar??null);
  if(active) {
   effective.nameStyle=preferences.nameStyle;
   effective.frame=preferences.frame;
   if(preferences.frame==='discord') {
    effective.decorationUrl=(preferences.avatarSource==='guild'?available.guildDecoration:undefined)??available.discordDecoration??null;
    if(!effective.decorationUrl)effective.frame='hearth';
   }
  }
 }
 return {preferences,supporter:{active,boostingSince:active?row!.boosting_since:null,verifiedAt:row?.verified_at??null,stale:!!row&&!fresh},available,effective};
}

export async function saveAppearance(env:Env,member:string,input:Record<string,unknown>) {
 if(!input||Object.keys(input).some(k=>!Object.keys(defaults).includes(k)) ||
 !['site','discord','guild'].includes(String(input.avatarSource)) || !['none','ember','aurora','glow'].includes(String(input.nameStyle)) || !['none','hearth','discord'].includes(String(input.frame)) || typeof input.publicAppearance!=='boolean')throw new HttpError(400,'community_input');
 const current=await appearanceView(env,member);
 // Revoked users can retain a dormant selection or turn it off, but cannot acquire a new perk.
 if(!current.supporter.active && ((input.nameStyle!=='none'&&input.nameStyle!==current.preferences.nameStyle)||(input.frame!=='none'&&input.frame!==current.preferences.frame)))throw new HttpError(403,'community_supporter_required');
 if(input.avatarSource!=='site'&&input.avatarSource!==current.preferences.avatarSource&&!await env.DB.prepare("SELECT 1 FROM discord_links WHERE member_id=? AND state='active'").bind(member).first())throw new HttpError(403,'community_link_required');
 await env.DB.prepare(`INSERT INTO community_appearance_preferences(member_id,avatar_source,name_style,frame,public_enabled) VALUES(?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET avatar_source=excluded.avatar_source,name_style=excluded.name_style,frame=excluded.frame,public_enabled=excluded.public_enabled`).bind(member,input.avatarSource,input.nameStyle,input.frame,input.publicAppearance?1:0).run();
 return appearanceView(env,member);
}

/** Only a signed Bot observation for the current link may change entitlement. */
export async function syncAppearance(env:Env,b:Record<string,unknown>) {
 const now=Date.now();
 if(typeof b.user!=='string'||!/^\d{17,20}$/.test(b.user)||typeof b.version!=='string'||typeof b.member!=='boolean'||!Number.isSafeInteger(b.observedAt)||Number(b.observedAt)>now+5000||Number(b.observedAt)<now-600000||!(b.boostingSince===null||(Number.isSafeInteger(b.boostingSince)&&Number(b.boostingSince)>0&&Number(b.boostingSince)<=now+5000)))throw new HttpError(400,'community_input');
 for(const k of ['avatar','guildAvatar','decoration','guildDecoration'])if(b[k]!==null&&!(typeof b[k]==='string'&&/^(a_)?[a-f0-9]{32}$/.test(b[k] as string)))throw new HttpError(400,'community_input');
 const link=await env.DB.prepare("SELECT member_id FROM discord_links WHERE discord_id=? AND version=? AND state='active'").bind(b.user,b.version).first<{member_id:string}>();
 if(!link)return false;
 const urls:Record<string,string>={};
 if(b.member) {
  urls.discordAvatar=b.avatar?`https://cdn.discordapp.com/avatars/${b.user}/${b.avatar}.png?size=256`:`https://cdn.discordapp.com/embed/avatars/${(BigInt(b.user)>>22n)%6n}.png`;
  if(b.guildAvatar)urls.guildAvatar=`https://cdn.discordapp.com/guilds/${env.COMMUNITY_GUILD_ID}/users/${b.user}/avatars/${b.guildAvatar}.png?size=256`;
  if(b.decoration)urls.discordDecoration=`https://cdn.discordapp.com/avatar-decoration-presets/${b.decoration}.png?size=256`;
  if(b.guildDecoration)urls.guildDecoration=`https://cdn.discordapp.com/avatar-decoration-presets/${b.guildDecoration}.png?size=256`;
 }
 const assets:Assets={},media:{key:string;kind:string;url:string}[]=[];
 for(const [kind,url] of Object.entries(urls)) {
  const key=await digest(env.COMMUNITY_BRIDGE_KEY+':appearance:'+b.version+':'+kind+':'+url);
  assets[kind as keyof Assets]='/v1/community/media/'+key;media.push({key,kind,url});
 }
 // One transaction: stale/out-of-order observations cannot replace either status or media.
 const guard=`EXISTS(SELECT 1 FROM discord_links WHERE member_id=? AND version=? AND state='active')`;
 const token=crypto.randomUUID();
 const statements=[env.DB.prepare(`INSERT INTO community_discord_appearance(member_id,link_version,observed_at,verified_at,boosting_since,assets,sync_token) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(member_id) DO UPDATE SET sync_token=excluded.sync_token,link_version=excluded.link_version,observed_at=excluded.observed_at,verified_at=excluded.verified_at,boosting_since=excluded.boosting_since,assets=excluded.assets WHERE excluded.observed_at>community_discord_appearance.observed_at`).bind(link.member_id,b.version,b.observedAt,now,b.member?b.boostingSince:null,JSON.stringify(assets),token,link.member_id,b.version)];
 const accepted=`EXISTS(SELECT 1 FROM community_discord_appearance WHERE member_id=? AND link_version=? AND observed_at=? AND sync_token=?) AND ${guard}`;
 const args=[link.member_id,b.version,b.observedAt,token,link.member_id,b.version];
 statements.push(env.DB.prepare(`DELETE FROM community_appearance_media WHERE member_id=? AND ${accepted}`).bind(link.member_id,...args));
 for(const m of media)statements.push(env.DB.prepare(`INSERT INTO community_appearance_media(key,member_id,link_version,kind,source_url) SELECT ?,?,?,?,? WHERE ${accepted}`).bind(m.key,link.member_id,b.version,m.kind,m.url,...args));
 const results=await env.DB.batch(statements);
 return !!results[0].meta.changes;
}

/** Same-origin opaque URLs keep Discord identifiers out of public profile payloads. */
export async function appearanceMedia(env:Env,key:string) {
 if(!/^[a-f0-9]{64}$/.test(key)||env.COMMUNITY_ENABLED!=='true')throw new HttpError(404,'not_found');
 const row=await env.DB.prepare(`SELECT m.source_url FROM community_appearance_media m JOIN discord_links l ON l.member_id=m.member_id AND l.version=m.link_version AND l.state='active' JOIN community_discord_appearance a ON a.member_id=l.member_id AND a.link_version=l.version AND a.verified_at>? WHERE m.key=?`).bind(Date.now()-86400000,key).first<{source_url:string}>();
 if(!row)throw new HttpError(404,'not_found');
 const url=new URL(row.source_url);
 if(url.origin!=='https://cdn.discordapp.com'||!/^\/(avatars|guilds|embed\/avatars|avatar-decoration-presets)\//.test(url.pathname))throw new HttpError(404,'not_found');
 // Workers supports manual/follow only. Reject all non-2xx responses below.
 const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(8000)});
 if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw new HttpError(502,'community_media_unavailable');
 const reader=response.body!.getReader();let size=0;const chunks:Uint8Array[]=[];
 try {for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new HttpError(502,'community_media_unavailable');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 if(![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))throw new HttpError(502,'community_media_unavailable');
 return new Response(bytes,{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
