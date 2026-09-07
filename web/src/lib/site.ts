/* i18n-ignore：這個檔只留專有名詞。各語言都用同一個名字，不進翻譯檔。 */

/**
 * 站台身分。
 *
 * 這是個獨立的開源專案，透過公開 API 讀取角色卡資料，就像任何第三方客戶端一樣。
 * 名稱因此是自己的，不借用資料來源的品牌。
 *
 * Hearthroom：有壁爐的那間屋子。角色卡社群一向愛用「客棧、酒館」當比喻——來這裡不是
 * 為了看資料庫，是為了挑一個想坐下來聊的人。
 *
 * 標語與描述不在這裡——那些是使用者讀得到的文案，住在 locales/。
 */
export const SITE = {
  name: "Hearthroom",
  /** OAuth 授權頁上顯示給使用者的應用名稱。 */
  clientName: "Hearthroom",
  /** 原始碼位置。頁尾的 GitHub 連結與授權連結都從這裡長出來；留空就整個頁尾不顯示。 */
  repoUrl: "https://github.com/hearthroom/hearthroom",
  /** 授權條款名稱與檔案位置；條款本文就在倉庫裡。 */
  license: "AGPL-3.0",
} as const;
