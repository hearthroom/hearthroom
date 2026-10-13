import { ref, watch } from "vue";

/** 桌寵開關：存在這台瀏覽器（設定頁可以再打開）。關掉後整個模組都不載入。 */
const KEY = "suki.pet.off";
function read(): boolean {
  try { return localStorage.getItem(KEY) !== "1"; } catch { return true; }
}
export const petEnabled = ref(read());
watch(petEnabled, (on) => {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, "1"); } catch { /* 存不了：這次有效 */ }
});
