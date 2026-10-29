import {HttpError} from './types';

export type PrivacyMode='inherit'|'anonymous'|'public';
export interface Privacy {anonymous:boolean;mode:PrivacyMode;revision:number}
export interface PrivacyRequest {requestId:string;revision:number;anonymous:boolean;cardKey?:string;mode?:PrivacyMode;confirmed?:boolean}
type Row={anonymous:number;overrides:string;revision:number};
export const effectiveAnonymous=(p:Privacy)=>p.mode==='anonymous'||p.mode==='inherit'&&p.anonymous;
const view=(row:Row|null,cardKey?:string):Privacy=>({anonymous:!!row?.anonymous,revision:row?.revision??0,mode:cardKey&&row?JSON.parse(row.overrides)[cardKey]??'inherit':'inherit'});

export async function readPrivacy(db:D1Database,member:string,cardKey?:string):Promise<Privacy>{
 return view(await db.prepare('SELECT anonymous,overrides,revision FROM leaderboard_privacy WHERE member_id=?').bind(member).first<Row>(),cardKey);
}
async function receipt(db:D1Database,member:string,id:string){
 return db.prepare('SELECT request_hash,result FROM leaderboard_privacy_operations WHERE member_id=? AND request_id=?').bind(member,id).first<{request_hash:string;result:string}>();
}
export async function readPrivacyOperation(db:D1Database,member:string,id:string):Promise<Privacy>{
 const row=await receipt(db,member,id);
 if(!row)throw new HttpError(404,'privacy_operation_not_found');
 return JSON.parse(row.result);
}
export async function savePrivacy(db:D1Database,member:string,input:PrivacyRequest):Promise<Privacy>{
 if(!/^[0-9a-f-]{36}$/i.test(input.requestId)||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.anonymous!=='boolean'
  ||input.cardKey!==undefined&&(typeof input.cardKey!=='string'||input.cardKey.length>200||!['inherit','anonymous','public'].includes(input.mode??'')))throw new HttpError(400,'invalid_request');
 const hash=JSON.stringify([input.revision,input.anonymous,input.cardKey??null,input.mode??null,!!input.confirmed]);
 const replay=async()=>{const row=await receipt(db,member,input.requestId);if(!row)return null;if(row.request_hash!==hash)throw new HttpError(409,'privacy_request_conflict');return JSON.parse(row.result) as Privacy;};
 const prior=await replay();if(prior)return prior;
 await db.prepare('INSERT OR IGNORE INTO leaderboard_privacy(member_id) VALUES(?)').bind(member).run();
 const old=(await db.prepare('SELECT anonymous,overrides,revision FROM leaderboard_privacy WHERE member_id=?').bind(member).first<Row>())!;
 if(old.revision!==input.revision){const again=await replay();if(again)return again;throw new HttpError(409,'privacy_conflict');}
 const before=view(old,input.cardKey),overrides=JSON.parse(old.overrides) as Record<string,PrivacyMode>;
 if(input.cardKey){if(input.mode==='inherit')delete overrides[input.cardKey];else overrides[input.cardKey]=input.mode!;}
 const next:Privacy={anonymous:input.anonymous,mode:input.cardKey?overrides[input.cardKey]??'inherit':'inherit',revision:old.revision+1};
 if((before.anonymous&&!next.anonymous||input.cardKey&&effectiveAnonymous(before)&&!effectiveAnonymous(next))&&!input.confirmed)throw new HttpError(409,'privacy_confirmation_required');
 try{
  const changed=await db.prepare('UPDATE leaderboard_privacy SET anonymous=?,overrides=?,revision=?,request_id=?,request_hash=?,result=? WHERE member_id=? AND revision=?')
   .bind(Number(input.anonymous),JSON.stringify(overrides),next.revision,input.requestId,hash,JSON.stringify(next),member,input.revision).run();
  if(changed.meta.changes===1)return next;
 }catch(e){const again=await replay();if(again)return again;throw e;}
 const again=await replay();if(again)return again;
 throw new HttpError(409,'privacy_conflict');
}

export interface NamedPlayer {rank:number;credits:string;accountNumId:number;nickname:string;avatarUrl:string;handle?:string;isSelf:boolean}
// Explicit allowlists prevent new upstream identity fields from escaping anonymity.
export function projectPlayer(row:NamedPlayer,anonymous:boolean){
 const base={rank:row.rank,credits:row.credits,anonymous,isSelf:row.isSelf};
 return anonymous?base:{...base,accountNumId:row.accountNumId,nickname:row.nickname,avatarUrl:row.avatarUrl,...(row.handle?{handle:row.handle}:{})};
}
