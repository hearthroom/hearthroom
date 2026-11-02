/**
 * 成員自選的「國家／地區」（伺服器 src/country-region.ts 存在成員上）。
 *
 * 選中國大陸時伺服器一律不回限制級卡，直接開卡片、分享連結、舊聊天回 403 region_unavailable；
 * 前端跟著把成人內容的入口（頁首 R18、設定頁開關、新手導覽 R18 那一步）收起來（owner 2026-11-03）。
 * 遊客沒有地區，照舊。
 */
export const REGION_GROUPS = [
  { key: "chinese", regions: ["HK", "MO", "TW", "SG", "MY", "CN"] },
  { key: "other", regions: ["JP", "KR", "US", "OTHER"] },
] as const;
export type CountryRegion = (typeof REGION_GROUPS)[number]["regions"][number];

/** 這個地區不提供限制級內容。 */
export function adultUnavailable(profile: { countryRegion?: string } | null | undefined): boolean {
  return profile?.countryRegion === "CN";
}

/** 伺服器拒絕的原因是地區（卡片頁、遊玩頁畫「暫不提供」那一頁，不畫成人內容的門、不掛舞台）。 */
export function isRegionUnavailable(err: unknown): boolean {
  const { status, code } = (err ?? {}) as { status?: number; code?: string };
  return status === 403 && code === "region_unavailable";
}
