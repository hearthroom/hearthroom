/**
 * 「新」標記可以掛的入口。
 *
 * 更新說明（updates/*.json）的 spotlight 欄位只能填這裡列出的鍵；建置時的驗證會擋掉不存在的鍵，
 * 免得說明寫了一個畫面上根本沒有掛的標記。要在新的入口掛標記：在這裡加一個鍵，再在那個入口放
 * <NewMark k="…" />。鍵本身不會出現在畫面上。
 */
export const SPOTLIGHT_KEYS = [
  "header.bell",
  "header.search",
  "menu.updates",
  "menu.resources",
  "mine.agent",
  "notifications.push",
] as const;

export type SpotlightKey = (typeof SPOTLIGHT_KEYS)[number];
