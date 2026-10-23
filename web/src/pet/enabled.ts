import { ref, watch } from "vue";
import { suki } from "./events";

/** 桌寵開關：存在這台瀏覽器（設定頁可以再打開）。關掉後整個模組都不載入。 */
const KEY = "suki.pet.off";
function read(): boolean {
  try { return localStorage.getItem(KEY) !== "1"; } catch { return true; }
}
export const petEnabled = ref(read());
watch(petEnabled, (on) => {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, "1"); } catch { /* 存不了：這次有效 */ }
});

/**
 * 設定頁的「叫她出來」：找不到她、她卡住時的脫離工具（任務 2026-10-23 曲面屏）。
 * 清掉存的位置；她被關掉的話先開回來，等她載入好再叫她（summonOnStart）。
 */
let summonOnStart = false;
export function summonPet() {
  try { localStorage.removeItem("suki.pet.pos"); } catch { /* 存不了：她本來就在預設位置 */ }
  if (!petEnabled.value) { summonOnStart = true; petEnabled.value = true; return; }
  suki({ type: "summon" });
}
/** 桌寵載入好時問一次：剛才是不是被「叫她出來」開起來的 */
export function takeSummon() { const v = summonOnStart; summonOnStart = false; return v; }
