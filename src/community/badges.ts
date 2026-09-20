import { HttpError, type Env } from '../types';
import { memberByHandle } from '../members';
import { appearanceView } from './appearance';
import { BADGE_ICONS, type BadgeDefinition, type BadgeCollection, type CollectedBadge } from '../../shared/community-badges';
export const ACTIVE_AWARD = "revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)";
export async function activeAwardKeys(env:Env,member:string) {
 return (await env.DB.prepare(`SELECT badge FROM community_awards WHERE member_id=? AND ${ACTIVE_AWARD} ORDER BY badge`).bind(member,Date.now()).all<{badge:string}>()).results.map(r=>r.badge);
}
async function definitions(env:Env):Promise<BadgeDefinition[]> {
 return (await env.DB.prepare('SELECT * FROM community_badge_definitions ORDER BY created_at,key').all<{key:string;icon:BadgeDefinition['icon'];category:string;titles:string;descriptions:string}>()).results.map(r=>({key:r.key,icon:r.icon,category:r.category,titles:JSON.parse(r.titles),descriptions:JSON.parse(r.descriptions)}));
}
export async function canManageBadges(env:Env,member:string) {
 return !!await env.DB.prepare("SELECT 1 FROM reviewers WHERE member_id=? AND revoked_at IS NULL AND role IN ('manager','owner')").bind(member).first();
}
async function requireManager(env:Env,member:string) {if(!await canManageBadges(env,member))throw new HttpError(403,'community_manager_required');}
export async function badgeCollection(env:Env,member:string,publicOnly=false):Promise<BadgeCollection> {
 const prefs=await env.DB.prepare('SELECT public_badges,featured_badges FROM community_preferences WHERE member_id=?').bind(member).first<{public_badges:number;featured_badges:string|null}>();
 if(publicOnly&&!prefs?.public_badges)return {items:[],featured:[]};
 const [catalog,awards,link,appearance]=await Promise.all([
  definitions(env),env.DB.prepare('SELECT badge,created_at,revoked_at,expires_at FROM community_awards WHERE member_id=?').bind(member).all<{badge:string;created_at:number;revoked_at:number|null;expires_at:number|null}>(),
  env.DB.prepare("SELECT l.created_at,COALESCE(SUM(x.points),0) AS xp FROM discord_links l LEFT JOIN community_xp x ON x.discord_id=l.discord_id WHERE l.member_id=? AND l.state='active' GROUP BY l.discord_id").bind(member).first<{created_at:number;xp:number}>(),appearanceView(env,member),
 ]);
 const now=Date.now();
 let items:CollectedBadge[]=catalog.map(def=>{
  const award=awards.results.find(a=>a.badge===def.key);
  let earnedAt=award?.created_at??null;
  let state:CollectedBadge['state']=!award?'locked':award.revoked_at!==null?'revoked':award.expires_at!==null&&award.expires_at<=now?'expired':'earned';
  if(def.key==='discord_linked'){state=link?'earned':'locked';earnedAt=link?.created_at??null;}
  if(def.key==='server_booster'){state=appearance.supporter.active?'earned':'locked';earnedAt=appearance.supporter.boostingSince;}
  const threshold=def.key==='community_level_5'?250:def.key==='community_level_10'?1000:def.key==='community_level_20'?4000:0;
  return {...def,state,earnedAt,expiresAt:award?.expires_at??null,...(!publicOnly&&threshold?{progress:{value:state==='earned'?threshold:Math.min(link?.xp??0,threshold),target:threshold}}:{})};
 });
 const active=items.filter(b=>b.state==='earned').map(b=>b.key);
 const chosen:string[]=prefs?.featured_badges===null||prefs?.featured_badges===undefined?active.slice(0,3):JSON.parse(prefs.featured_badges);
 const featured=chosen.filter(key=>active.includes(key)).slice(0,3);
 if(publicOnly){items=items.filter(b=>b.state==='earned');return {items,featured};}
 return {items,featured,public:!!prefs?.public_badges,canManage:await canManageBadges(env,member)};
}
export async function setFeaturedBadges(env:Env,member:string,input:unknown,visibility?:unknown) {
 if(visibility!==undefined&&typeof visibility!=="boolean")throw new HttpError(400,"community_input");
 if(!Array.isArray(input)||input.length>3||new Set(input).size!==input.length||input.some(x=>typeof x!=='string'))throw new HttpError(400,'community_badge_selection');
 const active=(await badgeCollection(env,member)).items.filter(b=>b.state==='earned').map(b=>b.key);
 if(input.some(key=>!active.includes(key)))throw new HttpError(409,'community_badge_selection');
 await env.DB.prepare('INSERT INTO community_preferences(member_id,featured_badges,public_badges) VALUES (?,?,COALESCE(?,0)) ON CONFLICT(member_id) DO UPDATE SET featured_badges=excluded.featured_badges,public_badges=COALESCE(?,community_preferences.public_badges)').bind(member,JSON.stringify(input),visibility===undefined?null:Number(visibility),visibility===undefined?null:Number(visibility)).run();
}
function obj(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'community_input');return value as Record<string,unknown>;}
function text(value:unknown,max:number,multiline=false){if(typeof value!=='string'||!value.trim()||value.length>max||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/:/[\u0000-\u001f]/).test(value))throw new HttpError(400,'community_input');return value.trim();}
function localized(value:unknown,max:number,multiline=false){const input=obj(value),result:Record<string,string>={};for(const key of Object.keys(input).sort()){if(!['zh-Hant','zh-Hans','en','ja','ko'].includes(key))throw new HttpError(400,'community_input');result[key]=text(input[key],max,multiline);}if(!Object.keys(result).length)throw new HttpError(400,'community_input');return result;}
export async function createEventBadge(env:Env,actor:string,input:unknown) {
 await requireManager(env,actor);const b=obj(input),key=text(b.key,60);
 if(!/^event_[a-z0-9][a-z0-9_]{0,49}$/.test(key)||!BADGE_ICONS.includes(b.icon as any))throw new HttpError(400,'community_input');
 const titles=JSON.stringify(localized(b.titles,60)),descriptions=JSON.stringify(localized(b.descriptions,300,true));
 const old=await env.DB.prepare('SELECT icon,titles,descriptions FROM community_badge_definitions WHERE key=?').bind(key).first<{icon:string;titles:string;descriptions:string}>();
 if(old){if(old.icon===b.icon&&old.titles===titles&&old.descriptions===descriptions)return;throw new HttpError(409,'community_badge_conflict');}
 const r=await env.DB.prepare("INSERT OR IGNORE INTO community_badge_definitions SELECT ?,?,'event',?,?,? WHERE (SELECT COUNT(*) FROM community_badge_definitions)<200").bind(key,b.icon,titles,descriptions,Date.now()).run();
 if(!r.meta.changes)throw new HttpError(409,'community_badge_conflict');
}
export async function changeBadgeAward(env:Env,actor:string,input:unknown) {
 await requireManager(env,actor);const b=obj(input),badge=text(b.badge,60),handle=text(b.handle,64),reason=text(b.reason,300),requestId=text(b.requestId,100);
 if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)||!['grant','revoke'].includes(b.action as string))throw new HttpError(400,'community_input');
 const expires=b.expiresAt??null;
 if(expires!==null&&(!Number.isSafeInteger(expires)||(expires as number)<=0||(expires as number)>8640000000000000))throw new HttpError(400,'community_input');
 const member=await memberByHandle(env.DB,handle);if(!member)throw new HttpError(404,'community_member_missing');
 if(!await env.DB.prepare("SELECT 1 FROM community_badge_definitions WHERE key=? AND category='event'").bind(badge).first())throw new HttpError(400,'community_input');
 const payload=JSON.stringify({actor,member,badge,action:b.action,reason,expires});
 async function existing(){const old=await env.DB.prepare('SELECT payload FROM community_badge_audit WHERE request_id=?').bind(requestId).first<{payload:string}>();if(old&&old.payload!==payload)throw new HttpError(409,'community_badge_conflict');return !!old;}
 if(await existing())return;
 const now=Date.now();if(b.action==='grant'&&expires!==null&&(expires as number)<=now)throw new HttpError(400,'community_input');
 try {await env.DB.batch([
  env.DB.prepare('INSERT INTO community_badge_audit VALUES (?,?,?,?,?,?,?,?)').bind(requestId,actor,member,badge,b.action,reason,payload,now),
  b.action==='grant'?env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at,expires_at) VALUES (?,?,'event',?,?) ON CONFLICT(member_id,badge) DO UPDATE SET created_at=excluded.created_at,revoked_at=NULL,expires_at=excluded.expires_at,expiry_notified=0").bind(member,badge,now,expires):env.DB.prepare('UPDATE community_awards SET revoked_at=? WHERE member_id=? AND badge=?').bind(now,member,badge),
 ]);}catch(error){if(await existing())return;throw error;}
}
export async function badgeManagement(env:Env,actor:string){await requireManager(env,actor);return {definitions:(await definitions(env)).filter(d=>d.category==='event'),audit:(await env.DB.prepare('SELECT a.request_id AS id,m.handle,a.badge,a.action,a.reason,a.created_at AS at FROM community_badge_audit a JOIN members m ON m.id=a.member_id ORDER BY a.created_at DESC LIMIT 50').all()).results};}
