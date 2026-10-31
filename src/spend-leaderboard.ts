import {Hono,type Context} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import type {CardRow} from './cards';
import {cardLink,linkPreview} from './card-link';
import {readOwnCardView} from './card-owner-view';
import {privatePlayerCard} from './private-player';
import {registerLegacyShare} from './work-share-registration';
import {bearerOf} from './staff';
import {currentCardAccess} from './work-read';
import {requireMember,viewerAllowsNsfw,providerOf,type Member} from './members';
import {type Env,HttpError} from './types';
import {apiBaseOf} from './providers';
import {hostingKey} from './hosting';
import {bumpOp} from './ops-metrics';
import {effectiveAnonymous,projectPlayer,readPrivacy,readPrivacyOperation,savePrivacy,type PrivacyRequest} from './leaderboard-privacy';

type Ctx=Context<{Bindings:Env}>;
type RawPlayer={accountNumId:number;credits:string;rank:number};
type RawBoard={list:RawPlayer[];self:RawPlayer|null;total:number;updatedAt?:string;authorCredits?:string};
export const spendGateway={
 async read(env:Env,input:{roleId:string;limit:number;offset:number},token?:string):Promise<RawBoard>{
  const key=hostingKey(env,'harbor');if(!key)throw new HttpError(503,'leaderboard_unavailable');
  const res=await fetch(`${apiBaseOf(env,'harbor')}/open/v1/hosting/spend-leaderboard`,{method:'POST',headers:{'Content-Type':'application/json','X-Hosting-Key':key,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(input),redirect:'manual',signal:AbortSignal.timeout(7000)});
  if(!res.ok)throw new HttpError(res.status===404?404:503,'leaderboard_unavailable');
  const body=await res.json() as RawBoard;
  const valid=(p:RawPlayer)=>p&&Number.isSafeInteger(p.accountNumId)&&p.accountNumId>0&&Number.isSafeInteger(p.rank)&&p.rank>0&&typeof p.credits==='string'&&/^[1-9]\d*$/.test(p.credits);
  if(!Array.isArray(body.list)||body.list.length>input.limit||!body.list.every(valid)||body.self!==null&&!valid(body.self)||!Number.isSafeInteger(body.total)||body.total<0||body.updatedAt!==undefined&&!Number.isFinite(Date.parse(body.updatedAt))||body.authorCredits!==undefined&&(typeof body.authorCredits!=='string'||!/^(0|[1-9]\d*)$/.test(body.authorCredits)))throw new HttpError(503,'leaderboard_unavailable');
  return body;
 }
};

type RankCard=Pick<CardRow,'id'|'provider'|'source_role_id'|'author_num_id'> & {rankRoleId:string};
async function visibleCard(c:Ctx,id:string):Promise<RankCard>{
 c.header('Cache-Control','private, no-store');
 const link=await cardLink(c.env,id,providerOf(c));let row=link.row;
 const source=link.source?.roleId??id;
 if(!row&&c.env.WORK_SHARING_ENABLED==='true'&&providerOf(c)==='harbor'){
  row=await registerLegacyShare(c.env,source,()=>viewerAllowsNsfw(c,{card:true}));
  if(!row){
   const own=await readOwnCardView(c.env,source,null,'en',bearerOf(c),providerOf(c));
   if(!own||own.provider!=='harbor')throw new HttpError(404,'card not found');
   return {id:own.id,provider:'harbor',source_role_id:source,author_num_id:own.author.accountNumId,rankRoleId:own.roleId};
  }
 }
 if(row){
  if(row.provider!=='harbor'||row.public_blocked)throw new HttpError(404,'card not found');
  const access=await currentCardAccess(c.env,row,'aggregate');
  if(access.reachable){
   if((row.rating==='R'||access.access==='unlisted')&&!await viewerAllowsNsfw(c,{card:true}))throw new HttpError(403,'adult_content');
   return {...row,rankRoleId:access.shareRoleId||row.approved_hosted_role_id||row.source_role_id};
  }

  // Legacy review status is a discovery state, not a link-access denial.
  // Managed private/suspended works keep the stricter branches below.
  if(!access.managed&&row.status!=='unlisted'){
   if(row.rating==='R'&&!await viewerAllowsNsfw(c,{card:true}))throw new HttpError(403,'adult_content');
   const preview=await linkPreview(c.env,id,link,'en');
   if(preview)return {...row,rankRoleId:preview.roleId};
  }
  const own=await readOwnCardView(c.env,source,row,'en',bearerOf(c),providerOf(c));
  if(own)return {...row,rankRoleId:row.source_role_id};
  if(access.access==='private'){
   const played=await privatePlayerCard(c.env,row,bearerOf(c),'en','detail',()=>viewerAllowsNsfw(c,{card:true}));
   if(played)return {...row,rankRoleId:played.roleId};
  }
  throw new HttpError(404,'card not found');
 }
 const preview=await linkPreview(c.env,id,link,'en')??await readOwnCardView(c.env,source,null,'en',bearerOf(c),providerOf(c));
 if(!preview||preview.provider!=='harbor')throw new HttpError(404,'card not found');
 return {id:preview.id,provider:'harbor',source_role_id:source,author_num_id:preview.author.accountNumId,rankRoleId:preview.roleId};
}

const keyOf=(row:RankCard)=>`${row.provider}:${row.source_role_id}`;
async function optionalViewer(c:Ctx):Promise<Member|null>{return c.req.header('Authorization')?requireMember(c):null;}

// Every public identity projection and preference read uses the primary D1
// session (d1-session.ts); these responses never enter shared HTTP caches.
export const spendLeaderboardRoutes=new Hono<{Bindings:Env}>();
spendLeaderboardRoutes.get('/v1/cards/:id/leaderboard',async c=>{
 c.header('Cache-Control','private, no-store');
 try{
  const card=await visibleCard(c,c.req.param('id')),viewer=await optionalViewer(c);
  const offset=Number(c.req.query('offset')??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new HttpError(400,'invalid_request');
  const raw=await spendGateway.read(c.env,{roleId:card.rankRoleId,limit:10,offset},bearerOf(c));
  const ids=[...new Set([...raw.list,...(raw.self?[raw.self]:[])].map(r=>String(r.accountNumId)))];
  type Profile={public_no:string;handle:string;display_name:string|null;avatar_url:string|null;account_class:string;anonymous:number|null;overrides:string|null;fenced:number};
  const rows=ids.length?(await c.env.DB.prepare(`SELECT j.value AS public_no,m.handle,m.display_name,m.avatar_url,m.account_class,p.anonymous,p.overrides,EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id) AS fenced
   FROM json_each(?) j LEFT JOIN member_identities i ON i.provider='harbor' AND i.external_id=j.value
   LEFT JOIN member_connections x ON x.provider='harbor' AND x.external_id=j.value
   LEFT JOIN members m ON m.id=coalesce(x.owner_member_id,i.member_id)
   LEFT JOIN leaderboard_privacy p ON p.member_id=m.id`).bind(JSON.stringify(ids)).all<Profile>()).results:[];
  const profiles=new Map(rows.map(r=>[r.public_no,r]));
  const project=(r:RawPlayer)=>{
   const p=profiles.get(String(r.accountNumId));
   if(p?.account_class==='test'||p?.fenced)throw new HttpError(503,'leaderboard_unavailable');
   const anonymous=!p?.handle||effectiveAnonymous({anonymous:!!p.anonymous,mode:p.overrides?JSON.parse(p.overrides)[keyOf(card)]??'inherit':'inherit',revision:0});
   return projectPlayer({...r,nickname:p?.display_name||p?.handle||'',avatarUrl:p?.avatar_url||'',handle:p?.handle,isSelf:r.accountNumId===viewer?.externalId},anonymous);
  };
  const selfState=!viewer?'guest':viewer.accountClass==='test'?'test':viewer.externalId===card.author_num_id?'author':raw.self?'ranked':'unranked';
  const result={list:raw.list.map(project),self:raw.self?project(raw.self):null,total:raw.total,offset,nextOffset:offset+raw.list.length<raw.total?offset+raw.list.length:null,selfState,...(raw.updatedAt?{updatedAt:raw.updatedAt}:{}),
   // The author's own spend is never ranked and is shown only to the author.
   ...(selfState==='author'&&raw.authorCredits!==undefined?{authorCredits:raw.authorCredits}:{}),...(viewer?{privacy:await readPrivacy(c.env.DB,viewer.id,keyOf(card))}:{})};
  await bumpOp(c.env.DB,'spend_leaderboard','read','success');
  return c.json(result);
 }catch(e){await bumpOp(c.env.DB,'spend_leaderboard','read','error');throw e;}
});

spendLeaderboardRoutes.get('/v1/me/leaderboard-privacy',async c=>{
 c.header('Cache-Control','private, no-store');const member=await requireMember(c),cardId=c.req.query('cardId');
 const card=cardId?await visibleCard(c,cardId):null;
 return c.json(await readPrivacy(c.env.DB,member.id,card?keyOf(card):undefined));
});
spendLeaderboardRoutes.get('/v1/me/leaderboard-privacy/operations/:requestId',async c=>{
 c.header('Cache-Control','private, no-store');const member=await requireMember(c);
 return c.json(await readPrivacyOperation(c.env.DB,member.id,c.req.param('requestId')));
});
spendLeaderboardRoutes.put('/v1/me/leaderboard-privacy',bodyLimit({maxSize:4096}),async c=>{
 c.header('Cache-Control','private, no-store');
 const member=await requireMember(c),body=await c.req.json<PrivacyRequest&{cardId?:string}>();
 if(body.cardKey!==undefined)throw new HttpError(400,'invalid_request');
 const card=body.cardId?await visibleCard(c,body.cardId):null;
 try{
  const result=await savePrivacy(c.env.DB,member.id,{requestId:body.requestId,revision:body.revision,anonymous:body.anonymous,mode:body.mode,confirmed:body.confirmed,...(card?{cardKey:keyOf(card)}:{})});
  await bumpOp(c.env.DB,'spend_leaderboard','save','success');return c.json(result);
 }catch(e){await bumpOp(c.env.DB,'spend_leaderboard','save',e instanceof HttpError&&e.status===409?'conflict':'error');throw e;}
});
