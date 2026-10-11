import { shallowRef } from "vue";
/**
 * 舞台第一次畫出內容的次數（stageHost.ui.contentReady 每次進對話頁叫一次）。
 * 舞台每份文件只裝一次、回呼在裝的時候就綁死，所以用一個累加的數字：對話頁每次開始載入時記下現值，
 * 數字變大就是這一次的舞台畫好了，可以收掉載入畫面。
 */
export const stageContentSeq = shallowRef(0);
export function markStageContentReady(): void { stageContentSeq.value++; }
