/**
 * 站台身分。所有對外文案的名稱都從這裡取，改一處就換完整站。
 *
 * 這是個獨立的開源專案，透過公開 API 讀取角色卡資料，就像任何第三方客戶端一樣。
 * 名稱與文案因此都是自己的，不借用資料來源的品牌。
 */
export const SITE = {
  name: "人物誌",
  /** 瀏覽器分頁與分享卡片用。 */
  tagline: "角色卡榜單",
  description: "一個開源的角色卡社群：榜單、搜尋與作者主頁。",
  /** OAuth 授權頁上顯示給使用者的應用名稱。 */
  clientName: "人物誌 Personae",
  /**
   * 原始碼位置。留空時頁尾就不顯示這個連結——寧可不放，也不要指向一個會暴露
   * 從屬關係的組織帳號。等倉庫落到獨立位置再填。
   */
  repoUrl: "",
} as const;

export const pageTitle = (part?: string) =>
  part ? `${part} · ${SITE.name}` : `${SITE.name} · ${SITE.tagline}`;
