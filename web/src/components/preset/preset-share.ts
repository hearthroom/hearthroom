/**
 * 預設分享（P2）共用的小工具：模型代碼換成站上公開的模型名、判斷「新公開」。
 */
import { shallowRef } from "vue";
import { fetchModelOptions, type ModelOption, type PresetLibraryItem } from "@/lib/presets";

const options = shallowRef<ModelOption[]>([]);
let pending: Promise<void> | null = null;

/**
 * 模型目錄整頁共用一份，三個分頁與公開彈層不各抓一次。抓不到就顯示代碼本身：
 * 模型名只是標示，不該因為目錄讀不到就讓整列消失；下次再呼叫會重抓。
 */
export function useModelOptions(token: () => Promise<string>) {
  if (!options.value.length && !pending) {
    pending = token().then(fetchModelOptions).then((list) => { options.value = list; }).catch(() => {}).finally(() => { pending = null; });
  }
  return options;
}

export function modelLabel(code: string): string {
  return options.value.find((o) => o.value === code)?.label ?? code;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
/** 近 7 天沒人用，而且公開還不到 7 天：顯示「新公開」，不寫成「0 人使用」。 */
export function isNew(item: Pick<PresetLibraryItem, "usesLast7d" | "publishedAt">, now = Date.now()): boolean {
  if (item.usesLast7d > 0 || !item.publishedAt) return false;
  const at = Date.parse(item.publishedAt);
  return Number.isFinite(at) && now - at < WEEK_MS;
}

/** 作者沒設暱稱時用公開編號，不留白。 */
export const authorLabel = (item: Pick<PresetLibraryItem, "authorName" | "authorNumId">) => item.authorName.trim() || `#${item.authorNumId}`;
