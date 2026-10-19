/**
 * 主頁封面：只開放站內場景圖，不開放上傳（不用另做圖片審核）。
 *
 * hue 是那張圖的主色相：資料區往下淡出時用它調出同色系的淺色（白天）或深色（深色模式），
 * 不往白底淡出——深色夜景淡到白底，中間那段會是髒灰色（owner 2026-10-19）。
 * 存的是空字串 = 沒選過，畫面用預設那張。
 */
export const PROFILE_COVERS = [
  { id: "balcony-moon", hue: 262 },
  { id: "bookstore-night", hue: 24 },
  { id: "autumn-park", hue: 20 },
  { id: "sakura", hue: 350 },
  { id: "summer-beach", hue: 200 },
  { id: "rooftop-stars", hue: 250 },
  { id: "cafe-day", hue: 26 },
  { id: "snow-day", hue: 212 },
  { id: "riverbank-dusk", hue: 18 },
  { id: "window-night", hue: 246 },
] as const;

export type ProfileCoverId = (typeof PROFILE_COVERS)[number]["id"];
export const DEFAULT_PROFILE_COVER: ProfileCoverId = "balcony-moon";

export const isProfileCover = (value: unknown): value is ProfileCoverId =>
  typeof value === "string" && PROFILE_COVERS.some((c) => c.id === value);

/** 存的值認不得（舊資料或目錄改過）就退回預設，主頁不會沒有封面。 */
export function profileCover(id: string | null | undefined) {
  return PROFILE_COVERS.find((c) => c.id === id) ?? PROFILE_COVERS.find((c) => c.id === DEFAULT_PROFILE_COVER)!;
}

export const profileCoverUrl = (id: string | null | undefined) => `/mascot/home/scene-${profileCover(id).id}.webp`;
