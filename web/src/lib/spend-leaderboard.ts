import {currentProvider} from './provider';
export type PrivacyMode='inherit'|'anonymous'|'public';
export interface BoardPrivacy {anonymous:boolean;mode:PrivacyMode;revision:number}
export interface SpendPlayer {rank:number;credits:string;anonymous:boolean;isSelf:boolean;accountNumId?:number;nickname?:string;avatarUrl?:string;handle?:string}
export interface SpendBoard {list:SpendPlayer[];self:SpendPlayer|null;total:number;offset:number;nextOffset:number|null;selfState:'guest'|'author'|'test'|'ranked'|'unranked';updatedAt?:string;privacy?:BoardPrivacy}
export interface PrivacySave {requestId:string;revision:number;anonymous:boolean;mode?:PrivacyMode;cardId?:string;confirmed?:boolean}
export class BoardError extends Error {constructor(readonly status:number,readonly code:string){super(code)}}
async function request<T>(path:string,token?:string,body?:PrivacySave):Promise<T>{
 const res=await fetch('/v1/'+path,{method:body?'PUT':'GET',headers:{'X-Provider':currentProvider(),...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
 const out=await res.json();if(!res.ok)throw new BoardError(res.status,out.error??'unavailable');return out as T;
}
export async function fetchSpendBoard(id:string,token?:string,offset=0):Promise<SpendBoard>{
 const out=await request<SpendBoard>(`cards/${encodeURIComponent(id)}/leaderboard?offset=${offset}`,token);
 const player=(p:SpendPlayer)=>p&&Number.isSafeInteger(p.rank)&&p.rank>0&&typeof p.credits==='string'&&/^[1-9]\d*$/.test(p.credits)&&typeof p.anonymous==='boolean'&&typeof p.isSelf==='boolean'&&(p.anonymous||typeof p.nickname==='string'&&typeof p.avatarUrl==='string');
 if(!out||!Array.isArray(out.list)||!out.list.every(player)||out.self!==null&&!player(out.self)||!Number.isSafeInteger(out.total)||out.total<0||!Number.isSafeInteger(out.offset)||out.offset<0||out.nextOffset!==null&&(!Number.isSafeInteger(out.nextOffset)||out.nextOffset<=out.offset)||!['guest','author','test','ranked','unranked'].includes(out.selfState)||out.updatedAt!==undefined&&!Number.isFinite(Date.parse(out.updatedAt)))throw new BoardError(502,'leaderboard_invalid_response');
 return out;
}
export const fetchBoardPrivacy=(token:string,cardId?:string)=>request<BoardPrivacy>(`me/leaderboard-privacy${cardId?'?cardId='+encodeURIComponent(cardId):''}`,token);
export const saveBoardPrivacy=(token:string,input:PrivacySave)=>request<BoardPrivacy>('me/leaderboard-privacy',token,input);
export const fetchPrivacyOperation=(token:string,id:string)=>request<BoardPrivacy>('me/leaderboard-privacy/operations/'+encodeURIComponent(id),token);
export const isAnonymous=(p:BoardPrivacy)=>p.mode==='anonymous'||p.mode==='inherit'&&p.anonymous;
export function revealScope(before:BoardPrivacy,after:BoardPrivacy,hasCard=true):'revealCard'|'revealGlobal'|'revealBoth'|null {
 const global=before.anonymous&&!after.anonymous,card=hasCard&&isAnonymous(before)&&!isAnonymous(after);
 return global?card?'revealBoth':'revealGlobal':card?'revealCard':null;
}
export function formatCredits(value:string,locale:string):string{return new Intl.NumberFormat(locale).format(BigInt(value))}
