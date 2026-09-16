/**
 * 舊的入口，只做轉接：供應商的真相在 lib/provider.ts（代號、顯示名、API 位址、能力）。
 * 卡片與作者頁靠 providerName 把資料裡的代號翻成人看的名字，路徑保持不變。
 */
export { PROVIDERS, providerName, type ProviderId } from "./provider";
