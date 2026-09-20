import { currentProvider } from './provider';
import { ApiError } from './api';
import { i18n } from './i18n';
export interface ModerationCase {id:string;cardNumber:number;title:string;action:string;reason:string;status:string;createdAt:number;decidedAt:number|null;version:string;resolution?:string;canVote:boolean;canResolve:boolean;votes:{vote:string;reason:string;at:number}[]}
export interface ManagedCard {id:string;name:string;tags:string[];status:string;boardHidden:boolean;publicBlocked:boolean;version:string}
export interface CardHistory {card:ManagedCard;cases:ModerationCase[];reviews:{id:string;kind:string;status:string;note:string;submittedAt:number;version:string}[];events:{action:string;reason:string;beforeValue:string;afterValue:string;at:number}[]}
export async function moderationRequest<T>(path:string,token:string,body?:unknown):Promise<T>{
 const res=await fetch(`/v1/moderation${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'X-Provider':currentProvider(),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await res.json().catch(()=>({})) as {error?:string};
 if(!res.ok){const code=data.error??'';const key=`moderation.error.${code}`;throw new ApiError(res.status,i18n.global.te(key)?i18n.global.t(key):i18n.global.t(res.status===403?'state.forbidden':res.status===401?'auth.expired':'moderation.error.retry'),code);}
 return data as T;
}
