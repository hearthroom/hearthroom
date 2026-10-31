/**
 * 預設分享（P2）共用的小工具：模型目錄（系列／模型兩層）整頁共用一份、判斷「新公開」。
 */
import { shallowRef } from "vue";
import { fetchModelCatalog, presetModelValue, type ModelCatalogGroup, type PresetLibraryItem } from "@/lib/presets";

const catalog = shallowRef<ModelCatalogGroup[]>([]);
let pending: Promise<void> | null = null;

/**
 * 公開分頁的篩選與公開彈層都要用目錄，整頁共用一份，不各抓一次。抓不到就是空清單：
 * 列表與詳情顯示模型名用 `modelValueLabel`，不靠目錄；下次再呼叫會重抓。
 */
export function useModelCatalog(token: () => Promise<string>) {
  if (!catalog.value.length && !pending) {
    pending = token().then(fetchModelCatalog).then((list) => { catalog.value = list; }).catch(() => {}).finally(() => { pending = null; });
  }
  return catalog;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
/** 近 7 天沒人用，而且公開還不到 7 天：顯示「新公開」，不寫成「0 人使用」。已不公開的不算。 */
export function isNew(item: Pick<PresetLibraryItem, "usesLast7d" | "publishedAt"> & { listed?: boolean }, now = Date.now()): boolean {
  if (item.listed === false || item.usesLast7d > 0 || !item.publishedAt) return false;
  const at = Date.parse(item.publishedAt);
  return Number.isFinite(at) && now - at < WEEK_MS;
}

/** 作者沒設暱稱時用公開編號，不留白。 */
export const authorLabel = (item: Pick<PresetLibraryItem, "authorName" | "authorNumId">) => item.authorName.trim() || `#${item.authorNumId}`;

export function presetPurpose(item: Pick<PresetLibraryItem, "purpose" | "recommendedModels">): "general" | "specific" {
  return item.purpose || (item.recommendedModels.length ? "specific" : "general");
}

export function presetModelMatches(models: string[], selected: string, groups: ModelCatalogGroup[]): boolean {
  if (!selected || selected === "all" || selected === "general") return false;
  selected = presetModelValue(selected);
  const family = (value: string) => value.startsWith("model:") ? value.slice(6) : value;
  const series = (value: string) => value.startsWith("series:") ? value.slice(7) : groups.find(g => g.families.includes(family(value)))?.group;
  return models.map(presetModelValue).some(m => m === selected || ((m.startsWith("series:") || selected.startsWith("series:")) && !!series(m) && series(m) === series(selected)));
}
