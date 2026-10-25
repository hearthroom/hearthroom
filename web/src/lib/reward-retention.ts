import {i18n} from './i18n';
export interface RewardRetention {publicUntil:string;days:number;recoveryCredits:number}
export function retentionParams(value:RewardRetention,available?:number,shortfall?:number){
 const locale=i18n.global.locale.value as string;
 const amount=(n:number)=>{const number=new Intl.NumberFormat(locale).format(n);return locale==='en'?`${number} ${n===1?'credit':'credits'}`:number;};
 return {days:new Intl.NumberFormat(locale).format(value.days),unlockAt:new Intl.DateTimeFormat(locale,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(value.publicUntil)),points:amount(value.recoveryCredits),...(available===undefined?{}:{available:amount(available)}),...(shortfall===undefined?{}:{shortfall:amount(shortfall)})};
}
export function retentionText(key:string,value:RewardRetention){return i18n.global.t(`rewardRetention.${key}${(i18n.global.locale.value as string)==='en'&&value.days===1&&['lock.reason','rules.public'].includes(key)?'.one':''}`,retentionParams(value));}

export function retentionRules(days:number){return i18n.global.t(`rewardRetention.rules.public${(i18n.global.locale.value as string)==='en'&&days===1?'.one':''}`,{days:new Intl.NumberFormat(i18n.global.locale.value).format(days)});}
