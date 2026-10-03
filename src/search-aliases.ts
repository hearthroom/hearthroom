/**
 * 搜尋別名：同一個東西的不同叫法，查詢時展開成「任一命中」。
 *
 * 來源是搜尋埋點裡反覆出現、卻因為叫法不同而空手而回的詞（星鐵／崩鐵／星穹鐵道、SAO／刀劍神域）。
 * 只收「確定是同一個東西」的縮寫與譯名，不收泛稱——「刀劍」單獨一個詞不只指 SAO，不放。
 * 寫哪種字體都行，載入時會跟查詢字串一樣正規化（繁→簡、小寫、去標點）。
 */
export const ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["星穹鐵道", "崩壞星穹鐵道", "星鐵", "崩鐵", "honkai star rail", "star rail"],
  ["刀劍神域", "sao", "sword art online"],
  ["碧藍檔案", "蔚藍檔案", "blue archive"],
  ["原神", "genshin", "genshin impact"],
  ["絕區零", "zenless zone zero"],
  ["崩壞三", "崩壞3rd", "崩壞3", "honkai impact"],
];
