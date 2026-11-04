import {reviewLength} from '../../../shared/review-count';
import {reviewLengthStatus, type ReviewLength} from '../../../shared/review-length';
import type {WorldbookEntryDraft} from './role-draft';

/*
 * 編輯器裡的送審字數：角色設定＋卡綁的那本世界書條目，交給送審檢查用的同一份 reviewLength。
 * 角色的私有書不綁卡、送審不讀，這裡也不收。
 * 只給編輯器匯入：計數帶著 markdown-it，放進 review-length.ts 會被 api.ts 拉進每一頁的主包。
 * 兩半分開算：打字時只有角色設定在變，世界書那一半（可能上萬字）不必每個按鍵重算。
 * 瀏覽器沒有 Intl.Segmenter 時算不出來，回 null，編輯器就不顯示這一塊（存檔與送審不受影響）。
 */
const safely=(count:()=>number):number|null=>{
  try{return count();}catch{return null;}
};
export const personaReviewCount=(roleDetailDesc:string)=>safely(()=>reviewLength({document:{roleDetailDesc}}).persona);
export const constantReviewCount=(entries:readonly WorldbookEntryDraft[])=>safely(()=>reviewLength({worldbooks:[{entries}]}).constantWorldbook);

export function combineReviewLength(persona:number|null,constantWorldbook:number|null):ReviewLength|null{
  if(persona===null||constantWorldbook===null)return null;
  return {persona,constantWorldbook,...reviewLengthStatus(persona+constantWorldbook),welcome:0};
}

export function draftReviewLength(roleDetailDesc:string,entries:readonly WorldbookEntryDraft[]):ReviewLength|null{
  return combineReviewLength(personaReviewCount(roleDetailDesc),constantReviewCount(entries));
}
