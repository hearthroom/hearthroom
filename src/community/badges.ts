import { snapshot } from '../snapshot-cache';
import { HttpError, type Env } from '../types';
import { memberByHandle } from '../members';
import { appearanceView } from './appearance';
import { badgeAp, badgeReward, parseConversationRewardFreeze } from '../../shared/badge-rarity';
import { claimSummaries } from './badge-rewards';
import { levelOf } from '../../shared/achievements';
import { authorRankOf } from './achievement-board';
import { BADGE_ICONS, BADGE_CATEGORIES, FEATURED_LIMIT, type BadgeDefinition, type BadgeCollection, type CollectedBadge, type BadgeProgress } from '../../shared/community-badges';
export const ACTIVE_AWARD = "revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)";
/** Members who joined before this instant earned the founding-member badge. */
export const FOUNDER_CUTOFF = Date.UTC(2026, 9, 16,16);
export const VETERAN_END = Date.UTC(2026,10,17,16);
const DAY = 86400000;
/**
 * Cards a member owns for creator milestones: same ownership rule as the author page
 * (a connected account outranks the original identity), listed only, and never a
 * distributed copy — otherwise one work shipped to two providers counts twice.
 */
export const OWNED_LISTED = `cards c LEFT JOIN member_identities ai ON ai.provider=c.provider AND ai.external_id=CAST(c.author_num_id AS TEXT)
 LEFT JOIN member_connections ac ON ac.provider=c.provider AND ac.external_id=CAST(c.author_num_id AS TEXT)
 WHERE COALESCE(ac.owner_member_id,ai.member_id) IS NOT NULL AND c.status='approved' AND c.board_hidden=0 AND c.public_blocked=0
 AND NOT EXISTS (SELECT 1 FROM work_copies w WHERE w.provider=c.provider AND w.role_id=c.source_role_id)`;
const OWNER = 'COALESCE(ac.owner_member_id,ai.member_id)';
/**
 * 有效互動者（成就第一批，owner 2026-11-23）：按讚、關注、收藏的人要註冊滿 3 天，且在 Harbor 聊過至少 3 輪
 * （徽章統計寫入的 send_turns），測試帳號不算。第一個 `?` 是 now，所以這幾個指標都是 timed。
 * ponytail: 同一裝置的多個帳號還沒合併成一人；要合併時改讀 reward_devices。
 */
const established=(who:string,now='?')=>`JOIN members em ON em.id=${who} AND em.account_class='normal' AND em.created_at<=${now}-${3*DAY}
 JOIN badge_qualifications eq ON eq.member_id=${who} AND eq.send_turns>=3`;
/** 留言：10 個字以上、同一個對象（卡、文章、模組）最多 3 則、每個台北營業日（04:00 換日）最多 5 則 */
const COMMENT_TARGET="COALESCE(post_id,workshop_id,CAST(card_id AS TEXT))";
const COUNTED_COMMENT="deleted_at IS NULL AND status='visible' AND length(trim(content))>=10";
const BUSINESS_DAY="date(created_at/1000+14400,'unixepoch')";
type Metric = {
 /** value for one member; placeholders are the member id, or `now` then the member id when `timed` */
 one:string;
 /** (member_id,value) for every member; a single placeholder is `now` when `timed` */
 all:string;
 timed?:true; unit?:BadgeProgress['unit']; progress?:false;
};
/**
 * Milestone counters. `one` feeds the owner's wall; `all` feeds the hourly sweep so an
 * award lands even when the member never opens the page. Both read the same tables, so
 * the two paths cannot disagree about who qualifies.
 */
export const METRICS:Record<string,Metric>={
 effective_invites:{one:'SELECT effective_invites FROM badge_qualifications WHERE member_id=?',all:'SELECT member_id,effective_invites AS value FROM badge_qualifications'},
 paid_invites:{one:'SELECT paid_invites FROM badge_qualifications WHERE member_id=?',all:'SELECT member_id,paid_invites AS value FROM badge_qualifications'},
 xp:{unit:'xp',one:"SELECT COALESCE(SUM(x.points),0) FROM discord_links l JOIN community_xp x ON x.discord_id=l.discord_id WHERE l.member_id=? AND l.state='active'",
  all:"SELECT l.member_id,SUM(x.points) AS value FROM discord_links l JOIN community_xp x ON x.discord_id=l.discord_id WHERE l.state='active' GROUP BY l.member_id"},
 works_listed:{one:`SELECT COUNT(*) FROM ${OWNED_LISTED} AND ${OWNER}=?`,all:`SELECT ${OWNER} AS member_id,COUNT(*) AS value FROM ${OWNED_LISTED} GROUP BY 1`},
 works_featured:{one:`SELECT COUNT(*) FROM ${OWNED_LISTED} AND c.featured_at IS NOT NULL AND ${OWNER}=?`,all:`SELECT ${OWNER} AS member_id,COUNT(*) AS value FROM ${OWNED_LISTED} AND c.featured_at IS NOT NULL GROUP BY 1`},
  // 從作者自己的卡出發（CROSS JOIN 固定順序）：先掃全部收藏再過濾，作者看一次徽章頁要讀 5.9 萬行（2026-11-23 線上量測）
 favorites_received:{timed:true,one:`SELECT COUNT(*) FROM (SELECT ? AS now) t CROSS JOIN (SELECT c.id,${OWNER} AS owner FROM ${OWNED_LISTED} AND ${OWNER}=?) o
  CROSS JOIN member_favorites f ON f.card_id=o.id ${established('f.member_id','t.now')} WHERE f.member_id<>o.owner`,
  all:`SELECT o.member_id,COUNT(*) AS value FROM (SELECT ? AS now) t CROSS JOIN (SELECT c.id,${OWNER} AS member_id FROM ${OWNED_LISTED}) o
  CROSS JOIN member_favorites f ON f.card_id=o.id ${established('f.member_id','t.now')} WHERE f.member_id<>o.member_id GROUP BY o.member_id`},
 followers:{timed:true,one:`SELECT COUNT(*) FROM member_follows f ${established('f.member_id')} WHERE f.author_id=? AND f.member_id<>f.author_id`,
  all:`SELECT f.author_id AS member_id,COUNT(*) AS value FROM member_follows f ${established('f.member_id')} WHERE f.member_id<>f.author_id GROUP BY f.author_id`},
 follows:{one:'SELECT COUNT(*) FROM member_follows WHERE member_id=?',all:'SELECT member_id,COUNT(*) AS value FROM member_follows GROUP BY member_id'},
 favorites:{one:'SELECT COUNT(*) FROM member_favorites WHERE member_id=?',all:'SELECT member_id,COUNT(*) AS value FROM member_favorites GROUP BY member_id'},
 /** 開過對話的角色數（遊玩頁回報、不驗證），只給「初次見面」用 */
 cards_played:{one:'SELECT COUNT(*) FROM member_conversations WHERE member_id=?',all:'SELECT member_id,COUNT(*) AS value FROM member_conversations GROUP BY member_id'},
 /** Harbor 驗證過的探索角色數：每個角色自己聊滿 10 輪、每天最多計入 10 個（探險家一系列） */
 explored_roles:{one:'SELECT explored_roles FROM badge_qualifications WHERE member_id=?',all:'SELECT member_id,explored_roles AS value FROM badge_qualifications WHERE explored_roles>0'},
 /** Harbor 驗證過的對話輪數與單張卡最多輪數：自己的卡不算，每個營業日最多計入 300 輪 */
 send_turns:{one:'SELECT send_turns FROM badge_qualifications WHERE member_id=?',all:'SELECT member_id,send_turns AS value FROM badge_qualifications WHERE send_turns>0'},
 max_role_turns:{one:'SELECT max_role_turns FROM badge_qualifications WHERE member_id=?',all:'SELECT member_id,max_role_turns AS value FROM badge_qualifications WHERE max_role_turns>0'},
 /** 三合君王：同一張卡拿過日、週、月榜第一（清水或綜合都算） */
 same_card_crown:{progress:false,one:"SELECT COUNT(*) FROM (SELECT card_id FROM rank_awards WHERE member_id=? AND band=1 GROUP BY card_id HAVING COUNT(DISTINCT window)=3)",
  all:"SELECT member_id,COUNT(*) AS value FROM (SELECT member_id,card_id FROM rank_awards WHERE band=1 GROUP BY member_id,card_id HAVING COUNT(DISTINCT window)=3) GROUP BY member_id"},
 saves:{one:'SELECT COUNT(DISTINCT role_id) FROM card_saves WHERE member_id=?',all:'SELECT member_id,COUNT(DISTINCT role_id) AS value FROM card_saves GROUP BY member_id'},
 comments:{one:`SELECT COALESCE(SUM(MIN(n,5)),0) FROM (SELECT COUNT(*) n FROM (SELECT created_at,ROW_NUMBER() OVER (PARTITION BY ${COMMENT_TARGET} ORDER BY created_at,id) k
  FROM comments WHERE member_id=? AND ${COUNTED_COMMENT}) WHERE k<=3 GROUP BY ${BUSINESS_DAY})`,
  all:`SELECT member_id,SUM(MIN(n,5)) AS value FROM (SELECT member_id,COUNT(*) n FROM (SELECT member_id,created_at,ROW_NUMBER() OVER (PARTITION BY member_id,${COMMENT_TARGET} ORDER BY created_at,id) k
  FROM comments WHERE ${COUNTED_COMMENT}) WHERE k<=3 GROUP BY member_id,${BUSINESS_DAY}) GROUP BY member_id`},
 /** 留言獲讚：自己按的不算，同一個人最多計 3 個，按讚的人要是有效互動者 */
 likes_received:{timed:true,one:`SELECT COALESCE(SUM(MIN(n,3)),0) FROM (SELECT COUNT(*) n FROM comment_likes l ${established('l.member_id')}
  JOIN comments c ON c.id=l.comment_id AND c.member_id=? AND c.deleted_at IS NULL AND c.status='visible' WHERE l.member_id<>c.member_id GROUP BY l.member_id)`,
  all:`SELECT member_id,SUM(MIN(n,3)) AS value FROM (SELECT c.member_id,COUNT(*) n FROM comment_likes l ${established('l.member_id')}
  JOIN comments c ON c.id=l.comment_id AND c.deleted_at IS NULL AND c.status='visible' WHERE l.member_id<>c.member_id GROUP BY c.member_id,l.member_id) GROUP BY member_id`},
 /** 伯樂：在卡片第一次拿到榜單名次之前就收藏了它（作者自己的卡不算） */
 talent_spotted:{one:`SELECT COUNT(*) FROM member_favorites f JOIN (SELECT card_id,MIN(awarded_at) AS first_at FROM rank_awards GROUP BY card_id) r ON r.card_id=f.card_id
  WHERE f.member_id=? AND f.created_at<r.first_at AND NOT EXISTS(SELECT 1 FROM rank_awards x WHERE x.card_id=f.card_id AND x.member_id=f.member_id)`,
  all:`SELECT f.member_id,COUNT(*) AS value FROM member_favorites f JOIN (SELECT card_id,MIN(awarded_at) AS first_at FROM rank_awards GROUP BY card_id) r ON r.card_id=f.card_id
  WHERE f.created_at<r.first_at AND NOT EXISTS(SELECT 1 FROM rank_awards x WHERE x.card_id=f.card_id AND x.member_id=f.member_id) GROUP BY f.member_id`},
 ratings:{one:'SELECT COUNT(*) FROM card_scores WHERE member_id=?',all:'SELECT member_id,COUNT(*) AS value FROM card_scores GROUP BY member_id'},
 profile:{progress:false,one:'SELECT profile_edited_at IS NOT NULL FROM members WHERE id=?',all:'SELECT id AS member_id,1 AS value FROM members WHERE profile_edited_at IS NOT NULL'},
 beta_veteran:{progress:false,one:`SELECT created_at<${FOUNDER_CUTOFF} FROM members WHERE id=?`,all:`SELECT id AS member_id,1 AS value FROM members WHERE created_at<${FOUNDER_CUTOFF}`},
 opening_veteran:{progress:false,one:`SELECT created_at<${VETERAN_END} FROM members WHERE id=?`,all:`SELECT id AS member_id,1 AS value FROM members WHERE created_at<${VETERAN_END}`},
 tenure_days:{unit:'days',timed:true,one:`SELECT (?-created_at)/${DAY} FROM members WHERE id=?`,all:`SELECT id AS member_id,(?-created_at)/${DAY} AS value FROM members`},
};
export async function activeAwardKeys(env:Env,member:string) {
 return (await env.DB.prepare(`SELECT badge FROM community_awards WHERE member_id=? AND ${ACTIVE_AWARD} ORDER BY badge`).bind(member,Date.now()).all<{badge:string}>()).results.map(r=>r.badge);
}
type Definition=BadgeDefinition&{metric:string|null;threshold:number|null};
const rank=(category:string)=>{const i=(BADGE_CATEGORIES as readonly string[]).indexOf(category);return i<0?BADGE_CATEGORIES.length:i;};
async function definitions(env:Env):Promise<Definition[]> {
 const revision=await env.DB.prepare('SELECT revision FROM public_catalog_clock WHERE id=1').first<{revision:string}>();
 return (await snapshot(env,['badge-definitions-v2',revision?.revision],1800,async()=> (await env.DB.prepare('SELECT * FROM community_badge_definitions ORDER BY sort_order,created_at,key').all<{key:string;icon:BadgeDefinition['icon'];category:string;titles:string;descriptions:string;metric:string|null;threshold:number|null}>()).results
  .map(r=>({key:r.key,icon:r.icon,category:r.category,titles:JSON.parse(r.titles),descriptions:JSON.parse(r.descriptions),metric:r.metric,threshold:r.threshold}))
  .sort((a,b)=>rank(a.category)-rank(b.category)))).value;
}
/** Current counter values for one member, in one round trip. */
async function measure(env:Env,member:string,names:string[]):Promise<Record<string,number>> {
 if(!names.length)return {};
 const now=Date.now();
 const row=await env.DB.prepare('SELECT '+names.map(n=>`(${METRICS[n].one}) AS "${n}"`).join(',')).bind(...names.flatMap(n=>METRICS[n].timed?[now,member]:[member])).first<Record<string,number|null>>();
 return Object.fromEntries(names.map(n=>[n,Number(row?.[n]??0)]));
}
/** Award every milestone whose counter already crossed its threshold, for all members at once. Idempotent. */
export async function sweepMilestones(env:Env) {
 const now=Date.now();
 const metrics=[...new Set((await definitions(env)).filter(d=>d.metric&&METRICS[d.metric]).map(d=>d.metric as string))];
 if(!metrics.length)return;
 await env.DB.batch(metrics.map(name=>env.DB.prepare(
  `INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT v.member_id,d.key,'metric-v1',? FROM (${METRICS[name].all}) v JOIN community_badge_definitions d ON d.metric=? AND d.threshold<=v.value WHERE v.member_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=v.member_id)`
 ).bind(now,...(METRICS[name].timed?[now]:[]),name)));
}
export async function canManageBadges(env:Env,member:string) {
 return !!await env.DB.prepare("SELECT 1 FROM reviewers WHERE member_id=? AND revoked_at IS NULL AND role IN ('manager','owner')").bind(member).first();
}
async function requireManager(env:Env,member:string) {if(!await canManageBadges(env,member))throw new HttpError(403,'community_manager_required');}
/** 每枚徽章目前的持有人數與全站成員數；30 分鐘快取，持有率只是參考，不必即時。 */
async function holderCounts(env:Env):Promise<{members:number;holders:Record<string,number>}>{
 const bucket=Math.floor(Date.now()/1800000);
 return (await snapshot(env,['badge-holders-v1',bucket],1800,async()=>{
  const now=Date.now();
  const [members,rows]=await Promise.all([
   env.DB.prepare("SELECT COUNT(*) n FROM members WHERE account_class='normal' AND NOT EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=members.id)").first<number>('n'),
   env.DB.prepare(`SELECT badge,COUNT(*) n FROM community_awards WHERE ${ACTIVE_AWARD} GROUP BY badge`).bind(now).all<{badge:string;n:number}>(),
  ]);
  return {members:members??0,holders:Object.fromEntries(rows.results.map(r=>[r.badge,r.n]))};
 })).value;
}
/**
 * 全服唯一徽章（sole_，不含先驅版）現在的持有人；持有人公開了徽章才給公開 ID。撤銷了也算拿走（不順延）。
 * 照目錄裡的 key 精確查（走 badge 索引）：帶 ESCAPE 的 LIKE 用不上索引，每次要掃整張獲獎表（2026-11-20 D1 過載）。
 */
async function crownHolders(env:Env,keys:string[]):Promise<Record<string,{member:string;handle:string|null}>>{
 if(!keys.length)return {};
 const rows=(await env.DB.prepare(`SELECT a.badge,a.member_id,CASE WHEN p.public_badges=1 THEN m.handle END AS handle FROM community_awards a JOIN members m ON m.id=a.member_id
  LEFT JOIN community_preferences p ON p.member_id=a.member_id WHERE a.badge IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all<{badge:string;member_id:string;handle:string|null}>()).results;
 return Object.fromEntries(rows.map(r=>[r.badge,{member:r.member_id,handle:r.handle}]));
}
export async function badgeCollection(env:Env,member:string,publicOnly=false):Promise<BadgeCollection> {
 const prefs=await env.DB.prepare('SELECT public_badges,featured_badges FROM community_preferences WHERE member_id=?').bind(member).first<{public_badges:number;featured_badges:string|null}>();
 if(publicOnly&&!prefs?.public_badges)return {items:[],featured:[]};
 const catalog=await definitions(env);
 const [awards,link,appearance,values,rankCounts]=await Promise.all([
  env.DB.prepare('SELECT badge,created_at,revoked_at,expires_at FROM community_awards WHERE member_id=?').bind(member).all<{badge:string;created_at:number;revoked_at:number|null;expires_at:number|null}>(),
  env.DB.prepare("SELECT created_at FROM discord_links WHERE member_id=? AND state='active'").bind(member).first<{created_at:number}>(),appearanceView(env,member),
  publicOnly?{} as Record<string,number>:measure(env,member,[...new Set(catalog.filter(d=>d.metric&&METRICS[d.metric]).map(d=>d.metric as string))]),
  env.DB.prepare("SELECT 'rank_'||zone||'_'||window||'_'||band AS badge,COUNT(*) AS count,MIN(awarded_at) AS first_at,MAX(awarded_at) AS last_at,MAX(period) AS last_period FROM rank_awards WHERE member_id=? GROUP BY zone,window,band").bind(member).all<{badge:string;count:number;first_at:number;last_at:number;last_period:string}>(),
 ]);
 // 「第幾位獲得」拿掉了：每次讀收藏都要按徽章數早於自己的紀錄，平均一次讀一萬多行，2026-11-20 上線後是 D1 讀取量最大的查詢
 const [census,claims,crowns]=await Promise.all([holderCounts(env),publicOnly?{} as Record<string,never>:claimSummaries(env,member),crownHolders(env,catalog.filter(d=>d.key.startsWith('sole_')&&!d.key.endsWith('_pioneer')).map(d=>d.key))]);
 const now=Date.now();
 const rewardFreeze=publicOnly?undefined:parseConversationRewardFreeze(env.CONVERSATION_BADGE_REWARD_FREEZE,env.CONVERSATION_BADGE_FREEZE_EXCLUDED);
 const crossed:string[]=[];
 let items:CollectedBadge[]=catalog.map(def=>{
  const award=awards.results.find(a=>a.badge===def.key);
  let earnedAt=award?.created_at??null;
  let state:CollectedBadge['state']=!award?'locked':award.revoked_at!==null?'revoked':award.expires_at!==null&&award.expires_at<=now?'expired':'earned';
  if(def.key==='discord_linked'){state=link?'earned':'locked';earnedAt=link?.created_at??null;}
  if(def.key==='server_booster'){state=appearance.supporter.active?'earned':'locked';earnedAt=appearance.supporter.boostingSince;}
  const metric=def.metric&&METRICS[def.metric]?METRICS[def.metric]:null;
  const {metric:_m,threshold:_t,...visible}=def;
  const item:CollectedBadge={...visible,state,earnedAt,expiresAt:award?.expires_at??null};
  const counts=rankCounts.results.find(r=>r.badge===def.key);
  if(counts){item.state='earned';item.earnedAt=counts.first_at;item.count=counts.count;item.firstAt=counts.first_at;item.lastAt=counts.last_at;item.lastPeriod=counts.last_period;}
  if(metric&&def.threshold!==null&&!publicOnly){
   const value=values[def.metric as string]??0;
   if(!award&&value>=def.threshold){item.state='earned';item.earnedAt=now;crossed.push(def.key);}
   if(metric.progress!==false)item.progress={value:item.state==='earned'?Math.max(value,def.threshold):Math.min(value,def.threshold),target:def.threshold,...(metric.unit?{unit:metric.unit}:{})};
  }
  if(!counts){item.count=item.state==='earned'?1:0;item.firstAt=item.earnedAt;item.lastAt=item.earnedAt;}
  item.ap=badgeAp(def);
  const crown=crowns[def.key];
  if(crown&&crown.member!==member&&item.state!=='earned'){item.taken=true;if(crown.handle)item.holder=crown.handle;}
  if(!publicOnly){const reward=badgeReward(def,{freeze:rewardFreeze,memberId:member,state:item.state,earnedAt:item.earnedAt});if(reward>0)item.reward=reward;const claim=claims[def.key];if(claim){item.claim=claim.status;if(claim.amount>0)item.claimAmount=claim.amount;}}
  if(item.state==='earned'){
   const held=census.holders[def.key];
   if(held&&census.members)item.share=Math.round(Math.min(held,census.members)/census.members*1000)/10;
  }
  return item;
 });
 if(crossed.length)await env.DB.batch(crossed.map(key=>env.DB.prepare("INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) VALUES (?,?,'metric-v1',?)").bind(member,key,now)));
 const active=items.filter(b=>b.state==='earned').map(b=>b.key);
 const apOf=(list:CollectedBadge[])=>list.filter(b=>b.state==='earned').reduce((sum,b)=>sum+(b.ap??0)*Math.max(1,b.count??1),0);
 const chosen:string[]=prefs?.featured_badges===null||prefs?.featured_badges===undefined?items.filter(b=>b.state==='earned'&&b.category!=='spend').map(b=>b.key).slice(0,FEATURED_LIMIT):JSON.parse(prefs.featured_badges);
 const featured=chosen.filter(key=>active.includes(key)).slice(0,FEATURED_LIMIT);
 const authorRank=await authorRankOf(env,member).catch(()=>null);
 if(publicOnly){items=items.filter(b=>b.state==='earned'&&(b.category!=='spend'||featured.includes(b.key)));const ap=apOf(items);return {items,featured,ap,level:levelOf(ap),authorRank};}
 const ap=apOf(items);
 return {items,featured,public:!!prefs?.public_badges,ap,level:levelOf(ap),authorRank};
}
export async function setFeaturedBadges(env:Env,member:string,input:unknown,visibility?:unknown) {
 if(visibility!==undefined&&typeof visibility!=="boolean")throw new HttpError(400,"community_input");
 if(!Array.isArray(input)||input.length>FEATURED_LIMIT||new Set(input).size!==input.length||input.some(x=>typeof x!=='string'))throw new HttpError(400,'community_badge_selection');
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
 const r=await env.DB.prepare("INSERT OR IGNORE INTO community_badge_definitions(key,icon,category,titles,descriptions,created_at) SELECT ?,?,'event',?,?,? WHERE (SELECT COUNT(*) FROM community_badge_definitions)<200").bind(key,b.icon,titles,descriptions,Date.now()).run();
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
export async function badgeManagement(env:Env,actor:string){await requireManager(env,actor);return {definitions:(await definitions(env)).filter(d=>d.category==='event').map(({metric:_m,threshold:_t,...d})=>d),audit:(await env.DB.prepare('SELECT a.request_id AS id,m.handle,a.badge,a.action,a.reason,a.created_at AS at FROM community_badge_audit a JOIN members m ON m.id=a.member_id ORDER BY a.created_at DESC LIMIT 50').all()).results};}
