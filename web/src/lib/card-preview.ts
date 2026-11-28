import { readonly, shallowRef } from "vue";
import type { CardQualityDetail } from "../../../shared/card-quality";
import { fetchCardQuality } from "./api";
import type { CommunityCard } from "./types";

/*
 * 卡片預覽（封面右下角的鈕打開）：整個站只有一個預覽，掛在 App 層；任何清單裡的磚都能打開它。
 * 磚把卡片、按下的那顆鈕（關掉後焦點回這裡、桌機浮層貼著它的磚）、封面是否還遮著交進來。
 */
export interface CardPreviewTarget {
  card: CommunityCard;
  opener: HTMLElement;
  /** 磚上的敏感封面還沒點「顯示」：預覽頭部的縮圖也模糊 */
  concealed: boolean;
}

const target = shallowRef<CardPreviewTarget | null>(null);
export const cardPreview = readonly(target);
export function openCardPreview(next: CardPreviewTarget): void { target.value = next; }
export function closeCardPreview(): void { target.value = null; }

/*
 * 數據每張卡記一分鐘：同一張卡關掉再開、或從預覽進卡片頁，不用再等一次。
 * 失敗的不記，重試才會真的重打。
 */
const TTL = 60_000;
const cache = new Map<string, { at: number; value: Promise<CardQualityDetail> }>();
export function loadCardQuality(id: string): Promise<CardQualityDetail> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = fetchCardQuality(id);
  cache.set(id, { at: Date.now(), value });
  value.catch(() => { if (cache.get(id)?.value === value) cache.delete(id); });
  return value;
}
