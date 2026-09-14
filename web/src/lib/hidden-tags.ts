/**
 * 「不想看的類型」在畫面這邊的兩件小事（owner 2026-09-14）。
 *
 * 名單存在成員上（設定頁勾的目錄鍵），榜單與搜尋拿清單時把它帶上去，由伺服器過濾——
 * 畫面上事後挑掉會讓每頁數量忽多忽少。這裡只管：類型列要少畫哪些籤、查詢字串怎麼組。
 */
import type { TagEntry } from "../../../shared/tag-catalog";

/**
 * 類型列要畫的籤：隱藏的不畫（那排只列你看得到的）；例外是網址上正點著的那個籤——
 * 分享來的連結點的就是它，籤要在，人才知道自己在看什麼、怎麼取消。
 */
export function visibleCatalog(catalog: TagEntry[], hidden: string[], activeTag: string): TagEntry[] {
  if (!hidden.length) return catalog;
  const set = new Set(hidden);
  return catalog.filter((x) => !set.has(x.key) || x.key === activeTag);
}

/** 查詢字串用的值：排序去重，同一組名單永遠同一串，邊緣快取才共用得到；空名單回空字串（不帶參數）。 */
export function hideParam(hidden: string[]): string {
  return [...new Set(hidden.filter(Boolean))].sort().join(",");
}
